"use client";

import Image from "next/image";
import { ChangeEvent, useState, HTMLAttributes } from "react";
import clsx from "clsx";

interface ImageUploadProps extends HTMLAttributes<HTMLDivElement> {
  onUpload?: (avatarUrl: string) => void;
  isUploading?: boolean;
  authToken?: string;
}

const ImageUpload = ({
  className,
  onUpload,
  isUploading = false,
  authToken,
  ...props
}: ImageUploadProps) => {
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);

    if (file.size > 10 * 1024 * 1024) {
      setError("File is too large! Maximum allowed size is 10MB.");
      e.target.value = "";
      return;
    }

    if (!["image/jpeg", "image/png"].includes(file.type)) {
      setError("Please select a JPEG or PNG image file.");
      e.target.value = "";
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setPreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  };

  const removeImage = () => {
    setPreview(null);
    setError(null);
  };

  const handleUpload = async () => {
    if (!preview || !authToken) {
      setError("Missing file or authentication token");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const fileInput = document.querySelector(
        'input[type="file"]'
      ) as HTMLInputElement;
      const file = fileInput?.files?.[0];

      if (!file) {
        throw new Error("No file selected");
      }

      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/users/avatar", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          errorData.detail || "Failed to upload avatar"
        );
      }

      const data = await response.json();
      if (data.user?.avatarUrl) {
        onUpload?.(data.user.avatarUrl);
        setPreview(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  const containerClasses = clsx(
    "relative rounded-3xl border-2 border-dashed border-[#E1E1E5] bg-[#F7F7FC] shadow-sm overflow-hidden",
    "aspect-[4/3]",
  );

  if (preview) {
    return (
      <div className={clsx("mx-auto w-full", className)} {...props}>
        <div className={containerClasses}>
          <Image src={preview} alt="Preview" fill className="object-cover" />
          <div className="absolute top-0 right-0 px-6 py-5 flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={removeImage}
              disabled={isSubmitting}
              className={`
              h-8.5 w-8.5     
              flex items-center justify-center
              rounded-full
              bg-[#E4EFFD]/80 hover:bg-[#E4EFFD]
              border-2 border-[#5A42DE]/30 border-dotted
              text-[#5A42DE] text-lg font-medium
              transition-colors
              cursor-pointer
              disabled:opacity-50 disabled:cursor-not-allowed
            `}
            >
              ×
            </button>
          </div>
        </div>
        {error && (
          <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}
        <div className="mt-4 flex gap-3">
          <button
            type="button"
            onClick={removeImage}
            disabled={isSubmitting}
            className="flex-1 px-4 py-2.5 border border-[#5A42DE] text-[#5A42DE] rounded-xl font-medium transition-colors hover:bg-[#F7F7FC] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleUpload}
            disabled={isSubmitting || !authToken}
            className="flex-1 px-4 py-2.5 bg-[#5A42DE] text-white rounded-xl font-medium transition-colors hover:bg-[#4b35e5] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? "Uploading..." : "Upload"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={clsx("mx-auto w-full", className)} {...props}>
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}
      <label className="block cursor-pointer h-full w-full">
        <div className="flex flex-col justify-center items-center h-full rounded-3xl border-2 border-dashed border-[#E1E1E5] bg-[#F7F7FC] px-6 py-12 text-center transition-colors hover:border-[#5A42DE] hover:bg-blue-50/50 focus-within:border-[[#5A42DE]] focus-within:bg-blue-50/50">
          <div className="mx-auto mb-5 flex h-8 w-8 rounded-full border border-dashed bg-[#E4EFFD]  items-center justify-center border-[#5A42DE] text-4xl font-bold text-white shadow-sm">
            <p className="text-[#5A42DE] font-br-firma text-2xl font-light">
              +
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <p className="font-br-firma font-semibold text-base leading-6 text-center text-[#1F2937]">
              Tap to upload
            </p>
            <p className="font-br-firma font-medium text-[12px] leading-3 text-center text-[#1F2937]">
              JPEG or PNG, max 10MB
            </p>
          </div>
        </div>
        <input
          type="file"
          accept="image/jpeg,image/png"
          onChange={handleFileChange}
          disabled={isUploading || isSubmitting}
          className="hidden"
        />
      </label>
    </div>
  );
};

export default ImageUpload;
