import { useState, useEffect, useRef } from "react";

const PHOTOS = [
  "1414235077428-338989a2e8c0",
  "1555396273-367ea4eb4db5",
  "1565299624946-b28f40a0ae38",
  "1493770348161-369560ae357d",
  "1504674900247-0877df9cc836",
  "1466637574441-749b8f19452f",
  "1476224203421-9ac39bcb3327",
  "1567620905732-2d1ec7ab7445",
  "1490645935967-10de6ba17061",
  "1544025162-d76538084de9",
];

function photoUrl(id: string) {
  return `https://images.unsplash.com/photo-${id}?w=1600&h=900&fit=crop&q=80`;
}

export function RestaurantBackground() {
  // Two image slots — we alternate which one is the "active" top image
  const [slotA, setSlotA] = useState(0);   // index into PHOTOS
  const [slotB, setSlotB] = useState(1);   // index into PHOTOS
  const [activeSlot, setActiveSlot] = useState<"a" | "b">("a"); // which is on top
  const indexRef = useRef(1); // next photo to load

  useEffect(() => {
    const interval = setInterval(() => {
      const nextIndex = (indexRef.current + 1) % PHOTOS.length;

      if (activeSlot === "a") {
        // Load next photo into slot B (currently behind), then bring it to front
        setSlotB(nextIndex);
        setTimeout(() => setActiveSlot("b"), 50); // tiny delay to let src settle
      } else {
        setSlotA(nextIndex);
        setTimeout(() => setActiveSlot("a"), 50);
      }
      indexRef.current = nextIndex;
    }, 7000);

    return () => clearInterval(interval);
  }, [activeSlot]);

  const FADE = "transition-opacity duration-[1500ms] ease-in-out";

  return (
    <div className="fixed inset-0 z-0 overflow-hidden" aria-hidden="true">
      {/* Slot A */}
      <img
        src={photoUrl(PHOTOS[slotA])}
        alt=""
        className={`absolute inset-0 w-full h-full object-cover ${FADE}`}
        style={{ opacity: activeSlot === "a" ? 1 : 0 }}
      />
      {/* Slot B */}
      <img
        src={photoUrl(PHOTOS[slotB])}
        alt=""
        className={`absolute inset-0 w-full h-full object-cover ${FADE}`}
        style={{ opacity: activeSlot === "b" ? 1 : 0 }}
      />
      {/* Light muting overlay */}
      <div className="absolute inset-0 bg-background/35" style={{ zIndex: 2 }} />
    </div>
  );
}
