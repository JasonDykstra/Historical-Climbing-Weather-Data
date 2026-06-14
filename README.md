# Historical Climbing Weather Data

An interactive website for exploring the daily temperature climate of climbing
destinations. Pick a location, toggle daily highs / lows / average and the
high–low range, set your own preferable temperature band, and see how many days
a year actually land in it.

**Live site:** https://jasondykstra.github.io/Historical-Climbing-Weather-Data/
*(available once GitHub Pages is enabled — see below)*

## How it works

```
*.csv                  Raw daily weather per location (from Visual Crossing)
locations.json         Registry: slug -> display name shown on the site
get_weather_data.py    Fetches a location, registers it, and rebuilds the data
build_data.py          Bundles the registered CSVs into docs/data.js
docs/                  The website (served by GitHub Pages)
  index.html
  styles.css
  app.js               Chart logic (Chart.js + annotation plugin via CDN)
  data.js              Auto-generated — do not edit by hand
```

The site is fully static: `build_data.py` flattens the CSVs into a single
`docs/data.js` file, so there is no backend and no build step in the browser.

## Run it locally

`data.js` is a plain script (not fetched), so you can just open
`docs/index.html` in a browser. To mirror production exactly, serve it:

```bash
cd docs
python3 -m http.server 8000
# open http://localhost:8000
```

## Add a new location

This site is owner-curated: you fetch a location once with your own API key and
commit the result. The key is only ever used locally and never deployed.

1. Set your Visual Crossing API key once per shell:

   ```bash
   export VISUALCROSSING_API_KEY="your_key_here"
   ```

2. Fetch + register + rebuild in one command (positional args are the Visual
   Crossing query and a filename-safe slug):

   ```bash
   python3 get_weather_data.py "Smith Rock, OR" smith_rock
   # optional: nicer display name, or a different number of years
   python3 get_weather_data.py "Brione Verzasca,Switzerland" brione_verzasca \
       --name "Brione Verzasca, Switzerland" --years 3
   ```

   This writes `smith_rock_weather_<years>.csv`, adds the location to
   `locations.json`, and regenerates `docs/data.js` automatically.

3. Commit the new CSV, `locations.json`, and `docs/data.js`, then push. The
   site updates after GitHub Pages redeploys.

> Heads-up on quota: Visual Crossing's free tier is ~1,000 records/day and one
> location-year is ~365 records, so fetching 3 years (~1,095 records) can use a
> full day's allowance. Fetch deliberately.

## Enable GitHub Pages

In the GitHub repo: **Settings → Pages → Build and deployment**

- **Source:** Deploy from a branch
- **Branch:** `main`, folder `/docs`
- Save. The site publishes at the URL above within a minute or two.

## Notes

- The Visual Crossing API key is read from the `VISUALCROSSING_API_KEY`
  environment variable and is intentionally **not** stored in the repo.
- Dates are aligned onto a fixed 365-day calendar so years line up; in leap
  years Feb 29 folds onto Feb 28.
