import { S3Client, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

let s3Client: S3Client | null = null;

const getS3Client = () => {
  if (!s3Client) {
    s3Client = new S3Client({
      region: process.env.AWS_REGION || "us-east-1",
      endpoint: process.env.AWS_ENDPOINT_URL_S3,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    });
  }
  return s3Client;
};

export async function generatePresignedUrl(
  key: string,
  contentType: string,
  expiresIn: number = 3600
) {
  const client = getS3Client();
  const command = new PutObjectCommand({
    Bucket: process.env.BUCKET_NAME!,
    Key: key,
    ContentType: contentType,
  });

  const url = await getSignedUrl(client, command, { expiresIn });
  
  return {
    uploadUrl: url,
    publicUrl: `${process.env.S3_PUBLIC_ENDPOINT}/${key}`,
    key,
  };
}

export function generateKey(filename: string, prefix: string = "chatbot-avatars", slug?: string) {
  const timestamp = Date.now();
  const extension = filename.split(".").pop();
  const nameWithoutExt = filename.split(".").slice(0, -1).join(".");
  
  if (slug && prefix === "chatbot-avatars") {
    // Para avatares de chatbot, usar slug con timestamp y nombre original
    return `${prefix}/${slug}/${timestamp}-${nameWithoutExt}.${extension}`;
  }
  
  if (slug) {
    // Para otros tipos de archivos, mantener ID único
    return `${prefix}/${slug}-${timestamp}.${extension}`;
  }
  
  const randomStr = Math.random().toString(36).substring(2, 8);
  return `${prefix}/${timestamp}-${randomStr}.${extension}`;
}

export async function deleteOldAvatars(slug: string) {
  const client = getS3Client();
  const prefix = `chatbot-avatars/${slug}/`;
  
  try {
    // Listar todos los objetos con el prefijo del slug
    const listCommand = new ListObjectsV2Command({
      Bucket: process.env.BUCKET_NAME!,
      Prefix: prefix,
    });
    
    const listResponse = await client.send(listCommand);
    
    if (listResponse.Contents && listResponse.Contents.length > 0) {
      // Borrar todos los archivos encontrados
      for (const object of listResponse.Contents) {
        if (object.Key) {
          const deleteCommand = new DeleteObjectCommand({
            Bucket: process.env.BUCKET_NAME!,
            Key: object.Key,
          });
          await client.send(deleteCommand);
        }
      }
    }
    
    return true;
  } catch (error) {
    console.error("Error deleting old avatars:", error);
    return false;
  }
}