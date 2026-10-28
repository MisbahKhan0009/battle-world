import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
type Size = 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm';

const variants: Record<Variant, string> = {
  primary:
    'bg-accent text-accent-ink hover:brightness-110 active:brightness-95 shadow-[0_0_0_1px_rgb(198_255_61/0.4),0_8px_24px_-8px_rgb(198_255_61/0.55)] font-semibold',
  secondary: 'bg-surface-2 text-text hover:bg-surface-3 border border-line-strong',
  outline: 'bg-transparent text-text border border-line-strong hover:bg-surface-2',
  ghost: 'bg-transparent text-muted hover:text-text hover:bg-surface-2',
  danger: 'bg-danger/12 text-danger hover:bg-danger/20 border border-danger/30',
};

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-12 px-6 text-[15px] gap-2.5 rounded-xl',
  icon: 'h-10 w-10 rounded-xl justify-center',
  'icon-sm': 'h-8 w-8 rounded-lg justify-center',
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', className, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex shrink-0 items-center whitespace-nowrap transition-[filter,background-color,color,transform] duration-150 select-none active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
});
