import os
import csv
import matplotlib.pyplot as plt
from datetime import datetime
from collections import defaultdict
import calendar

CSV_FILENAME = "brione_verzasca_weather_2022_2024.csv"

# Holds daily temp data per year: list of (day_of_year, tempmin, tempmax, tempavg)
data_by_year = defaultdict(list)

# Holds monthly totals per year:
# monthly_totals[year][month] = {"rain": float, "snow": float}
monthly_totals = defaultdict(lambda: defaultdict(lambda: {"rain": 0.0, "snow": 0.0}))

def to_float(value, default=None):
    """Safely convert value to float."""
    try:
        if value is None or value == "":
            return default
        return float(value)
    except (ValueError, TypeError):
        return default

def get_first_float(row, keys, default=0.0):
    """Return the first valid float from row for the provided keys."""
    for k in keys:
        if k in row:
            v = to_float(row.get(k), default=None)
            if v is not None:
                return v
    return default

if os.path.exists(CSV_FILENAME):
    with open(CSV_FILENAME, newline="") as csvfile:
        reader = csv.DictReader(csvfile)
        for row in reader:
            date_str = row.get("date", "")
            try:
                dt = datetime.strptime(date_str, "%Y-%m-%d")
            except ValueError:
                continue

            day_of_year = dt.timetuple().tm_yday

            # --- Temps (support both your old column names and the new ones) ---
            tmin = get_first_float(row, ["tempmin", "tempmin_f"], default=None)
            tmax = get_first_float(row, ["tempmax", "tempmax_f"], default=None)
            tavg = get_first_float(row, ["tempavg", "tempavg_f"], default=None)

            if tmin is None or tmax is None or tavg is None:
                continue

            data_by_year[dt.year].append((day_of_year, tmin, tmax, tavg))

            # --- Precip/Snow (support inches or mm variants) ---
            # If your CSV is in inches: precip_inches, snow_inches
            # If your CSV is in mm: precip_mm, snow_mm (we'll treat them as-is; ideally use inches consistently)
            rain = get_first_float(row, ["precip_inches", "precip_in", "precip_mm", "precip"], default=0.0)
            snow = get_first_float(row, ["snow_inches", "snow_in", "snow_mm", "snow"], default=0.0)

            monthly_totals[dt.year][dt.month]["rain"] += rain
            monthly_totals[dt.year][dt.month]["snow"] += snow
else:
    print(f"CSV file '{CSV_FILENAME}' not found!")
    raise SystemExit(1)

# Sort daily data for each year by day-of-year
for year in data_by_year:
    data_by_year[year].sort(key=lambda x: x[0])

# Colors for each year (edit as you like)
colors = {2024: "red", 2023: "orange", 2022: "yellow"}

# ----- Build month boundaries and label positions -----
# Use a non-leap year as the day-of-year reference
_REF_YEAR = 2023

# First day-of-year for each month, plus a sentinel for Dec 31 + 1
month_starts = [datetime(_REF_YEAR, m, 1).timetuple().tm_yday for m in range(1, 13)]
month_starts.append(366)  # one past Dec 31

# Tick labels sit at the midpoint of each month
month_positions = [(month_starts[i] + month_starts[i + 1]) / 2 for i in range(12)]
month_labels = [calendar.month_abbr[m] for m in range(1, 13)]

# Bar dimensions aligned to true month edges
month_widths = [month_starts[i + 1] - month_starts[i] for i in range(12)]

# ----- Compute average monthly rain/snow across all years in your CSV -----
years_present = sorted(monthly_totals.keys())
avg_rain_by_month = []
avg_snow_by_month = []

for month in range(1, 13):
    rains = []
    snows = []
    for y in years_present:
        rains.append(monthly_totals[y][month]["rain"])
        snows.append(monthly_totals[y][month]["snow"])

    avg_rain_by_month.append(sum(rains) / len(rains) if rains else 0.0)
    avg_snow_by_month.append(sum(snows) / len(snows) if snows else 0.0)

# ----- Plot: temps on top, precip bars on bottom -----
fig, (ax_temp, ax_precip) = plt.subplots(
    2, 1,
    figsize=(15, 8),
    sharex=True,
    gridspec_kw={"height_ratios": [3, 1]}
)

# Top: temperature plot
ax_temp.axhspan(45, 65, color="blue", alpha=0.1, zorder=0)

for year in sorted(data_by_year.keys(), reverse=True):
    days, tempmins, tempmaxs, tempavgs = zip(*data_by_year[year])
    line_color = colors.get(year, "black")
    ax_temp.plot(days, tempavgs, label=f"{year} Avg", color=line_color, linewidth=2)
    ax_temp.fill_between(days, tempmins, tempmaxs, color=line_color, alpha=0.1)

ax_temp.set_ylabel("Temperature (°F)")
ax_temp.set_title("Daily Temperatures for Vegas, NV (2022-2024)", pad=20)
ax_temp.legend()
ax_temp.grid(True)
ax_temp.set_xlim(1, 366)

# Vertical lines at month boundaries
for boundary in month_starts[1:-1]:
    ax_temp.axvline(x=boundary, color="gray", linewidth=0.8, linestyle="--", alpha=0.5)

# Bottom: precipitation bars (monthly averages)
# Plot snow first (behind), then rain in front
ax_precip.bar(
    month_starts[:12],
    avg_snow_by_month,
    width=month_widths,
    color="lightgrey",
    label="Snow (monthly avg)",
    align="edge"
)

ax_precip.bar(
    month_starts[:12],
    avg_rain_by_month,
    width=month_widths,
    color="tab:blue",
    label="Rain (monthly avg)",
    align="edge"
)

ax_precip.set_ylabel("Precip (in)")
ax_precip.grid(True, axis="y", alpha=0.3)
ax_precip.legend(ncol=2)

# Vertical lines at month boundaries
for boundary in month_starts[1:-1]:
    ax_precip.axvline(x=boundary, color="gray", linewidth=0.8, linestyle="--", alpha=0.5)

# X-axis: ticks at true month midpoints so labels sit centered in each month
ax_precip.set_xticks(month_positions)
ax_precip.set_xticklabels(month_labels)
ax_precip.set_xlabel("Month")

plt.tight_layout()
plt.show()
