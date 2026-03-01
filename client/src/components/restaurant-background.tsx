import { useState, useEffect, useRef } from "react";

const PHOTOS = [
  // Restaurant / food / pizza
  "1414235077428-338989a2e8c0",
  "1555396273-367ea4eb4db5",
  "1565299624946-b28f40a0ae38",
  "1504674900247-0877df9cc836",
  "1466637574441-749b8f19452f",
  "1476224203421-9ac39bcb3327",
  "1567620905732-2d1ec7ab7445",
  "1490645935967-10de6ba17061",
  "1544025162-d76538084de9",
  // Commercial kitchen line
  "1493770348161-369560ae357d",
  "1764099529429-694179333425",
  "1760001553414-5634201efc36",
  "1663040086477-c8302f1244c6",
  "1661883327374-4372312b8bd3",
  "1764202466120-400d3d9e1783",
  "1671656200343-d2a322492223",
  "1557573791-7ab7d3d68932",
  // Walk-in cooler / commercial refrigerator / freezer
  "1759547118069-38be3895faa1",
  "1771788816650-5f943e63a029",
  "1591640375708-6a976b40547b",
  "1661780384432-cd62303b1cb1",
];

function photoUrl(id: string) {
  return `https://images.unsplash.com/photo-${id}?w=1600&h=900&fit=crop&q=80`;
}

export function RestaurantBackground() {
  // Two image slots — we alternate which one is the "active" top image
  const [slotA, setSlotA] = useState(0);
  const [slotB, setSlotB] = useState(1);
  const [activeSlot, setActiveSlot] = useState<"a" | "b">("a");
  const indexRef = useRef(1);

  useEffect(() => {
    const interval = setInterval(() => {
      const nextIndex = (indexRef.current + 1) % PHOTOS.length;

      if (activeSlot === "a") {
        setSlotB(nextIndex);
        setTimeout(() => setActiveSlot("b"), 50);
      } else {
        setSlotA(nextIndex);
        setTimeout(() => setActiveSlot("a"), 50);
      }
      indexRef.current = nextIndex;
    }, 10000); // rotate every 10 seconds

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
