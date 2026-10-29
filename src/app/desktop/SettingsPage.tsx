import { Eye, EyeOff, FolderOpen } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Field, Slider, Toggle, inputClass } from '../../components/ui/controls';
import { desktop, isDesktop } from '../../desktop/bridge';
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
