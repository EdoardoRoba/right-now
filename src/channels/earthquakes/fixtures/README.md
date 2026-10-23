# Earthquake fixtures

| File | What it is |
|---|---|
| `synthetic-sample.geojson` | **Hand-written, not real data.** Follows the documented USGS GeoJSON summary format and covers edge cases (null magnitude, negative magnitude, rounding at M2.5, quarry blast, tsunami flag, missing place, missing/negative depth, non-USGS URL). Place names are deliberately fictional (`Testland`). Used by unit tests and the e2e smoke test. |
| `usgs-*.geojson` | Real recorded responses from the USGS feeds (public domain), created with `npm run record:fixtures`. Optional: if present, the unit tests also run every one of them through the parser. |

Real recordings could not be made in the environment where this project was bootstrapped (outbound access to `earthquake.usgs.gov` was blocked); run `npm run record:fixtures` on a machine with internet access and commit the result.
