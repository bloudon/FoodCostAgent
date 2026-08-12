import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Upload, Loader2 } from "lucide-react";
import { isHeicFile, normalizeImageUpload } from "@/lib/normalizeImageUpload";

interface SimpleObjectUploaderProps {
  onUploadComplete: (url: string, file?: File) => void;
  onMultipleUploadsComplete?: (urls: string[], files?: File[]) => void;
  multiple?: boolean;
  buttonText?: string;
  dataTestId?: string;
  maxFileSize?: number;
  buttonVariant?: "default" | "outline" | "secondary" | "ghost" | "destructive";
  visibility?: "public" | "private";
  capture?: "environment" | "user";
  icon?: React.ReactNode;
  accept?: string;
}

export function ObjectUploader({
  onUploadComplete,
  onMultipleUploadsComplete,
  multiple = false,
  buttonText = "Upload Image",
  dataTestId = "button-upload-image",
  maxFileSize = 20971520,
  buttonVariant = "outline",
  visibility = "private",
  capture,
  icon,
  accept = "image/*",
}: SimpleObjectUploaderProps) {
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadSingleFile = async (file: File): Promise<{ path: string; file: File }> => {
    if (file.size > maxFileSize) {
      throw new Error(`File "${file.name}" is too large. Maximum size is ${Math.round(maxFileSize / 1024 / 1024)}MB.`);
    }

    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    // Browsers often report an empty or generic MIME type for HEIC/HEIF, so
    // recognize those by name too — otherwise an iPhone photo would be refused
    // here before it ever reached conversion.
    const isImage = file.type.startsWith("image/") || isHeicFile(file);
    if (!isPdf && !isImage) {
      throw new Error(`"${file.name}" is not a supported file type. Please upload an image or PDF.`);
    }

    const uploadFile = isPdf ? file : await normalizeImageUpload(file);
    if (uploadFile.size > maxFileSize) {
      throw new Error(`File "${uploadFile.name}" is too large after conversion. Maximum size is ${Math.round(maxFileSize / 1024 / 1024)}MB.`);
    }

    const formData = new FormData();
    formData.append("file", uploadFile);
    formData.append("visibility", visibility);

    const response = await fetch("/api/objects/upload", {
      method: "POST",
      credentials: "include",
      body: formData,
    });

    if (!response.ok) {
      const message = await response
        .json()
        .then((body) => body?.error)
        .catch(() => null);
      throw new Error(message || "Upload failed");
    }

    const data = await response.json();

    if (data.objectPath) {
      return { path: data.objectPath, file: uploadFile };
    } else if (data.uploadUrl) {
      const putResponse = await fetch(data.uploadUrl, {
        method: "PUT",
        body: uploadFile,
        headers: { "Content-Type": uploadFile.type },
      });
      if (!putResponse.ok) {
        throw new Error("Failed to upload to storage");
      }

      // Claim the object: sets the current user as ACL owner and normalizes
      // any format the browser could not convert before it is used anywhere.
      const finalizeResponse = await fetch("/api/objects/finalize", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadUrl: data.uploadUrl, visibility }),
      });
      if (!finalizeResponse.ok) {
        const message = await finalizeResponse
          .json()
          .then((body) => body?.error)
          .catch(() => null);
        throw new Error(message || "Failed to finalize upload");
      }
      const finalized = await finalizeResponse.json();
      if (!finalized.objectPath) {
        throw new Error("No object path returned from upload");
      }
      return { path: finalized.objectPath, file: uploadFile };
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
        const fileList: File[] = [];
        for (let i = 0; i < files.length; i++) {
          const upload = await uploadSingleFile(files[i]);
          paths.push(upload.path);
          fileList.push(upload.file);
        }
        onMultipleUploadsComplete(paths, fileList);
      } else {
        const upload = await uploadSingleFile(files[0]);
        onUploadComplete(upload.path, upload.file);
      }
    } catch (error: any) {
      console.error("Upload error:", error);
      alert(error?.message || "Failed to upload file. Please try again.");
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
        accept={accept}
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
