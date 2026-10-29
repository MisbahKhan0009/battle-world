/**
 * First-run setup: a guided, step-by-step path from "nothing" to "autopilot posting", including
 * the Google Cloud part. Each Google step shows a small mock of the page the user will see with
 * the exact fields and buttons highlighted, plus one-click links and copyable values.
 */
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
  Loader2,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { AutopilotState, PostSettings, ScheduleSettings } from '../../autopilot/types';
import { DEFAULT_SCHEDULE } from '../../autopilot/types';
import { Button } from '../../components/ui/Button';
import { inputClass } from '../../components/ui/controls';
import { desktop, isDesktop } from '../../desktop/bridge';
import { useAutopilot } from '../../desktop/runtime';
import { cn } from '../../lib/utils';
import { navigate } from '../router';
import { DesktopLayout, DesktopOnly } from './Layout';

const URLS = {
  project: 'https://console.cloud.google.com/projectcreate',
  api: 'https://console.cloud.google.com/apis/library/youtube.googleapis.com',
  branding: 'https://console.cloud.google.com/auth/overview',
  audience: 'https://console.cloud.google.com/auth/audience',
  clients: 'https://console.cloud.google.com/auth/clients',
  audit: 'https://support.google.com/youtube/contact/yt_api_form',
};

const open = (url: string) =>
  isDesktop() ? void desktop.openUrl(url) : void window.open(url, '_blank', 'noopener');

const CLIENT_ID_RE = /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/;

// ------------------------------------------------------------------------------------------
// Building blocks

function OpenLink({ url, children }: { url: string; children: ReactNode }) {
  return (
    <Button variant="primary" onClick={() => open(url)}>
      {children} <ExternalLink size={14} />
    </Button>
  );
}

function CopyValue({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(value).catch(() => undefined);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
      className="inline-flex items-center gap-1.5 rounded-md bg-surface-3 px-2 py-0.5 align-baseline font-mono text-[12px] text-text ring-1 ring-line-strong hover:ring-accent/60"
      aria-label={`Copy ${value}`}
    >
      {value} {done ? <Check size={12} className="text-accent" /> : <Copy size={12} className="text-muted" />}
    </button>
  );
}

/** Numbered instructions that line up with the numbered highlights in the mock. */
function Instructions({ items }: { items: ReactNode[] }) {
  return (
    <ol className="space-y-3">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3 text-[14px] leading-relaxed">
          <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent text-[12px] font-semibold text-accent-ink">
            {i + 1}
          </span>
          <span className="flex-1">{item}</span>
        </li>
      ))}
    </ol>
  );
}

// Mock of a Google Cloud Console page.
function Mock({
  url,
  title,
  children,
  brand = 'Google Cloud',
}: {
  url: string;
  title: string;
  children: ReactNode;
  brand?: string;
}) {
  return (
    <figure className="overflow-hidden rounded-2xl bg-[#f8f9fb] text-[#202124] shadow-[0_24px_60px_-24px_rgb(0_0_0/0.8)] ring-1 ring-white/10">
      <div className="flex items-center gap-2 bg-[#e8eaed] px-3 py-2">
        <span className="flex gap-1.5" aria-hidden>
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        </span>
        <span className="ml-2 min-w-0 flex-1 truncate rounded-md bg-white px-2.5 py-1 font-mono text-[11px] text-[#5f6368]">
          {url}
        </span>
      </div>
      <div className="flex items-center gap-2 border-b border-[#dadce0] bg-white px-4 py-2.5">
        <span className="text-[13px] font-medium text-[#5f6368]">{brand}</span>
        <span className="text-[#dadce0]">/</span>
        <span className="text-[13px]">{title}</span>
      </div>
      <div className="space-y-3 p-5">{children}</div>
      <figcaption className="sr-only">Illustration of the {title} page</figcaption>
    </figure>
  );
}

function Mark({ n, children, className }: { n?: number; children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'relative rounded-lg ring-2 ring-[#9acd00] ring-offset-2 ring-offset-[#f8f9fb]',
        className,
      )}
    >
      {n !== undefined && (
        <span className="absolute -top-2.5 -left-2.5 z-10 grid h-5 w-5 place-items-center rounded-full bg-[#9acd00] text-[11px] font-bold text-[#11160a] shadow">
          {n}
        </span>
      )}
      {children}
    </div>
  );
}

function MField({ label, value, n, select }: { label: string; value: string; n?: number; select?: boolean }) {
  const field = (
    <div className="rounded-md border border-[#dadce0] bg-white px-3 pt-1.5 pb-2">
      <div className="text-[10px] text-[#5f6368]">{label}</div>
      <div className="flex items-center justify-between text-[13px]">
        {value}
        {select && <span className="text-[#5f6368]">▾</span>}
      </div>
    </div>
  );
  return n ? <Mark n={n}>{field}</Mark> : field;
}

function MButton({ label, n, primary = true }: { label: string; n?: number; primary?: boolean }) {
  const b = (
    <span
      className={cn(
        'inline-flex h-8 items-center rounded-md px-4 text-[13px] font-medium',
        primary ? 'bg-[#1a73e8] text-white' : 'border border-[#dadce0] bg-white text-[#1a73e8]',
      )}
    >
      {label}
    </span>
  );
  return n ? (
    <Mark n={n} className="inline-block">
      {b}
    </Mark>
  ) : (
    b
  );
}

function MRadio({ options, selected, n }: { options: string[]; selected: string; n?: number }) {
  const r = (
    <div className="space-y-1.5 rounded-md bg-white p-3">
      {options.map((o) => (
        <div key={o} className="flex items-center gap-2 text-[13px]">
          <span
            className={cn(
              'grid h-4 w-4 place-items-center rounded-full border-2',
              o === selected ? 'border-[#1a73e8]' : 'border-[#5f6368]',
            )}
          >
            {o === selected && <span className="h-2 w-2 rounded-full bg-[#1a73e8]" />}
          </span>
          {o}
        </div>
      ))}
    </div>
  );
  return n ? <Mark n={n}>{r}</Mark> : r;
}

// ------------------------------------------------------------------------------------------
// Steps

type StepCtx = {
  state: AutopilotState;
  update: (patch: Partial<AutopilotState>, opts?: { replan?: boolean }) => Promise<void>;
  next: () => void;
};

type Step = {
  id: string;
  title: string;
  short: string;
  done: (s: AutopilotState) => boolean;
  body: (ctx: StepCtx) => ReactNode;
  /** Replaces the default "Next" button. */
  action?: (ctx: StepCtx) => ReactNode;
};

function WelcomeBody() {
  return (
    <div className="space-y-5">
      <p className="text-[15px] leading-relaxed text-muted">
        Flag Clash posts to YouTube through Google's official API, using a free Google Cloud project that
        belongs to you. That keeps your channel's quota and access in your hands. Setting it up takes about
        five minutes, and this guide shows every click.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          ['A Google account', 'The one that owns your YouTube channel.'],
          ['A YouTube channel', 'Create one on YouTube first if you have not yet.'],
          ['About 5 minutes', 'Free. No credit card needed.'],
        ].map(([t, d]) => (
          <div key={t} className="rounded-xl bg-surface-2/70 p-4 ring-1 ring-line">
            <Check size={16} className="text-accent" />
            <div className="mt-2 text-sm font-medium">{t}</div>
            <div className="mt-1 text-xs text-muted">{d}</div>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted">
        Tip: keep this window open next to your browser and work through the steps side by side.
      </p>
    </div>
  );
}

function KeysBody({ state, update, next }: StepCtx) {
  const [id, setId] = useState(state.google.clientId);
  const [secret, setSecret] = useState(state.google.clientSecret);
  const idOk = CLIENT_ID_RE.test(id.trim());
  const secretOk = secret.trim().length >= 10;
  const secretLooksOdd = secretOk && !secret.trim().startsWith('GOCSPX-');
  const save = async () => {
    await update({ google: { clientId: id.trim(), clientSecret: secret.trim() } });
    toast.success('Keys saved');
    next();
  };
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="space-y-5">
        <Instructions
          items={[
            <>
              Open <strong>Clients</strong> and click <strong>Create client</strong>.
            </>,
            <>
              Set <strong>Application type</strong> to <strong>Desktop app</strong> and the name to{' '}
              <CopyValue value="Flag Clash" />. Click <strong>Create</strong>.
            </>,
            <>Copy the Client ID and Client secret from the dialog and paste them below.</>,
          ]}
        />
        <OpenLink url={URLS.clients}>Open Clients</OpenLink>
        <div className="space-y-4 rounded-2xl bg-surface-2/60 p-4 ring-1 ring-line">
          <label className="block space-y-2">
            <span className="text-[13px] font-medium">Client ID</span>
            <input
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="123456789-abc123.apps.googleusercontent.com"
              className={inputClass}
              spellCheck={false}
              autoComplete="off"
            />
            {id && !idOk && (
              <span className="block text-xs text-hp-mid">
                That does not look like a client ID. It ends with .apps.googleusercontent.com.
              </span>
            )}
          </label>
          <label className="block space-y-2">
            <span className="text-[13px] font-medium">Client secret</span>
            <input
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="GOCSPX-..."
              className={inputClass}
              spellCheck={false}
              autoComplete="off"
              type="password"
            />
            {secretLooksOdd && (
              <span className="block text-xs text-hp-mid">
                Client secrets usually start with GOCSPX-. Double-check you copied the secret, not the ID.
              </span>
            )}
          </label>
          <Button variant="primary" onClick={save} disabled={!idOk || !secretOk}>
            Save keys and continue <ArrowRight size={15} />
          </Button>
        </div>
      </div>
      <Mock url="console.cloud.google.com/auth/clients/create" title="Create OAuth client ID">
        <MField label="Application type" value="Desktop app" select n={2} />
        <MField label="Name" value="Flag Clash" />
        <MButton label="Create" />
        <Mark n={3}>
          <div className="space-y-1.5 rounded-md bg-white p-3 text-[12px]">
            <div className="font-medium">OAuth client created</div>
            <div className="text-[#5f6368]">Client ID</div>
            <div className="truncate font-mono">123456789-abc123.apps.googleusercontent.com</div>
            <div className="text-[#5f6368]">Client secret</div>
            <div className="font-mono">GOCSPX-••••••••••••</div>
          </div>
        </Mark>
      </Mock>
    </div>
  );
}

function ConnectBody({ state, update }: StepCtx) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const info = await desktop.connectChannel(state.google.clientId, state.google.clientSecret);
      const others = state.channels.filter((c) => c.id !== info.id);
      await update(
        { channels: [...others, { ...info, connectedAt: Date.now(), enabled: true }] },
        { replan: true },
      );
      toast.success(`Connected ${info.title}`);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };
  const hint = useMemo(() => {
    if (!error) return null;
    if (/access_denied|cancelled/i.test(error))
      return 'Sign-in was cancelled or blocked. Make sure you published the app (step 4) or added yourself as a test user, then try again.';
    if (/redirect_uri_mismatch/i.test(error))
      return 'The client is not a Desktop app. Create a new client with Application type "Desktop app" (step 5).';
    if (/invalid_client|unauthorized_client/i.test(error))
      return 'Google rejected the keys. Go back to step 5 and paste the Client ID and secret again.';
    if (/no YouTube channel/i.test(error))
      return 'That Google account has no YouTube channel. Create one on YouTube, or sign in with the account that owns your channel.';
    return 'Check the steps above and try again.';
  }, [error]);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="space-y-5">
        <Instructions
          items={[
            <>
              Click <strong>Sign in with Google</strong>. Your browser opens Google's sign-in page.
            </>,
            <>
              Pick the Google account that owns your YouTube channel (and the channel itself, if you have
              several).
            </>,
            <>
              Google warns that it <strong>hasn't verified this app</strong>. That is expected: it is your own
              app. Click <strong>Advanced</strong>, then <strong>Go to Flag Clash (unsafe)</strong>.
            </>,
            <>
              Allow both permissions (upload videos, view your channel). The browser then says{' '}
              <strong>Channel connected</strong> and you can come back here.
            </>,
          ]}
        />
        <Button variant="primary" size="lg" onClick={connect} disabled={busy}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
          {busy
            ? 'Waiting for you in the browser…'
            : state.channels.length
              ? 'Connect another channel'
              : 'Sign in with Google'}
        </Button>
        {error && (
          <div className="rounded-xl bg-danger/10 p-4 text-sm ring-1 ring-danger/30">
            <div className="font-medium text-danger">{error.replace(/^youtube:\w+:\s*/, '')}</div>
            {hint && <div className="mt-1 text-muted">{hint}</div>}
          </div>
        )}
        {state.channels.length > 0 && (
          <ul className="space-y-2">
            {state.channels.map((c) => (
              <li
                key={c.id}
                className="flex items-center gap-3 rounded-xl bg-accent/8 p-3 ring-1 ring-accent/30"
              >
                {c.thumbnail ? (
                  <img
                    src={c.thumbnail}
                    alt=""
                    className="h-10 w-10 rounded-full"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span className="h-10 w-10 rounded-full bg-surface-3" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{c.title}</div>
                  <div className="text-xs text-muted">
                    {c.subscribers !== undefined
                      ? `${c.subscribers.toLocaleString()} subscribers`
                      : 'Connected'}
                  </div>
                </div>
                <Check size={18} className="text-accent" />
              </li>
            ))}
          </ul>
        )}
      </div>
      <Mock url="accounts.google.com/signin/oauth/warning" title="Sign in" brand="Google">
        <div className="flex items-start gap-2 rounded-md bg-white p-3 text-[12px]">
          <ShieldAlert size={18} className="shrink-0 text-[#d93025]" />
          <div>
            <div className="font-medium">Google hasn't verified this app</div>
            <div className="mt-1 text-[#5f6368]">
              The app is requesting access to sensitive info in your Google Account.
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <Mark n={3} className="inline-block">
            <span className="px-2 text-[12px] text-[#1a73e8] underline">Advanced</span>
          </Mark>
          <MButton label="Back to safety" />
        </div>
        <Mark n={3}>
          <div className="rounded-md bg-white p-2 text-[12px] text-[#1a73e8] underline">
            Go to Flag Clash (unsafe)
          </div>
        </Mark>
      </Mock>
    </div>
  );
}

const PACES: { id: string; name: string; desc: string; schedule: Partial<ScheduleSettings> }[] = [
  {
    id: 'max',
    name: 'Maximum, still organic',
    desc: 'Up to 5 Shorts a day and 4 long videos a week. Uses the full default API quota.',
    schedule: { shortsPerDay: 5, videosPerWeek: 4, dailyCap: 6 },
  },
  {
    id: 'steady',
    name: 'Steady',
    desc: '3 Shorts a day and 2 long videos a week.',
    schedule: { shortsPerDay: 3, videosPerWeek: 2, dailyCap: 6 },
  },
  {
    id: 'light',
    name: 'Light',
    desc: '1 Short a day and 1 long video a week.',
    schedule: { shortsPerDay: 1, videosPerWeek: 1, dailyCap: 6 },
  },
];

function PaceBody({ state, update }: StepCtx) {
  const current = PACES.find(
    (p) =>
      p.schedule.shortsPerDay === state.schedule.shortsPerDay &&
      p.schedule.videosPerWeek === state.schedule.videosPerWeek,
  )?.id;
  const setPrivacy = (privacy: PostSettings['privacy']) => void update({ post: { ...state.post, privacy } });
  return (
    <div className="space-y-6">
      <div className="grid gap-3 md:grid-cols-3" role="radiogroup" aria-label="Posting pace">
        {PACES.map((p) => (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={current === p.id}
            onClick={() =>
              void update(
                { schedule: { ...DEFAULT_SCHEDULE, ...state.schedule, ...p.schedule } },
                { replan: true },
              )
            }
            className={cn(
              'rounded-2xl p-4 text-left ring-1 transition-colors',
              current === p.id
                ? 'bg-accent/10 ring-2 ring-accent'
                : 'bg-surface-2/60 ring-line hover:ring-line-strong',
            )}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{p.name}</span>
              {current === p.id && <Check size={16} className="text-accent" />}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted">{p.desc}</p>
          </button>
        ))}
      </div>
      <p className="text-xs text-muted">
        Posts go out between 9:00 and 23:00 at irregular times, at least 75 minutes apart. You can fine-tune
        everything later on the Autopilot page.
      </p>

      <div className="space-y-3 rounded-2xl bg-surface-2/60 p-4 ring-1 ring-line">
        <div className="text-sm font-medium">Who can see the videos?</div>
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              [
                'public',
                'Public',
                'Needs your Google Cloud project to pass the free YouTube API audit. Until then YouTube keeps API uploads private.',
              ],
              [
                'private',
                'Private for now',
                'Videos upload as private so you can review and publish them yourself. Switch to Public after the audit.',
              ],
            ] as const
          ).map(([value, label, desc]) => (
            <button
              key={value}
              type="button"
              aria-pressed={state.post.privacy === value}
              onClick={() => setPrivacy(value)}
              className={cn(
                'rounded-xl p-3 text-left ring-1',
                state.post.privacy === value
                  ? 'bg-accent/10 ring-2 ring-accent'
                  : 'ring-line hover:ring-line-strong',
              )}
            >
              <div className="text-[13px] font-medium">{label}</div>
              <div className="mt-1 text-xs text-muted">{desc}</div>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => open(URLS.audit)}
          className="inline-flex items-center gap-1.5 text-xs text-accent underline underline-offset-2"
        >
          Request the YouTube API audit <ExternalLink size={12} />
        </button>
      </div>
    </div>
  );
}

const STEPS: Step[] = [
  {
    id: 'welcome',
    title: 'Before you start',
    short: 'What you need',
    done: (s) => !!s.google.clientId || s.channels.length > 0,
    body: () => <WelcomeBody />,
  },
  {
    id: 'project',
    title: 'Create a Google Cloud project',
    short: 'Cloud project',
    done: (s) => !!s.google.clientId,
    body: () => (
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          <Instructions
            items={[
              <>
                Click <strong>Open Google Cloud</strong> below and sign in with your Google account.
              </>,
              <>
                Name the project <CopyValue value="Flag Clash" />. Leave Location as it is.
              </>,
              <>
                Click <strong>Create</strong> and wait a few seconds. Check that <strong>Flag Clash</strong>{' '}
                is selected in the project picker at the top of the page.
              </>,
            ]}
          />
          <OpenLink url={URLS.project}>Open Google Cloud</OpenLink>
        </div>
        <Mock url="console.cloud.google.com/projectcreate" title="New project">
          <MField label="Project name *" value="Flag Clash" n={2} />
          <MField label="Location" value="No organization" select />
          <MButton label="Create" n={3} />
        </Mock>
      </div>
    ),
  },
  {
    id: 'api',
    title: 'Turn on the YouTube Data API',
    short: 'YouTube API',
    done: (s) => !!s.google.clientId,
    body: () => (
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          <Instructions
            items={[
              <>
                Click <strong>Open the API page</strong>. Make sure the Flag Clash project is selected at the
                top.
              </>,
              <>
                Click <strong>Enable</strong>. When the page changes to "API enabled", you are done.
              </>,
            ]}
          />
          <OpenLink url={URLS.api}>Open the API page</OpenLink>
        </div>
        <Mock url="console.cloud.google.com/apis/library/youtube.googleapis.com" title="API Library">
          <div className="flex items-center gap-3 rounded-md bg-white p-3">
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-[#ff0000] text-white">▶</span>
            <div>
              <div className="text-[14px] font-medium">YouTube Data API v3</div>
              <div className="text-[11px] text-[#5f6368]">Google Enterprise API</div>
            </div>
          </div>
          <MButton label="Enable" n={2} />
        </Mock>
      </div>
    ),
  },
  {
    id: 'consent',
    title: 'Set up Google sign-in',
    short: 'Sign-in screen',
    done: (s) => !!s.google.clientId,
    body: () => (
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          <Instructions
            items={[
              <>
                Click <strong>Open Google Auth Platform</strong>, then <strong>Get started</strong>.
              </>,
              <>
                App name: <CopyValue value="Flag Clash" />. User support email: your email. Click{' '}
                <strong>Next</strong>.
              </>,
              <>
                Audience: choose <strong>External</strong>. Click <strong>Next</strong>, enter your email as
                contact, accept the policy, and click <strong>Create</strong>.
              </>,
              <>
                Open <strong>Audience</strong> and click <strong>Publish app</strong>, then{' '}
                <strong>Confirm</strong>. This keeps you signed in. Apps left in "Testing" are signed out by
                Google every 7 days.
              </>,
            ]}
          />
          <div className="flex flex-wrap gap-2">
            <OpenLink url={URLS.branding}>Open Google Auth Platform</OpenLink>
            <Button variant="secondary" onClick={() => open(URLS.audience)}>
              Open Audience <ExternalLink size={14} />
            </Button>
          </div>
          <p className="rounded-xl bg-surface-2/60 p-3 text-xs text-muted ring-1 ring-line">
            Publishing does not make anything public. It only lets your own app keep its sign-in. Google will
            not review it unless you ask.
          </p>
        </div>
        <Mock url="console.cloud.google.com/auth/overview" title="Google Auth Platform">
          <MField label="App name" value="Flag Clash" n={2} />
          <MRadio options={['Internal', 'External']} selected="External" n={3} />
          <div className="flex items-center justify-between rounded-md bg-white p-3 text-[12px]">
            <span>
              Publishing status: <strong>Testing</strong>
            </span>
            <Mark n={4} className="inline-block">
              <MButton label="Publish app" primary={false} />
            </Mark>
          </div>
        </Mock>
      </div>
    ),
  },
  {
    id: 'keys',
    title: "Create the app's keys",
    short: 'App keys',
    done: (s) => CLIENT_ID_RE.test(s.google.clientId) && !!s.google.clientSecret,
    body: (ctx) => <KeysBody {...ctx} />,
    action: () => null,
  },
  {
    id: 'connect',
    title: 'Connect your YouTube channel',
    short: 'Connect channel',
    done: (s) => s.channels.length > 0,
    body: (ctx) => <ConnectBody {...ctx} />,
  },
  {
    id: 'pace',
    title: 'Pick how often to post',
    short: 'Posting pace',
    done: (s) => s.setupDone,
    body: (ctx) => <PaceBody {...ctx} />,
    action: ({ state, update, next }) => (
      <Button
        variant="primary"
        size="lg"
        disabled={!state.channels.length}
        onClick={async () => {
          await update({ running: true, setupDone: true });
          next();
        }}
      >
        Start autopilot <ArrowRight size={16} />
      </Button>
    ),
  },
  {
    id: 'done',
    title: "You're all set",
    short: 'Done',
    done: (s) => s.setupDone && s.running,
    body: ({ state }) => {
      const next = state.slots.find((s) => s.status === 'planned');
      return (
        <div className="space-y-5">
          <div className="flex items-center gap-4 rounded-2xl bg-accent/10 p-5 ring-1 ring-accent/30">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-accent text-accent-ink">
              <Check size={24} />
            </span>
            <div>
              <div className="font-display text-3xl leading-none">Autopilot is on</div>
              <div className="mt-1 text-sm text-muted">
                {next
                  ? `First post planned for ${new Date(next.at).toLocaleString([], { weekday: 'long', hour: 'numeric', minute: '2-digit' })}.`
                  : 'Posts are being planned now.'}
              </div>
            </div>
          </div>
          <ul className="list-disc space-y-2 pl-5 text-sm text-muted">
            <li>
              Close the window any time: Flag Clash keeps running in the tray (bottom-right of the taskbar)
              and starts with Windows.
            </li>
            <li>
              Each post is rendered about 30 minutes ahead, so leave the computer on and awake during your
              posting hours.
            </li>
            <li>
              Want to see it work right now? Use <strong className="text-text">Post now</strong> on the
              Autopilot page.
            </li>
          </ul>
        </div>
      );
    },
    action: () => (
      <Button variant="primary" size="lg" onClick={() => navigate('autopilot')}>
        Go to Autopilot <ArrowRight size={16} />
      </Button>
    ),
  },
];

function initialStep(s: AutopilotState): number {
  if (s.setupDone) return STEPS.length - 1;
  if (s.channels.length) return STEPS.findIndex((x) => x.id === 'pace');
  if (s.google.clientId) return STEPS.findIndex((x) => x.id === 'connect');
  return 0;
}

export function SetupWizard() {
  const { ap, state } = useAutopilot();
  const [step, setStep] = useState<number | null>(null);

  useEffect(() => {
    if (state && step === null) setStep(initialStep(state));
  }, [state, step]);

  // The app opens here on first launch; give the page its own address so the sidebar is right.
  useEffect(() => {
    if (!/^#\/?setup/.test(window.location.hash)) navigate('setup');
  }, []);

  if (!isDesktop()) {
    return (
      <DesktopLayout title="Set up">
        <DesktopOnly feature="Channel setup" />
      </DesktopLayout>
    );
  }
  if (!ap || !state || step === null) {
    return (
      <DesktopLayout title="Set up">
        <p className="text-sm text-muted">Starting…</p>
      </DesktopLayout>
    );
  }

  const current = STEPS[step];
  const ctx: StepCtx = {
    state,
    update: (patch, opts) => ap.update(patch, opts),
    next: () => setStep(Math.min(STEPS.length - 1, step + 1)),
  };
  const canNext = current.id !== 'connect' || state.channels.length > 0;

  return (
    <DesktopLayout title="Set up">
      <div className="mx-auto grid max-w-[1180px] gap-8 lg:grid-cols-[230px_1fr]">
        <nav aria-label="Setup steps">
          <ol className="relative space-y-1">
            {STEPS.map((s, i) => {
              const done = s.done(state) && i !== step;
              const active = i === step;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setStep(i)}
                    aria-current={active ? 'step' : undefined}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left text-sm transition-colors',
                      active ? 'bg-surface-3' : 'hover:bg-surface-2',
                    )}
                  >
                    <span
                      className={cn(
                        'grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-semibold tabular',
                        done
                          ? 'bg-accent text-accent-ink'
                          : active
                            ? 'bg-text text-bg'
                            : 'bg-surface-3 text-muted',
                      )}
                    >
                      {done ? <Check size={14} /> : i + 1}
                    </span>
                    <span className={cn(active ? 'text-text' : 'text-muted')}>{s.short}</span>
                  </button>
                </li>
              );
            })}
          </ol>
          <div
            className="mt-4 h-1.5 overflow-hidden rounded-full bg-surface-3"
            role="progressbar"
            aria-label="Setup progress"
            aria-valuemin={0}
            aria-valuemax={STEPS.length - 1}
            aria-valuenow={step}
          >
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-300"
              style={{ width: `${(step / (STEPS.length - 1)) * 100}%` }}
            />
          </div>
        </nav>

        <section key={current.id} className="min-w-0 animate-[rise-in_300ms_var(--ease-spring)_both]">
          <div className="text-xs text-muted tabular">
            Step {step + 1} of {STEPS.length}
          </div>
          <h2 className="mt-1 font-display text-5xl leading-none">{current.title}</h2>
          <div className="mt-6">{current.body(ctx)}</div>
          <div className="mt-8 flex items-center gap-3 border-t border-line pt-5">
            {step > 0 && (
              <Button variant="ghost" onClick={() => setStep(step - 1)}>
                <ArrowLeft size={15} /> Back
              </Button>
            )}
            <div className="ml-auto">
              {current.action ? (
                current.action(ctx)
              ) : (
                <Button variant="primary" onClick={ctx.next} disabled={!canNext}>
                  {step === 0 ? "Let's go" : 'Next'} <ArrowRight size={15} />
                </Button>
              )}
            </div>
          </div>
        </section>
      </div>
    </DesktopLayout>
  );
}
