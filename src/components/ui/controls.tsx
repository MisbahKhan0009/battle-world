import * as RadixSlider from '@radix-ui/react-slider';
import * as RadixSwitch from '@radix-ui/react-switch';
import * as RadixTooltip from '@radix-ui/react-tooltip';
import { useId, type ReactNode } from 'react';
import { cn } from '../../lib/utils';

export function Field({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={htmlFor} className="text-[13px] font-medium text-text">
          {label}
        </label>
        {hint && <span className="text-xs text-muted tabular">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format = (v) => String(v),
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className={cn('space-y-2.5', disabled && 'opacity-45')}>
      <div className="flex items-baseline justify-between gap-3">
        <span id={id} className="text-[13px] font-medium">
          {label}
        </span>
        <span className="text-xs text-muted tabular">{format(value)}</span>
      </div>
      <RadixSlider.Root
        className="relative flex h-5 w-full touch-none items-center select-none"
        value={[value]}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onValueChange={([v]) => onChange(v)}
        aria-labelledby={id}
      >
        <RadixSlider.Track className="relative h-1.5 grow overflow-hidden rounded-full bg-surface-3">
          <RadixSlider.Range className="absolute h-full rounded-full bg-accent" />
        </RadixSlider.Track>
        <RadixSlider.Thumb
          aria-label={label}
          className="block h-4.5 w-4.5 rounded-full border-2 border-accent bg-bg shadow-[0_0_0_4px_rgb(198_255_61/0.12)] transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/40"
        />
      </RadixSlider.Root>
    </div>
  );
}

export function Toggle({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className={cn('flex items-center justify-between gap-4 py-1', disabled && 'opacity-45')}>
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        <span className="block text-[13px] font-medium">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-muted">{description}</span>}
      </label>
      <RadixSwitch.Root
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
        className="relative h-6 w-10 shrink-0 rounded-full bg-surface-3 transition-colors data-[state=checked]:bg-accent"
      >
        <RadixSwitch.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-text shadow transition-transform duration-200 ease-[var(--ease-spring)] data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-accent-ink" />
      </RadixSwitch.Root>
    </div>
  );
}

export type SegmentOption<T extends string> = { value: T; label: ReactNode; title?: string };

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: T;
  options: SegmentOption<T>[];
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('grid gap-1 rounded-xl bg-bg/60 p-1 ring-1 ring-line', className)}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={o.title}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => {
              const i = options.findIndex((x) => x.value === value);
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                e.preventDefault();
                onChange(options[(i + 1) % options.length].value);
              } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                e.preventDefault();
                onChange(options[(i - 1 + options.length) % options.length].value);
              }
            }}
            tabIndex={active ? 0 : -1}
            className={cn(
              'flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 text-[13px] font-medium transition-colors',
              active
                ? 'bg-surface-3 text-text shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]'
                : 'text-muted hover:text-text',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Tip({
  content,
  children,
  side = 'top',
}: {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
}) {
  return (
    <RadixTooltip.Root delayDuration={300}>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={6}
          className="z-50 rounded-lg border border-line-strong bg-surface-2 px-2.5 py-1.5 text-xs text-text shadow-xl"
        >
          {content}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-line-strong bg-surface-2 px-1 font-sans text-[11px] text-muted">
      {children}
    </kbd>
  );
}

export const inputClass =
  'h-10 w-full rounded-xl border border-line-strong bg-bg/60 px-3 text-sm text-text placeholder:text-muted/70 transition-colors focus:border-accent/60 focus:outline-none focus-visible:outline-none focus:ring-2 focus:ring-accent/25';
