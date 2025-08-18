import * as mammoth from "mammoth";
import * as XLSX from "xlsx";
import {
  createChatbot,
  updateChatbot,
  getChatbotById,
  getChatbotBySlug,
  getChatbotsByUserId,
  removeContextItem,
} from "../../server/chatbot/chatbotModel.server";
import {
  activateChatbot,
  deactivateChatbot,
  setToDraftMode,
  markChatbotAsDeleted,
  getChatbotState,
} from "../../server/chatbot/chatbotStateManager.server";
import { validateChatbotCreationAccess } from "../../server/chatbot/chatbotAccess.server";
import { getChatbotBrandingConfigById } from "../../server/chatbot/brandingConfig.server";
import {
  getChatbotUsageStats,
  checkMonthlyUsageLimit,
} from "../../server/chatbot/usageTracking.server";
import {
  addFileContext,
  addUrlContext,
  addTextContext,
  addQuestionContext,
  updateQuestionContext,
  updateTextContext,
  getChatbotContexts,
} from "../../server/chatbot/contextManager.server";
import {
  createIntegration,
  getIntegrationsByChatbotId,
  updateIntegration,
  toggleIntegrationStatus,
  deleteIntegration,
} from "../../server/chatbot/integrationModel.server";
import {
  validateUserAIModelAccess,
  getUserPlanFeatures,
  DEFAULT_CHATBOT_CONFIG,
  generateRandomChatbotName,
} from "~/utils/chatbot.server";
import { getUserOrRedirect } from "server/getUserUtils.server";
import { db } from "~/utils/db.server";
import { generateFallbackModels, isAnthropicDirectModel } from "~/utils/aiModels";
import { 
  truncateConversationHistory, 
  createProviderManager, 
  buildEnrichedSystemPrompt, 
  estimateTokens 
} from "./api.v1.chatbot.server";

export async function loader({ request }: any) {
  return new Response(JSON.stringify({ message: "GET not implemented" }), {
    headers: { "Content-Type": "application/json" },
  });
}

export async function action({ request }: any) {
  try {
    const formData = await request.formData();
    const intent = formData.get("intent") as string;
    const user = await getUserOrRedirect(request);
    const userId = user.id;
    switch (intent) {
      case "create_chatbot": {
        // Usar nombre aleatorio si no se proporciona uno
        const name =
          (formData.get("name") as string) || generateRandomChatbotName();

        // Usar configuración por defecto para todos los campos opcionales
        const description =
          (formData.get("description") as string) ||
          DEFAULT_CHATBOT_CONFIG.description;
        const personality =
          (formData.get("personality") as string) ||
          DEFAULT_CHATBOT_CONFIG.personality;
        const welcomeMessage =
          (formData.get("welcomeMessage") as string) ||
          DEFAULT_CHATBOT_CONFIG.welcomeMessage;
        const aiModel =
          (formData.get("aiModel") as string) || DEFAULT_CHATBOT_CONFIG.aiModel;
        const primaryColor =
          (formData.get("primaryColor") as string) ||
          DEFAULT_CHATBOT_CONFIG.primaryColor;
        const theme =
          (formData.get("theme") as string) || DEFAULT_CHATBOT_CONFIG.theme;
        const temperature = formData.get("temperature")
          ? Number(formData.get("temperature"))
          : DEFAULT_CHATBOT_CONFIG.temperature;
        const instructions =
          (formData.get("instructions") as string) ||
          DEFAULT_CHATBOT_CONFIG.instructions;

        // Validate if user can create more chatbots (FREE users limited to 1 chatbot)
        const validation = await validateChatbotCreationAccess(user.id);
        if (!validation.canCreate) {
          return new Response(
            JSON.stringify({
              success: false,
              error: `Has alcanzado el límite de ${validation.maxAllowed} chatbot${validation.maxAllowed > 1 ? "s" : ""} para tu plan ${validation.plan.toLowerCase()}.`,
              currentCount: validation.currentOwnedCount,
              maxAllowed: validation.maxAllowed,
              isPro: validation.isPro,
              plan: validation.plan,
            }),
            { status: 402, headers: { "Content-Type": "application/json" } }
          );
        }

        // Validar modelo de IA si se especifica uno diferente al por defecto
        if (aiModel !== DEFAULT_CHATBOT_CONFIG.aiModel) {
          const modelAccess = await validateUserAIModelAccess(user.id);
          if (!modelAccess.availableModels.includes(aiModel)) {
            return new Response(
              JSON.stringify({
                error: `El modelo ${aiModel} no está disponible en tu plan actual.`,
                availableModels: modelAccess.availableModels,
              }),
              { status: 403, headers: { "Content-Type": "application/json" } }
            );
          }
        }

        const chatbot = await createChatbot({
          name,
          description,
          userId: user.id,
          personality,
          welcomeMessage,
          aiModel,
          primaryColor,
          theme,
          temperature,
          instructions,
        });

        return new Response(JSON.stringify({ success: true, chatbot }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      case "update_chatbot": {
        const chatbotId = formData.get("chatbotId") as string;
        if (!chatbotId) {
          return new Response(
            JSON.stringify({ error: "ID de chatbot no proporcionado" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }
        const chatbot = await getChatbotById(chatbotId);
        if (!chatbot) {
          return new Response(
            JSON.stringify({ error: "Chatbot no encontrado" }),
            { status: 404, headers: { "Content-Type": "application/json" } }
          );
        }
        if (chatbot.userId !== userId) {
          return new Response(
            JSON.stringify({
              error: "No tienes permiso para modificar este chatbot",
            }),
            { status: 403, headers: { "Content-Type": "application/json" } }
          );
        }
        const updateData: any = {};
        const name = formData.get("name") as string;
        if (name) updateData.name = name;
        const description = formData.get("description") as string;
        if (description) updateData.description = description;
        const personality = formData.get("personality") as string;
        if (personality) updateData.personality = personality;
        const welcomeMessage = formData.get("welcomeMessage") as string;
        if (welcomeMessage !== null && welcomeMessage !== undefined) {
          updateData.welcomeMessage = welcomeMessage;
        }
        const goodbyeMessage = formData.get("goodbyeMessage") as string;
        if (goodbyeMessage !== null && goodbyeMessage !== undefined) {
          updateData.goodbyeMessage = goodbyeMessage;
        }
        const aiModel = formData.get("aiModel") as string;
        if (aiModel) {
          const modelAccess = await validateUserAIModelAccess(user.id);
          if (!modelAccess.availableModels.includes(aiModel)) {
            return new Response(
              JSON.stringify({
                error: `El modelo ${aiModel} no está disponible en tu plan actual.`,
                availableModels: modelAccess.availableModels,
              }),
              { status: 403, headers: { "Content-Type": "application/json" } }
            );
          }
          updateData.aiModel = aiModel;
        }
        const primaryColor = formData.get("primaryColor") as string;
        if (primaryColor) updateData.primaryColor = primaryColor;
        const avatarUrl = formData.get("avatarUrl") as string;
        if (
          avatarUrl &&
          avatarUrl !== "null" &&
          avatarUrl !== "undefined" &&
          avatarUrl.trim() !== ""
        ) {
          updateData.avatarUrl = avatarUrl;
        }
        const theme = formData.get("theme") as string;
        if (theme) updateData.theme = theme;
        const temperature = formData.get("temperature");
        if (
          temperature !== null &&
          temperature !== undefined &&
          temperature !== ""
        ) {
          updateData.temperature = Number(temperature);
        }
        const instructions = formData.get("instructions") as string;
        if (instructions) updateData.instructions = instructions;
        const customInstructions = formData.get("customInstructions") as string;
        if (customInstructions !== null && customInstructions !== undefined) {
          updateData.customInstructions = customInstructions;
        }
        const isActive = formData.get("isActive");
        if (isActive !== null && isActive !== undefined && isActive !== "") {
          updateData.isActive = isActive === "true" || isActive === true;
        }
        const updatedChatbot = await updateChatbot(chatbotId, updateData);
        return new Response(
          JSON.stringify({ success: true, chatbot: updatedChatbot }),
          { headers: { "Content-Type": "application/json" } }
        );
      }
      case "get_chatbot": {
        const chatbotId = formData.get("chatbotId") as string;
        if (!chatbotId) {
          return new Response(
            JSON.stringify({ error: "ID de chatbot no proporcionado" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }
        const chatbot = await getChatbotById(chatbotId);
        if (!chatbot) {
          return new Response(
            JSON.stringify({ error: "Chatbot no encontrado" }),
            { status: 404, headers: { "Content-Type": "application/json" } }
          );
        }
        if (chatbot.userId !== userId && !chatbot.isActive) {
          return new Response(
            JSON.stringify({
              error: "No tienes permiso para ver este chatbot",
            }),
            { status: 403, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response(JSON.stringify({ success: true, chatbot }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      case "get_chatbot_by_slug": {
        const slug = formData.get("slug") as string;
        if (!slug) {
          return new Response(
            JSON.stringify({ error: "Slug de chatbot no proporcionado" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }
        const chatbot = await getChatbotBySlug(slug);
        if (!chatbot) {
          return new Response(
            JSON.stringify({ error: "Chatbot no encontrado" }),
            { status: 404, headers: { "Content-Type": "application/json" } }
          );
        }
        if (chatbot.userId !== userId && !chatbot.isActive) {
          return new Response(
            JSON.stringify({
              error: "Este chatbot no está disponible actualmente",
            }),
            { status: 403, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response(JSON.stringify({ success: true, chatbot }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      case "get_user_chatbots": {
        const chatbots = await getChatbotsByUserId(userId);
        return new Response(JSON.stringify({ success: true, chatbots }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      case "delete_chatbot": {
        const chatbotId = formData.get("chatbotId") as string;
        if (!chatbotId) {
          return new Response(
            JSON.stringify({ error: "ID de chatbot no proporcionado" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }
        const chatbot = await getChatbotById(chatbotId);
        if (!chatbot) {
          return new Response(
            JSON.stringify({ error: "Chatbot no encontrado" }),
            { status: 404, headers: { "Content-Type": "application/json" } }
          );
        }
        if (chatbot.userId !== user.id) {
          return new Response(
            JSON.stringify({
              error: "No tienes permiso para eliminar este chatbot",
            }),
            { status: 403, headers: { "Content-Type": "application/json" } }
          );
        }
        const deletedChatbot = await markChatbotAsDeleted(chatbotId);
        return new Response(
          JSON.stringify({ success: true, chatbot: deletedChatbot }),
          { headers: { "Content-Type": "application/json" } }
        );
      }
      case "activate_chatbot": {
        const chatbotId = formData.get("chatbotId") as string;
        if (!chatbotId) {
          return new Response(
            JSON.stringify({ error: "ID de chatbot no proporcionado" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }
        const chatbot = await getChatbotById(chatbotId);
        if (!chatbot) {
          return new Response(
            JSON.stringify({ error: "Chatbot no encontrado" }),
            { status: 404, headers: { "Content-Type": "application/json" } }
          );
        }
        if (chatbot.userId !== userId) {
          return new Response(
            JSON.stringify({
              error: "No tienes permiso para modificar este chatbot",
            }),
            { status: 403, headers: { "Content-Type": "application/json" } }
          );
        }
        const activatedChatbot = await activateChatbot(chatbotId);
        return new Response(
          JSON.stringify({ success: true, chatbot: activatedChatbot }),
          { headers: { "Content-Type": "application/json" } }
        );
      }
      case "deactivate_chatbot": {
        const chatbotId = formData.get("chatbotId") as string;
        if (!chatbotId) {
          return new Response(
            JSON.stringify({ error: "ID de chatbot no proporcionado" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }
        const chatbot = await getChatbotById(chatbotId);
        if (!chatbot) {
          return new Response(
            JSON.stringify({ error: "Chatbot no encontrado" }),
            { status: 404, headers: { "Content-Type": "application/json" } }
          );
        }
        if (chatbot.userId !== userId) {
          return new Response(
            JSON.stringify({
              error: "No tienes permiso para modificar este chatbot",
            }),
            { status: 403, headers: { "Content-Type": "application/json" } }
          );
        }
        const deactivatedChatbot = await deactivateChatbot(chatbotId);
        return new Response(
          JSON.stringify({ success: true, chatbot: deactivatedChatbot }),
          { headers: { "Content-Type": "application/json" } }
        );
      }
      case "set_to_draft": {
        const chatbotId = formData.get("chatbotId") as string;
        if (!chatbotId) {
          return new Response(
            JSON.stringify({ error: "ID de chatbot no proporcionado" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }
        const chatbot = await getChatbotById(chatbotId);
        if (!chatbot) {
          return new Response(
            JSON.stringify({ error: "Chatbot no encontrado" }),
            { status: 404, headers: { "Content-Type": "application/json" } }
          );
        }
        if (chatbot.userId !== userId) {
          return new Response(
            JSON.stringify({
              error: "No tienes permiso para modificar este chatbot",
            }),
            { status: 403, headers: { "Content-Type": "application/json" } }
          );
        }
        const draftChatbot = await setToDraftMode(chatbotId);
        return new Response(
          JSON.stringify({ success: true, chatbot: draftChatbot }),
          { headers: { "Content-Type": "application/json" } }
        );
      }
      case "get_chatbot_state": {
        const chatbotId = formData.get("chatbotId") as string;
        if (!chatbotId) {
          return new Response(
            JSON.stringify({ error: "ID de chatbot no proporcionado" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }
        const chatbot = await getChatbotById(chatbotId);
        if (!chatbot) {
          return new Response(
            JSON.stringify({ error: "Chatbot no encontrado" }),
            { status: 404, headers: { "Content-Type": "application/json" } }
          );
        }
        if (chatbot.userId !== userId && !chatbot.isActive) {
          return new Response(
            JSON.stringify({
              error: "No tienes permiso para ver este chatbot",
            }),
            { status: 403, headers: { "Content-Type": "application/json" } }
          );
        }
        const state = await getChatbotState(chatbotId);
        return new Response(JSON.stringify({ success: true, state }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      case "get_conversations_count": {
        const chatbotId = formData.get("chatbotId") as string;
        const count = await db.conversation.count({
          where: {
            chatbotId,
            status: { not: "DELETED" },
          },
        });
        return new Response(JSON.stringify({ success: true, count }));
      }
      case "get_usage_stats": {
        const chatbotId = formData.get("chatbotId") as string;
        if (!chatbotId) {
          return new Response(
            JSON.stringify({ error: "ID de chatbot no proporcionado" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }
        const chatbot = await getChatbotById(chatbotId);
        if (!chatbot) {
          return new Response(
            JSON.stringify({ error: "Chatbot no encontrado" }),
            { status: 404, headers: { "Content-Type": "application/json" } }
          );
        }
        if (chatbot.userId !== userId) {
          return new Response(
            JSON.stringify({
              error:
                "No tienes permiso para ver las estadísticas de este chatbot",
            }),
            { status: 403, headers: { "Content-Type": "application/json" } }
          );
        }
        const stats = await getChatbotUsageStats(chatbotId);
        return new Response(JSON.stringify({ success: true, stats }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      case "check_monthly_limit": {
        const chatbotId = formData.get("chatbotId") as string;
        if (!chatbotId) {
          return new Response(
            JSON.stringify({ error: "ID de chatbot no proporcionado" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }
        const chatbot = await getChatbotById(chatbotId);
        if (!chatbot) {
          return new Response(
            JSON.stringify({ error: "Chatbot no encontrado" }),
            { status: 404, headers: { "Content-Type": "application/json" } }
          );
        }
        if (chatbot.userId !== userId) {
          return new Response(
            JSON.stringify({
              error: "No tienes permiso para ver los límites de este chatbot",
            }),
            { status: 403, headers: { "Content-Type": "application/json" } }
          );
        }
        const limitInfo = await checkMonthlyUsageLimit(chatbotId);
        return new Response(JSON.stringify({ success: true, limitInfo }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      case "get_plan_features": {
        const planFeatures = await getUserPlanFeatures(userId);
        return new Response(JSON.stringify({ success: true, planFeatures }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      case "get_branding_config": {
        const chatbotId = formData.get("chatbotId") as string;
        if (!chatbotId) {
          return new Response(
            JSON.stringify({ error: "ID de chatbot no proporcionado" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }
        try {
          const brandingConfig = await getChatbotBrandingConfigById(chatbotId);
          return new Response(
            JSON.stringify({ success: true, brandingConfig }),
            { headers: { "Content-Type": "application/json" } }
          );
        } catch (error: any) {
          return new Response(
            JSON.stringify({
              error:
                error instanceof Error
                  ? error.message
                  : "Error al obtener configuración de branding",
            }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }
      }
      case "add_file_context": {
        const chatbotId = formData.get("chatbotId") as string;
        const fileName = formData.get("fileName") as string;
        const fileType = formData.get("fileType") as string;
        const fileUrl = formData.get("fileUrl") as string;
        const sizeKB = Number(formData.get("sizeKB"));
        const file = formData.get("file") as File | null;

        let content: string | undefined;

        if (file) {
          try {
            // Extraer contenido basado en el tipo de archivo
            if (
              fileType === "application/pdf" ||
              fileName.toLowerCase().endsWith(".pdf")
            ) {
              // Procesar PDF con unpdf
              const arrayBuffer = await file.arrayBuffer();

              try {
                const { extractText } = await import("unpdf");

                // unpdf es muy simple: solo necesita el arrayBuffer
                const result = await extractText(arrayBuffer);

                // Manejar diferentes posibles estructuras
                if (typeof result === "string") {
                  content = result.trim();
                } else if (result && typeof result.text === "string") {
                  content = result.text.trim();
                } else if (
                  result &&
                  Array.isArray(result.text) &&
                  result.text.length > 0
                ) {
                  // unpdf devuelve { totalPages: N, text: ["página1", "página2", ...] }
                  // Unir todas las páginas con doble salto de línea para separarlas claramente
                  content = result.text
                    .map(
                      (page: string, index: number) =>
                        `=== PÁGINA ${index + 1} ===\n${page.trim()}`
                    )
                    .join("\n\n")
                    .trim();
                } else if (result && Array.isArray(result)) {
                  content = result.join("\n\n").trim();
                } else if (result && typeof result === "object") {
                  // Si es un objeto, intentar encontrar el texto
                  content = JSON.stringify(result);
                } else {
                  content = String(result || "").trim();
                }
              } catch (pdfError) {
                // No hay fallback necesario con pdf2json
                content = `[ERROR_PDF: ${pdfError instanceof Error ? pdfError.message : "Error desconocido"} - archivo: ${fileName}]`;
              }
            } else if (fileName.toLowerCase().endsWith(".docx")) {
              // Procesar DOCX con mammoth
              const arrayBuffer = await file.arrayBuffer();
              const buffer = Buffer.from(arrayBuffer);

              try {
                const result = await mammoth.extractRawText({ buffer });
                content = result.value;
              } catch (docxError) {
                content = `[ERROR_DOCX: No se pudo extraer texto del archivo ${fileName}]`;
              }
            } else if (fileName.toLowerCase().endsWith(".xlsx")) {
              // Procesar XLSX con xlsx
              const arrayBuffer = await file.arrayBuffer();

              try {
                const workbook = XLSX.read(arrayBuffer, { type: "array" });
                let allText = "";

                workbook.SheetNames.forEach((sheetName) => {
                  const worksheet = workbook.Sheets[sheetName];
                  const csvData = XLSX.utils.sheet_to_csv(worksheet);
                  allText += `\n--- Hoja: ${sheetName} ---\n${csvData}\n`;
                });

                content = allText.trim();
              } catch (xlsxError) {
                content = `[ERROR_XLSX: No se pudo extraer datos del archivo ${fileName}]`;
              }
            } else if (
              fileType.includes("text") ||
              fileName.toLowerCase().endsWith(".txt") ||
              fileName.toLowerCase().endsWith(".csv")
            ) {
              // Archivos de texto plano
              content = await file.text();
            } else {
              // Fallback: intentar leer como texto
              try {
                content = await file.text();
              } catch (textError) {
                content = `[ERROR_TEXT: No se pudo leer el archivo ${fileName}]`;
              }
            }
          } catch (error) {
            content = `[ERROR: No se pudo procesar el archivo ${fileName}]`;
          }
        } else {
          // Fallback al contenido enviado directamente (compatibilidad)
          content = formData.get("content") as string | undefined;
        }

        try {
          const chatbot = await addFileContext(chatbotId, {
            fileName,
            fileType,
            fileUrl,
            sizeKB,
            content,
          });

          return new Response(JSON.stringify({ success: true, chatbot }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (error: any) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
      }
      case "add_url_context": {
        const chatbotId = formData.get("chatbotId") as string;
        const url = formData.get("url") as string;
        const title = formData.get("title") as string | undefined;
        const content = formData.get("content") as string | undefined;
        const sizeKB = formData.get("sizeKB")
          ? Number(formData.get("sizeKB"))
          : undefined;
        const routesData = formData.get("routes") as string | undefined;
        const routes = routesData ? JSON.parse(routesData) : undefined;

        try {
          const chatbot = await addUrlContext(chatbotId, {
            url,
            title,
            content,
            sizeKB,
            routes,
          });
          return new Response(JSON.stringify({ success: true, chatbot }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (error: any) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
      }
      case "add_text_context": {
        const chatbotId = formData.get("chatbotId") as string;
        const title = formData.get("title") as string;
        const content = formData.get("content") as string;
        try {
          const chatbot = await addTextContext(chatbotId, { title, content });
          return new Response(JSON.stringify({ success: true, chatbot }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (error: any) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
      }
      case "update_text_context": {
        const chatbotId = formData.get("chatbotId") as string;
        const contextId = formData.get("contextId") as string;
        const title = formData.get("title") as string;
        const content = formData.get("content") as string;

        try {
          const chatbot = await updateTextContext(chatbotId, contextId, {
            title,
            content,
          });
          return new Response(JSON.stringify({ success: true, chatbot }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (error: any) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
      }
      case "add_question_context": {
        const chatbotId = formData.get("chatbotId") as string;
        const title = formData.get("title") as string;
        const questions = formData.get("questions") as string;
        const answer = formData.get("answer") as string;

        try {
          const chatbot = await addQuestionContext(chatbotId, {
            title,
            questions,
            answer,
          });
          return new Response(JSON.stringify({ success: true, chatbot }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (error: any) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
      }
      case "update_question_context": {
        const chatbotId = formData.get("chatbotId") as string;
        const contextId = formData.get("contextId") as string;
        const title = formData.get("title") as string;
        const questions = formData.get("questions") as string;
        const answer = formData.get("answer") as string;

        try {
          const chatbot = await updateQuestionContext(chatbotId, contextId, {
            title,
            questions,
            answer,
          });
          return new Response(JSON.stringify({ success: true, chatbot }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (error: any) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
      }
      case "remove_context": {
        const chatbotId = formData.get("chatbotId") as string;
        const contextItemId = formData.get("contextItemId") as string;
        try {
          const chatbot = await removeContextItem(chatbotId, contextItemId);
          return new Response(JSON.stringify({ success: true, chatbot }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (error: any) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
      }
      case "get_contexts": {
        const chatbotId = formData.get("chatbotId") as string;
        try {
          const contexts = await getChatbotContexts(chatbotId);
          return new Response(JSON.stringify({ success: true, contexts }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (error: any) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
      }
      // Integraciones
      case "create_integration": {
        const chatbotId = formData.get("chatbotId") as string;
        const platform = formData.get("platform") as any;
        const token = formData.get("token") as string | undefined;
        try {
          const integration = await createIntegration(
            chatbotId,
            platform,
            token
          );
          return new Response(JSON.stringify({ success: true, integration }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (error: any) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
      }
      case "get_integrations": {
        const chatbotId = formData.get("chatbotId") as string;
        try {
          const integrations = await getIntegrationsByChatbotId(chatbotId);
          return new Response(JSON.stringify({ success: true, integrations }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (error: any) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
      }
      case "update_integration": {
        const integrationId = formData.get("integrationId") as string;
        const token = formData.get("token") as string | undefined;
        const isActive =
          formData.get("isActive") !== undefined
            ? formData.get("isActive") === "true"
            : undefined;
        try {
          const integration = await updateIntegration(integrationId, {
            token,
            isActive,
          });
          return new Response(JSON.stringify({ success: true, integration }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (error: any) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
      }
      case "toggle_integration_status": {
        const integrationId = formData.get("integrationId") as string;
        const isActive = formData.get("isActive") === "true";
        try {
          const integration = await toggleIntegrationStatus(
            integrationId,
            isActive
          );
          return new Response(JSON.stringify({ success: true, integration }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (error: any) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
      }
      case "delete_integration": {
        const integrationId = formData.get("integrationId") as string;
        try {
          const integration = await deleteIntegration(integrationId);
          return new Response(JSON.stringify({ success: true, integration }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (error: any) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
      }
      case "update_notifications": {
        const chatbotId = formData.get("chatbotId") as string;
        if (!chatbotId) {
          return new Response(
            JSON.stringify({ error: "ID de chatbot no proporcionado" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }

        const chatbot = await getChatbotById(chatbotId);
        if (!chatbot) {
          return new Response(
            JSON.stringify({ error: "Chatbot no encontrado" }),
            { status: 404, headers: { "Content-Type": "application/json" } }
          );
        }

        if (chatbot.userId !== userId) {
          return new Response(
            JSON.stringify({
              error: "No tienes permiso para modificar este chatbot",
            }),
            { status: 403, headers: { "Content-Type": "application/json" } }
          );
        }

        const weeklyDigest = formData.get("weeklyDigest") === "true";
        const usageLimit = formData.get("usageLimit") === "true";
        const configChanges = formData.get("configChanges") === "true";

        const updatedChatbot = await db.chatbot.update({
          where: { id: chatbotId },
          data: {
            settings: {
              notifications: {
                weeklyDigest,
                usageLimit,
                configChanges,
              },
              security: chatbot.settings?.security || {
                allowedDomains: [],
                rateLimit: 100,
                status: "public",
              },
            },
          },
        });

        return new Response(JSON.stringify(updatedChatbot), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      case "add_chatbot_user": {
        const chatbotId = formData.get("chatbotId") as string;
        const email = formData.get("email") as string;
        const role = formData.get("role") as string;

        if (!chatbotId || !email || !role) {
          return new Response(
            JSON.stringify({ error: "Faltan parámetros requeridos" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }

        const chatbot = await getChatbotById(chatbotId);
        if (!chatbot) {
          return new Response(
            JSON.stringify({ error: "Chatbot no encontrado" }),
            { status: 404, headers: { "Content-Type": "application/json" } }
          );
        }

        if (chatbot.userId !== userId) {
          return new Response(
            JSON.stringify({
              error: "No tienes permiso para modificar este chatbot",
            }),
            { status: 403, headers: { "Content-Type": "application/json" } }
          );
        }

        // Verificar si ya existe un permiso para este usuario
        const existingPermission = await db.permission.findFirst({
          where: {
            email,
            chatbotId,
            resourceType: "CHATBOT",
          },
        });

        if (existingPermission) {
          return new Response(
            JSON.stringify({
              error: "El usuario ya tiene acceso a este chatbot",
            }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }

        // Crear el nuevo permiso
        const permission = await db.permission.create({
          data: {
            email,
            chatbotId,
            resourceType: "CHATBOT",
            role: role as any,
            status: "pending",
            notifications: true,
          },
        });

        return new Response(JSON.stringify(permission), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      }

      case "remove_chatbot_user": {
        const permissionId = formData.get("permissionId") as string;

        if (!permissionId) {
          return new Response(
            JSON.stringify({ error: "ID de permiso no proporcionado" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }

        const permission = await db.permission.findUnique({
          where: { id: permissionId },
          include: { chatbot: true },
        });

        if (!permission || !permission.chatbot) {
          return new Response(
            JSON.stringify({ error: "Permiso no encontrado" }),
            { status: 404, headers: { "Content-Type": "application/json" } }
          );
        }

        if (permission.chatbot.userId !== userId) {
          return new Response(
            JSON.stringify({
              error: "No tienes permiso para modificar este chatbot",
            }),
            { status: 403, headers: { "Content-Type": "application/json" } }
          );
        }

        await db.permission.delete({
          where: { id: permissionId },
        });

        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      case "toggle_chatbot_user_notifications": {
        const permissionId = formData.get("permissionId") as string;
        const value = formData.get("value") === "true";

        if (!permissionId) {
          return new Response(
            JSON.stringify({ error: "ID de permiso no proporcionado" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }

        const permission = await db.permission.findUnique({
          where: { id: permissionId },
          include: { chatbot: true },
        });

        if (!permission || !permission.chatbot) {
          return new Response(
            JSON.stringify({ error: "Permiso no encontrado" }),
            { status: 404, headers: { "Content-Type": "application/json" } }
          );
        }

        if (permission.chatbot.userId !== userId) {
          return new Response(
            JSON.stringify({
              error: "No tienes permiso para modificar este chatbot",
            }),
            { status: 403, headers: { "Content-Type": "application/json" } }
          );
        }

        const updated = await db.permission.update({
          where: { id: permissionId },
          data: { notifications: value },
        });

        return new Response(JSON.stringify(updated), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      case "get_chatbot_users": {
        const chatbotId = formData.get("chatbotId") as string;

        if (!chatbotId) {
          return new Response(
            JSON.stringify({ error: "ID de chatbot no proporcionado" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }

        const chatbot = await getChatbotById(chatbotId);
        if (!chatbot) {
          return new Response(
            JSON.stringify({ error: "Chatbot no encontrado" }),
            { status: 404, headers: { "Content-Type": "application/json" } }
          );
        }

        if (chatbot.userId !== userId) {
          return new Response(
            JSON.stringify({
              error: "No tienes permiso para ver este chatbot",
            }),
            { status: 403, headers: { "Content-Type": "application/json" } }
          );
        }

        const permissions = await db.permission.findMany({
          where: {
            chatbotId,
            resourceType: "CHATBOT",
          },
          include: {
            user: {
              select: {
                id: true,
                email: true,
                name: true,
                picture: true,
              },
            },
          },
        });

        return new Response(JSON.stringify(permissions), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      case "update_security": {
        const chatbotId = formData.get("chatbotId") as string;
        if (!chatbotId) {
          return new Response(
            JSON.stringify({ error: "ID de chatbot no proporcionado" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }

        const chatbot = await getChatbotById(chatbotId);
        if (!chatbot) {
          return new Response(
            JSON.stringify({ error: "Chatbot no encontrado" }),
            { status: 404, headers: { "Content-Type": "application/json" } }
          );
        }

        if (chatbot.userId !== userId) {
          return new Response(
            JSON.stringify({
              error: "No tienes permiso para modificar este chatbot",
            }),
            { status: 403, headers: { "Content-Type": "application/json" } }
          );
        }

        const allowedDomains = formData.get("allowedDomains") as string;
        const status = formData.get("status") as string;
        const rateLimit = parseInt(formData.get("rateLimit") as string) || 100;

        const domainsArray = allowedDomains
          ? allowedDomains
              .split(",")
              .map((d) => d.trim())
              .filter((d) => d)
          : [];

        const updatedChatbot = await db.chatbot.update({
          where: { id: chatbotId },
          data: {
            settings: {
              notifications: chatbot.settings?.notifications || {
                weeklyDigest: true,
                usageLimit: true,
                configChanges: false,
              },
              security: {
                allowedDomains: domainsArray,
                rateLimit,
                status: status || "public",
              },
            },
          },
        });

        return new Response(JSON.stringify(updatedChatbot), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      case "update_streaming": {
        const chatbotId = formData.get("chatbotId") as string;
        if (!chatbotId) {
          return new Response(
            JSON.stringify({ error: "ID de chatbot no proporcionado" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }

        const chatbot = await getChatbotById(chatbotId);
        if (!chatbot) {
          return new Response(
            JSON.stringify({ error: "Chatbot no encontrado" }),
            { status: 404, headers: { "Content-Type": "application/json" } }
          );
        }

        if (chatbot.userId !== userId) {
          return new Response(
            JSON.stringify({
              error: "No tienes permiso para modificar este chatbot",
            }),
            { status: 403, headers: { "Content-Type": "application/json" } }
          );
        }

        const enableStreaming = formData.get("enableStreaming") === "true";
        const streamingSpeed = parseInt(formData.get("streamingSpeed") as string) || 50;

        const updatedChatbot = await db.chatbot.update({
          where: { id: chatbotId },
          data: {
            enableStreaming,
            streamingSpeed,
          },
        });

        return new Response(
          JSON.stringify({ 
            success: true, 
            chatbot: updatedChatbot,
            message: "Configuración de streaming actualizada" 
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      case "preview_chat": {
        
        // Chat de preview para el dashboard (no requiere API key del SDK)
        const chatbotId = formData.get("chatbotId") as string;
        const message = formData.get("message") as string;
        const sessionId = formData.get("sessionId") as string;
        const conversationHistoryStr = formData.get("conversationHistory") as string;
        const requestedStream = formData.get("stream") === "true";
        
        
        // Parsear el historial conversacional
        let conversationHistory: Array<{ role: "user" | "assistant"; content: string }> = [];
        if (conversationHistoryStr) {
          try {
            conversationHistory = JSON.parse(conversationHistoryStr);
          } catch (e) {
            console.warn("Error parsing conversation history:", e);
          }
        }
        
        // Usar funciones de utilidad del archivo server correspondiente
        
        if (!chatbotId || !message) {
          return new Response(
            JSON.stringify({ error: "Faltan parámetros requeridos" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }

        // Verificar que el chatbot pertenece al usuario
        const chatbot = await getChatbotById(chatbotId);
        if (!chatbot) {
          return new Response(
            JSON.stringify({ error: "Chatbot no encontrado" }),
            { status: 404, headers: { "Content-Type": "application/json" } }
          );
        }

        if (chatbot.userId !== userId) {
          return new Response(
            JSON.stringify({ error: "No tienes permiso para usar este chatbot" }),
            { status: 403, headers: { "Content-Type": "application/json" } }
          );
        }

        // RESPETAR configuración del chatbot, no solo la request
        const stream = requestedStream && (chatbot.enableStreaming !== false);

        // Obtener las API keys necesarias
        const openRouterApiKey = process.env.OPENROUTER_API_KEY;
        const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
        const openaiApiKey = process.env.CHATGPT_API_KEY;
        
        if (!openRouterApiKey && !anthropicApiKey && !openaiApiKey) {
          return new Response(
            JSON.stringify({ error: "No se encontraron API keys configuradas" }),
            { status: 500, headers: { "Content-Type": "application/json" } }
          );
        }

        // Usar función unificada para construir prompt optimizado
        const enrichedSystemPrompt = buildEnrichedSystemPrompt(chatbot, message, {
          maxContextTokens: 800, // Límite de emergencia
          enableLogging: true
        });
        
        const systemMessage = {
          role: "system",
          content: enrichedSystemPrompt
        };
        
        // Función para llamar directamente a Anthropic
        const callAnthropicDirect = async (messages: Array<{role: string, content: string}>) => {
          const anthropicMessages = messages.filter(m => m.role !== 'system').map(m => ({
            role: m.role === 'user' ? 'user' : 'assistant',
            content: m.content
          }));
          
          // Validar y ajustar temperatura para Anthropic (debe estar entre 0-1)
          const rawTemperature = chatbot.temperature || 0.7;
          const validTemperature = Math.max(0, Math.min(1, rawTemperature));
          
          
          const requestBody = {
            model: chatbot.aiModel,
            max_tokens: 1000,
            temperature: validTemperature,
            system: enrichedSystemPrompt.substring(0, 4000), // Limitar system prompt para debug
            messages: anthropicMessages,
            ...(stream ? { stream: true } : {}) // Solo agregar stream si es true
          };
          
          // DEBUG: Log de la request
          
          const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': anthropicApiKey!,
              'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify(requestBody)
          });
          
          // DEBUG: Log de la response
          
          return response;
        };

        // ✅ NUEVO SISTEMA MODULAR DE PROVEEDORES
        const providerManager = createProviderManager(anthropicApiKey, openRouterApiKey, openaiApiKey);
        
        const fallbackModels = generateFallbackModels(chatbot.aiModel);

        // Preparar request para el sistema modular
        const chatRequest = {
          model: chatbot.aiModel,
          messages: [
            systemMessage,
            ...truncateConversationHistory(conversationHistory),
            { role: "user" as const, content: message }
          ],
          temperature: chatbot.temperature || 0.7,
          maxTokens: 1000,
          stream: stream
        };
        
        let apiResponse;
        let modelUsed = chatbot.aiModel;
        let providerUsed = 'unknown';
        let usedFallback = false;
        let lastError;
        
        try {
          if (stream) {
            // STREAMING con sistema modular
            const result = await providerManager.chatCompletionStreamWithFallback(
              chatRequest,
              fallbackModels.filter(m => !m.includes("deepseek"))
            );
            
            modelUsed = result.modelUsed;
            providerUsed = result.providerUsed;
            usedFallback = result.usedFallback;
            
            
            // Convertir el stream modular al formato esperado por el frontend
            const compatibleStream = new ReadableStream({
              async start(controller) {
                const reader = result.stream.getReader();
                let contentChunks = 0;
                let accumulatedContent = "";
                
                try {
                  while (true) {
                    const { done, value } = await reader.read();
                    
                    if (done) {
                      const doneMessage = 'data: [DONE]\n\n';
                      controller.enqueue(new TextEncoder().encode(doneMessage));
                      controller.close();
                      break;
                    }
                    
                    if (value.content && value.content.trim()) {
                      contentChunks++;
                      accumulatedContent += value.content;
                      
                      // Enviar chunk al frontend en el formato que espera
                      const chunk = {
                        content: value.content  // Frontend espera content directamente
                      };
                      
                      const chunkData = `data: ${JSON.stringify(chunk)}\n\n`;
                      controller.enqueue(new TextEncoder().encode(chunkData));
                    }
                    
                    if (value.finishReason) {
                    }
                  }
                } catch (error) {
                  console.error('❌ Stream error:', error);
                  controller.error(error);
                } finally {
                  reader.releaseLock();
                }
              }
            });
            
            return new Response(compatibleStream, {
              headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive"
              }
            });
            
          } else {
            // NON-STREAMING con sistema modular
            const result = await providerManager.chatCompletionWithFallback(
              chatRequest,
              fallbackModels.filter(m => !m.includes("deepseek"))
            );
            
            modelUsed = result.modelUsed;
            providerUsed = result.providerUsed;
            usedFallback = result.usedFallback;
            
            
            return new Response(
              JSON.stringify({
                success: true,
                response: result.response.content,
                // TRANSPARENCY: Incluir información del modelo usado
                modelInfo: {
                  used: modelUsed,
                  preferred: chatbot.aiModel,
                  provider: providerUsed,
                  wasFromFallback: usedFallback,
                  fallbackReason: usedFallback ? "Modelo preferido no disponible" : null,
                  usage: result.response.usage
                }
              }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            );
          }
          
        } catch (error) {
          lastError = error;
          console.error('❌ All providers failed:', error);
        }

        // Si llegamos aquí, todos los proveedores fallaron
        return new Response(
          JSON.stringify({ 
            error: `All providers failed: ${lastError?.message || 'Unknown error'}`,
            triedModels: fallbackModels.filter(m => !m.includes("deepseek")),
            preferredModel: chatbot.aiModel,
            availableProviders: providerManager.getAvailableProviders()
            }),
            { status: 500, headers: { "Content-Type": "application/json" } }
          );
        }

      default:
        return new Response(
          JSON.stringify({ error: `Intent no reconocido: ${intent}` }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
    }
  } catch (error: any) {
    return new Response(
      JSON.stringify({
        error:
          error instanceof Error ? error.message : "Error interno del servidor",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
