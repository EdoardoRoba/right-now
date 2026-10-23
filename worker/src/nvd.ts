/**
 * NVD CVE API 2.0. Called only from the Worker; the optional API key lives in
 * the Worker secret NVD_API_KEY and is never sent to browsers.
 * This product uses the NVD API but is not endorsed or certified by the NVD.
 */
import type { CompactCve, KevScore } from './types';

export const NVD_URL = 'https://services.nvd.nist.gov/rest/json/cves/2.0';
export const NVD_PAGE_SIZE = 500;

/** NVD wants "YYYY-MM-DDTHH:mm:ss.sss" (UTC when no offset is given). */
export const nvdDate = (t: number) => new Date(t).toISOString().replace('Z', '');

export function publishedUrl(start: number, end: number, startIndex = 0): string {
  const q = new URLSearchParams({
    pubStartDate: nvdDate(start),
    pubEndDate: nvdDate(end),
    resultsPerPage: String(NVD_PAGE_SIZE),
    startIndex: String(startIndex),
  });
  return `${NVD_URL}?${q}`;
}

export const cveUrl = (id: string) => `${NVD_URL}?${new URLSearchParams({ cveId: id })}`;

interface CvssEntry {
  type?: string;
  cvssData?: { baseScore?: number; baseSeverity?: string; version?: string };
  baseSeverity?: string; // v2 keeps it here
}

interface NvdCve {
  id?: string;
  published?: string;
  vulnStatus?: string;
  descriptions?: { lang?: string; value?: string }[];
  metrics?: Record<string, CvssEntry[] | undefined>;
}

/** Preference order: CVSS 3.1, 4.0, 3.0, 2.0; Primary (NVD) before Secondary (CNA). */
const METRIC_KEYS = ['cvssMetricV31', 'cvssMetricV40', 'cvssMetricV30', 'cvssMetricV2'] as const;

export function pickScore(metrics: NvdCve['metrics']): KevScore {
  for (const key of METRIC_KEYS) {
    const list = metrics?.[key];
    if (!list?.length) continue;
    const entry = list.find((m) => m.type === 'Primary') ?? list[0]!;
    const score = entry.cvssData?.baseScore;
    if (typeof score !== 'number') continue;
    return {
      score,
      version:
        entry.cvssData?.version ?? key.replace('cvssMetricV', '').replace(/(\d)(\d)$/, '$1.$2'),
      severity: entry.cvssData?.baseSeverity ?? entry.baseSeverity ?? null,
    };
  }
  return { score: null, version: null, severity: null };
}

/** First sentence (or 160 chars) of the English description, marked as an excerpt. */
export function excerpt(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  const sentence = clean.match(/^.{20,160}?[.!?](\s|$)/)?.[0].trim();
  if (sentence) return sentence;
  return clean.length > 160 ? `${clean.slice(0, 157).trimEnd()}…` : clean;
}

export function toCompact(c: NvdCve): CompactCve | null {
  if (!c.id || !/^CVE-\d{4}-\d{4,}$/.test(c.id) || !c.published) return null;
  // NVD timestamps have no offset and are UTC.
  const published = Date.parse(
    /Z|[+-]\d\d:\d\d$/.test(c.published) ? c.published : `${c.published}Z`,
  );
  if (!Number.isFinite(published)) return null;
  if (c.vulnStatus === 'Rejected') return null;
  const en = c.descriptions?.find((d) => d.lang === 'en')?.value ?? '';
  return { id: c.id, published, ...pickScore(c.metrics), excerpt: excerpt(en) };
}

export function parseNvd(json: unknown): { cves: CompactCve[]; total: number } {
  const doc = json as { vulnerabilities?: { cve?: NvdCve }[]; totalResults?: number };
  if (!Array.isArray(doc?.vulnerabilities)) throw new Error('NVD: missing vulnerabilities');
  const cves: CompactCve[] = [];
  for (const v of doc.vulnerabilities) {
    const c = v.cve && toCompact(v.cve);
    if (c) cves.push(c);
  }
  return { cves, total: doc.totalResults ?? cves.length };
}
