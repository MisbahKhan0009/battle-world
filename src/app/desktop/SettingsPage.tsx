import { ExternalLink, Eye, EyeOff, FileJson, FolderOpen, RefreshCw, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/Button';
import { Field, Slider, Toggle, inputClass } from '../../components/ui/controls';
import type { Autopilot } from '../../autopilot/engine';
import type { AutopilotState } from '../../autopilot/types';
import { DEFAULT_EXCLUDED, loadAllCountries, type Country } from '../../data/countries';
import { desktop, isDesktop, type MusicFile } from '../../desktop/bridge';
import { pickClientSecretFile } from '../../desktop/clientSecret';
import { useAutopilot } from '../../desktop/runtime';
import { navigate } from '../router';
import { Card, DesktopLayout, DesktopOnly } from './Layout';

export function SettingsPage() {
  const { ap, state } = useAutopilot();
  const [showSecret, setShowSecret] = useState(false);
  const [google, setGoogle] = useState({ clientId: '', clientSecret: '' });
  const [outputDir, setOutputDir] = useState('');
  const [version, setVersion] = useState('');

  useEffect(() => {
    if (isDesktop())
      void import('@tauri-apps/api/app').then((m) => m.getVersion().then(setVersion)).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (state) {
      setGoogle(state.google);
      setOutputDir(state.outputDir);
    }
    // Only seed the form once the state arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!state]);

  if (!isDesktop()) {
    return (
      <DesktopLayout title="Settings">
        <DesktopOnly feature="Autopilot settings" />
      </DesktopLayout>
    );
  }
  if (!ap || !state) {
    return (
      <DesktopLayout title="Settings">
        <p className="text-sm text-muted">Starting…</p>
      </DesktopLayout>
    );
  }

  return (
    <DesktopLayout title="Settings">
      <div className="max-w-[880px] space-y-5">
        <Card
          title="Google API credentials"
          note="Flag Clash talks to YouTube with your own free Google Cloud project, so quota and access stay yours."
        >
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Button
                onClick={async () => {
                  try {
                    const keys = await pickClientSecretFile();
                    if (!keys) return;
                    setGoogle(keys);
                    await ap.update({ google: keys });
                    toast.success('Keys loaded from the file');
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : String(err));
                  }
                }}
              >
                <FileJson size={15} /> Load from client_secret JSON
              </Button>
              <span className="text-xs text-muted">The file Google offers as Download JSON.</span>
            </div>
            <Field label="Client ID" htmlFor="client-id">
              <input
                id="client-id"
                value={google.clientId}
                onChange={(e) => setGoogle({ ...google, clientId: e.target.value })}
                onBlur={() => void ap.update({ google: { ...google, clientId: google.clientId.trim() } })}
                placeholder="1234-abc.apps.googleusercontent.com"
                className={inputClass}
                spellCheck={false}
                autoComplete="off"
              />
            </Field>
            <Field label="Client secret" htmlFor="client-secret">
              <div className="flex gap-2">
                <input
                  id="client-secret"
                  type={showSecret ? 'text' : 'password'}
                  value={google.clientSecret}
                  onChange={(e) => setGoogle({ ...google, clientSecret: e.target.value })}
                  onBlur={() =>
                    void ap.update({ google: { ...google, clientSecret: google.clientSecret.trim() } })
                  }
                  className={inputClass}
                  spellCheck={false}
                  autoComplete="off"
                />
                <Button
                  size="icon"
                  aria-label={showSecret ? 'Hide secret' : 'Show secret'}
                  onClick={() => setShowSecret(!showSecret)}
                >
                  {showSecret ? <EyeOff size={16} /> : <Eye size={16} />}
                </Button>
              </div>
            </Field>
            <div className="flex flex-wrap items-center gap-3 rounded-xl bg-surface-2/60 p-4 ring-1 ring-line">
              <p className="min-w-0 flex-1 text-[13px] text-muted">
                New to this? The setup guide shows every click in Google Cloud, with links and values to copy.
              </p>
              <Button onClick={() => navigate('setup')}>Open the setup guide</Button>
            </div>
          </div>
        </Card>

        <Card title="Rendered videos">
          <div className="space-y-5">
            <Field label="Save videos to" htmlFor="out-dir">
              <div className="flex gap-2">
                <input
                  id="out-dir"
                  value={outputDir}
                  onChange={(e) => setOutputDir(e.target.value)}
                  onBlur={() => void ap.update({ outputDir: outputDir.trim() || state.outputDir })}
                  className={inputClass}
                  spellCheck={false}
                />
                <Button onClick={() => void desktop.openPath(state.outputDir).catch(() => undefined)}>
                  <FolderOpen size={15} /> Open
                </Button>
              </div>
            </Field>
            <Slider
              label="Keep files after posting"
              value={state.keepDays}
              min={0}
              max={30}
              onChange={(keepDays) => void ap.update({ keepDays })}
              format={(v) => (v === 0 ? 'Delete right away' : `${v} day${v === 1 ? '' : 's'}`)}
            />
          </div>
        </Card>

        <MusicCard ap={ap} state={state} />
        <CountriesCard ap={ap} state={state} />

        <Card title="About">
          <p className="text-sm text-muted">
            Flag Clash {version ? `version ${version}` : ''}. New versions appear on the repository's Releases
            page; run the new installer to update. Your channels and schedule are kept.
          </p>
        </Card>

        <Card title="Background">
          <div className="space-y-3">
            <Toggle
              label="Launch when I sign in"
              description="Starts quietly in the tray so the schedule keeps running."
              checked={state.launchAtLogin}
              onChange={async (launchAtLogin) => {
                await desktop.setAutostart(launchAtLogin).catch(() => undefined);
                void ap.update({ launchAtLogin });
              }}
            />
            <Toggle
              label="Keep running in the tray when the window closes"
              description="Use Quit in the tray menu to stop the app completely."
              checked={state.closeToTray}
              onChange={(closeToTray) => {
                void desktop.setCloseToTray(closeToTray);
                void ap.update({ closeToTray });
              }}
            />
          </div>
        </Card>
      </div>
    </DesktopLayout>
  );
}

/** Music from the user's folder (e.g. YouTube's Audio Library) instead of the game sounds. */
/** Flags left out of every video (contested or politically charged ones by default). */
function CountriesCard({ ap, state }: { ap: Autopilot; state: AutopilotState }) {
  const [all, setAll] = useState<Country[]>([]);
  const [add, setAdd] = useState('');
  useEffect(() => {
    void loadAllCountries().then(setAll);
  }, []);
  const excluded = state.excludedCountries ?? DEFAULT_EXCLUDED;
  const byIso = useMemo(() => new Map(all.map((c) => [c.iso2, c])), [all]);
  const set = (codes: string[]) => void ap.update({ excludedCountries: codes });
  const left = all.filter((c) => !excluded.includes(c.iso2)).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <Card
      title="Countries left out"
      note="These flags never appear in any video. By default the list holds contested and politically charged flags; change it any time."
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {excluded.length === 0 && <p className="text-[13px] text-muted">Every country can appear.</p>}
          {excluded.map((code) => (
            <span
              key={code}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-surface-3 pr-1 pl-2.5 text-[13px]"
            >
              {byIso.get(code)?.name ?? code.toUpperCase()}
              <button
                type="button"
                aria-label={`Allow ${byIso.get(code)?.name ?? code}`}
                className="grid h-6 w-6 place-items-center rounded-md text-muted hover:bg-line-strong hover:text-text"
                onClick={() => set(excluded.filter((x) => x !== code))}
              >
                <X size={13} />
              </button>
            </span>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            aria-label="Leave out another country"
            value={add}
            onChange={(e) => setAdd(e.target.value)}
            className="h-10 min-w-[240px] flex-1 rounded-xl border border-line-strong bg-bg px-3 text-sm"
          >
            <option value="">Leave out another country…</option>
            {left.map((c) => (
              <option key={c.iso2} value={c.iso2}>
                {c.name}
              </option>
            ))}
          </select>
          <Button
            variant="secondary"
            disabled={!add}
            onClick={() => {
              set([...excluded, add]);
              setAdd('');
            }}
          >
            Leave out
          </Button>
          <Button variant="ghost" onClick={() => set([...DEFAULT_EXCLUDED])}>
            Reset to the default list
          </Button>
        </div>
      </div>
    </Card>
  );
}

function MusicCard({ ap, state }: { ap: Autopilot; state: AutopilotState }) {
  const music = state.music ?? { enabled: false, dir: '' };
  const [dir, setDir] = useState(music.dir);
  const [tracks, setTracks] = useState<MusicFile[] | null>(null);
  const [error, setError] = useState('');

  const load = (d: string) => {
    if (!d) return;
    desktop
      .musicList(d)
      .then((t) => {
        setTracks(t);
        setError('');
      })
      .catch((e) => {
        setTracks(null);
        setError(String(e));
      });
  };
  useEffect(() => {
    setDir(music.dir);
    load(music.dir);
  }, [music.dir]);

  const save = (patch: Partial<{ enabled: boolean; dir: string }>) =>
    void ap.update({ music: { ...music, ...patch } });
  const credited = tracks?.filter((t) => t.attribution).length ?? 0;

  return (
    <Card
      title="Music"
      note="Play a music track under each video instead of the game sounds. Each video gets a different track from your folder."
    >
      <div className="space-y-5">
        <Toggle
          label="Use music instead of the game sounds"
          description="Tracks come from the folder below, a different one for each video, avoiding the ones each channel used recently. The music fades in, loops if the video is longer, and fades out at the end."
          checked={music.enabled}
          onChange={(enabled) => save({ enabled })}
        />
        <Field label="Music folder" htmlFor="music-dir">
          <div className="flex gap-2">
            <input
              id="music-dir"
              value={dir}
              onChange={(e) => setDir(e.target.value)}
              onBlur={() => {
                const next = dir.trim() || music.dir;
                if (next !== music.dir) save({ dir: next });
              }}
              className={inputClass}
              spellCheck={false}
            />
            <Button onClick={() => void desktop.openPath(music.dir).catch(() => undefined)}>
              <FolderOpen size={15} /> Open
            </Button>
            <Button aria-label="Check the folder again" onClick={() => load(music.dir)}>
              <RefreshCw size={15} />
            </Button>
          </div>
        </Field>
        <div className="space-y-2 rounded-xl bg-surface-2/50 p-4 text-[13px] ring-1 ring-line">
          {error ? (
            <p className="text-danger">Could not read this folder: {error}</p>
          ) : tracks === null ? (
            <p className="text-muted">Checking the folder…</p>
          ) : tracks.length === 0 ? (
            <p className={music.enabled ? 'text-hp-mid' : 'text-muted'}>
              No tracks yet{music.enabled ? ', so videos keep the game sounds until you add some' : ''}. Add
              MP3, M4A, WAV, OGG or FLAC files to this folder.
            </p>
          ) : (
            <>
              <p className="text-text">
                {tracks.length} track{tracks.length === 1 ? '' : 's'}
                {credited ? `, ${credited} with a credit line` : ''}
              </p>
              <ul className="space-y-1 text-muted">
                {tracks.slice(0, 8).map((t) => (
                  <li key={t.path} className="truncate">
                    {t.name}
                    {t.attribution ? (
                      <span className="text-xs text-accent"> · credit added to descriptions</span>
                    ) : null}
                  </li>
                ))}
                {tracks.length > 8 && <li>and {tracks.length - 8} more</li>}
              </ul>
            </>
          )}
        </div>
        <div className="space-y-2 text-[13px] text-muted">
          <p>
            Free tracks for YouTube: open the Audio Library in YouTube Studio, download the tracks you like
            and put them in this folder.
          </p>
          <p>
            Some tracks say <span className="text-text">Attribution required</span>. Copy the credit text
            YouTube shows into a .txt file with the same name as the track (for example{' '}
            <span className="text-text">Track.mp3</span> and <span className="text-text">Track.txt</span>). It
            is added to the description of every video that uses it.
          </p>
          <Button size="sm" onClick={() => void desktop.openUrl('https://www.youtube.com/audiolibrary')}>
            <ExternalLink size={14} /> Open the Audio Library
          </Button>
        </div>
      </div>
    </Card>
  );
}
