import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";

interface BgImage {
  id?: string;
  url: string;
  label?: string;
}

interface BgResponse {
  images: BgImage[];
  isBranded: boolean;
}

interface Props {
  companyId?: string;
}

export function RestaurantBackground({ companyId }: Props) {
  const { data } = useQuery<BgResponse>({
    queryKey: ["/api/background-images", companyId ?? ""],
    queryFn: async () => {
      const url = companyId
        ? `/api/background-images?companyId=${companyId}`
        : "/api/background-images";
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to load background images");
      return res.json();
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  const photos: BgImage[] = data?.images ?? [];
  const isBranded = data?.isBranded ?? false;

  const [slotA, setSlotA] = useState(0);
  const [slotB, setSlotB] = useState(1);
  const [activeSlot, setActiveSlot] = useState<"a" | "b">("a");
  const indexRef = useRef(1);

  useEffect(() => {
    if (photos.length <= 1) return; // no rotation for single/zero images
    const interval = setInterval(() => {
      const nextIndex = (indexRef.current + 1) % photos.length;
      if (activeSlot === "a") {
        setSlotB(nextIndex);
        setTimeout(() => setActiveSlot("b"), 50);
      } else {
        setSlotA(nextIndex);
        setTimeout(() => setActiveSlot("a"), 50);
      }
      indexRef.current = nextIndex;
    }, 10000);
    return () => clearInterval(interval);
  }, [activeSlot, photos.length]);

  const FADE = "transition-opacity duration-[1500ms] ease-in-out";

  if (photos.length === 0) {
    return (
      <div className="fixed inset-0 z-0 overflow-hidden bg-slate-900" aria-hidden="true">
        <div className="absolute inset-0 bg-background/35" style={{ zIndex: 2 }} />
      </div>
    );
  }

  if (photos.length === 1 || isBranded) {
    return (
      <div className="fixed inset-0 z-0 overflow-hidden" aria-hidden="true">
        <img
          src={photos[0].url}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-background/35" style={{ zIndex: 2 }} />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-0 overflow-hidden" aria-hidden="true">
      <img
        src={photos[slotA]?.url}
        alt=""
        className={`absolute inset-0 w-full h-full object-cover ${FADE}`}
        style={{ opacity: activeSlot === "a" ? 1 : 0 }}
      />
      <img
        src={photos[slotB]?.url}
        alt=""
        className={`absolute inset-0 w-full h-full object-cover ${FADE}`}
        style={{ opacity: activeSlot === "b" ? 1 : 0 }}
      />
      <div className="absolute inset-0 bg-background/35" style={{ zIndex: 2 }} />
    </div>
  );
}
