// Records the Wikimedia recentchange stream into a privacy-safe fixture for
// tests and surge tuning: Wikipedia article edits only, no usernames, no IPs,
// no comments. Editors become a one-way hash with a random salt that is never
// saved, so the file can't be linked back to anyone.
// Usage: node scripts/record-wikipedia.mjs <minutes> [out.ndjson]
// Behind a proxy: NODE_USE_ENV_PROXY=1 node scripts/record-wikipedia.mjs 10
import { createHash, randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';

const minutes = Number(process.argv[2] ?? 10);
const out =
  process.argv[3] ??
  `src/channels/wikipedia/fixtures/recentchange-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}.ndjson`;
const salt = randomBytes(32);
const anon = (user) => createHash('sha256').update(salt).update(user).digest('hex').slice(0, 12);

const file = createWriteStream(out);
const decoder = new TextDecoder();
let kept = 0;
let seen = 0;
let lastDt = null;
const end = Date.now() + minutes * 60_000;
// Wikimedia closes long connections now and then; resume from the last event.
while (Date.now() < end) {
  const url = new URL('https://stream.wikimedia.org/v2/stream/recentchange');
  if (lastDt) url.searchParams.set('since', lastDt);
  try {
    const res = await fetch(url, {
      headers: {
        accept: 'text/event-stream',
        'user-agent': 'right-now fixture recorder (https://github.com/EdoardoRoba/right-now)',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    let buf = '';
    for await (const chunk of res.body) {
      buf += decoder.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (!line.startsWith('data: ')) continue;
        seen++;
        let e;
        try {
          e = JSON.parse(line.slice(6));
        } catch {
          continue;
        }
        if (e.meta?.dt) lastDt = e.meta.dt;
        if (e.type !== 'edit' || e.namespace !== 0 || !e.server_name?.endsWith('.wikipedia.org'))
          continue;
        file.write(
          JSON.stringify({
            id: e.meta?.id,
            dt: e.meta?.dt,
            type: e.type,
            namespace: e.namespace,
            wiki: e.wiki,
            server_name: e.server_name,
            title: e.title,
            bot: e.bot,
            length: e.length,
            revision: e.revision,
            editor: anon(String(e.user ?? '')),
          }) + '\n',
        );
        kept++;
      }
      if (Date.now() > end) break;
    }
  } catch (err) {
    console.warn('stream dropped, resuming:', err.message);
    await new Promise((r) => setTimeout(r, 1000));
  }
}
file.end();
console.log(`seen ${seen} events, kept ${kept} Wikipedia article edits → ${out}`);
process.exit(0);
