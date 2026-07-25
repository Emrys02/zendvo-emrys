"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadToS3 = uploadToS3;
exports.isAllowedFileType = isAllowedFileType;
exports.isFileSizeValid = isFileSizeValid;
const client_s3_1 = require("@aws-sdk/client-s3");
const nanoid_1 = require("nanoid");
// S3 Client configuration
const s3ClientConfig = {
    region: process.env.AWS_REGION || "us-east-1",
};
// Only include credentials if both are present, otherwise use default credential chain
if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    s3ClientConfig.credentials = {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    };
}
const s3Client = new client_s3_1.S3Client(s3ClientConfig);
const S3_BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME || "zendvo-uploads";
/**
 * Upload a file buffer to S3 and return the public URL
 * @param fileBuffer - The file buffer to upload
 * @param fileName - The original file name
 * @param contentType - The MIME type of the file
 * @returns The public URL of the uploaded file
 */
async function uploadToS3(fileBuffer, fileName, contentType) {
    // Generate a unique file name to prevent collisions
    const fileExtension = fileName.split(".").pop() || "jpg";
    const uniqueFileName = `uploads/${(0, nanoid_1.nanoid)()}.${fileExtension}`;
    const uploadParams = {
        Bucket: S3_BUCKET_NAME,
        Key: uniqueFileName,
        Body: fileBuffer,
        ContentType: contentType,
    };
    try {
        await s3Client.send(new client_s3_1.PutObjectCommand(uploadParams));
        // Construct the public URL
        const publicUrl = `https://${S3_BUCKET_NAME}.s3.${process.env.AWS_REGION || "us-east-1"}.amazonaws.com/${uniqueFileName}`;
        return publicUrl;
    }
    catch (error) {
        console.error("[S3_UPLOAD_ERROR]", error);
        throw new Error("Failed to upload file to S3");
    }
}
/**
 * Validate if a file type is allowed
 * @param contentType - The MIME type to validate
 * @returns True if the file type is allowed
 */
function isAllowedFileType(contentType) {
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
function isFileSizeValid(fileSize) {
    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
    return fileSize <= MAX_FILE_SIZE;
}
