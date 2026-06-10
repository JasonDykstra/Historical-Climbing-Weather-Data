/* Climbing Weather History - interactive chart
 * Data comes from data.js as window.WEATHER_DATA (built by build_data.py).
 */
(function () {
  "use strict";

  // Register the annotation plugin. Depending on the CDN build it may expose
  // itself under a couple of global names, or auto-register. Try each, and
  // skip silently if it's already registered.
  const alreadyRegistered = () => {
    try { return Chart.registry.plugins.get("annotation") != null; }
    catch (e) { return false; }
  };
  if (!alreadyRegistered()) {
    const candidate =
      window["chartjs-plugin-annotation"] || window.ChartAnnotation || window.annotationPlugin;
    if (candidate) {
      try { Chart.register(candidate.default || candidate); } catch (e) { /* noop */ }
    }
  }

  const DATA = (window.WEATHER_DATA && window.WEATHER_DATA.locations) || {};

  // Fixed 365-day calendar reference (non-leap). Index 1..365.
  const MONTH_STARTS = [1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335];
  const MONTH_END = 366;
  const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const MONTH_MIDS = MONTH_STARTS.map((s, i) => {
    const next = i < 11 ? MONTH_STARTS[i + 1] : MONTH_END;
    return Math.round((s + next) / 2);
  });

  // ----- DOM -----
  const el = (id) => document.getElementById(id);
  const ui = {
    location: el("location"),
    year: el("year"),
    yearHint: el("year-hint"),
    high: el("toggle-high"),
    avg: el("toggle-avg"),
    low: el("toggle-low"),
    band: el("toggle-band"),
    smoothing: el("smoothing"),
    unitF: el("unit-f"),
    unitC: el("unit-c"),
    prefMin: el("pref-min"),
    prefMax: el("pref-max"),
    prefUnit: el("pref-unit"),
    prefToggle: el("toggle-pref"),
    prefStat: el("pref-stat"),
    title: el("chart-title"),
    footnote: el("footnote"),
    canvas: el("chart"),
  };

  let unit = "F"; // "F" or "C"
  let chart = null;

  // ----- Helpers -----
  const toC = (f) => (f - 32) * 5 / 9;
  const conv = (f) => (f == null ? null : unit === "C" ? toC(f) : f);
  const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10);

  function dayToLabel(d) {
    let m = 0;
    for (let i = 0; i < 12; i++) {
      const next = i < 11 ? MONTH_STARTS[i + 1] : MONTH_END;
      if (d >= MONTH_STARTS[i] && d < next) { m = i; break; }
    }
    const day = d - MONTH_STARTS[m] + 1;
    return MONTH_NAMES[m] + " " + day;
  }

  // Build dense per-day arrays (index 1..365) for a location + year selection.
  // Returns { hi:[366], lo:[366], avg:[366] } in degrees F, nulls where missing.
  function rawSeries(locId, yearKey) {
    const loc = DATA[locId];
    const hi = new Array(366).fill(null);
    const lo = new Array(366).fill(null);
    const avg = new Array(366).fill(null);

    if (yearKey === "all") {
      const sum = { hi: new Array(366).fill(0), lo: new Array(366).fill(0), avg: new Array(366).fill(0), n: new Array(366).fill(0) };
      loc.years.forEach((y) => {
        (loc.data[String(y)] || []).forEach((r) => {
          sum.hi[r.d] += r.hi; sum.lo[r.d] += r.lo; sum.avg[r.d] += r.avg; sum.n[r.d] += 1;
        });
      });
      for (let d = 1; d <= 365; d++) {
        if (sum.n[d] > 0) {
          hi[d] = sum.hi[d] / sum.n[d];
          lo[d] = sum.lo[d] / sum.n[d];
          avg[d] = sum.avg[d] / sum.n[d];
        }
      }
    } else {
      (loc.data[yearKey] || []).forEach((r) => { hi[r.d] = r.hi; lo[r.d] = r.lo; avg[r.d] = r.avg; });
    }
    return { hi, lo, avg };
  }

  // Centered circular rolling mean over a window (calendar wraps Dec->Jan).
  function smooth(arr, window) {
    if (window <= 1) return arr.slice();
    const valid = []; // collect day indices with data
    for (let d = 1; d <= 365; d++) if (arr[d] != null) valid.push(d);
    if (valid.length === 0) return arr.slice();

    const out = new Array(366).fill(null);
    const half = Math.floor(window / 2);
    for (let d = 1; d <= 365; d++) {
      if (arr[d] == null) continue;
      let s = 0, c = 0;
      for (let k = -half; k <= half; k++) {
        let idx = d + k;
        if (idx < 1) idx += 365;
        if (idx > 365) idx -= 365;
        if (arr[idx] != null) { s += arr[idx]; c += 1; }
      }
      out[d] = c ? s / c : arr[d];
    }
    return out;
  }

  function toPoints(arr) {
    const pts = [];
    for (let d = 1; d <= 365; d++) if (arr[d] != null) pts.push({ x: d, y: round1(conv(arr[d])) });
    return pts;
  }

  function lineDataset(label, points, color, opts) {
    return Object.assign({
      label,
      data: points,
      borderColor: color,
      backgroundColor: color,
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 4,
      tension: 0.35,
      spanGaps: true,
      order: 1,
    }, opts || {});
  }

  // ----- Chart build / update -----
  function buildDatasets(s, smoothing) {
    const hi = smooth(s.hi, smoothing);
    const lo = smooth(s.lo, smoothing);
    const avg = smooth(s.avg, smoothing);

    const bandColor = "rgba(99, 102, 110, 0.12)";
    const ds = [];

    // Band (drawn first / behind): low boundary then high filling down to it.
    ds.push(lineDataset("_bandLow", toPoints(lo), bandColor, {
      borderWidth: 0, fill: false, order: 5, hidden: !ui.band.checked,
    }));
    ds.push(lineDataset("_bandHigh", toPoints(hi), bandColor, {
      borderWidth: 0, backgroundColor: bandColor, fill: "-1", order: 5, hidden: !ui.band.checked,
    }));

    // Visible lines.
    ds.push(lineDataset("Daily low", toPoints(lo), "#3b82f6", { hidden: !ui.low.checked }));
    ds.push(lineDataset("Average", toPoints(avg), "#6b7280", { hidden: !ui.avg.checked }));
    ds.push(lineDataset("Daily high", toPoints(hi), "#ef6c47", { hidden: !ui.high.checked }));
    return ds;
  }

  function prefAnnotations() {
    const ann = {};
    // Month boundary separators.
    MONTH_STARTS.forEach((d, i) => {
      if (i === 0) return;
      ann["m" + i] = {
        type: "line", xMin: d, xMax: d,
        borderColor: "rgba(150,160,170,0.35)", borderWidth: 1, borderDash: [4, 4],
      };
    });
    // Preferable temperature band.
    if (ui.prefToggle.checked) {
      const lo = parseFloat(ui.prefMin.value);
      const hi = parseFloat(ui.prefMax.value);
      if (!isNaN(lo) && !isNaN(hi)) {
        ann.pref = {
          type: "box",
          yMin: Math.min(lo, hi), yMax: Math.max(lo, hi),
          backgroundColor: "rgba(34, 197, 94, 0.13)",
          borderColor: "rgba(34, 197, 94, 0.35)", borderWidth: 1,
          label: {
            display: true, content: "Preferable", position: { x: "start", y: "start" },
            color: "#15803d", backgroundColor: "rgba(255,255,255,0)",
            font: { size: 11, weight: "600" }, padding: 4,
          },
        };
      }
    }
    return ann;
  }

  function render() {
    const locId = ui.location.value;
    const yearKey = ui.year.value;
    const smoothing = parseInt(ui.smoothing.value, 10);
    const s = rawSeries(locId, yearKey);
    const datasets = buildDatasets(s, smoothing);

    const cfg = {
      type: "line",
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 250 },
        interaction: { mode: "index", intersect: false },
        scales: {
          x: {
            type: "linear", min: 1, max: 365,
            grid: { display: false, drawTicks: false },
            border: { color: "#e4e7eb" },
            ticks: {
              color: "#9aa5b1", font: { size: 12 }, autoSkip: false, maxRotation: 0,
              callback: (v) => {
                const i = MONTH_MIDS.indexOf(v);
                return i >= 0 ? MONTH_NAMES[i] : "";
              },
            },
            afterBuildTicks: (axis) => { axis.ticks = MONTH_MIDS.map((v) => ({ value: v })); },
          },
          y: {
            grid: { color: "#eef1f4" },
            border: { display: false },
            ticks: { color: "#9aa5b1", font: { size: 12 }, callback: (v) => v + "°" },
            title: { display: true, text: "Temperature (°" + unit + ")", color: "#52606d", font: { size: 12 } },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "#1f2933", padding: 10, cornerRadius: 8, titleFont: { size: 12 }, bodyFont: { size: 12 },
            filter: (item) => !item.dataset.label.startsWith("_"),
            callbacks: {
              title: (items) => (items.length ? dayToLabel(items[0].parsed.x) : ""),
              label: (item) => item.dataset.label + ": " + item.parsed.y + "°" + unit,
            },
          },
          annotation: { annotations: prefAnnotations() },
        },
      },
    };

    if (chart) chart.destroy();
    chart = new Chart(ui.canvas.getContext("2d"), cfg);

    updateTexts(locId, yearKey, s);
  }

  function updateTexts(locId, yearKey, s) {
    const name = DATA[locId].name;
    const yearsLabel = yearKey === "all" ? "average " + DATA[locId].years[0] + "–" + DATA[locId].years[DATA[locId].years.length - 1] : yearKey;
    ui.title.textContent = name;
    ui.footnote.textContent = yearKey === "all"
      ? "Showing the daily average across " + DATA[locId].years.length + " years (" + DATA[locId].years.join(", ") + ")."
      : "Showing daily values for " + yearKey + ".";

    // Days-in-range stat: count days where the daily high falls in the band
    // (uses raw, unsmoothed data so smoothing doesn't change the number).
    const lo = parseFloat(ui.prefMin.value);
    const hi = parseFloat(ui.prefMax.value);
    if (!isNaN(lo) && !isNaN(hi) && ui.prefToggle.checked) {
      const lonum = Math.min(lo, hi), hinum = Math.max(lo, hi);
      let count = 0, total = 0;
      for (let d = 1; d <= 365; d++) {
        if (s.hi[d] == null) continue;
        total += 1;
        const v = conv(s.hi[d]);
        if (v >= lonum && v <= hinum) count += 1;
      }
      const days = total ? Math.round((count / total) * 365) : 0;
      ui.prefStat.innerHTML = "&approx; <b>" + days + " days/yr</b> with daily highs between " + lonum + "° and " + hinum + "°" + unit + ".";
      ui.prefStat.style.display = "";
    } else {
      ui.prefStat.style.display = "none";
    }
  }

  // ----- Populate controls -----
  function init() {
    const ids = Object.keys(DATA);
    if (ids.length === 0) {
      ui.title.textContent = "No data found";
      ui.footnote.textContent = "Run build_data.py to generate docs/data.js.";
      return;
    }

    ids.forEach((id) => {
      const o = document.createElement("option");
      o.value = id; o.textContent = DATA[id].name;
      ui.location.appendChild(o);
    });

    populateYears(ids[0]);

    // Events
    ui.location.addEventListener("change", () => { populateYears(ui.location.value); render(); });
    [ui.year, ui.smoothing].forEach((c) => c.addEventListener("change", render));
    [ui.high, ui.avg, ui.low, ui.band, ui.prefToggle].forEach((c) => c.addEventListener("change", render));
    [ui.prefMin, ui.prefMax].forEach((c) => c.addEventListener("input", render));
    ui.unitF.addEventListener("click", () => setUnit("F"));
    ui.unitC.addEventListener("click", () => setUnit("C"));

    render();
  }

  function populateYears(locId) {
    const loc = DATA[locId];
    ui.year.innerHTML = "";
    const all = document.createElement("option");
    all.value = "all"; all.textContent = "All years (average)";
    ui.year.appendChild(all);
    loc.years.forEach((y) => {
      const o = document.createElement("option");
      o.value = String(y); o.textContent = String(y);
      ui.year.appendChild(o);
    });
    ui.year.value = "all";
    ui.yearHint.textContent = "Data available: " + loc.years.join(", ");
  }

  function setUnit(next) {
    if (next === unit) return;
    // Convert the preferable-temperature inputs so they keep the same real value.
    const convertField = (input) => {
      const v = parseFloat(input.value);
      if (isNaN(v)) return;
      input.value = Math.round(next === "C" ? toC(v) : (v * 9 / 5) + 32);
    };
    convertField(ui.prefMin);
    convertField(ui.prefMax);

    unit = next;
    ui.unitF.classList.toggle("active", unit === "F");
    ui.unitC.classList.toggle("active", unit === "C");
    ui.unitF.setAttribute("aria-pressed", String(unit === "F"));
    ui.unitC.setAttribute("aria-pressed", String(unit === "C"));
    ui.prefUnit.innerHTML = "°" + unit;
    render();
  }

  init();
})();
