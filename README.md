# Genealogy Mapper

Plot your family-tree research on a shared map and timeline to find where different lines of ancestry might have crossed paths.

Upload a GEDCOM (or CSV / pasted rows), and the app builds the tree, geocodes every place, and flags times and places where people from different family trees could have been together.

Everything runs in the browser - no build step, no framework. Trees are saved in local storage unless you configure the optional cloud save.

## Run it locally

```bash
npx serve -l 8842 .
```

Then open <http://localhost:8842/genealogy-mapper/> (keep the trailing slash).

## Built with

Vanilla JS (ES modules), [Leaflet](https://leafletjs.com) + OpenStreetMap for the map, [D3](https://d3js.org) for the fan chart, [family-chart](https://github.com/donatso/family-chart) for the cards view, and OpenStreetMap's Nominatim for geocoding (throttled to about 1 request/second).

## Optional: cloud save

Copy `supabase/config.example.js` to `supabase/config.js` (git-ignored), fill in your own Supabase project, and run both SQL files in `supabase/`. Without it the app falls back to local-only saving.

## Sample data

The "guided walkthrough" loads four bundled GEDCOM-derived family trees from `genealogy-mapper/js/sync/`. Their places are pre-geocoded in `samplePlaceCache.js`; regenerate with `node genealogy-mapper/scripts/geocode-sample-places.mjs` after changing the data.
