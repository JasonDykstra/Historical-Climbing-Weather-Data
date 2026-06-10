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
get_weather_data.py    Fetches a location's CSV from the Visual Crossing API
build_data.py          Bundles all CSVs into docs/data.js
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

1. Fetch the data. Set your Visual Crossing API key once, then point
   `get_weather_data.py` at the location (edit `LOCATION` / `OUTPUT_FILENAME`):

   ```bash
   export VISUALCROSSING_API_KEY="your_key_here"
   python3 get_weather_data.py
   ```

2. Register the new CSV in the `LOCATIONS` list in `build_data.py` with a
   display name.

3. Rebuild the site data:

   ```bash
   python3 build_data.py
   ```

4. Commit the new CSV and the regenerated `docs/data.js`.

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
