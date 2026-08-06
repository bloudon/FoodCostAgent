import { useEffect } from "react";
import { X } from "lucide-react";

interface RecipePhotoLightboxProps {
  src: string;
  alt: string;
  onClose: () => void;
}

/**
 * Full-size image overlay. Closes on backdrop click, ✕ button, or Escape.
 */
export function RecipePhotoLightbox({ src, alt, onClose }: RecipePhotoLightboxProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
      data-testid="recipe-photo-lightbox-backdrop"
    >
      {/* Stop clicks on the image itself from closing the lightbox */}
      <div className="relative max-w-[90vw] max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
        <img
          src={src}
          alt={alt}
          className="max-w-[90vw] max-h-[90vh] rounded-lg object-contain shadow-2xl"
          data-testid="recipe-photo-lightbox-img"
        />
        <button
          onClick={onClose}
          className="absolute -top-3 -right-3 flex h-7 w-7 items-center justify-center rounded-full bg-white text-black shadow-md hover:bg-gray-100 transition-colors"
          aria-label="Close photo"
          data-testid="recipe-photo-lightbox-close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
