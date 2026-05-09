import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Upload, Loader2 } from "lucide-react";

interface SimpleObjectUploaderProps {
  onUploadComplete: (url: string) => void;
  onMultipleUploadsComplete?: (urls: string[]) => void;
  multiple?: boolean;
  buttonText?: string;
  dataTestId?: string;
  maxFileSize?: number;
  buttonVariant?: "default" | "outline" | "secondary" | "ghost" | "destructive";
  visibility?: "public" | "private";
  capture?: "environment" | "user";
  icon?: React.ReactNode;
}

export function ObjectUploader({
  onUploadComplete,
  onMultipleUploadsComplete,
  multiple = false,
  buttonText = "Upload Image",
  dataTestId = "button-upload-image",
  maxFileSize = 10485760,
  buttonVariant = "outline",
  visibility = "private",
  capture,
  icon,
}: SimpleObjectUploaderProps) {
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadSingleFile = async (file: File): Promise<string> => {
    if (file.size > maxFileSize) {
      throw new Error(`File "${file.name}" is too large. Maximum size is ${Math.round(maxFileSize / 1024 / 1024)}MB.`);
    }
    if (!file.type.startsWith("image/")) {
      throw new Error(`"${file.name}" is not an image file.`);
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("visibility", visibility);

    const response = await fetch("/api/objects/upload", {
      method: "POST",
      credentials: "include",
      body: formData,
    });

    if (!response.ok) {
      throw new Error("Upload failed");
    }

    const data = await response.json();

    if (data.objectPath) {
      return data.objectPath;
    } else if (data.uploadUrl) {
      const putResponse = await fetch(data.uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      if (!putResponse.ok) {
        throw new Error("Failed to upload to storage");
      }
      const url = new URL(data.uploadUrl);
      return url.pathname;
    }

    throw new Error("No object path returned from upload");
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    try {
      if (multiple && files.length > 1 && onMultipleUploadsComplete) {
        const paths: string[] = [];
        for (let i = 0; i < files.length; i++) {
          const path = await uploadSingleFile(files[i]);
          paths.push(path);
        }
        onMultipleUploadsComplete(paths);
      } else {
        const path = await uploadSingleFile(files[0]);
        onUploadComplete(path);
      }
    } catch (error: any) {
      console.error("Upload error:", error);
      alert(error?.message || "Failed to upload image. Please try again.");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  return (
    <div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture={capture}
        multiple={multiple}
        onChange={handleFileSelect}
        className="hidden"
        data-testid={`${dataTestId}-input`}
      />
      <Button
        onClick={() => fileInputRef.current?.click()}
        variant={buttonVariant}
        type="button"
        disabled={isUploading}
        data-testid={dataTestId}
      >
        {isUploading ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : icon ? (
          <span className="mr-2 flex items-center">{icon}</span>
        ) : (
          <Upload className="mr-2 h-4 w-4" />
        )}
        {isUploading ? "Uploading..." : buttonText}
      </Button>
    </div>
  );
}
