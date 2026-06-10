import csv
import os
import requests
import sys

# ----- Configuration -----
# Set your Visual Crossing API key in the environment before running:
#   export VISUALCROSSING_API_KEY="your_key_here"
API_KEY = os.environ.get("VISUALCROSSING_API_KEY", "")
if not API_KEY:
    print("Error: set the VISUALCROSSING_API_KEY environment variable before running.")
    sys.exit(1)
LOCATION = "Brione Verzasca,Switzerland"
CURRENT_YEAR = 2026
YEARS_TO_FETCH = [CURRENT_YEAR - 1, CURRENT_YEAR - 2, CURRENT_YEAR - 3]  # 2024, 2023, 2022
OUTPUT_FILENAME = "brione_verzasca_weather_2022_2024.csv"

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
        f"https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/"
        f"{location}/{start_date}/{end_date}"
        f"?unitGroup=metric&key={api_key}&include=days"
    )

    print(f"Fetching weather data for {year}...")
    response = requests.get(url)

    if response.status_code != 200:
        print(f"Error fetching data for {year}: {response.status_code}")
        print(response.text)
        sys.exit(1)

    return response.json()

# ----- Main -----
def main():
    all_rows = []

    for year in YEARS_TO_FETCH:
        data = fetch_weather_for_year(year, LOCATION, API_KEY)
        days = data.get("days", [])

        for day in days:
            # Temperatures
            tempmin_f = c_to_f(day["tempmin"]) if "tempmin" in day else ""
            tempmax_f = c_to_f(day["tempmax"]) if "tempmax" in day else ""
            tempavg_f = c_to_f(day["temp"]) if "temp" in day else ""

            # Precipitation
            precip_in = mm_to_inches(day.get("precip", 0))
            snow_in = mm_to_inches(day.get("snow", 0))

            row = {
                "date": day.get("datetime", ""),
                "tempmin_f": tempmin_f,
                "tempmax_f": tempmax_f,
                "tempavg_f": tempavg_f,
                "humidity_pct": day.get("humidity", ""),
                "precip_inches": precip_in,
                "precip_probability_pct": day.get("precipprob", 0),
                "snow_inches": snow_in,
                "conditions": day.get("conditions", "")
            }

            all_rows.append(row)

    # Write CSV
    with open(OUTPUT_FILENAME, "w", newline="") as csvfile:
        fieldnames = [
            "date",
            "tempmin_f",
            "tempmax_f",
            "tempavg_f",
            "humidity_pct",
            "precip_inches",
            "precip_probability_pct",
            "snow_inches",
            "conditions"
        ]

        writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(all_rows)

    print(f"Weather data saved to {OUTPUT_FILENAME}")

if __name__ == "__main__":
    main()
