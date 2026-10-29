/** The one-minute warning before the computer sleeps or shuts down after a batch, with Cancel. */
import { Moon, Power } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { cancelPower, pendingPower, useAutopilot } from '../../desktop/runtime';

export function PowerCountdown() {
  useAutopilot();
  const pending = pendingPower();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!pending) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [pending]);
  if (!pending) return null;
  const left = Math.max(0, Math.ceil((pending.at - now) / 1000));
  const sleep = pending.kind === 'sleep';
  return (
    <Dialog
      open
      onOpenChange={() => undefined}
      dismissible={false}
      title={sleep ? 'Going to sleep' : 'Shutting down'}
      description="Your videos are prepared. Everything is saved."
    >
      <div className="flex flex-col items-center gap-5 py-2">
        {sleep ? <Moon size={34} className="text-accent" /> : <Power size={34} className="text-accent" />}
        <p className="font-display text-6xl leading-none tabular">{left}</p>
        <p className="text-sm text-muted">
          The computer will {sleep ? 'sleep' : 'shut down'} in {left} second{left === 1 ? '' : 's'}.
        </p>
        <Button variant="primary" size="lg" onClick={cancelPower}>
          Cancel, keep it on
        </Button>
      </div>
    </Dialog>
  );
}
