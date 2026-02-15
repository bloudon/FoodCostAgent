import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Upload, Loader2 } from "lucide-react";

interface SimpleObjectUploaderProps {
  onUploadComplete: (url: string) => void;
  buttonText?: string;
  dataTestId?: string;
  maxFileSize?: number;
  buttonVariant?: "default" | "outline" | "secondary" | "ghost" | "destructive";
}

export function ObjectUploader({
  onUploadComplete,
  buttonText = "Upload Image",
  dataTestId = "button-upload-image",
  maxFileSize = 10485760,
  buttonVariant = "outline",
}: SimpleObjectUploaderProps) {
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > maxFileSize) {
      alert(`File too large. Maximum size is ${Math.round(maxFileSize / 1024 / 1024)}MB.`);
      return;
    }

    if (!file.type.startsWith("image/")) {
      alert("Only image files are allowed.");
      return;
    }

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

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
        onUploadComplete(data.objectPath);
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
        onUploadComplete(url.pathname);
      }
    } catch (error) {
      console.error("Upload error:", error);
      alert("Failed to upload image. Please try again.");
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
        ) : (
          <Upload className="mr-2 h-4 w-4" />
        )}
        {isUploading ? "Uploading..." : buttonText}
      </Button>
    </div>
  );
}
