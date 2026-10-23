/**
 * Path routing: /earthquakes, /wikipedia, /exploited. "/" redirects to the
 * default channel. Query strings (e.g. ?demo=1) are preserved across navigation.
 * Cloudflare Pages serves index.html for unknown paths (SPA mode).
 */
import { channelForPath, defaultChannel, type ChannelEntry } from './channels/registry';

export type Route = { kind: 'channel'; entry: ChannelEntry } | { kind: 'not-found'; path: string };

export function resolve(pathname: string): Route {
  if (pathname === '/' || pathname === '') return { kind: 'channel', entry: defaultChannel };
  const entry = channelForPath(pathname);
  return entry ? { kind: 'channel', entry } : { kind: 'not-found', path: pathname };
}

export function startRouter(onRoute: (route: Route) => void): { go(path: string): void } {
  const render = () => {
    if (location.pathname === '/') {
      history.replaceState(null, '', defaultChannel.path + location.search + location.hash);
    }
    onRoute(resolve(location.pathname));
  };

  const go = (path: string) => {
    if (path === location.pathname) return;
    history.pushState(null, '', path + location.search);
    render();
  };

  // Intercept same-origin, unmodified clicks on internal links.
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
      return;
    const a = (e.target as Element).closest?.('a[data-route]');
    if (!(a instanceof HTMLAnchorElement)) return;
    e.preventDefault();
    go(new URL(a.href).pathname);
  });

  window.addEventListener('popstate', render);
  render();
  return { go };
}
