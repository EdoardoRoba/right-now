# Earthquake fixtures

| File | What it is |
|---|---|
| `synthetic-sample.geojson` | **Hand-written, not real data.** Follows the documented USGS GeoJSON summary format and covers edge cases (null magnitude, negative magnitude, rounding at M2.5, quarry blast, tsunami flag, missing place, missing/negative depth, non-USGS URL). Place names are deliberately fictional (`Testland`). Used by unit tests and the e2e smoke test. |
| `usgs-*.geojson` | Real recorded responses from the USGS feeds (public domain), created with `npm run record:fixtures`. The unit tests run every one of them through the parser. |

To refresh, run `npm run record:fixtures` (behind a proxy, use `NODE_USE_ENV_PROXY=1`).
