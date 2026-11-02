// Simple circle packing: place the biggest bubble in the middle, then each next one at the closest free spot
// on a widening spiral. Bubble area is proportional to the number of tickets.
const GAP = 3;

function pack(list, k) {
  const placed = [];
  list.forEach((item, index) => {
    item.r = Math.max(5, k * Math.sqrt(item.count));
    if (index === 0) {
      item.x = 0;
      item.y = 0;
      placed.push(item);
      return;
    }
    for (let radius = 0; radius < 3000; radius += 3) {
      const steps = Math.max(16, Math.round(radius / 2.5));
      for (let s = 0; s < steps; s += 1) {
        const angle = (s / steps) * 2 * Math.PI + index * 0.7;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius * 0.62; // flatter than a circle, so the cloud is wide
        const free = placed.every((p) => {
          const dx = x - p.x;
          const dy = y - p.y;
          const min = item.r + p.r + GAP;
          return dx * dx + dy * dy >= min * min;
        });
        if (free) {
          item.x = x;
          item.y = y;
          placed.push(item);
          return;
        }
      }
    }
  });
  const box = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
  placed.forEach((p) => {
    box.x0 = Math.min(box.x0, p.x - p.r);
    box.x1 = Math.max(box.x1, p.x + p.r);
    box.y0 = Math.min(box.y0, p.y - p.r);
    box.y1 = Math.max(box.y1, p.y + p.r);
  });
  return box;
}

// groups: [{ label, count, other }] sorted by count, biggest first. Returns the same with cx, cy, r in a width x height box.
export function layoutBubbles(groups, width = 600, height = 380) {
  const list = groups.map((g) => ({ ...g }));
  if (!list.length) return [];
  const total = list.reduce((sum, g) => sum + g.count, 0);
  let k = Math.sqrt((0.55 * width * height) / (Math.PI * total)) * 1.15;
  let box = pack(list, k);
  for (let i = 0; i < 60 && (box.x1 - box.x0 > width - 16 || box.y1 - box.y0 > height - 16); i += 1) {
    k *= 0.96;
    box = pack(list, k);
  }
  const tx = width / 2 - (box.x0 + box.x1) / 2;
  const ty = height / 2 - (box.y0 + box.y1) / 2;
  return list.map((g) => ({ ...g, cx: g.x + tx, cy: g.y + ty }));
}
