import { Download, FileUp, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { navigate } from '../app/router';
import { downloadBlob, exportPresetFile, importPresetFile } from '../lib/presetFile';
import { slug } from '../lib/utils';
import { useApp } from '../store/app';
import { useUi } from '../store/ui';
import { FlagDisc } from './FlagDisc';
import { Button } from './ui/Button';
import { inputClass } from './ui/controls';
import { Dialog } from './ui/Dialog';

export function PresetStack({ srcs, size = 26 }: { srcs: string[]; size?: number }) {
  return (
    <span className="flex -space-x-2">
      {srcs.slice(0, 5).map((s, i) => (
        <FlagDisc key={i} src={s} size={size} className="ring-surface" />
      ))}
    </span>
  );
}

export function PresetsDialog() {
  const open = useUi((s) => s.presetsOpen);
  const setUi = useUi((s) => s.set);
  const presets = useApp((s) => s.presets);
  const applyPreset = useApp((s) => s.applyPreset);
  const deletePreset = useApp((s) => s.deletePreset);
  const addPreset = useApp((s) => s.addPreset);
  const savePreset = useApp((s) => s.savePreset);
  const count = useApp((s) => s.fighters.length);
  const [name, setName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const close = () => setUi({ presetsOpen: false });

  const onSave = (e: React.FormEvent) => {
    e.preventDefault();
    const p = savePreset(name.trim() || `Battle of ${count}`);
    setName('');
    toast.success(`Saved preset "${p.name}"`);
  };

  const onImport = async (file: File | undefined) => {
    if (!file) return;
    try {
      const p = await importPresetFile(file);
      addPreset(p);
      toast.success(`Imported "${p.name}"`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed.');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => setUi({ presetsOpen: o })}
      title="Presets"
      description="Save the current roster, rules and look, or load one you made earlier."
      className="max-w-xl"
    >
      <form onSubmit={onSave} className="flex gap-2">
        <label htmlFor="preset-name" className="sr-only">
          Preset name
        </label>
        <input
          id="preset-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={`Battle of ${count}`}
          maxLength={60}
          className={inputClass}
        />
        <Button type="submit" variant="primary">
          Save preset
        </Button>
      </form>

      <div className="mt-6 flex items-center justify-between">
        <h2 className="text-[13px] font-medium text-muted">Saved ({presets.length})</h2>
        <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()}>
          <FileUp size={14} /> Import .json
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => onImport(e.target.files?.[0])}
        />
      </div>

      {presets.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-line-strong px-4 py-8 text-center text-sm text-muted">
          No presets yet. Save the current setup above, or import a preset file.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {presets.map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-3 rounded-xl bg-surface-2/70 p-2.5 pr-2 ring-1 ring-line"
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left"
                onClick={() => {
                  applyPreset(p);
                  close();
                  navigate('studio');
                  toast.success(`Loaded "${p.name}"`);
                }}
              >
                <PresetStack srcs={p.fighters.map((f) => f.imageSrc)} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{p.name}</span>
                  <span className="block text-xs text-muted tabular">
                    {p.fighters.length} flags, {p.look.aspect}, seed {p.rules.seed}
                  </span>
                </span>
              </button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Download ${p.name}`}
                onClick={async () =>
                  downloadBlob(await exportPresetFile(p), `${slug(p.name)}.flag-clash.json`)
                }
              >
                <Download size={15} />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Delete ${p.name}`}
                onClick={() => {
                  deletePreset(p.id);
                  toast(`Deleted "${p.name}"`, { action: { label: 'Undo', onClick: () => addPreset(p) } });
                }}
              >
                <Trash2 size={15} />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
