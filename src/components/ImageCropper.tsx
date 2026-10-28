import { useEffect, useRef, useState } from 'react';
import { Button } from './ui/Button';
import { Slider } from './ui/controls';

const VIEW = 240;
const OUT = 512;

/** Circle crop with zoom and drag-to-pan. Outputs a square PNG (the circle is applied at render). */
export function ImageCropper({
  file,
  onCancel,
  onDone,
}: {
  file: File;
  onCancel: () => void;
  onDone: (blob: Blob) => void;
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const el = new Image();
    el.src = url;
    el.decode()
      .then(() => setImg(el))
      .catch(() => setError('This image could not be read. Try a PNG, JPG or SVG file.'));
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const w = img?.naturalWidth || VIEW;
  const h = img?.naturalHeight || VIEW;
  const scale = Math.max(VIEW / w, VIEW / h) * zoom;
  const maxX = Math.max(0, (w * scale - VIEW) / 2);
  const maxY = Math.max(0, (h * scale - VIEW) / 2);
  const ox = Math.max(-maxX, Math.min(maxX, off.x));
  const oy = Math.max(-maxY, Math.min(maxY, off.y));

  const nudge = (dx: number, dy: number) => setOff({ x: ox + dx, y: oy + dy });

  const apply = async () => {
    if (!img) return;
    const c = document.createElement('canvas');
    c.width = c.height = OUT;
    const ctx = c.getContext('2d')!;
    const k = OUT / VIEW;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(
      img,
      OUT / 2 + ox * k - (w * scale * k) / 2,
      OUT / 2 + oy * k - (h * scale * k) / 2,
      w * scale * k,
      h * scale * k,
    );
    c.toBlob((b) => b && onDone(b), 'image/png');
  };

  if (error) {
    return (
      <div className="space-y-4">
        <p className="rounded-xl bg-danger/10 p-3 text-sm text-danger">{error}</p>
        <Button onClick={onCancel}>Back</Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div
        className="checker relative mx-auto touch-none overflow-hidden rounded-full ring-4 ring-white/90 select-none focus-visible:ring-accent"
        style={{ width: VIEW, height: VIEW, cursor: 'grab' }}
        tabIndex={0}
        role="application"
        aria-label="Crop area. Drag or use arrow keys to move the image."
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, ox, oy };
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          setOff({
            x: drag.current.ox + e.clientX - drag.current.x,
            y: drag.current.oy + e.clientY - drag.current.y,
          });
        }}
        onPointerUp={() => (drag.current = null)}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 20 : 5;
          if (e.key === 'ArrowLeft') nudge(-step, 0);
          else if (e.key === 'ArrowRight') nudge(step, 0);
          else if (e.key === 'ArrowUp') nudge(0, -step);
          else if (e.key === 'ArrowDown') nudge(0, step);
          else return;
          e.preventDefault();
        }}
      >
        {img && (
          <img
            src={img.src}
            alt=""
            draggable={false}
            className="pointer-events-none absolute max-w-none"
            style={{
              width: w * scale,
              height: h * scale,
              left: VIEW / 2 + ox - (w * scale) / 2,
              top: VIEW / 2 + oy - (h * scale) / 2,
            }}
          />
        )}
      </div>
      <Slider
        label="Zoom"
        value={zoom}
        min={1}
        max={4}
        step={0.01}
        onChange={setZoom}
        format={(v) => `${v.toFixed(2)}×`}
      />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={apply} disabled={!img}>
          Use image
        </Button>
      </div>
    </div>
  );
}
