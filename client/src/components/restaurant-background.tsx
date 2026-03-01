const PHOTOS = [
  "1414235077428-338989a2e8c0",
  "1565299624946-b28f40a0ae38",
  "1504674900247-0877df9cc836",
  "1555396273-367ea4eb4db5",
  "1466637574441-749b8f19452f",
  "1476224203421-9ac39bcb3327",
  "1540189549336-e6e99c3679fe",
  "1567620905732-2d1ec7ab7445",
  "1493770348161-369560ae357d",
  "1490645935967-10de6ba17061",
  "1544025162-d76538084de9",
  "1559847844-5315695dadae",
];

export function RestaurantBackground() {
  return (
    <div className="fixed inset-0 z-0 overflow-hidden" aria-hidden="true">
      <div
        className="grid w-full h-full"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}
      >
        {Array.from({ length: 32 }).map((_, i) => {
          const id = PHOTOS[i % PHOTOS.length];
          return (
            <div key={i} className="overflow-hidden" style={{ height: "220px" }}>
              <img
                src={`https://images.unsplash.com/photo-${id}?w=400&h=260&fit=crop&q=60`}
                alt=""
                className="w-full h-full object-cover saturate-50 opacity-60"
                loading="lazy"
              />
            </div>
          );
        })}
      </div>
      <div className="absolute inset-0 bg-background/80" />
    </div>
  );
}
