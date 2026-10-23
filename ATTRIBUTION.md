# Attribution & data terms

Right Now shows only real, openly licensed data. Every event links to its official source page, and the required notices are always visible: in the ticker, in the **Sources** dialog, and here.

> **Status of the terms check (2026-10-23):** the environment this project was bootstrapped in could not reach `usgs.gov` or `wikimedia.org` (outbound network policy). The notes below are based on the providers' long-standing published terms and **must be re-read against the live pages before launch**. Update the "Last checked" dates when you do.

## Earthquakes — U.S. Geological Survey (v1, live)

|                         |                                                                                                                                                                                                                                                                               |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Endpoints               | `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson` (polled every 60 s) · `…/all_day.geojson` (initial fill)                                                                                                                                         |
| Docs                    | https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php                                                                                                                                                                                                                 |
| License                 | U.S. public domain (works of the U.S. Government). USGS asks for credit.                                                                                                                                                                                                      |
| Terms page              | https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits                                                                                                                                                                                             |
| Required / shown notice | **"Data: U.S. Geological Survey"** (ticker, Sources dialog)                                                                                                                                                                                                                   |
| How we use it           | Fetched directly by the visitor's browser (no server), at most once a minute, paused while the tab is hidden. Each event links to its USGS event page. We show magnitude, place, depth, time and the tsunami flag exactly as published; nothing is invented or editorialised. |
| Last checked            | ⚠️ not yet verified live — see status above                                                                                                                                                                                                                                   |

## Wikipedia pulse — Wikimedia EventStreams (v1.1, not built yet)

|                |                                                                               |
| -------------- | ----------------------------------------------------------------------------- |
| Endpoint       | `https://stream.wikimedia.org/v2/stream/recentchange` (SSE)                   |
| License        | Wikipedia text: CC BY-SA. We show only article titles and counts.             |
| Notice to show | "Live edits: Wikimedia EventStreams · Wikipedia content CC BY-SA"             |
| Privacy        | Usernames and IP addresses are never shown or stored.                         |
| Last checked   | ⚠️ to do before v1.1 (API access policy, User-Agent rules, connection limits) |

## Exploited vulnerabilities — CISA KEV + NVD (v1.2, not built yet)

|                |                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| CISA KEV       | `https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json` — CC0            |
| NVD API 2.0    | `https://services.nvd.nist.gov/rest/json/cves/2.0` — called only from the Worker with a secret API key |
| Notice to show | **"This product uses the NVD API but is not endorsed or certified by the NVD."**                       |
| Last checked   | ⚠️ to do before v1.2                                                                                   |

## Fonts

Self-hosted from `public/fonts/` (no runtime requests to Google):

- **Space Grotesk** — SIL Open Font License 1.1 (`public/fonts/OFL-SpaceGrotesk.txt`)
- **JetBrains Mono** — SIL Open Font License 1.1 (`public/fonts/OFL-JetBrainsMono.txt`)

Files come from the Fontsource packages (`@fontsource/space-grotesk`, `@fontsource/jetbrains-mono`), Latin and Latin Extended subsets.
