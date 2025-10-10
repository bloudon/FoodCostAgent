import { useState } from "react";
import Uppy from "@uppy/core";
import { DashboardModal } from "@uppy/react";
import AwsS3 from "@uppy/aws-s3";
import type { UploadResult } from "@uppy/core";
import { Button } from "@/components/ui/button";

interface SimpleObjectUploaderProps {
  onUploadComplete: (url: string) => void;
  buttonText?: string;
  dataTestId?: string;
  maxFileSize?: number;
  buttonVariant?: "default" | "outline" | "secondary" | "ghost" | "link" | "destructive";
}

/**
 * Simplified object uploader component for single-file image uploads.
 * Automatically fetches presigned URL from backend and uploads to object storage.
 */
export function ObjectUploader({
  onUploadComplete,
  buttonText = "Upload Image",
  dataTestId = "button-upload-image",
  maxFileSize = 10485760, // 10MB default
  buttonVariant = "outline",
}: SimpleObjectUploaderProps) {
  const [showModal, setShowModal] = useState(false);
  const [uppy] = useState(() =>
    new Uppy({
      restrictions: {
        maxNumberOfFiles: 1,
        maxFileSize,
        allowedFileTypes: ['image/*'],
      },
      autoProceed: false,
    })
      .use(AwsS3, {
        shouldUseMultipart: false,
        getUploadParameters: async () => {
          // Fetch presigned URL from backend
          const response = await fetch("/api/objects/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
          });
          
          if (!response.ok) {
            throw new Error("Failed to get upload URL");
          }
          
          const data = await response.json();
          return {
            method: "PUT" as const,
            url: data.uploadUrl,
          };
        },
      })
      .on("complete", (result: UploadResult) => {
        // Extract uploaded file URL and call completion handler
        if (result.successful && result.successful[0]) {
          const uploadedFile = result.successful[0];
          const uploadUrl = uploadedFile.uploadURL;
          
          if (uploadUrl) {
            // Extract object path from the full URL
            const url = new URL(uploadUrl);
            const objectPath = url.pathname;
            onUploadComplete(objectPath);
          }
        }
        setShowModal(false);
      })
  );

  return (
    <div>
      <Button 
        onClick={() => setShowModal(true)} 
        variant={buttonVariant}
        type="button"
        data-testid={dataTestId}
      >
        {buttonText}
      </Button>

      <DashboardModal
        uppy={uppy}
        open={showModal}
        onRequestClose={() => setShowModal(false)}
        proudlyDisplayPoweredByUppy={false}
      />
    </div>
  );
}
