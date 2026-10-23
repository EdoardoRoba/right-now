# Attribution & data terms

Right Now shows only real, openly licensed data. Every event links to its official source page, and the required notices are always visible: in the ticker, in the **Sources** dialog, and here.

> **Status of the terms check (2026-10-23):**
>
> - USGS feed and feed documentation: verified live.
> - USGS copyright page (`www.usgs.gov`): still unreachable from the dev environment.
> - Wikimedia EventStreams: endpoint and spec verified live; policy wiki pages still to re-read.
> - CISA/NVD: to check before that channel ships.
>
> Update the "Last checked" dates when you re-read a page.

## Earthquakes — U.S. Geological Survey (v1, live)

|                         |                                                                                                                                                                                                                                                                                                                              |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Endpoints               | `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson` (polled every 60 s) · `…/all_day.geojson` (initial fill)                                                                                                                                                                                        |
| Docs                    | https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php                                                                                                                                                                                                                                                                |
| License                 | U.S. public domain (works of the U.S. Government). USGS asks for credit.                                                                                                                                                                                                                                                     |
| Terms page              | https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits                                                                                                                                                                                                                                            |
| Required / shown notice | **"Data: U.S. Geological Survey"** (ticker, Sources dialog)                                                                                                                                                                                                                                                                  |
| How we use it           | Fetched directly by the visitor's browser (no server), at most once a minute, paused while the tab is hidden. Each event links to its USGS event page. We show magnitude, place, depth, time and the tsunami flag exactly as published; nothing is invented or editorialised.                                                |
| Last checked            | 2026-10-23: feed endpoints and the [feed docs](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php) re-read ("GeoJSON is intended to be used as a programatic interface for applications"; follows the USGS Earthquakes Feed Life Cycle Policy). CORS `*`, `max-age=60`. ⚠️ Copyright/credit page not yet re-read. |

## Wikipedia pulse — Wikimedia EventStreams (v1.1, live)

|                         |                                                                                                                                                                                                                                                                                   |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Endpoint                | `https://stream.wikimedia.org/v2/stream/recentchange` (Server-Sent Events, CORS `*`)                                                                                                                                                                                              |
| Docs                    | https://stream.wikimedia.org/?doc (OpenAPI spec: `?spec`)                                                                                                                                                                                                                         |
| Terms                   | Wikimedia Terms of Use (https://wikimediafoundation.org/wiki/Terms_of_Use), as linked from the stream's own spec                                                                                                                                                                  |
| License of content      | Wikipedia text: CC BY-SA. We show only article titles, edit sizes and counts, and link every title to its article.                                                                                                                                                                |
| Required / shown notice | **"Live edits: Wikimedia EventStreams · Wikipedia content CC BY-SA"** (ticker, Sources dialog)                                                                                                                                                                                    |
| Privacy                 | Usernames and IP addresses are never shown, stored or sent anywhere. Distinct editors are counted through a salted 32-bit hash that lives only in the visitor's tab. The committed test fixture holds only one-way hashes (random salt, discarded).                               |
| How we use it           | Each visitor's browser connects directly with `EventSource` (about 3 MB/min) and disconnects while the tab is hidden. Resuming after a drop uses `?since=`, capped to 30 s. Browsers can't set a User-Agent on EventSource; our Node scripts send a descriptive one.              |
| Last checked            | 2026-10-23: endpoint, spec, `since` / `Last-Event-ID` resume and CORS verified live. ⚠️ The wiki pages describing connection limits and the User-Agent policy (wikitech.wikimedia.org, meta.wikimedia.org) were unreachable from the dev environment; re-read them when possible. |

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
