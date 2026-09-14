/**
 * HoneyChain Yield ML Microservice - Museum-Grade Controller
 * Clean, uncluttered event loop with Channel Picker and Reticle Oscilloscope
 */

let sampleData = {};
let presetKeysOrder = [];
let currentPresetKey = "early_strong_flow";
let currentInputMode = "telemetry";
let currentPointsData = [];

document.addEventListener("DOMContentLoaded", () => {
  initVisualMode();
  initTheme();
  initUtcClock();
  checkHealth();
  fetchSampleData();

  const textarea = document.getElementById("telemetry-json");
  if (textarea) {
    textarea.addEventListener("input", updateRecordCount);
  }

  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      const form = document.getElementById("predict-form");
      if (form) {
        handlePredict(new Event("submit", { cancelable: true }));
      }
    }
  });

  setupChartHover();
});

// Live UTC Clock
function initUtcClock() {
  const clockEl = document.getElementById("utc-clock");
  if (!clockEl) return;
  function update() {
    const now = new Date();
    const h = String(now.getUTCHours()).padStart(2, "0");
    const m = String(now.getUTCMinutes()).padStart(2, "0");
    const s = String(now.getUTCSeconds()).padStart(2, "0");
    clockEl.textContent = `${h}:${m}:${s} UTC`;
  }
  update();
  setInterval(update, 1000);
}

// Visual Mode (Dark / Light)
function initVisualMode() {
  const savedMode = localStorage.getItem("honeychain_mode") || "dark";
  setColorMode(savedMode, false);
}

function initTheme() {
  const savedTheme = localStorage.getItem("honeychain_theme") || "amber";
  changeTheme(savedTheme, false);
}

function setColorMode(mode, save = true) {
  document.documentElement.setAttribute("data-mode", mode);
  if (save) localStorage.setItem("honeychain_mode", mode);

  const sunIcon = document.getElementById("mode-icon-sun");
  const moonIcon = document.getElementById("mode-icon-moon");
  if (mode === "dark") {
    if (sunIcon) sunIcon.style.display = "block";
    if (moonIcon) moonIcon.style.display = "none";
  } else {
    if (sunIcon) sunIcon.style.display = "none";
    if (moonIcon) moonIcon.style.display = "block";
  }

  if (currentPresetKey && sampleData[currentPresetKey]) {
    renderTrendSparkline(sampleData[currentPresetKey].history);
  }
}

function toggleColorMode() {
  const current = document.documentElement.getAttribute("data-mode") || "dark";
  const next = current === "dark" ? "light" : "dark";
  setColorMode(next, true);
  showToast(`Switched to ${next === "dark" ? "Titanium Obsidian" : "Museum Alabaster"} mode`);
}

function changeTheme(themeName, save = true) {
  document.documentElement.setAttribute("data-theme", themeName);
  if (save) localStorage.setItem("honeychain_theme", themeName);

  document.querySelectorAll(".theme-pill-btn").forEach(btn => {
    if (btn.getAttribute("data-theme-val") === themeName) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });

  if (currentPresetKey && sampleData[currentPresetKey]) {
    renderTrendSparkline(sampleData[currentPresetKey].history);
  }
}

// Health & Data
async function checkHealth() {
  const badge = document.getElementById("health-badge");
  const text = document.getElementById("health-text");
  try {
    const res = await fetch("/health");
    const data = await res.json();
    if (data.status === "healthy" && data.model_loaded) {
      text.textContent = `Online • ${data.model_version}`;
      badge.className = "header-badge healthy";
    } else {
      text.textContent = `Degraded • Model Unloaded`;
      badge.className = "header-badge error";
    }
  } catch (err) {
    text.textContent = "Service Offline";
    badge.className = "header-badge error";
  }
}

async function fetchSampleData() {
  try {
    const res = await fetch("/api/sample-data");
    sampleData = await res.json();
    presetKeysOrder = Object.keys(sampleData);
    populatePresetDropdown();
    loadPreset("early_strong_flow");
  } catch (err) {
    console.error("Failed to load sample scenarios:", err);
  }
}

function populatePresetDropdown() {
  const select = document.getElementById("preset-select");
  if (!select || !sampleData) return;

  select.innerHTML = "";

  const categories = {
    "flow_phases": "Bank A • Flow Dynamics",
    "environmental": "Bank B • Climate Stress",
    "edge_cases": "Bank C • Diagnostic Guards"
  };

  Object.entries(categories).forEach(([catKey, catLabel]) => {
    const group = document.createElement("optgroup");
    group.label = catLabel;

    Object.entries(sampleData).forEach(([key, item]) => {
      if (item.category === catKey) {
        const opt = document.createElement("option");
        opt.value = key;
        opt.textContent = `${item.badge || "Channel"}: ${item.name}`;
        group.appendChild(opt);
      }
    });

    select.appendChild(group);
  });
}

function onPresetSelectChange(key) {
  loadPreset(key);
}

function cyclePreset(direction) {
  if (!presetKeysOrder || presetKeysOrder.length === 0) return;
  const currIdx = presetKeysOrder.indexOf(currentPresetKey);
  let nextIdx = currIdx + direction;
  if (nextIdx < 0) nextIdx = presetKeysOrder.length - 1;
  if (nextIdx >= presetKeysOrder.length) nextIdx = 0;
  loadPreset(presetKeysOrder[nextIdx]);
}

function loadPreset(key) {
  if (!sampleData || !sampleData[key]) return;
  currentPresetKey = key;
  const scenario = sampleData[key];

  const select = document.getElementById("preset-select");
  if (select) select.value = key;

  document.getElementById("hive-id").value = scenario.hiveId || "HIVE-KV-201";
  document.getElementById("days-into-flow").value = scenario.days_into_flow;
  document.getElementById("margin").value = 5;

  const jsonStr = JSON.stringify(scenario.history, null, 2);
  document.getElementById("telemetry-json").value = jsonStr;
  updateRecordCount();

  // Update summary strip
  const descEl = document.getElementById("preset-description");
  if (descEl) descEl.textContent = scenario.description;

  const chipsEl = document.getElementById("preset-meta-chips");
  if (chipsEl) {
    const history = scenario.history || [];
    let chips = `<span class="chip-mini">${history.length}d records</span>`;
    chips += `<span class="chip-mini">Day ${scenario.days_into_flow} flow</span>`;
    if (history.length >= 2) {
      const startW = history[0].weight;
      const endW = history[history.length - 1].weight;
      if (startW != null && endW != null) {
        const delta = (endW - startW).toFixed(1);
        const sign = delta >= 0 ? "+" : "";
        chips += `<span class="chip-mini">${sign}${delta}kg net</span>`;
      }
    }
    chipsEl.innerHTML = chips;
  }

  renderTrendSparkline(scenario.history);
}

function resetToCurrentPreset() {
  if (currentPresetKey && sampleData[currentPresetKey]) {
    loadPreset(currentPresetKey);
    showToast("Reset to channel default values");
  }
}

// Oscilloscope Reticle
function renderTrendSparkline(history) {
  const visualizerCard = document.getElementById("trend-visualizer-card");
  const container = document.getElementById("trend-chart-container");
  const deltaSummary = document.getElementById("trend-delta-summary");

  if (!history || history.length < 2) {
    visualizerCard.style.display = "none";
    currentPointsData = [];
    return;
  }

  const validPoints = history
    .map((d, idx) => ({ idx, weight: d.weight, temp: d.temperature, date: d.timestamp }))
    .filter(d => d.weight !== null && !isNaN(d.weight));

  if (validPoints.length < 2) {
    visualizerCard.style.display = "none";
    currentPointsData = [];
    return;
  }

  visualizerCard.style.display = "block";

  const weights = validPoints.map(p => p.weight);
  const minW = Math.min(...weights);
  const maxW = Math.max(...weights);
  const rangeW = maxW - minW || 1.0;

  const startW = weights[0];
  const endW = weights[weights.length - 1];
  const netDelta = (endW - startW).toFixed(2);
  const netSign = netDelta >= 0 ? "+" : "";
  deltaSummary.textContent = `${startW.toFixed(1)}kg → ${endW.toFixed(1)}kg (${netSign}${netDelta}kg net)`;

  const width = 520;
  const height = 85;
  const padTop = 12;
  const padBottom = 16;
  const plotH = height - padTop - padBottom;

  const points = validPoints.map((p, i) => {
    const x = (i / (validPoints.length - 1)) * (width - 40) + 20;
    const y = padTop + plotH - ((p.weight - minW) / rangeW) * plotH;
    return { x, y, weight: p.weight, day: i + 1, date: p.date, temp: p.temp };
  });

  currentPointsData = points;

  let pathD = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    pathD += ` L ${points[i].x} ${points[i].y}`;
  }

  const areaD = `${pathD} L ${points[points.length - 1].x} ${height - 2} L ${points[0].x} ${height - 2} Z`;

  const rootStyles = getComputedStyle(document.documentElement);
  const chartTrace = rootStyles.getPropertyValue("--chart-trace").trim() || "#f3ba63";
  const chartGlow = rootStyles.getPropertyValue("--chart-glow").trim() || "rgba(243, 186, 99, 0.4)";
  const chartAreaTop = rootStyles.getPropertyValue("--chart-area-top").trim() || "rgba(243, 186, 99, 0.2)";
  const chartAreaBottom = rootStyles.getPropertyValue("--chart-area-bottom").trim() || "rgba(243, 186, 99, 0.0)";
  const chartReticle = rootStyles.getPropertyValue("--chart-reticle").trim() || "rgba(255, 255, 255, 0.05)";
  const chartLabel = rootStyles.getPropertyValue("--chart-label").trim() || "#646a7c";

  const yMid = padTop + plotH / 2;
  const midW = (minW + rangeW / 2).toFixed(1);

  const svgHtml = `
    <svg viewBox="0 0 ${width} ${height}" class="sparkline-svg" preserveAspectRatio="none" id="oscilloscope-svg">
      <defs>
        <linearGradient id="sparkline-grad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="${chartAreaTop}"/>
          <stop offset="100%" stop-color="${chartAreaBottom}"/>
        </linearGradient>
      </defs>

      <line x1="20" y1="${padTop}" x2="${width - 20}" y2="${padTop}" stroke="${chartReticle}" stroke-dasharray="2,3" stroke-width="1"/>
      <text x="22" y="${padTop + 8}" fill="${chartLabel}" font-size="7.5" font-family="JetBrains Mono">${maxW.toFixed(1)}kg</text>

      <line x1="20" y1="${yMid}" x2="${width - 20}" y2="${yMid}" stroke="${chartReticle}" stroke-dasharray="2,3" stroke-width="1"/>
      <text x="22" y="${yMid + 8}" fill="${chartLabel}" font-size="7.5" font-family="JetBrains Mono">${midW}kg</text>

      <line x1="20" y1="${padTop + plotH}" x2="${width - 20}" y2="${padTop + plotH}" stroke="${chartReticle}" stroke-dasharray="2,3" stroke-width="1"/>
      <text x="22" y="${padTop + plotH - 3}" fill="${chartLabel}" font-size="7.5" font-family="JetBrains Mono">${minW.toFixed(1)}kg</text>

      <path d="${areaD}" fill="url(#sparkline-grad)"/>
      <path d="${pathD}" fill="none" stroke="${chartTrace}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>

      <circle cx="${points[0].x}" cy="${points[0].y}" r="2.5" fill="${chartTrace}"/>
      <circle cx="${points[points.length - 1].x}" cy="${points[points.length - 1].y}" r="3.5" fill="${chartTrace}" stroke="#ffffff" stroke-width="1"/>

      <line id="ch-line" x1="0" y1="${padTop}" x2="0" y2="${padTop + plotH}" stroke="${chartTrace}" stroke-width="1" stroke-dasharray="2,2" opacity="0"/>
      <circle id="ch-dot" cx="0" cy="0" r="3.5" fill="${chartTrace}" stroke="#ffffff" stroke-width="1.5" opacity="0"/>
    </svg>
  `;

  container.innerHTML = svgHtml;
}

function setupChartHover() {
  const container = document.getElementById("trend-chart-container");
  const tooltip = document.getElementById("chart-tooltip");
  if (!container || !tooltip) return;

  container.addEventListener("mousemove", (e) => {
    if (!currentPointsData || currentPointsData.length === 0) return;

    const rect = container.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const relX = mouseX / rect.width;

    const width = 520;
    const targetSvgX = relX * width;

    let closest = currentPointsData[0];
    let minDist = Math.abs(closest.x - targetSvgX);

    for (let i = 1; i < currentPointsData.length; i++) {
      const dist = Math.abs(currentPointsData[i].x - targetSvgX);
      if (dist < minDist) {
        minDist = dist;
        closest = currentPointsData[i];
      }
    }

    const chLine = document.getElementById("ch-line");
    const chDot = document.getElementById("ch-dot");
    if (chLine && chDot) {
      chLine.setAttribute("x1", closest.x);
      chLine.setAttribute("x2", closest.x);
      chLine.setAttribute("opacity", "0.75");
      chDot.setAttribute("cx", closest.x);
      chDot.setAttribute("cy", closest.y);
      chDot.setAttribute("opacity", "1");
    }

    const tooltipX = (closest.x / width) * rect.width;
    const tooltipY = (closest.y / 85) * rect.height;

    tooltip.style.display = "block";
    tooltip.style.left = `${tooltipX}px`;
    tooltip.style.top = `${tooltipY}px`;
    tooltip.innerHTML = `Day ${closest.day}: <strong>${closest.weight.toFixed(2)} kg</strong>${closest.temp ? ` &bull; ${closest.temp}°C` : ""}`;
  });

  container.addEventListener("mouseleave", () => {
    tooltip.style.display = "none";
    const chLine = document.getElementById("ch-line");
    const chDot = document.getElementById("ch-dot");
    if (chLine) chLine.setAttribute("opacity", "0");
    if (chDot) chDot.setAttribute("opacity", "0");
  });
}

function switchInputMode(mode) {
  currentInputMode = mode;
  const tabTel = document.getElementById("tab-telemetry");
  const tabFeat = document.getElementById("tab-features");
  const containerTel = document.getElementById("telemetry-input-container");
  const containerFeat = document.getElementById("features-input-container");
  const flowDaysGroup = document.getElementById("flow-days-group");

  if (mode === "telemetry") {
    tabTel.classList.add("active");
    tabTel.setAttribute("aria-selected", "true");
    tabFeat.classList.remove("active");
    tabFeat.setAttribute("aria-selected", "false");
    containerTel.style.display = "block";
    containerFeat.style.display = "none";
    flowDaysGroup.style.display = "flex";
  } else {
    tabTel.classList.remove("active");
    tabTel.setAttribute("aria-selected", "false");
    tabFeat.classList.add("active");
    tabFeat.setAttribute("aria-selected", "true");
    containerTel.style.display = "none";
    containerFeat.style.display = "block";
    flowDaysGroup.style.display = "none";
    if (!document.getElementById("features-json").value.trim()) {
      loadSampleFeatureVector();
    }
  }
}

function loadSampleFeatureVector() {
  const sample = {
    weight: 62.5,
    weight_change_1d: 0.8,
    gain_rate_3d: 0.85,
    gain_rate_7d: 0.90,
    gain_rate_14d: 0.75,
    weight_std_3d: 0.15,
    weight_std_7d: 0.20,
    weight_std_14d: 0.25,
    gain_accel: -0.05,
    weight_vs_14d: 4.2,
    flow: 180.0,
    flow_roll_3d: 175.0,
    flow_roll_7d: 160.0,
    flow_abs_7d: 160.0,
    temperature: 24.5,
    temp_roll_7d: 23.8,
    temp_roll_14d: 22.5,
    humidity: 62.0,
    humid_roll_7d: 64.0,
    doy_sin: 0.85,
    doy_cos: -0.52,
    days_into_flow: 14.0
  };
  document.getElementById("features-json").value = JSON.stringify(sample, null, 2);
  showToast("Loaded 22-dimensional feature schema");
}

function updateRecordCount() {
  const textarea = document.getElementById("telemetry-json");
  if (!textarea) return;
  const text = textarea.value.trim();
  const countBadge = document.getElementById("record-count");

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      countBadge.textContent = `${parsed.length} day(s)`;
      if (parsed.length < 6) {
        countBadge.style.background = "var(--danger-soft)";
        countBadge.style.color = "var(--danger)";
      } else if (parsed.length < 14) {
        countBadge.style.background = "var(--primary-soft)";
        countBadge.style.color = "var(--primary)";
      } else {
        countBadge.style.background = "var(--success-soft)";
        countBadge.style.color = "var(--success)";
      }
      renderTrendSparkline(parsed);
      return;
    }
  } catch (e) {
    // invalid json
  }
  countBadge.textContent = "invalid JSON";
  countBadge.style.background = "var(--danger-soft)";
  countBadge.style.color = "var(--danger)";
}

function formatActiveJSON() {
  const isTelemetry = currentInputMode === "telemetry";
  const targetId = isTelemetry ? "telemetry-json" : "features-json";
  const textarea = document.getElementById(targetId);
  try {
    const parsed = JSON.parse(textarea.value);
    textarea.value = JSON.stringify(parsed, null, 2);
    if (isTelemetry) updateRecordCount();
    showToast("JSON formatted cleanly");
  } catch (err) {
    showToast("Invalid JSON syntax", true);
  }
}

async function handlePredict(event) {
  if (event && event.preventDefault) event.preventDefault();

  const submitBtn = document.getElementById("submit-btn");
  const btnText = document.getElementById("btn-text");
  const btnSpinner = document.getElementById("btn-spinner");
  const placeholder = document.getElementById("result-placeholder");
  const errorBanner = document.getElementById("result-error");
  const successCard = document.getElementById("result-success");
  const rawBox = document.getElementById("raw-json");
  const statusPill = document.getElementById("res-status-pill");

  const hiveId = document.getElementById("hive-id").value.trim();
  const margin = parseInt(document.getElementById("margin").value, 10);

  let endpoint = "/predict";
  let payload = {};

  if (currentInputMode === "telemetry") {
    const daysIntoFlow = parseInt(document.getElementById("days-into-flow").value, 10);
    const rawJson = document.getElementById("telemetry-json").value.trim();

    let history = [];
    try {
      history = JSON.parse(rawJson);
      if (!Array.isArray(history)) {
        throw new Error("Telemetry history must be a JSON array of daily readings.");
      }
    } catch (err) {
      showError("JSON Validation Failed", err.message, "Ensure your telemetry history is a valid JSON array.");
      return;
    }

    payload = {
      hiveId: hiveId,
      days_into_flow: daysIntoFlow,
      history: history,
      margin: margin
    };
  } else {
    endpoint = "/predict/features";
    const rawJson = document.getElementById("features-json").value.trim();
    let featuresObj = {};
    try {
      featuresObj = JSON.parse(rawJson);
    } catch (err) {
      showError("JSON Validation Failed", err.message, "Feature input must be a valid JSON key-value map.");
      return;
    }

    payload = {
      hiveId: hiveId,
      features: featuresObj,
      margin: margin
    };
  }

  submitBtn.disabled = true;
  btnText.textContent = "Forecasting...";
  btnSpinner.style.display = "inline-block";
  const startTime = performance.now();

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const latency = Math.round(performance.now() - startTime);
    const result = await response.json();
    rawBox.textContent = JSON.stringify(result, null, 2);

    if (result.success && result.status === "OK" && result.prediction) {
      placeholder.style.display = "none";
      errorBanner.style.display = "none";
      successCard.style.display = "block";

      statusPill.textContent = "Calibrated";
      statusPill.className = "status-pill status-ok";

      const pred = result.prediction;
      document.getElementById("res-range").textContent = pred.harvestWindowRange;
      document.getElementById("res-days").textContent = `${pred.expectedHarvestWindowDays} days`;
      
      const confEl = document.getElementById("res-confidence");
      confEl.textContent = result.confidence || "CALIBRATED";
      confEl.className = `metric-item-val badge-confidence ${result.confidence === "HIGH" ? "badge-high" : "badge-low"}`;

      document.getElementById("res-hive").textContent = result.hiveId || hiveId;
      document.getElementById("res-model").textContent = `${result.model} (${latency}ms)`;
      document.getElementById("res-margin").textContent = `±${margin} Days`;
      document.getElementById("res-note").textContent = result.note || "Continuous bloom monitoring recommended.";

      const daysIn = payload.days_into_flow || 0;
      const daysRem = pred.expectedHarvestWindowDays;
      const totalDays = Math.max(1, daysIn + daysRem);
      const progressPercent = Math.min(100, Math.round((daysIn / totalDays) * 100));

      document.getElementById("timeline-current-label").textContent = `Day ${daysIn}`;
      document.getElementById("timeline-end-label").textContent = `Est. Total: ${totalDays}d`;
      document.getElementById("timeline-progress").style.width = `${progressPercent}%`;

      showToast(`Forecast generated in ${latency}ms`);
    } else {
      let advice = "";
      if (result.status === "INSUFFICIENT_HISTORY") {
        advice = "Biological Guard: LightGBM rolling features strictly require >= 6 continuous daily records.";
      } else if (result.status === "INVALID_INPUT") {
        advice = "Input Guard: Verify that days_into_flow is not negative.";
      }
      showError(
        `Inference Rejected (${result.status || "ERROR"})`,
        result.message || "Model rejected telemetry data.",
        advice
      );
    }
  } catch (err) {
    showError("Network / API Error", err.message, "Could not communicate with the ML microservice.");
    rawBox.textContent = JSON.stringify({ error: err.message }, null, 2);
  } finally {
    submitBtn.disabled = false;
    btnText.textContent = "Generate Forecast";
    btnSpinner.style.display = "none";
  }
}

function showError(title, message, advice = "") {
  const placeholder = document.getElementById("result-placeholder");
  const errorBanner = document.getElementById("result-error");
  const successCard = document.getElementById("result-success");
  const adviceEl = document.getElementById("error-advice");
  const statusPill = document.getElementById("res-status-pill");

  placeholder.style.display = "none";
  successCard.style.display = "none";
  errorBanner.style.display = "block";

  statusPill.textContent = "Rejected";
  statusPill.className = "status-pill status-ready";

  document.getElementById("error-title").textContent = title;
  document.getElementById("error-message").textContent = message;

  if (advice) {
    adviceEl.style.display = "block";
    adviceEl.textContent = advice;
  } else {
    adviceEl.style.display = "none";
  }
}

function toggleRaw() {
  const box = document.getElementById("raw-json");
  const arrow = document.getElementById("raw-toggle-arrow");
  if (box.style.display === "none") {
    box.style.display = "block";
    arrow.innerHTML = "&blacktriangledown;";
  } else {
    box.style.display = "none";
    arrow.innerHTML = "&blacktriangleright;";
  }
}

function copyRawJson(event) {
  event.stopPropagation();
  const text = document.getElementById("raw-json").textContent;
  navigator.clipboard.writeText(text).then(() => {
    showToast("Payload copied to clipboard");
  }).catch(err => {
    alert("Failed to copy JSON: " + err);
  });
}

function showToast(message, isError = false) {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = "toast";
  if (isError) toast.style.borderColor = "var(--danger-border)";

  toast.innerHTML = `
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="${isError ? 'var(--danger)' : 'var(--primary)'}" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
    <span>${message}</span>
  `;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(8px) scale(0.96)";
    setTimeout(() => toast.remove(), 250);
  }, 2400);
}
