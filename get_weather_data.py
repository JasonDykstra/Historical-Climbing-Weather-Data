"""Fetch a location's daily weather from Visual Crossing and add it to the site.

This is the curator tool: it fetches the data using YOUR API key (read from the
environment, never committed), writes the CSV, registers the location in
locations.json, and rebuilds docs/data.js so the site picks it up.

Set your key once per shell:
    export VISUALCROSSING_API_KEY="your_key_here"

Add a location (one command):
    python3 get_weather_data.py "Smith Rock, OR" smith_rock
    python3 get_weather_data.py "Brione Verzasca,Switzerland" brione_verzasca --name "Brione Verzasca, Switzerland"

Then commit the new CSV, locations.json, and docs/data.js.
"""

import argparse
import csv
import glob
import json
import os
import sys
from datetime import datetime

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
REGISTRY = os.path.join(HERE, "locations.json")

API_KEY = os.environ.get("VISUALCROSSING_API_KEY", "")


# ----- Unit Conversion Helpers -----
def c_to_f(celsius):
    """Convert Celsius to Fahrenheit."""
    return round((float(celsius) * 9 / 5) + 32, 2)


def mm_to_inches(mm):
    """Convert millimeters to inches."""
    return round(float(mm) / 25.4, 2)


# ----- API Fetch -----
def fetch_weather_for_year(year, location, api_key):
    start_date = f"{year}-01-01"
    end_date = f"{year}-12-31"
    url = (
        "https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/"
        f"{location}/{start_date}/{end_date}"
        f"?unitGroup=metric&key={api_key}&include=days"
    )

    print(f"  fetching {year}...")
    response = requests.get(url)
    if response.status_code != 200:
        print(f"Error fetching data for {year}: {response.status_code}")
        print(response.text)
        sys.exit(1)
    data = response.json()
    if "resolvedAddress" in data:
        print(f"    resolved to: {data['resolvedAddress']}")
    return data


def rows_for_year(year, location, api_key):
    data = fetch_weather_for_year(year, location, api_key)
    rows = []
    for day in data.get("days", []):
        rows.append({
            "date": day.get("datetime", ""),
            "tempmin_f": c_to_f(day["tempmin"]) if "tempmin" in day else "",
            "tempmax_f": c_to_f(day["tempmax"]) if "tempmax" in day else "",
            "tempavg_f": c_to_f(day["temp"]) if "temp" in day else "",
            "humidity_pct": day.get("humidity", ""),
            "precip_inches": mm_to_inches(day.get("precip", 0)),
            "precip_probability_pct": day.get("precipprob", 0),
            "snow_inches": mm_to_inches(day.get("snow", 0)),
            "conditions": day.get("conditions", ""),
        })
    return rows


FIELDNAMES = [
    "date", "tempmin_f", "tempmax_f", "tempavg_f", "humidity_pct",
    "precip_inches", "precip_probability_pct", "snow_inches", "conditions",
]


def update_registry(slug, name):
    registry = {}
    if os.path.exists(REGISTRY):
        with open(REGISTRY) as f:
            registry = json.load(f)
    registry[slug] = name
    with open(REGISTRY, "w") as f:
        json.dump(registry, f, indent=2)
        f.write("\n")


def main():
    parser = argparse.ArgumentParser(description="Fetch a location and add it to the site.")
    parser.add_argument("location", help='Visual Crossing query, e.g. "Red Rocks, NV"')
    parser.add_argument("slug", help="filename-safe id, e.g. red_rocks")
    parser.add_argument("--name", help="display name on the site (defaults to the location query)")
    parser.add_argument("--years", type=int, default=3, help="number of trailing full years to fetch (default 3)")
    parser.add_argument("--no-build", action="store_true", help="skip rebuilding docs/data.js")
    args = parser.parse_args()

    if not API_KEY:
        print("Error: set the VISUALCROSSING_API_KEY environment variable before running.")
        sys.exit(1)

    years = [datetime.now().year - n for n in range(1, args.years + 1)]
    years.sort()
    print(f"Fetching {args.location} for {years[0]}-{years[-1]}...")

    all_rows = []
    for year in years:
        all_rows.extend(rows_for_year(year, args.location, API_KEY))

    # One CSV per slug: clear any older year-range files for this slug first.
    for old in glob.glob(os.path.join(HERE, args.slug + "_weather*.csv")):
        os.remove(old)

    output = os.path.join(HERE, f"{args.slug}_weather_{years[0]}_{years[-1]}.csv")
    with open(output, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        writer.writeheader()
        writer.writerows(all_rows)
    print(f"Saved {output}")

    update_registry(args.slug, args.name or args.location)
    print(f"Registered '{args.slug}' in locations.json")

    if not args.no_build:
        import build_data
        build_data.main()


if __name__ == "__main__":
    main()
