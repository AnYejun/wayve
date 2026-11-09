// Where each zone is, in words, from the zone polygons on the floor plan — so the assistants can give directions
// ("Lounge A is the left one of the middle row, next to Lounge B") for any venue, without anyone writing them down.
type Box = { name: string; x0: number; y0: number; x1: number; y1: number; cx: number; cy: number };

export function venueLayout(zones: Array<{ name: string; polygon_json: string }>): string[] {
  const boxes: Box[] = [];
  for (const z of zones) {
    let pts: Array<[number, number]> = [];
    try { pts = JSON.parse(z.polygon_json) as Array<[number, number]>; } catch { /* no shape */ }
    if (!Array.isArray(pts) || pts.length < 3) continue;
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    boxes.push({ name: z.name, x0, x1, y0, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 });
  }
  if (boxes.length < 2) return [];
  const X0 = Math.min(...boxes.map((b) => b.x0)), X1 = Math.max(...boxes.map((b) => b.x1));
  const Y0 = Math.min(...boxes.map((b) => b.y0)), Y1 = Math.max(...boxes.map((b) => b.y1));
  const third = (v: number, a: number, b: number, w: [string, string, string]) => w[Math.max(0, Math.min(2, Math.floor(((v - a) / Math.max(1, b - a)) * 3)))];
  const gap = Math.max(X1 - X0, Y1 - Y0) * 0.1; // walkways between zones still count as "next to"
  return boxes.map((b) => {
    const v = third(b.cy, Y0, Y1, ['top', 'middle', 'bottom']), h = third(b.cx, X0, X1, ['left', 'center', 'right']);
    const near: string[] = [];
    for (const o of boxes) {
      if (o === b) continue;
      const xo = Math.min(b.x1, o.x1) - Math.max(b.x0, o.x0), yo = Math.min(b.y1, o.y1) - Math.max(b.y0, o.y0);
      if (xo > 0 && yo <= 0 && -yo <= gap) near.push(`${o.name} (${o.cy > b.cy ? 'below' : 'above'})`);
      else if (yo > 0 && xo <= 0 && -xo <= gap) near.push(`${o.name} (${o.cx > b.cx ? 'right' : 'left'})`);
    }
    return `- ${b.name}: ${v === 'middle' && h === 'center' ? 'center' : `${v} ${h}`} of the floor plan${near.length ? `; next to ${near.join(', ')}` : ''}`;
  });
}
