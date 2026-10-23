// Records real USGS feed responses into src/channels/earthquakes/fixtures/.
// Usage: npm run record:fixtures
import { writeFile } from 'node:fs/promises';

const BASE = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/';
const OUT = new URL('../src/channels/earthquakes/fixtures/', import.meta.url);
const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');

for (const feed of ['all_hour', 'all_day']) {
  const res = await fetch(`${BASE}${feed}.geojson`);
  if (!res.ok) throw new Error(`${feed}: HTTP ${res.status}`);
  console.log(
    `${feed}: HTTP ${res.status}, access-control-allow-origin: ${res.headers.get('access-control-allow-origin')}`,
  );
  const file = new URL(`usgs-${feed}-${stamp}.geojson`, OUT);
  await writeFile(file, await res.text());
  console.log('wrote', file.pathname);
}
