import { useState } from "react";
import { ConfigMenu, EmbebidoButton, IntegracionesButton } from "../ConfigMenu";
import { StickyGrid } from "../PageContainer";
import {
  Card,
  IntegrationCard,
  MiniCardGroup,
  type IntegrationStatus,
} from "../common/Card";
import { useChipTabs } from "../common/ChipTabs";
import { CodeBlock } from "../common/CodeBlock";
import type { Chatbot, Integration as PrismaIntegration } from "@prisma/client";
import WhatsAppIntegrationModal from "../../integrations/WhatsAppIntegrationModal";
import GoogleCalendarIntegrationModal from "../../integrations/GoogleCalendarIntegrationCard";

// Integraciones disponibles con sus configuraciones
const availableIntegrations = [
  {
    id: "GOOGLE_CALENDAR",
    name: "Google Calendar",
    logo: "/assets/chat/calendar.png",
    description:
      "Conecta tu agente a Google Calendar para que pueda programar citas y recordatorios automáticamente.",
  },
  {
    id: "WHATSAPP",
    name: "WhatsApp",
    logo: "/assets/chat/whatsapp.svg",
    description:
      "Conecta a tu agente a un número de WhatsApp y deja que responda los mensajes de tus clientes.",
  },
  {
    id: "INSTAGRAM",
    name: "Instagram",
    logo: "/assets/chat/instagram.svg",
    description:
      "Conecta a tu agente a una página de Instagram y deja que responda los mensajes de tus clientes.",
  },
  {
    id: "MESSENGER",
    name: "Messenger",
    logo: "/assets/chat/messenger.svg",
    description:
      "Conecta a tu agente a tu fan page y deja que responda los mensajes de tus clientes.",
  },
  {
    id: "SHOPIFY",
    name: "Shopify",
    logo: "/assets/chat/shopify.svg",
    description:
      "Deje que tu agente interactúe con sus clientes, responda a sus consultas, ayude con los pedidos y más.",
  },
  {
    id: "WORDPRESS",
    name: "WordPress",
    logo: "/assets/chat/wordpress.svg",
    description:
      "Utiliza el plugin para Wordpress para agregar el widget de chat a su sitio web.",
  },
  {
    id: "SLACK",
    name: "Slack",
    logo: "/assets/chat/slack.svg",
    description:
      "Conecta a tu agente a Slack, menciónalo y haz que responda cualquier mensaje.",
  },
] as const;

// Extender el tipo de integración con propiedades adicionales si es necesario
type Integration = PrismaIntegration & {
  // Propiedades adicionales si son necesarias
};

// Extender el tipo Chatbot para incluir la propiedad slug
type ChatbotWithSlug = Chatbot & {
  slug: string;
  // Otras propiedades del chatbot que necesites
};

// Props del componente Codigo
interface CodigoProps {
  chatbot: ChatbotWithSlug;
  integrations: Integration[];
  user: {
    id: string;
    // Otras propiedades del usuario que necesites
  };
}

export const Codigo = ({ chatbot, integrations }: CodigoProps) => {
  const { currentTab, setCurrentTab } = useChipTabs("integrations", `codigo_${chatbot.id}`);
  const { currentTab: miniCard, setCurrentTab: setMiniCard } =
    useChipTabs("iframe", `codigo_mini_${chatbot.id}`);
  const [selectedIntegration, setSelectedIntegration] = useState<string | null>(
    null
  );
  // Estado para el estado de conexión de las integraciones
  const [integrationStatus, setIntegrationStatus] = useState<
    Record<string, IntegrationStatus>
  >(() => {
    const status: Record<string, IntegrationStatus> = {};

    // Debug: Verificar qué integraciones están llegando
    console.log("🔍 Debug - Integraciones recibidas:", integrations);
    console.log(
      "🔍 Debug - Cantidad de integraciones:",
      integrations?.length || 0
    );

    // Inicializar todas las integraciones disponibles como desconectadas
    availableIntegrations.forEach((availableIntegration) => {
      status[availableIntegration.id.toLowerCase()] = "disconnected";
    });

    // Verificar si hay integraciones existentes y actualizar su estado
    if (integrations && integrations.length > 0) {
      integrations.forEach((integration, index) => {
        console.log(`🔍 Debug - Integración ${index}:`, {
          id: integration.id,
          platform: integration.platform,
          isActive: integration.isActive,
          chatbotId: integration.chatbotId,
        });

        const platformKey = integration.platform.toLowerCase();

        // Si la integración existe pero está inactiva, mostrarla como desconectada
        // Si está activa, mostrarla como conectada
        const integrationStatus = integration.isActive
          ? "connected"
          : "disconnected";
        status[platformKey] = integrationStatus;

        console.log(
          `✅ Debug - ${integration.platform} encontrado, estado:`,
          integrationStatus,
          "(isActive:",
          integration.isActive,
          ")"
        );
      });
    } else {
      console.log("⚠️ Debug - No hay integraciones o array vacío");
    }

    console.log("🔍 Debug - Estado final de integraciones:", status);
    return status;
  });
  // Estados para controlar los modales de integración
  const [whatsAppModalOpen, setWhatsAppModalOpen] = useState(false);
  const [googleCalendarModalOpen, setGoogleCalendarModalOpen] = useState(false);

  const handleConnect = (integrationId: string) => {
    console.log("🔍 Debug - Conectando integración:", integrationId);

    setIntegrationStatus((prev) => ({
      ...prev,
      [integrationId.toLowerCase()]: "connecting",
    }));

    setSelectedIntegration(integrationId);

    // Abrir el modal correspondiente
    if (integrationId === "WHATSAPP") {
      setWhatsAppModalOpen(true);
    } else if (integrationId === "GOOGLE_CALENDAR") {
      console.log("🔍 Starting Google Calendar OAuth2 flow");
      handleGoogleCalendarOAuth();
    } else {
      // Para otras integraciones, simular conexión
      setTimeout(() => {
        setIntegrationStatus((prev) => ({
          ...prev,
          [integrationId.toLowerCase()]: "connected",
        }));
      }, 1000);
    }
  };

  const handleDisconnect = (integrationId: string) => {
    console.log("🔍 Debug - Desconectando integración:", integrationId);
    setIntegrationStatus((prev) => ({
      ...prev,
      [integrationId.toLowerCase()]: "disconnected",
    }));
  };

  const handleEdit = (integrationId: string) => {
    console.log("🔍 Debug - Editando integración:", integrationId);
    setSelectedIntegration(integrationId);

    if (integrationId === "WHATSAPP") {
      setWhatsAppModalOpen(true);
    } else if (integrationId === "GOOGLE_CALENDAR") {
      setGoogleCalendarModalOpen(true);
    }
  };

  // Manejador de éxito para la integración de WhatsApp
  const handleWhatsAppSuccess = (integration: any) => {
    console.log("🔍 Debug - WhatsApp integración exitosa:", integration);

    if (selectedIntegration) {
      // Actualizar el estado local
      setIntegrationStatus((prev) => ({
        ...prev,
        [selectedIntegration.toLowerCase()]: "connected" as const,
      }));

      setWhatsAppModalOpen(false);
      setSelectedIntegration(null);

      // Mostrar notificación de éxito
      // Aquí podrías usar tu sistema de notificaciones
      alert("¡Integración de WhatsApp configurada correctamente!");

      // Nota: En una aplicación real, podrías querer actualizar el estado
      // de las integraciones sin recargar la página, pero para este ejemplo
      // lo hacemos simple con una recarga
      window.location.reload();
    }
  };

  const handleGoogleCalendarSuccess = (integration: any) => {
    console.log("🔍 Debug - Google Calendar integración exitosa:", integration);

    if (selectedIntegration) {
      // Actualizar el estado local
      setIntegrationStatus((prev) => ({
        ...prev,
        [selectedIntegration.toLowerCase()]: "connected" as const,
      }));

      setGoogleCalendarModalOpen(false);
      setSelectedIntegration(null);

      // Mostrar notificación de éxito
      // Aquí podrías usar tu sistema de notificaciones
      alert("¡Integración de Google Calendar configurada correctamente!");

      // Nota: En una aplicación real, podrías querer actualizar el estado
      // de las integraciones sin recargar la página, pero para este ejemplo
      // lo hacemos simple con una recarga
      window.location.reload();
    }
  };

  // Función para manejar OAuth2 de Google Calendar
  const handleGoogleCalendarOAuth = async () => {
    try {
      // Primero crear la integración (el servidor usará las credenciales del entorno)
      const response = await fetch("/api/v1/integration", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          intent: "create",
          chatbotId: chatbot.id,
          platform: "GOOGLE_CALENDAR",
          token: "", // Token will be set later via OAuth callback
          calendarId: "primary",
        }),
      });

      if (!response.ok) {
        const errorData = await response.text();
        console.error("API Error Response:", errorData);
        throw new Error(`Error al crear la integración: ${response.status} - ${errorData}`);
      }

      const data = await response.json();
      const integrationId = data.integration.id;
      const integration = data.integration;

      // Crear URL de OAuth con state conteniendo datos de integración
      const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      authUrl.searchParams.append("client_id", integration.clientId);
      authUrl.searchParams.append("redirect_uri", integration.redirectUri);
      authUrl.searchParams.append("response_type", "code");
      authUrl.searchParams.append(
        "scope",
        "https://www.googleapis.com/auth/calendar"
      );
      authUrl.searchParams.append("access_type", "offline");
      authUrl.searchParams.append("prompt", "consent");

      // Incluir datos de integración en state
      const state = encodeURIComponent(
        JSON.stringify({
          integrationId,
          clientId: integration.clientId,
          clientSecret: integration.clientSecret,
          redirectUri: integration.redirectUri,
        })
      );
      authUrl.searchParams.append("state", state);

      // Abrir popup de OAuth
      const popup = window.open(
        authUrl.toString(),
        "google-oauth",
        "width=500,height=600,scrollbars=yes,resizable=yes"
      );

      if (!popup) {
        throw new Error(
          "No se pudo abrir la ventana de autorización. Verifica que no esté bloqueada por el navegador."
        );
      }

      // Escuchar mensajes del popup
      const handleMessage = (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return;

        if (event.data.type === "oauth_success") {
          // Actualizar estado de integración
          setIntegrationStatus((prev) => ({
            ...prev,
            google_calendar: "connected",
          }));
          
          // Limpiar listener
          window.removeEventListener("message", handleMessage);
          
          // Mostrar notificación de éxito
          alert("¡Integración de Google Calendar configurada correctamente!");
          
          // Recargar para actualizar la lista de integraciones
          window.location.reload();
        } else if (event.data.type === "oauth_error") {
          // Actualizar estado de integración a error
          setIntegrationStatus((prev) => ({
            ...prev,
            google_calendar: "disconnected",
          }));
          
          // Limpiar listener
          window.removeEventListener("message", handleMessage);
          
          // Mostrar error
          alert(`Error en la autorización: ${event.data.description || "Error desconocido"}`);
        }
      };

      window.addEventListener("message", handleMessage);
      
    } catch (error) {
      console.error("Error en OAuth2 de Google Calendar:", error);
      
      // Actualizar estado de integración a error
      setIntegrationStatus((prev) => ({
        ...prev,
        google_calendar: "disconnected",
      }));
      
      // Mostrar error al usuario
      alert(error instanceof Error ? error.message : "Error desconocido en la autorización");
    }
  };

  return (
    <StickyGrid>
      <section>
        <ConfigMenu>
          <EmbebidoButton
            current={currentTab}
            onClick={() => setCurrentTab("embed")}
          />
          <IntegracionesButton
            current={currentTab}
            onClick={() => setCurrentTab("integrations")}
          />
        </ConfigMenu>
      </section>
      {currentTab === "embed" && (
        <section className="w-full">
          <Card
            title="Embebe tu chatbot en tu sitio web"
            text={
              <div>
                <p className="text-metal font-light">
                  Elige la forma de embebido que más te convenga.{" "}
                  <a href="#!" className="underline">
                    Más información
                  </a>
                </p>
              </div>
            }
          >
            <section>
              <MiniCardGroup selectedMinicard={miniCard} onSelect={setMiniCard}>
                {miniCard === "iframe" && <Iframe chatbot={chatbot} />}
                {miniCard === "link" && <LinkBlock chatbot={chatbot} />}
              </MiniCardGroup>
            </section>
          </Card>
        </section>
      )}
      {currentTab === "integrations" && (
        <article className="grid lg:grid-cols-3 grid-cols-1 md:grid-cols-2 gap-4 py-3">
          {availableIntegrations.map((availableIntegration) => {
            const existingIntegration = integrations.find(
              (i) => i.platform === availableIntegration.id
            );

            return (
              <IntegrationCard
                integration={existingIntegration}
                key={availableIntegration.id}
                name={availableIntegration.name}
                logo={availableIntegration.logo}
                description={availableIntegration.description}
                lastActivity={
                  integrationStatus[availableIntegration.id.toLowerCase()] ===
                  "connected"
                    ? "Hoy"
                    : undefined
                }
                onConnect={() => handleConnect(availableIntegration.id)}
                onDisconnect={() => handleDisconnect(availableIntegration.id)}
                onEdit={() => handleEdit(availableIntegration.id)}
              />
            );
          })}

          {selectedIntegration === "WHATSAPP" && (
            <WhatsAppIntegrationModal
              isOpen={whatsAppModalOpen}
              onClose={() => setWhatsAppModalOpen(false)}
              chatbotId={chatbot.id}
              onSuccess={handleWhatsAppSuccess}
              existingIntegration={(() => {
                const whatsappIntegration = integrations.find(
                  (integration) => integration.platform === "WHATSAPP"
                );
                if (!whatsappIntegration) return null;

                return {
                  id: whatsappIntegration.id,
                  phoneNumberId: whatsappIntegration.phoneNumberId || "",
                  businessAccountId:
                    whatsappIntegration.businessAccountId || "",
                  webhookVerifyToken:
                    whatsappIntegration.webhookVerifyToken || undefined,
                };
              })()}
            />
          )}
        </article>
      )}
    </StickyGrid>
  );
};

interface LinkBlockProps {
  chatbot: {
    slug: string;
  };
}

const LinkBlock = ({ chatbot }: LinkBlockProps) => {
  const baseUrl =
    typeof window !== "undefined"
      ? window.location.origin
      : "https://formmy-v2.fly.dev";
  const chatUrl = `${baseUrl}/chat/embed?slug=${chatbot.slug}`;

  const codeToCopy = `
<a href="${chatUrl}" target="_blank" rel="noopener noreferrer">
  Chatear con nuestro asistente
</a>
`;

  const instructions = [
    { step: "1", description: "Copia el código del enlace" },
    {
      step: "2",
      description: "Pégalo en tu archivo HTML donde quieras que aparezca",
    },
    {
      step: "3",
      description: "Personaliza el texto y los estilos según tus necesidades",
    },
  ];

  return (
    <CodeBlock
      title="Instrucciones de configuración"
      language="html"
      code={codeToCopy}
      instructions={instructions}
    />
  );
};

const Iframe = ({ chatbot }: { chatbot: { slug: string } }) => {
  const baseUrl =
    typeof window !== "undefined"
      ? window.location.origin
      : "https://formmy-v2.fly.dev";

  const codeToCopy = `
<article style="background:transparent;position:fixed;bottom:40px;right:40px;">
  <iframe 
    src="${baseUrl}/chat/embed?slug=${chatbot.slug}" 
    width="400" 
    height="600"
    frameborder="0"
    style="border-radius: 8px;"
  ></iframe>
</article>
`;

  const instructions = [
    { step: "1", description: "Copia el código del iframe" },
    {
      step: "2",
      description: "Pégalo en tu archivo HTML donde quieras que aparezca",
    },
    {
      step: "3",
      description: "Ajusta el width y height según tus necesidades",
    },
    {
      step: "4",
      description:
        "El chatbot se adaptará automáticamente y ocupará todo el espacio disponible",
    },
    {
      step: "5",
      description:
        "La ruta /chat/embed usa el slug de tu chatbot para mostrarlo correctamente",
    },
  ];

  return (
    <CodeBlock
      title="Instrucciones de configuración"
      language="html"
      code={codeToCopy}
      instructions={instructions}
    />
  );
};

