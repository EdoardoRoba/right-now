/**
 * The compact JSON served at /api/exploited. Shared by the Worker and the
 * frontend (type-only), so both sides agree on the shape.
 */

export interface CompactCve {
  /** e.g. "CVE-2026-12345" */
  id: string;
  /** NVD `published`, epoch ms */
  published: number;
  /** CVSS base score 0–10, or null while NVD has none yet */
  score: number | null;
  /** "3.1", "4.0", "3.0", "2.0" */
  version: string | null;
  /** NVD baseSeverity, e.g. "CRITICAL" */
  severity: string | null;
  /** First sentence of the English description, max ~160 chars (an excerpt, not NVD's wording changed). */
  excerpt: string;
}

export interface KevItem {
  cve: string;
  vendor: string;
  product: string;
  name: string;
  /** "YYYY-MM-DD" as published by CISA */
  dateAdded: string;
  /** "YYYY-MM-DD" federal remediation deadline */
  dueDate: string;
  /** true only when CISA says "Known" */
  ransomware: boolean;
}

export interface KevScore {
  score: number | null;
  version: string | null;
  severity: string | null;
}

export interface ExploitedPayload {
  generatedAt: number;
  nvd: { fetchedAt: number | null; ok: boolean; cves: CompactCve[] };
  kev: {
    fetchedAt: number | null;
    ok: boolean;
    catalogVersion: string | null;
    dateReleased: string | null;
    items: (KevItem & KevScore)[];
  };
}
