/**
 * The channel menu. Adding a channel = adding its folder and one entry here.
 * Channels are lazy-loaded so each only costs bytes when it's opened.
 */
import type { Channel, ChannelId } from '../core/types';

export interface ChannelEntry {
  id: ChannelId;
  name: string;
  path: string;
  status: 'live' | 'soon';
  /** For "coming soon" channels. */
  release?: string;
  blurb?: string;
  load?: () => Promise<Channel>;
}

export const channels: ChannelEntry[] = [
  {
    id: 'earthquakes',
    name: 'Earthquakes',
    path: '/earthquakes',
    status: 'live',
    load: () => import('./earthquakes').then((m) => m.default),
  },
  {
    id: 'exploited',
    name: 'Exploited vulns',
    path: '/exploited',
    status: 'soon',
    release: 'v1.2',
    blurb:
      'Every new software vulnerability as it is published — and the ones attackers are known to be using right now, from the CISA KEV catalog and the NVD.',
  },
  {
    id: 'wikipedia',
    name: 'Wikipedia pulse',
    path: '/wikipedia',
    status: 'live',
    load: () => import('./wikipedia').then((m) => m.default),
  },
];

export const defaultChannel = channels[0]!;

export function channelForPath(pathname: string): ChannelEntry | undefined {
  const clean = pathname.replace(/\/+$/, '') || '/';
  return channels.find((c) => c.path === clean);
}
