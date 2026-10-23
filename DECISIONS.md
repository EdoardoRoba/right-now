# Decisions

A short log of the choices made and why. Newest sections are at the bottom.

## Plan

**M0 — Skeleton** ✅

- Vite + TS, ESLint/Prettier, Vitest, Playwright
- Tokens + plain CSS (tokens / base / layout / components / animations)
- Shell: header (wordmark, pills, freshness, UTC clock), hero row, river frame, ticker, Sources dialog
- Path router with the 3 channels; Wikipedia and Exploited show "coming soon"; in-app 404

**M1 — Earthquakes (v1)** ✅ in code · ⏳ deployment

- USGS source: past-day fill, past-hour poll every 60 s, backoff, pause when hidden
- Store: dedupe, in-place revisions, window pruning, cap
- Canvas river, Pulse, side list, stats, ticker, freshness badge, tooltip
- Reduced motion and mobile layouts
- Unit tests + e2e smoke test with fixtures
- ⏳ Cloudflare Pages deploy and README screenshots/GIF from real data, which need network access to USGS and a Cloudflare account (see "Open items")

**M2 — Wikipedia pulse (v1.1)**: `src/channels/wikipedia/` with an EventSource source, surge detector (+ recorded fixture), and a CSP `connect-src` entry.
**M3 — Exploited (v1.2)**: Worker cron (KEV + NVD) → `/api/exploited`, `src/channels/exploited/`.
**M4 — Polish**: OG image, About & sources page, keyboard shortcuts 1/2/3, share button.

## Architecture

- **Channel = one folder + one registry entry.** `src/channels/registry.ts` lists the menu, and each live channel is a lazy `import()`, so it only costs bytes when opened. The core (`river`, `pulse`, `sidelist`, `store`, `view`) is channel-agnostic.
- **Small deviations from the brief's interface** (`src/core/types.ts`):
  - `start(ctx)` receives `{ store, freshness }` instead of just the store, so every source reports successes and errors the same way.
  - `tagline` is `string[]` (ticker segments) rather than one string.
  - `pulse.bar.labels` carry their position (`{ text, at }`), so "M5 strong" sits at its true place on the M1→M8 scale (57%), not centred as in the mockup.
  - Extra fields: `retainImportantMs`, `pollMs`, `sources`, `sideTitle`, `sideItem`, `summary`, `startDemo`.
- **`LiveEvent.size` is the dot diameter**, not the radius. The mockup formula `6 + mag² × 1.5` is a width in px; read as a radius it would make an M5 dot 87 px wide. It is clamped to 6–80 px. On rivers narrower than 1100 px, dots scale down to 60% at most.
- **The store keeps important events longer than the river window** (`retainImportantMs`, 24 h for quakes). That is how the Pulse shows "the latest M2.5+ from the past day" with an honest "2 h ago" when the last hour was quiet.
- **Path routing** (`/earthquakes`…), not hash routing: nicer URLs to share. Cloudflare Pages serves `index.html` for unknown paths when there is no top-level `404.html` (SPA mode), and the 404 view is in-app.
- Pills are `<a>` links (navigation semantics, middle-click works) with `aria-current="page"`.

## Earthquakes

- **Only `type === "earthquake"`** is shown. Quarry blasts, explosions, ice quakes etc. are dropped: the channel promises "every quake", and dimmed non-quakes would need a legend.
- **Events without a magnitude are skipped.** They can't be sized or coloured honestly, and USGS normally fills in the magnitude within minutes, so they appear on the next poll.
- **Magnitudes are rounded to one decimal before the M2.5 test**, so what is shown always matches the rule: a 2.47 shows as "2.5" and counts as important.
- **Depth**: sqrt scale to 700 km. Above-sea-level depths clamp to 0, and an unknown depth shows "depth not yet known".
- **Links**: only `https://*.usgs.gov` URLs are rendered as links.
- **Conditional requests**: `fetch(url, { cache: 'no-cache' })` makes the browser revalidate with ETag/Last-Modified itself. Setting `If-Modified-Since` by hand would make the request non-simple and trigger a CORS preflight.
- **After a gap over 50 min** (e.g. a long-hidden tab), the next poll refills from `all_day` instead of `all_hour`, so the Pulse and side list don't miss notable quakes.
- **Copy change**: the mockup's "THE MOMENT IT IS RECORDED" became "AS SOON AS USGS PUBLISHES IT". USGS publishes with a delay of minutes, and the honesty rules win.
- **The "Strongest" stat** uses the magnitude colour of that quake instead of always orange, so the colour matches the number.
- **The tsunami tag** is calm blue (not red), links to the USGS event page, and says only "Tsunami information issued — check official sources".

## CORS / Worker

- **Verified on 2026-10-23**: the USGS feeds answer with `Access-Control-Allow-Origin: *`, `Cache-Control: public, max-age=60` and `Last-Modified` (no ETag), and are served via CloudFront. **Decision: the frontend fetches USGS directly** (zero server cost). `cache: 'no-cache'` lets the browser revalidate with `If-Modified-Since`.
- **The fallback stays ready**: the Worker implements `GET /api/usgs/:feed` (allow-list `all_hour`, `all_day`, Cache API 55 s, CORS `*`). It is not needed today.
- No cron in v1. v1.2 will use at most 2.

## Data & fixtures

- **Real recorded fixtures**: `usgs-all_hour-*.geojson` and `usgs-all_day-*.geojson` (2026-10-23, public domain) are run through the parser by the unit tests. The day feed held 267 events: 262 earthquakes, 3 quarry blasts, 2 explosions, 45 at M2.5+ (only 1 in the last hour), 4 with negative magnitudes, and depths from −2.25 to 236 km.
- **`synthetic-sample.geojson` is hand-written** (fictional "Testland" places) to cover edge cases the real feed rarely has (null magnitude, tsunami flag, missing place, non-USGS URL). The e2e test uses it.
- **The e2e test** intercepts the USGS URLs and serves the fixture with its timestamps shifted to "now".
- **Demo mode** (`?demo=1`): real-time (no time-lapse), busier than reality, a "DEMO DATA" badge and ticker segment, `DEMO-2026-xxxxx` ids. The code is lazy-loaded, so production visitors never download it. `?dots=N` sets the starting count for performance tests.

## Visual / motion

- **CSS keyframes** live in `animations.css` (breathe, hero-in, hero-out, shockwave, marquee). Canvas motion (pop-in, ring, drift, fade) is in `river.ts`, with pure, unit-tested helpers.
- **Glow uses one pre-rendered radial-gradient sprite per colour** plus a crisp `arc()` core, instead of `shadowBlur` per dot (cheap at 1,500 dots).
- **The canvas bleeds 40 px above and below the river box**, so large, shallow quakes aren't clipped (the mockup's DOM dots overflow the same way).
- **Labels**: a newest-first placement pass skips any label that would overlap a newer one. Labels flip to the left of their dot near the NOW line, and a thin background-coloured halo keeps them legible over other dots.
- **Initial fill doesn't pop**: only events that arrive after the first fill animate in, so a page load is calm.
- **The outgoing Pulse hero** blurs up and away (0.5 s) while the new one slides in (0.9 s, `--ease-out-expo`).
- **Hidden tab**: the rAF loop and polling stop, and CSS animations are paused (`.is-hidden`). On return, everything is recomputed from timestamps, with no catch-up bursts.
- **Reduced motion**: no pop, rings, blur or marquee (static ticker text), and the river redraws once a second.

## Privacy & security

- **No cookies, no analytics, no third-party requests** other than the data sources. Fonts are self-hosted (OFL).
- **A strict CSP** is in `public/_headers` (`script-src 'self'`, `connect-src 'self' https://earthquake.usgs.gov`).
- **No secrets anywhere in the repo**: `.gitignore` excludes `.env*`, `.dev.vars`, keys and certificates. The future NVD key goes only into `wrangler secret`.

## Performance (measured)

Measured with headless Chromium (software rendering, 4 vCPU container, 1280×880), via `?demo=1&dots=N`:

| Dots  | Average fps (5 s) | Worst frame |
| ----- | ----------------- | ----------- |
| 500   | 59.9              | 33 ms       |
| 1,500 | 59.3              | 33 ms       |

**Bundle** (production build, gzip):

- JS: 8.96 KB entry + 2.66 KB earthquake channel (+ 0.86 KB demo, only loaded with `?demo=1`)
- CSS: 3.71 KB
- Fonts: about 82 KB for the Latin subsets actually used

**Memory (soak test)**: headless Chromium ran `?demo=1&dots=1400` with the store at its 1,500-dot cap and new events arriving every 1–3 s. Heap after forced GC, sampled once a minute for 10 minutes: 10.0 MB every time, with no growth.

- Caveat: Chromium's `performance.memory` is coarse (bucketed) without `--enable-precise-memory-info`, so this rules out a real leak but not drift under about 1 MB.
- Still to do: a 30-minute DevTools check on the deployed site.

Lighthouse has not been run yet: it needs the deployed URL.

## Live check (2026-10-23)

- **The production build on the live USGS feed** rendered correctly: Pulse "M3.4 · 70 km W of Ferndale, CA · 10 km deep · 27 min ago", 8 quakes in the river, and the earlier M4+ quakes in the side list.
- **Bug found and fixed**: the "DEMO DATA" badge showed on real data, because `.chip { display: inline-flex }` beat the `hidden` attribute. A global `[hidden] { display: none !important }` fixes it, and the e2e test now asserts the badge is hidden outside demo mode.
- **A real hour is quiet** (about 5–15 quakes worldwide, usually 0–2 at M2.5+). The river is sparse but honest. A possible later option is a longer window (e.g. 6 h); not done, because the brief asks for 60 min.
- **Sandbox note**: in this sandbox, Chromium can't use the agent proxy, so the live check relayed the USGS responses through Node unchanged (same body and same CORS header).

## Open items

- [ ] Allow `www.usgs.gov` in the dev environment to re-read the USGS copyright/credit page, then update `ATTRIBUTION.md`. The feed documentation was re-read on 2026-10-23.
- [ ] Deploy to Cloudflare Pages (needs the owner's Cloudflare account; see the README).
- [ ] README screenshots and a GIF with real data; Lighthouse run on the deployed URL.
- [ ] Choose a license for the code (none has been set yet).
