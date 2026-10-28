import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
  dismissible = true,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  dismissible?: boolean;
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={(o) => (dismissible || o ? onOpenChange(o) : undefined)}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px] data-[state=open]:animate-[fade-in_150ms_ease-out]" />
        <RadixDialog.Content
          onEscapeKeyDown={(e) => !dismissible && e.preventDefault()}
          onPointerDownOutside={(e) => !dismissible && e.preventDefault()}
          className={cn(
            'panel fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-32px)] w-[calc(100vw-32px)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto p-6 shadow-2xl scrollbar-thin focus:outline-none data-[state=open]:animate-[dialog-in_200ms_var(--ease-spring)]',
            className,
          )}
        >
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <RadixDialog.Title className="font-display text-3xl leading-none">{title}</RadixDialog.Title>
              {description ? (
                <RadixDialog.Description className="mt-2 text-sm text-muted">
                  {description}
                </RadixDialog.Description>
              ) : (
                <RadixDialog.Description className="sr-only">{title}</RadixDialog.Description>
              )}
            </div>
            {dismissible && (
              <RadixDialog.Close
                className="-mt-1 -mr-2 rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-text"
                aria-label="Close"
              >
                <X size={18} />
              </RadixDialog.Close>
            )}
          </div>
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
