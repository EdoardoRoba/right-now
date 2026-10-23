import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

/**
 * Smoke test: the page's EventSource is replaced by a fake that replays the
 * recorded (privacy-safe) fixture, timestamps shifted into the last minute.
 */
const lines = readFileSync(
  new URL('../../src/channels/wikipedia/fixtures/recentchange-10min.ndjson', import.meta.url),
  'utf8',
)
  .trim()
  .split('\n');

test('wikipedia: replays the stream, draws the river, never shows usernames', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('https://earthquake.usgs.gov/**', (r) => r.abort());
  await page.addInitScript(() => {
    const w = window as unknown as {
      __es: { onmessage?: (m: { data: string }) => void; url: string }[];
    };
    w.__es = [];
    (window as unknown as { EventSource: unknown }).EventSource = class {
      readyState = 1;
      onmessage?: (m: { data: string }) => void;
      constructor(public url: string) {
        w.__es.push(this);
      }
      close() {
        this.readyState = 2;
      }
    };
  });
  await page.goto('/wikipedia');
  await expect(page.getByRole('link', { name: 'Wikipedia pulse' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.locator('.pulse__kicker')).toContainText('LISTENING');
  await page.waitForFunction(() => (window as unknown as { __es: unknown[] }).__es.length > 0);
  expect(
    await page.evaluate(() => (window as unknown as { __es: { url: string }[] }).__es[0]!.url),
  ).toBe('https://stream.wikimedia.org/v2/stream/recentchange');

  // Replay: spread the fixture over the last 50 s; add one message carrying a username.
  const now = Date.now();
  const msgs = lines.map((l, i) => {
    const raw = JSON.parse(l);
    raw.meta = {
      id: raw.id,
      dt: new Date(now - 50_000 + (i / lines.length) * 50_000).toISOString(),
    };
    return JSON.stringify(raw);
  });
  msgs.push(
    JSON.stringify({
      meta: { id: 'privacy-check', dt: new Date(now).toISOString() },
      type: 'edit',
      namespace: 0,
      title: 'Privacy check article',
      server_name: 'en.wikipedia.org',
      user: 'SECRET-USERNAME-198.51.100.7',
      bot: false,
      length: { old: 0, new: 9000 },
    }),
  );
  await page.evaluate((ms) => {
    const es = (window as unknown as { __es: { onmessage?: (m: { data: string }) => void }[] })
      .__es[0]!;
    for (const data of ms) es.onmessage?.({ data });
  }, msgs);

  // Pulse: the most-edited article (no real surge in a 10-minute sample)
  await expect(page.locator('.pulse__kicker')).toContainText('MOST EDITED');
  await expect(page.locator('.pulse__subtitle')).toContainText(
    /edits in 10 min · \d+ editors · [a-z-]+\.wikipedia/,
  );
  await expect(
    page.locator('.pulse').getByRole('link', { name: /Read the article/ }),
  ).toHaveAttribute('href', /^https:\/\/[a-z-]+\.wikipedia\.org\/wiki\//);

  // Stats and freshness
  await expect(page.locator('.stat__value').first()).not.toHaveText('0.0');
  await expect(page.locator('#freshness')).toContainText('Updated');

  // River has painted pixels
  await expect
    .poll(() =>
      page.locator('.river__canvas').evaluate((c: HTMLCanvasElement) => {
        const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i]! > 0) n++;
        return n;
      }),
    )
    .toBeGreaterThan(500);

  // Required notice is visible; usernames/IPs appear nowhere
  await expect(page.locator('#ticker')).toContainText('WIKIPEDIA CONTENT CC BY-SA');
  const html = await page.content();
  expect(html).not.toContain('SECRET-USERNAME');
  expect(html).not.toContain('198.51.100.7');
  expect(errors).toEqual([]);
});
