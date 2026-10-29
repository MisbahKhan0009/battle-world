/**
 * Smooth outlines for land kept on a grid (marching squares on a softened field). Each owner's
 * cells are blurred over their 3x3 neighbourhood, and every 2x2 block of cell centers contributes
 * the piece of the region where that field is at least one half, cutting its edges where the field
 * crosses one half. Blobs of land read as smooth, rounded shapes instead of stair steps, and two
 * neighbours meet on the same line.
 */

/**
 * Fill paths for every owner of a grid (values 1..owners; 0 is nobody), `cell` pixels per cell.
 * Land on the board's edge reaches the edge.
 */
export function landPaths(grid: Uint8Array, size: number, owners: number, cell: number): Path2D[] {
  const paths = Array.from({ length: owners }, () => new Path2D());
  const clamp = (v: number) => Math.min(size - 1, Math.max(0, v));
  const field = new Float32Array(size * size);
  const tmp = new Float32Array(size * size);
  const half = cell / 2;
  const present = new Set(grid);
  for (let o = 1; o <= owners; o++) {
    if (!present.has(o)) continue;
    // Separable 3x3 box blur of "owned by o".
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const r = y * size;
        tmp[r + x] =
          (grid[r + clamp(x - 1)] === o ? 1 : 0) +
          (grid[r + x] === o ? 1 : 0) +
          (grid[r + clamp(x + 1)] === o ? 1 : 0);
      }
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++)
        field[y * size + x] =
          (tmp[clamp(y - 1) * size + x] + tmp[y * size + x] + tmp[clamp(y + 1) * size + x]) / 9;
    const f = (x: number, y: number) => field[clamp(y) * size + clamp(x)];
    const p = paths[o - 1];
    for (let y = -1; y < size; y++) {
      const py = y * cell + half;
      let runStart = 0;
      let inRun = false;
      const flush = (end: number) => {
        if (inRun) p.rect(runStart * cell + half, py, (end - runStart) * cell, cell);
        inRun = false;
      };
      for (let x = -1; x < size; x++) {
        // Corners clockwise from top left, with their field values.
        const v = [f(x, y), f(x + 1, y), f(x + 1, y + 1), f(x, y + 1)];
        const cx = [0, 1, 1, 0];
        const cy = [0, 0, 1, 1];
        const inside = v.map((a) => a >= 0.5);
        const count = inside.filter(Boolean).length;
        if (count === 4) {
          if (!inRun) {
            runStart = x;
            inRun = true;
          }
          continue;
        }
        flush(x);
        if (!count) continue;
        const px = x * cell + half;
        let first = true;
        const to = (u: number, w: number) => {
          if (first) p.moveTo(px + u * cell, py + w * cell);
          else p.lineTo(px + u * cell, py + w * cell);
          first = false;
        };
        for (let k = 0; k < 4; k++) {
          const j = (k + 1) & 3;
          if (inside[k]) to(cx[k], cy[k]);
          if (inside[k] !== inside[j]) {
            const t = (0.5 - v[k]) / (v[j] - v[k]);
            to(cx[k] + (cx[j] - cx[k]) * t, cy[k] + (cy[j] - cy[k]) * t);
          }
        }
        p.closePath();
      }
      flush(size);
    }
  }
  return paths;
}
