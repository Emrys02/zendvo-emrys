import { NextRequest, NextResponse } from "next/server";
import { createProblemDetails } from "@/lib/api-utils";
import {
  uploadToS3,
  isAllowedFileType,
  isFileSizeValid,
} from "@/lib/storage";

// Magic bytes for image type detection
const MAGIC_BYTES = {
  jpeg: [0xFF, 0xD8, 0xFF],
  png: [0x89, 0x50, 0x4E, 0x47],
  webp: [0x52, 0x49, 0x46, 0x46], // RIFF
};

function detectImageType(buffer: Buffer): string | null {
  if (buffer.length < 4) return null;

  // Check JPEG
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return "image/jpeg";
  }

  // Check PNG
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    return "image/png";
  }

  // Check WebP (RIFF + WEBP)
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
    if (buffer.length >= 12 && 
        buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
      return "image/webp";
    }
  }

  return null;
}

function getExtensionFromMimeType(mimeType: string): string {
  switch (mimeType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    default:
      return "jpg";
  }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "No file provided. Please upload a file with the 'file' field name."
      );
    }

    // Validate file size (10MB limit)
    const fileSize = file.size;
    if (!isFileSizeValid(fileSize)) {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "File size exceeds the 10MB limit."
      );
    }

    // Convert File to Buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Detect actual image type from magic bytes
    const detectedType = detectImageType(buffer);
    if (!detectedType || !isAllowedFileType(detectedType)) {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "Invalid file type. Only JPEG, PNG, and WebP images are allowed."
      );
    }

    // Generate safe filename with detected extension
    const extension = getExtensionFromMimeType(detectedType);
    const safeFileName = `upload.${extension}`;

    // Upload to S3 with detected type
    const publicUrl = await uploadToS3(buffer, safeFileName, detectedType);

    return NextResponse.json(
      {
        url: publicUrl,
        message: "File uploaded successfully",
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[IMAGE_UPLOAD_ERROR]", error);
    return createProblemDetails(
      "about:blank",
      "Internal Server Error",
      500,
      "Failed to upload image. Please try again later."
    );
  }
}
