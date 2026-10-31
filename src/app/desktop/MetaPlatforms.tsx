/**
 * Facebook Pages and Instagram accounts on the Platforms page: a step-by-step guide to get a Page
 * access token from your own Meta app, the connect form, and what each connected account does.
 */
import { ChevronDown, ExternalLink, Link2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { Autopilot } from '../../autopilot/engine';
import { metaChannel, platformOf, type AutopilotState, type Channel } from '../../autopilot/types';
import { Button } from '../../components/ui/Button';
import { inputClass } from '../../components/ui/controls';
import { desktop } from '../../desktop/bridge';
import { cn } from '../../lib/utils';
import { readyModuleIds } from '../../modules/registry';
import { Card } from './Layout';

const STEPS: { title: string; body: string; link?: [string, string] }[] = [
  {
    title: 'Have a Facebook Page (and link Instagram to it)',
    body: 'Posting goes to a Facebook Page, not a personal profile. For Instagram, switch your account to a Professional account (Creator or Business) and link it to the Page in Meta Business Suite or in Instagram, Settings, Accounts Center.',
    link: ['Meta Business Suite', 'https://business.facebook.com/'],
  },
  {
    title: 'Create your own Meta app',
    body: 'On Meta for Developers, open My Apps, Create app. Pick "Other", then the "Business" type, and name it (for example Flag Clash). It stays in Development mode, which is enough for Pages and accounts you manage; no App Review needed.',
    link: ['Meta for Developers, My Apps', 'https://developers.facebook.com/apps/'],
  },
  {
    title: 'Add Facebook Login and Instagram to the app',
    body: 'In the app dashboard, add the "Facebook Login for Business" product and the "Instagram" product (Instagram API with Facebook Login).',
  },
  {
    title: 'Get a user token with the right permissions',
    body: 'Open Graph API Explorer, pick your app, and under Permissions add: pages_show_list, pages_read_engagement, pages_manage_posts, publish_video, business_management, instagram_basic, instagram_content_publish. Click Generate Access Token and allow your Page and Instagram account.',
    link: ['Graph API Explorer', 'https://developers.facebook.com/tools/explorer/'],
  },
  {
    title: 'Make it long-lived',
    body: 'Paste that token into the Access Token Debugger and click "Extend Access Token". Copy the long-lived token and paste it back into Graph API Explorer as the access token.',
    link: ['Access Token Debugger', 'https://developers.facebook.com/tools/debug/accesstoken/'],
  },
  {
    title: 'Copy the Page access token',
    body: 'In Graph API Explorer, open "User or Page" and pick your Page (or run GET me/accounts). Copy the Page access token: one made from a long-lived token does not expire.',
  },
  {
    title: 'Paste it below and connect',
    body: 'Flag Clash finds your Page and the Instagram account linked to it, and keeps the token in Windows Credential Manager.',
  },
];

function Guide() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl bg-surface-2/50 ring-1 ring-line">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-[13px] font-medium"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        How to connect (about 10 minutes, once)
        <ChevronDown size={16} className={cn('transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <ol className="space-y-4 px-4 pb-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex gap-3">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent/15 text-xs font-semibold text-accent">
                {i + 1}
              </span>
              <div className="min-w-0 text-[13px]">
                <p className="font-medium">{s.title}</p>
                <p className="mt-1 leading-relaxed text-muted">{s.body}</p>
                {s.link && (
                  <button
                    type="button"
                    className="mt-1 inline-flex items-center gap-1 text-accent underline-offset-2 hover:underline"
                    onClick={() => void desktop.openUrl(s.link![1])}
                  >
                    {s.link[0]} <ExternalLink size={12} />
                  </button>
                )}
              </div>
            </li>
          ))}
          <li className="rounded-lg bg-bg/50 p-3 text-xs leading-relaxed text-muted">
            Limits: Instagram allows 50 posts and Facebook 30 Reels a day through the API. Facebook schedules
            long videos ahead, so they go out with your computer off; Reels and Instagram posts go out at
            their time while the app runs (preparing ahead still renders them early).
          </li>
        </ol>
      )}
    </div>
  );
}

/** The connect form and guide. Connected Facebook and Instagram cards are listed by the page. */
export function MetaConnect({ ap, state }: { ap: Autopilot; state: AutopilotState }) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const connected = state.channels.filter((c) => platformOf(c) !== 'youtube');
  const connect = async () => {
    setBusy(true);
    try {
      const acc = await desktop.metaConnect(token);
      const ready = readyModuleIds();
      const added: Channel[] = [
        metaChannel(
          { id: acc.pageId, title: acc.pageName, thumbnail: acc.pagePicture ?? '', pageId: acc.pageId },
          'facebook',
          state.channels,
          ready,
        ),
      ];
      if (acc.igId)
        added.push(
          metaChannel(
            {
              id: acc.igId,
              title: `@${acc.igUsername ?? 'instagram'}`,
              thumbnail: acc.igPicture ?? '',
              pageId: acc.pageId,
            },
            'instagram',
            state.channels,
            ready,
          ),
        );
      const ids = new Set(added.map((c) => c.id));
      await ap.update(
        { channels: [...state.channels.filter((c) => !ids.has(c.id)), ...added] },
        { replan: true },
      );
      setToken('');
      toast.success(
        acc.igId
          ? `Connected ${acc.pageName} and @${acc.igUsername}`
          : `Connected ${acc.pageName}. No Instagram account is linked to this Page.`,
      );
    } catch (err) {
      toast.error(String(err).replace(/^meta:\s*/, ''));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card
      title="Facebook and Instagram"
      note="Optional. Post the same games to a Facebook Page and its Instagram account through Meta's Graph API, each with its own daily plan. YouTube does not depend on them."
    >
      <div className="space-y-4">
        <Guide />
        <div className="space-y-2">
          <label htmlFor="meta-token" className="text-[13px] font-medium">
            Page access token
          </label>
          <div className="flex gap-2">
            <input
              id="meta-token"
              type="password"
              className={inputClass}
              placeholder="EAAG…"
              value={token}
              autoComplete="off"
              onChange={(e) => setToken(e.target.value)}
            />
            <Button variant="primary" disabled={!token.trim() || busy} onClick={() => void connect()}>
              <Link2 size={15} /> {busy ? 'Checking…' : connected.length ? 'Connect another Page' : 'Connect'}
            </Button>
          </div>
          <p className="text-xs text-muted">
            Connected accounts start with one Short a day per game (Facebook also one long video a day) and
            post the YouTube channel&apos;s videos when they fit, so nothing renders twice. Change it on their
            cards below and on the Autopilot page.
          </p>
        </div>
      </div>
    </Card>
  );
}
