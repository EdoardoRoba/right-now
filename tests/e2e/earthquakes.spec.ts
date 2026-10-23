import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * Smoke test with recorded fixtures: USGS requests are intercepted and answered
 * with the fixture, its timestamps shifted so the newest event is ~20 s old.
 */
const fixture = JSON.parse(
  readFileSync(
    new URL('../../src/channels/earthquakes/fixtures/synthetic-sample.geojson', import.meta.url),
    'utf8',
  ),
);

async function serveFixture(page: Page) {
  const newest = Math.max(
    ...fixture.features.map((f: { properties: { time: number } }) => f.properties.time),
  );
  await page.route(
    'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/*.geojson',
    (route) => {
      const shift = Date.now() - 20_000 - newest;
      const body = structuredClone(fixture);
      for (const f of body.features) f.properties.time += shift;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(body),
      });
    },
  );
}

test.describe('earthquakes', () => {
  test('loads, draws the river and shows the Pulse from fixtures', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await serveFixture(page);
    await page.goto('/');

    await expect(page).toHaveURL(/\/earthquakes$/);
    await expect(page.getByRole('link', { name: 'Earthquakes' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    // Pulse: the newest M2.5+ in the fixture
    const pulse = page.locator('.pulse');
    await expect(pulse.locator('.pulse__number')).toHaveText('4.6');
    await expect(pulse.locator('.pulse__title')).toHaveText('Offshore Test Region A');
    await expect(pulse.locator('.pulse__subtitle')).toHaveText('12 km deep');
    await expect(pulse.locator('.pulse__ago')).toContainText('min ago');
    await expect(pulse.getByRole('link', { name: /View on USGS/ })).toHaveAttribute(
      'href',
      'https://earthquake.usgs.gov/earthquakes/eventpage/xx0002',
    );

    // Side list + stats
    await expect(page.locator('.side__item').first()).toBeVisible();
    await expect(page.locator('.stat__value').first()).toHaveText('10');
    await expect(page.locator('.stat__value').nth(1)).toHaveText('M6.3');

    // Freshness
    await expect(page.locator('#freshness')).toContainText('Updated');

    // River: the canvas has painted pixels
    await expect
      .poll(async () =>
        page.locator('.river__canvas').evaluate((c: HTMLCanvasElement) => {
          const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
          let painted = 0;
          for (let i = 3; i < data.length; i += 4) if (data[i]! > 0) painted++;
          return painted;
        }),
      )
      .toBeGreaterThan(500);

    // Attribution is visible
    await expect(page.locator('#ticker')).toContainText('DATA: U.S. GEOLOGICAL SURVEY');
    expect(errors).toEqual([]);
  });

  test('Sources dialog shows the attribution', async ({ page }) => {
    await serveFixture(page);
    await page.goto('/earthquakes');
    await page.getByRole('button', { name: 'SOURCES' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Data: U.S. Geological Survey');
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();
  });

  test('demo mode is clearly labelled', async ({ page }) => {
    await page.route('https://earthquake.usgs.gov/**', (r) => r.abort());
    await page.goto('/earthquakes?demo=1');
    await expect(page.locator('#demo-badge')).toBeVisible();
    await expect(page.locator('#ticker')).toContainText('DEMO DATA');
  });
});

test('coming-soon channels and 404', async ({ page }) => {
  await page.route('https://earthquake.usgs.gov/**', (r) => r.abort());
  await page.goto('/wikipedia');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Wikipedia pulse');
  await page.getByRole('link', { name: 'Exploited vulns' }).click();
  await expect(page).toHaveURL(/\/exploited$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Exploited vulns');
  await page.goto('/nope');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Nothing is happening here');
});
