/**
 * CISA Known Exploited Vulnerabilities (CC0).
 *
 * The catalog is ~1.8 MB and lists the newest entries first. Parsing all of
 * it would blow the free plan's 10 ms CPU budget, so we stream the response
 * and stop after the first `max` entries, scanning objects with a small
 * string-aware brace matcher instead of JSON.parse on the whole document.
 */
import type { KevItem } from './types';

export const KEV_URL =
  'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';
/** Official CISA mirror, used if the main URL fails. */
export const KEV_MIRROR_URL =
  'https://raw.githubusercontent.com/cisagov/kev-data/main/known_exploited_vulnerabilities.json';
export const KEV_HEAD_ITEMS = 40;

export interface KevHead {
  catalogVersion: string | null;
  dateReleased: string | null;
  items: KevItem[];
}

interface RawKev {
  cveID?: string;
  vendorProject?: string;
  product?: string;
  vulnerabilityName?: string;
  dateAdded?: string;
  dueDate?: string;
  knownRansomwareCampaignUse?: string;
}

export function toKevItem(r: RawKev): KevItem | null {
  if (!r.cveID || !/^CVE-\d{4}-\d{4,}$/.test(r.cveID) || !r.dateAdded) return null;
  return {
    cve: r.cveID,
    vendor: r.vendorProject ?? '',
    product: r.product ?? '',
    name: r.vulnerabilityName ?? '',
    dateAdded: r.dateAdded,
    dueDate: r.dueDate ?? '',
    ransomware: r.knownRansomwareCampaignUse === 'Known',
  };
}

/**
 * Incremental scanner: feed text chunks; it returns true once `max` items of
 * the "vulnerabilities" array have been collected (then the caller can stop
 * reading the stream).
 */
export class KevHeadScanner {
  readonly head: KevHead = { catalogVersion: null, dateReleased: null, items: [] };
  private buf = '';
  private pos = 0;
  private inArray = false;
  private done = false;

  constructor(private readonly max = KEV_HEAD_ITEMS) {}

  push(chunk: string): boolean {
    if (this.done) return true;
    this.buf += chunk;
    if (!this.inArray) {
      const at = this.buf.indexOf('"vulnerabilities"');
      if (at < 0) return false;
      const bracket = this.buf.indexOf('[', at);
      if (bracket < 0) return false;
      // Catalog metadata sits before the array.
      const pre = this.buf.slice(0, at);
      this.head.catalogVersion = pre.match(/"catalogVersion"\s*:\s*"([^"]*)"/)?.[1] ?? null;
      this.head.dateReleased = pre.match(/"dateReleased"\s*:\s*"([^"]*)"/)?.[1] ?? null;
      this.inArray = true;
      this.pos = bracket + 1;
    }
    while (this.head.items.length < this.max) {
      const start = this.buf.indexOf('{', this.pos);
      if (start < 0) break;
      const end = matchObject(this.buf, start);
      if (end < 0) break; // object not complete yet: wait for more text
      try {
        const item = toKevItem(JSON.parse(this.buf.slice(start, end + 1)) as RawKev);
        if (item) this.head.items.push(item);
      } catch {
        /* skip a malformed entry */
      }
      this.pos = end + 1;
    }
    // Keep memory flat: drop what we've consumed.
    if (this.pos > 65_536) {
      this.buf = this.buf.slice(this.pos);
      this.pos = 0;
    }
    this.done = this.head.items.length >= this.max;
    return this.done;
  }
}

/** Index of the `}` closing the object that starts at `start`, or -1 if incomplete. */
export function matchObject(s: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (inString) {
      if (c === 92 /* \ */) i++;
      else if (c === 34 /* " */) inString = false;
    } else if (c === 34) inString = true;
    else if (c === 123 /* { */) depth++;
    else if (c === 125 /* } */) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Streams a KEV document and returns only its head. */
export async function readKevHead(res: Response, max = KEV_HEAD_ITEMS): Promise<KevHead> {
  if (!res.body) throw new Error('KEV: empty body');
  const scanner = new KevHeadScanner(max);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (scanner.push(decoder.decode(value, { stream: true }))) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  if (!scanner.head.items.length) throw new Error('KEV: no entries found');
  // Newest first, whatever order the file uses.
  scanner.head.items.sort((a, b) => b.dateAdded.localeCompare(a.dateAdded));
  return scanner.head;
}
