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

  // Zoom thresholds: when the visible range shrinks to this size, the axis
  // switches to a finer tick scheme (per-day on x, per-degree on y).
  const X_DAY_SPAN = 75; // days
  // Vertical tick density by zoom: a <=15deg view gets 1deg marks; <=60deg gets
  // 5deg marks; otherwise Chart.js' automatic ticks. Labels show at a coarser
  // interval than the marks, leaving the in-between marks unlabeled.
  const Y_TICK_1_SPAN = 15; // degrees
  const Y_TICK_5_SPAN = 60; // degrees

  // Dark-theme chart colors (kept in sync with styles.css).
  const C = {
    high: "#f87171",
    avg: "#cbd5e1",
    low: "#60a5fa",
    band: "rgba(148, 163, 184, 0.16)",
    grid: "rgba(148, 163, 184, 0.12)",
    gridMinor: "rgba(148, 163, 184, 0.06)",
    axisLine: "rgba(148, 163, 184, 0.25)",
    tick: "#8b98a5",
    axisTitle: "#9aa7b4",
    tooltipBg: "#1b232c",
    tooltipBorder: "#2a3540",
    monthLine: "rgba(148, 163, 184, 0.18)",
    prefBg: "rgba(52, 211, 153, 0.16)",
    prefBorder: "rgba(52, 211, 153, 0.45)",
    prefLabel: "#34d399",
  };

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
    openMapBtn: el("open-map"),
    closeMapBtn: el("close-map"),
    mapOverlay: el("map-overlay"),
    resetZoomBtn: el("reset-zoom"),
    zoomBox: el("zoom-box"),
  };

  let unit = "F"; // "F" or "C"
  let chart = null;
  // Current crop from drag-to-zoom, or null for the full view.
  // { xmin, xmax } are day indices (1..365); { ymin, ymax } are in display units.
  let zoomState = null;

  // ----- Helpers -----
  const toC = (f) => (f - 32) * 5 / 9;
  const conv = (f) => (f == null ? null : unit === "C" ? toC(f) : f);
  const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10);

  function monthIndexOf(d) {
    for (let i = 0; i < 12; i++) {
      const next = i < 11 ? MONTH_STARTS[i + 1] : MONTH_END;
      if (d >= MONTH_STARTS[i] && d < next) return i;
    }
    return 11;
  }

  function dayOfMonth(d) {
    return d - MONTH_STARTS[monthIndexOf(d)] + 1;
  }

  function dayToLabel(d) {
    const m = monthIndexOf(d);
    return MONTH_NAMES[m] + " " + (d - MONTH_STARTS[m] + 1);
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

    const bandColor = C.band;
    const ds = [];

    // Band (drawn first / behind): low boundary then high filling down to it.
    ds.push(lineDataset("_bandLow", toPoints(lo), bandColor, {
      borderWidth: 0, fill: false, order: 5, hidden: !ui.band.checked,
    }));
    ds.push(lineDataset("_bandHigh", toPoints(hi), bandColor, {
      borderWidth: 0, backgroundColor: bandColor, fill: "-1", order: 5, hidden: !ui.band.checked,
    }));

    // Visible lines.
    ds.push(lineDataset("Daily low", toPoints(lo), C.low, { hidden: !ui.low.checked }));
    ds.push(lineDataset("Average", toPoints(avg), C.avg, { hidden: !ui.avg.checked }));
    ds.push(lineDataset("Daily high", toPoints(hi), C.high, { hidden: !ui.high.checked }));
    return ds;
  }

  function prefAnnotations() {
    const ann = {};
    // Month boundary separators.
    MONTH_STARTS.forEach((d, i) => {
      if (i === 0) return;
      ann["m" + i] = {
        type: "line", xMin: d, xMax: d,
        borderColor: C.monthLine, borderWidth: 1, borderDash: [4, 4],
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
          backgroundColor: C.prefBg,
          borderColor: C.prefBorder, borderWidth: 1,
          label: {
            display: true, content: "Preferable", position: { x: "start", y: "start" },
            color: C.prefLabel, backgroundColor: "rgba(0,0,0,0)",
            font: { size: 11, weight: "600" }, padding: 4,
          },
        };
      }
    }
    return ann;
  }

  // ----- Adaptive axis ticks (respond to the current zoom range) -----
  // x: month names when zoomed out, a tick per day when zoomed in.
  function xAfterBuildTicks(axis) {
    const min = axis.min, max = axis.max;
    if (max - min > X_DAY_SPAN) {
      axis.ticks = MONTH_MIDS.filter((v) => v >= min && v <= max).map((v) => ({ value: v }));
    } else {
      const start = Math.max(1, Math.ceil(min));
      const end = Math.min(365, Math.floor(max));
      const ticks = [];
      for (let d = start; d <= end; d++) ticks.push({ value: d });
      axis.ticks = ticks;
    }
  }

  function xTickLabel(value) {
    // `this` is the scale, so this.min/max reflect the live zoom range.
    if (this.max - this.min > X_DAY_SPAN) {
      const i = MONTH_MIDS.indexOf(value);
      return i >= 0 ? MONTH_NAMES[i] : "";
    }
    const dom = dayOfMonth(value);
    if (dom % 5 !== 0) return ""; // tick for every day, label only multiples of 5
    return dom === 5 ? MONTH_NAMES[monthIndexOf(value)] + " 5" : String(dom);
  }

  // y: finer tick marks as you zoom in (1deg or 5deg). Outside those ranges,
  // leave Chart.js' automatic ticks in place.
  function yAfterBuildTicks(axis) {
    const span = axis.max - axis.min;
    let step;
    if (span <= Y_TICK_1_SPAN) step = 1;
    else if (span <= Y_TICK_5_SPAN) step = 5;
    else return;
    const start = Math.ceil(axis.min / step) * step;
    const end = Math.floor(axis.max / step) * step;
    const ticks = [];
    for (let t = start; t <= end + 1e-9; t += step) ticks.push({ value: Math.round(t) });
    if (ticks.length) axis.ticks = ticks;
  }

  // The label / "major gridline" interval for a given visible span. null means
  // automatic ticks (treat them all as labeled/major).
  function yLabelStep(span) {
    if (span <= Y_TICK_1_SPAN) return 5; // 1deg marks, emphasise every 5deg
    if (span <= Y_TICK_5_SPAN) return 10; // 5deg marks, emphasise every 10deg
    return null;
  }

  // A value sits on a "major" (labeled, solid) gridline at the label interval;
  // in-between values are minor (barely-visible, widely-dashed).
  function yIsMajor(value, span) {
    const step = yLabelStep(span);
    return step == null || Math.round(value) % step === 0;
  }

  function yTickLabel(value) {
    const v = Math.round(value); // guard against float artifacts (e.g. 12.00000001)
    return yIsMajor(v, this.max - this.min) ? v + "°" : "";
  }

  // We draw the horizontal gridlines ourselves: Chart.js' grid dashing isn't
  // reliably scriptable per line, so its borderDash stayed solid. Major lines
  // (the labeled interval) are solid; the in-between minor lines are a faint,
  // widely-spaced dash.
  const yGridPlugin = {
    id: "yGrid",
    beforeDatasetsDraw(chart) {
      const y = chart.scales.y;
      if (!y || !y.ticks) return;
      const span = y.max - y.min;
      const area = chart.chartArea;
      const ctx = chart.ctx;
      ctx.save();
      ctx.lineWidth = 1;
      y.ticks.forEach((t) => {
        const py = y.getPixelForValue(t.value);
        if (py < area.top - 0.5 || py > area.bottom + 0.5) return;
        const major = yIsMajor(t.value, span);
        ctx.strokeStyle = major ? C.grid : C.gridMinor;
        ctx.setLineDash(major ? [] : [2, 16]);
        ctx.beginPath();
        ctx.moveTo(area.left, py);
        ctx.lineTo(area.right, py);
        ctx.stroke();
      });
      ctx.restore();
    },
  };

  function render() {
    const locId = ui.location.value;
    const yearKey = ui.year.value;
    const smoothing = parseInt(ui.smoothing.value, 10);
    const s = rawSeries(locId, yearKey);
    const datasets = buildDatasets(s, smoothing);

    // Show per-day tick marks only when zoomed in tight enough horizontally.
    const dayModeX = !!zoomState && zoomState.xmax - zoomState.xmin <= X_DAY_SPAN;

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
            type: "linear",
            min: zoomState ? zoomState.xmin : 1,
            max: zoomState ? zoomState.xmax : 365,
            // In day mode show a tick mark per day (no vertical lines across the
            // plot); otherwise keep the clean label-only axis.
            grid: {
              display: dayModeX,
              drawOnChartArea: false,
              drawTicks: dayModeX,
              tickLength: 5,
              tickColor: C.axisLine,
            },
            border: { color: C.axisLine },
            ticks: {
              color: C.tick, font: { size: 12 }, autoSkip: false, maxRotation: 0,
              callback: xTickLabel,
            },
            afterBuildTicks: xAfterBuildTicks,
          },
          y: {
            min: zoomState ? zoomState.ymin : undefined,
            max: zoomState ? zoomState.ymax : undefined,
            grid: {
              // Gridlines are drawn by yGridPlugin; keep only the tick marks.
              drawOnChartArea: false,
              drawTicks: true,
              tickColor: C.axisLine,
            },
            border: { display: false },
            ticks: { color: C.tick, font: { size: 12 }, callback: yTickLabel },
            title: { display: true, text: "Temperature (°" + unit + ")", color: C.axisTitle, font: { size: 12 } },
            afterBuildTicks: yAfterBuildTicks,
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: C.tooltipBg, borderColor: C.tooltipBorder, borderWidth: 1,
            titleColor: "#e6edf3", bodyColor: "#cbd5e1",
            padding: 10, cornerRadius: 8, titleFont: { size: 12 }, bodyFont: { size: 12 },
            filter: (item) => !item.dataset.label.startsWith("_"),
            callbacks: {
              title: (items) => (items.length ? dayToLabel(items[0].parsed.x) : ""),
              label: (item) => item.dataset.label + ": " + item.parsed.y + "°" + unit,
            },
          },
          annotation: { annotations: prefAnnotations() },
        },
      },
      plugins: [yGridPlugin],
    };

    if (chart) chart.destroy();
    chart = new Chart(ui.canvas.getContext("2d"), cfg);

    ui.resetZoomBtn.hidden = !zoomState;
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
    ui.location.addEventListener("change", () => selectLocation(ui.location.value));
    [ui.year, ui.smoothing].forEach((c) => c.addEventListener("change", render));
    [ui.high, ui.avg, ui.low, ui.band, ui.prefToggle].forEach((c) => c.addEventListener("change", render));
    // Live update while typing; enforce min <= max once the value is committed.
    [ui.prefMin, ui.prefMax].forEach((c) => c.addEventListener("input", render));
    ui.prefMin.addEventListener("change", () => { clampPref("min"); render(); });
    ui.prefMax.addEventListener("change", () => { clampPref("max"); render(); });
    updatePrefBounds();
    ui.unitF.addEventListener("click", () => setUnit("F"));
    ui.unitC.addEventListener("click", () => setUnit("C"));

    // Map picker
    ui.openMapBtn.addEventListener("click", openMap);
    ui.closeMapBtn.addEventListener("click", closeMap);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !ui.mapOverlay.hidden) closeMap();
    });

    setupZoom();
    render();
  }

  function selectLocation(slug) {
    if (!DATA[slug]) return;
    ui.location.value = slug;
    populateYears(slug);
    render();
  }

  // Keep the preferable-range boxes ordered: Min can't exceed Max and vice
  // versa. Clamps the box that was just edited to the other one.
  function clampPref(edited) {
    const lo = parseFloat(ui.prefMin.value);
    const hi = parseFloat(ui.prefMax.value);
    if (!isNaN(lo) && !isNaN(hi) && lo > hi) {
      if (edited === "max") ui.prefMax.value = String(lo);
      else ui.prefMin.value = String(hi);
    }
    updatePrefBounds();
  }

  // Mirror the order into the inputs' min/max attributes so the spinner arrows
  // and browser validation also respect it.
  function updatePrefBounds() {
    ui.prefMin.max = ui.prefMax.value;
    ui.prefMax.min = ui.prefMin.value;
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
    updatePrefBounds();

    unit = next;
    ui.unitF.classList.toggle("active", unit === "F");
    ui.unitC.classList.toggle("active", unit === "C");
    ui.unitF.setAttribute("aria-pressed", String(unit === "F"));
    ui.unitC.setAttribute("aria-pressed", String(unit === "C"));
    ui.prefUnit.innerHTML = "°" + unit;
    // The y-crop is stored in the old unit's degrees, so drop it on a switch.
    zoomState = null;
    render();
  }

  // ----- Drag-to-zoom -----
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  // Min/max y of the visible (toggled-on) series within an x-range, in display
  // units. Used to trim dead vertical space from a zoom selection.
  function dataYExtent(xmin, xmax) {
    let min = Infinity, max = -Infinity;
    chart.data.datasets.forEach((ds, i) => {
      if (!ds.label || ds.label.startsWith("_")) return; // skip the fill-band pair
      if (!chart.isDatasetVisible(i)) return;
      for (const pt of ds.data) {
        if (pt.x >= xmin && pt.x <= xmax && pt.y != null) {
          if (pt.y < min) min = pt.y;
          if (pt.y > max) max = pt.y;
        }
      }
    });
    return min <= max ? { min, max } : null;
  }

  function setupZoom() {
    const box = ui.zoomBox;
    let drag = null;

    // Cursor position clamped into the current plotting area, in canvas pixels.
    const localPoint = (e) => {
      const rect = ui.canvas.getBoundingClientRect();
      const a = chart.chartArea;
      return {
        x: clamp(e.clientX - rect.left, a.left, a.right),
        y: clamp(e.clientY - rect.top, a.top, a.bottom),
      };
    };

    // Horizontal-only selection: a full-height band over the chosen date
    // range. The vertical crop is derived from the data on release.
    const drawBox = (x) => {
      const a = chart.chartArea;
      box.style.left = Math.min(x, drag.x0) + "px";
      box.style.top = a.top + "px";
      box.style.width = Math.abs(x - drag.x0) + "px";
      box.style.height = a.bottom - a.top + "px";
    };

    const cancelDrag = () => {
      drag = null;
      box.hidden = true;
    };

    ui.canvas.addEventListener("pointerdown", (e) => {
      if (!chart || e.button !== 0) return; // primary button only
      const p = localPoint(e);
      drag = { x0: p.x };
      // Capture so we keep getting move/up even if the cursor leaves the canvas.
      try { ui.canvas.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
      e.preventDefault();
      box.hidden = false;
      drawBox(p.x);
    });

    ui.canvas.addEventListener("pointermove", (e) => {
      if (!drag) return;
      drawBox(localPoint(e).x);
    });

    ui.canvas.addEventListener("pointerup", (e) => {
      if (!drag || e.button !== 0) return;
      const x1 = localPoint(e).x;
      const d = drag;
      cancelDrag();
      // Ignore plain clicks: only the horizontal sweep matters.
      if (Math.abs(x1 - d.x0) < 6) return;

      const xs = chart.scales.x;
      const xa = xs.getValueForPixel(d.x0), xb = xs.getValueForPixel(x1);
      const xmin = Math.max(1, Math.min(xa, xb));
      const xmax = Math.min(365, Math.max(xa, xb));
      if (xmax - xmin < 1) return; // too narrow to be useful

      // Vertical crop is always derived from the high/low lines in the chosen
      // window, with a small pad, so the graph never ends up compressed.
      let ymin, ymax;
      const ext = dataYExtent(xmin, xmax);
      if (ext) {
        const pad = Math.max(1, (ext.max - ext.min) * 0.05);
        ymin = Math.floor(ext.min - pad); // integer bounds -> clean axis labels
        ymax = Math.ceil(ext.max + pad);
      }
      zoomState = { xmin, xmax, ymin, ymax };
      render();
    });

    ui.canvas.addEventListener("pointercancel", cancelDrag);

    // Right-click cancels an in-progress selection (and suppresses the menu).
    ui.canvas.addEventListener("contextmenu", (e) => {
      if (drag) { cancelDrag(); e.preventDefault(); }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && drag) cancelDrag();
    });

    ui.canvas.addEventListener("dblclick", resetZoom);
    ui.resetZoomBtn.addEventListener("click", resetZoom);
  }

  function resetZoom() {
    if (!zoomState) return;
    zoomState = null;
    render();
  }

  // ----- Full-screen map picker -----
  let map = null;

  // Web Mercator caps latitude near +/-85.0511, which makes the world square.
  const WORLD_BOUNDS = () => L.latLngBounds([[-85.0511, -180], [85.0511, 180]]);
  // Extra zoom on top of the world-fits-vertically floor; higher = tighter
  // (you can't zoom out as far).
  const MIN_ZOOM_MARGIN = 1.0;

  function applyMinZoom() {
    // Base = the zoom at which the world just fills the viewport height (the
    // limiting dimension on a landscape screen). The margin pulls the zoom-out
    // floor in a bit past that. Horizontal wrapping stays on, so you can still
    // scroll sideways forever.
    map.setMinZoom(map.getBoundsZoom(WORLD_BOUNDS()) + MIN_ZOOM_MARGIN);
  }

  function initMap() {
    map = L.map("map", {
      zoomControl: true,
      zoomSnap: 0, // let the world fit the height exactly, not just integer zooms
      worldCopyJump: true, // seamless infinite horizontal panning
      maxBoundsViscosity: 1.0, // hard wall at maxBounds (no drag past the edges)
    }).setView([30, 0], 2);

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: "abcd",
      maxZoom: 19,
    }).addTo(map);

    const pinIcon = L.divIcon({
      className: "map-pin",
      html: '<span class="dot"></span>',
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });

    const points = [];
    Object.keys(DATA).forEach((slug) => {
      const loc = DATA[slug];
      if (loc.lat == null || loc.lon == null) return;
      L.marker([loc.lat, loc.lon], { icon: pinIcon, keyboard: false })
        .addTo(map)
        .bindTooltip(loc.name, { className: "loc-tip", direction: "top", offset: [0, -10] })
        .on("click", () => { selectLocation(slug); closeMap(); });
      points.push([loc.lat, loc.lon]);
    });

    // Clamp vertical panning to the world's extent so you never see the blank
    // background past the poles. Longitude is left unbounded (+/-Infinity) so
    // the infinite horizontal wrapping still works.
    map.setMaxBounds(L.latLngBounds([-85.0511, -Infinity], [85.0511, Infinity]));

    map.invalidateSize();
    applyMinZoom();
    window.addEventListener("resize", applyMinZoom);
    if (points.length) map.fitBounds(points, { padding: [60, 60], maxZoom: 6 });
  }

  function openMap() {
    if (typeof L === "undefined") return; // Leaflet failed to load
    ui.mapOverlay.hidden = false;
    // The container only has a size once the overlay is shown.
    requestAnimationFrame(() => {
      if (!map) initMap();
      else { map.invalidateSize(); applyMinZoom(); }
    });
  }

  function closeMap() {
    ui.mapOverlay.hidden = true;
  }

  init();
})();
