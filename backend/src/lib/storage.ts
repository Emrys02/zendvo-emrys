import { S3Client, PutObjectCommand, PutObjectCommandInput } from "@aws-sdk/client-s3";
import { nanoid } from "nanoid";

// S3 Client configuration
const s3ClientConfig: { region: string; credentials?: { accessKeyId: string; secretAccessKey: string } } = {
  region: process.env.AWS_REGION || "us-east-1",
};

// Only include credentials if both are present, otherwise use default credential chain
if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
  s3ClientConfig.credentials = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  };
}

const s3Client = new S3Client(s3ClientConfig);

const S3_BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME || "zendvo-uploads";

/**
 * Upload a file buffer to S3 and return the public URL
 * @param fileBuffer - The file buffer to upload
 * @param fileName - The original file name
 * @param contentType - The MIME type of the file
 * @returns The public URL of the uploaded file
 */
export async function uploadToS3(
  fileBuffer: Buffer,
  fileName: string,
  contentType: string
): Promise<string> {
  // Generate a unique file name to prevent collisions
  const fileExtension = fileName.split(".").pop() || "jpg";
  const uniqueFileName = `uploads/${nanoid()}.${fileExtension}`;

  const uploadParams: PutObjectCommandInput = {
    Bucket: S3_BUCKET_NAME,
    Key: uniqueFileName,
    Body: fileBuffer,
    ContentType: contentType,
  };

  try {
    await s3Client.send(new PutObjectCommand(uploadParams));
    
    // Construct the public URL
    const publicUrl = `https://${S3_BUCKET_NAME}.s3.${process.env.AWS_REGION || "us-east-1"}.amazonaws.com/${uniqueFileName}`;
    
    return publicUrl;
  } catch (error) {
    console.error("[S3_UPLOAD_ERROR]", error);
    throw new Error("Failed to upload file to S3");
  }
}

/**
 * Validate if a file type is allowed
 * @param contentType - The MIME type to validate
 * @returns True if the file type is allowed
 */
export function isAllowedFileType(contentType: string): boolean {
  const allowedTypes = [
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
  ];
  return allowedTypes.includes(contentType);
}

/**
 * Validate if a file size is within the limit (10MB)
 * @param fileSize - The file size in bytes
 * @returns True if the file size is within the limit
 */
export function isFileSizeValid(fileSize: number): boolean {
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
  return fileSize <= MAX_FILE_SIZE;
}
