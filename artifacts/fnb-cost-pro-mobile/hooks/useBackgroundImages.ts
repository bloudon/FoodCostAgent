import { useEffect, useState } from "react";

const BG_IMAGES_URL = "https://app.fnbcostpro.com/api/mobile/background-images";
const BASE_URL = "https://app.fnbcostpro.com";

export interface BackgroundImage {
  id: string;
  url: string;
  label: string;
}

export function useBackgroundImages() {
  const [images, setImages] = useState<BackgroundImage[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    fetch(BG_IMAGES_URL)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: unknown) => {
        if (!mounted) return;
        const raw: unknown[] = (() => {
          if (!data) return [];
          if (Array.isArray(data)) return data;
          if (
            typeof data === "object" &&
            "images" in data &&
            Array.isArray((data as { images: unknown }).images)
          ) {
            return (data as { images: unknown[] }).images;
          }
          return [];
        })();
        const valid = raw
          .filter(
            (item): item is BackgroundImage =>
              typeof item === "object" &&
              item !== null &&
              typeof (item as { url?: unknown }).url === "string" &&
              (item as { url: string }).url.length > 0 &&
              typeof (item as { id?: unknown }).id === "string"
          )
          .map((item) => ({
            ...item,
            url: item.url.startsWith("http") ? item.url : `${BASE_URL}${item.url}`,
          }));
        setImages(valid);
      })
      .catch(() => {
        // silent failure — no backgrounds, solid fallback shows
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  return { images, isLoading };
}
