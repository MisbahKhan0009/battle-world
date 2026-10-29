import { Eye, EyeOff, FolderOpen } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Field, Slider, Toggle, inputClass } from '../../components/ui/controls';
import { desktop, isDesktop } from '../../desktop/bridge';
import { useAutopilot } from '../../desktop/runtime';
import { Card, DesktopLayout, DesktopOnly } from './Layout';

const STEPS: { text: string; link?: { href: string; label: string } }[] = [
  {
    text: 'Create a project in Google Cloud Console.',
    link: { href: 'https://console.cloud.google.com/projectcreate', label: 'New project' },
  },
  {
    text: 'Enable "YouTube Data API v3" for the project.',
    link: {
      href: 'https://console.cloud.google.com/apis/library/youtube.googleapis.com',
      label: 'API library',
    },
  },
  {
    text: 'Set up the OAuth consent screen: External, then add your own Google account under Test users.',
    link: { href: 'https://console.cloud.google.com/apis/credentials/consent', label: 'Consent screen' },
  },
  {
    text: 'Create credentials: OAuth client ID, application type "Desktop app". Copy the client ID and secret here.',
    link: { href: 'https://console.cloud.google.com/apis/credentials', label: 'Credentials' },
  },
  {
    text: 'To publish videos publicly, request the YouTube API audit for the project. Until then YouTube keeps API uploads private.',
    link: { href: 'https://support.google.com/youtube/contact/yt_api_form', label: 'Audit form' },
  },
];

export function SettingsPage() {
  const { ap, state } = useAutopilot();
  const [showSecret, setShowSecret] = useState(false);
  const [google, setGoogle] = useState({ clientId: '', clientSecret: '' });
  const [outputDir, setOutputDir] = useState('');

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

  const open = (href: string) => void desktop.openUrl(href);

  return (
    <DesktopLayout title="Settings">
      <div className="max-w-[880px] space-y-5">
        <Card
          title="Google API credentials"
          note="Flag Clash talks to YouTube with your own free Google Cloud project, so quota and access stay yours."
        >
          <div className="space-y-4">
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
            <details className="rounded-xl bg-surface-2/60 p-4 ring-1 ring-line">
              <summary className="cursor-pointer text-sm font-medium">
                How to get these (about five minutes)
              </summary>
              <ol className="mt-4 space-y-3">
                {STEPS.map((s, i) => (
                  <li key={s.text} className="flex gap-3 text-[13px]">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-surface-3 text-xs tabular">
                      {i + 1}
                    </span>
                    <span className="flex-1 text-muted">
                      {s.text}{' '}
                      {s.link && (
                        <button
                          type="button"
                          className="text-accent underline underline-offset-2"
                          onClick={() => open(s.link!.href)}
                        >
                          {s.link.label}
                        </button>
                      )}
                    </span>
                  </li>
                ))}
              </ol>
            </details>
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
