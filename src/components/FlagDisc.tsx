import { useImageUrl } from '../hooks/useImageUrl';
import { cn } from '../lib/utils';

export function FlagDisc({
  src,
  size = 28,
  className,
  ring = true,
}: {
  src: string;
  size?: number;
  className?: string;
  ring?: boolean;
}) {
  const url = useImageUrl(src);
  return (
    <span
      className={cn(
        'relative inline-block shrink-0 overflow-hidden rounded-full bg-surface-3',
        ring && 'ring-2 ring-white/90',
        className,
      )}
      style={{ width: size, height: size }}
    >
      {url && (
        <img
          src={url}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
          draggable={false}
        />
      )}
    </span>
  );
}
