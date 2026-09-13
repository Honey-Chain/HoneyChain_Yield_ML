let sampleData = {};
let currentPresetKey = "early_strong_flow";
let currentCategory = "all";
let currentInputMode = "telemetry"; // 'telemetry' or 'features'

document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  checkHealth();
  fetchSampleData();

  const textarea = document.getElementById("telemetry-json");
  textarea.addEventListener("input", updateRecordCount);
});

// ==========================================
// Theme Management
// ==========================================
function initTheme() {
  const savedTheme = localStorage.getItem("honeychain_theme") || "amber";
  changeTheme(savedTheme, false);
  const select = document.getElementById("theme-select");
  if (select) select.value = savedTheme;
}

function changeTheme(themeName, save = true) {
  document.documentElement.setAttribute("data-theme", themeName);
  if (save) {
    localStorage.setItem("honeychain_theme", themeName);
  }
}

// ==========================================
// Service Health & Scenarios Loading
// ==========================================
async function checkHealth() {
  const badge = document.getElementById("health-badge");
  try {
    const res = await fetch("/health");
    const data = await res.json();
    if (data.status === "healthy" && data.model_loaded) {
      badge.textContent = `Online • ${data.model_version}`;
      badge.className = "header-badge healthy";
    } else {
      badge.textContent = `Degraded • Model Unloaded`;
      badge.className = "header-badge error";
    }
  } catch (err) {
    badge.textContent = "Service Offline";
    badge.className = "header-badge error";
  }
}

async function fetchSampleData() {
  try {
    const res = await fetch("/api/sample-data");
    sampleData = await res.json();
    renderPresetButtons(currentCategory);
    loadPreset("early_strong_flow");
  } catch (err) {
    console.error("Failed to load sample scenarios:", err);
  }
}

// ==========================================
// Preset Categories & Rendering
// ==========================================
function filterCategory(category, btnElement) {
  currentCategory = category;
  document.querySelectorAll(".cat-pill").forEach(p => p.classList.remove("active"));
  if (btnElement) btnElement.classList.add("active");
  renderPresetButtons(category);
}

function renderPresetButtons(category) {
  const container = document.getElementById("preset-buttons-container");
  if (!container || !sampleData) return;

  container.innerHTML = "";

  Object.entries(sampleData).forEach(([key, item]) => {
    if (category !== "all" && item.category !== category) {
      return;
    }

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `btn-preset-card ${key === currentPresetKey ? "active" : ""}`;
    btn.id = `preset-btn-${key}`;
    btn.onclick = () => loadPreset(key);

    btn.innerHTML = `
      <span class="preset-card-tag">${item.badge || "Preset"}</span>
      <span class="preset-card-title">${item.name}</span>
    `;

    container.appendChild(btn);
  });
}

function loadPreset(key) {
  if (!sampleData || !sampleData[key]) return;
  currentPresetKey = key;
  const scenario = sampleData[key];

  // Update active card styling
  document.querySelectorAll(".btn-preset-card").forEach(b => b.classList.remove("active"));
  const activeBtn = document.getElementById(`preset-btn-${key}`);
  if (activeBtn) activeBtn.classList.add("active");

  // Update form inputs
  document.getElementById("hive-id").value = scenario.hiveId || "HIVE-001";
  document.getElementById("days-into-flow").value = scenario.days_into_flow;
  document.getElementById("margin").value = 5;

  const jsonStr = JSON.stringify(scenario.history, null, 2);
  document.getElementById("telemetry-json").value = jsonStr;
  updateRecordCount();

  // Render info card
  renderPresetInfoCard(scenario);
}

function renderPresetInfoCard(scenario) {
  const card = document.getElementById("preset-info-card");
  const badge = document.getElementById("preset-badge");
  const title = document.getElementById("preset-title");
  const desc = document.getElementById("preset-description");
  const chips = document.getElementById("preset-meta-chips");

  card.style.display = "block";
  badge.textContent = scenario.badge || "Preset";
  title.textContent = scenario.name;
  desc.textContent = scenario.description;

  // Calculate quick stats from history
  const history = scenario.history || [];
  let statsHtml = `<span class="chip">📅 ${history.length} Days History</span>`;
  statsHtml += `<span class="chip">⏱️ Flow Day: ${scenario.days_into_flow}</span>`;

  if (history.length > 0) {
    const validWeights = history.map(h => h.weight).filter(w => w !== null && !isNaN(w));
    if (validWeights.length >= 2) {
      const startW = validWeights[0];
      const endW = validWeights[validWeights.length - 1];
      const delta = (endW - startW).toFixed(2);
      statsHtml += `<span class="chip">⚖️ ${startW}kg &rarr; ${endW}kg (&Delta;${delta > 0 ? "+" : ""}${delta}kg)</span>`;
    }
  }

  chips.innerHTML = statsHtml;
}

function resetToCurrentPreset() {
  if (currentPresetKey && sampleData[currentPresetKey]) {
    loadPreset(currentPresetKey);
  }
}

// ==========================================
// Input Mode Switching (Telemetry vs Direct Features)
// ==========================================
function switchInputMode(mode) {
  currentInputMode = mode;
  const tabTel = document.getElementById("tab-telemetry");
  const tabFeat = document.getElementById("tab-features");
  const containerTel = document.getElementById("telemetry-input-container");
  const containerFeat = document.getElementById("features-input-container");
  const flowDaysGroup = document.getElementById("flow-days-group");

  if (mode === "telemetry") {
    tabTel.classList.add("active");
    tabFeat.classList.remove("active");
    containerTel.style.display = "block";
    containerFeat.style.display = "none";
    flowDaysGroup.style.display = "flex";
  } else {
    tabTel.classList.remove("active");
    tabFeat.classList.add("active");
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
}

// ==========================================
// Form Validation & Execution
// ==========================================
function updateRecordCount() {
  const text = document.getElementById("telemetry-json").value.trim();
  const countBadge = document.getElementById("record-count");
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      countBadge.textContent = `${parsed.length} day(s)`;
      if (parsed.length < 6) {
        countBadge.style.background = "var(--danger-bg)";
        countBadge.style.color = "var(--danger)";
      } else if (parsed.length < 14) {
        countBadge.style.background = "var(--primary-soft)";
        countBadge.style.color = "var(--primary-text)";
      } else {
        countBadge.style.background = "var(--success-bg)";
        countBadge.style.color = "var(--success)";
      }
      return;
    }
  } catch (e) {
    // invalid json
  }
  countBadge.textContent = "invalid JSON";
  countBadge.style.background = "var(--danger-bg)";
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
  } catch (err) {
    alert("Invalid JSON syntax: " + err.message);
  }
}

async function handlePredict(event) {
  event.preventDefault();

  const submitBtn = document.getElementById("submit-btn");
  const btnText = document.getElementById("btn-text");
  const btnSpinner = document.getElementById("btn-spinner");
  const placeholder = document.getElementById("result-placeholder");
  const errorBanner = document.getElementById("result-error");
  const successCard = document.getElementById("result-success");
  const rawBox = document.getElementById("raw-json");

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

  // Set loading state
  submitBtn.disabled = true;
  btnText.textContent = "Computing Inference...";
  btnSpinner.style.display = "inline-block";

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    rawBox.textContent = JSON.stringify(result, null, 2);

    if (result.success && result.status === "OK" && result.prediction) {
      placeholder.style.display = "none";
      errorBanner.style.display = "none";
      successCard.style.display = "block";

      const pred = result.prediction;
      document.getElementById("res-range").textContent = pred.harvestWindowRange;
      document.getElementById("res-days").textContent = `${pred.expectedHarvestWindowDays} days`;
      document.getElementById("res-confidence").textContent = result.confidence || "LOW";
      document.getElementById("res-hive").textContent = result.hiveId || hiveId;
      document.getElementById("res-model").textContent = result.model;
      document.getElementById("res-margin").textContent = `±${margin} Days`;
      document.getElementById("res-timestamp").textContent = result.timestamp
        ? new Date(result.timestamp).toLocaleTimeString()
        : "Just Now";
      document.getElementById("res-note").textContent = result.note || "Monitor flow developments daily.";

      // Update timeline visualization
      const daysIn = payload.days_into_flow || 0;
      const daysRem = pred.expectedHarvestWindowDays;
      const totalDays = Math.max(1, daysIn + daysRem);
      const progressPercent = Math.min(100, Math.round((daysIn / totalDays) * 100));

      document.getElementById("timeline-current-label").textContent = `Current: Day ${daysIn}`;
      document.getElementById("timeline-end-label").textContent = `Est. Total: ${totalDays}d`;
      document.getElementById("timeline-progress").style.width = `${progressPercent}%`;

    } else {
      let advice = "";
      if (result.status === "INSUFFICIENT_HISTORY") {
        advice = "💡 Biological Constraint: The LightGBM feature pipeline computes 3-day, 7-day, and 14-day rolling dynamics and requires a strict minimum of 6 continuous daily records. Please provide more telemetry.";
      } else if (result.status === "INVALID_INPUT") {
        advice = "💡 Input Guard: Verify that days_into_flow is not negative and that all required columns are present.";
      }
      showError(
        `Prediction Rejected (${result.status || "ERROR"})`,
        result.message || "Model rejected telemetry data or encountered an unexpected error.",
        advice
      );
    }
  } catch (err) {
    showError("Network / API Error", err.message, "Could not communicate with the Python ML microservice.");
    rawBox.textContent = JSON.stringify({ error: err.message }, null, 2);
  } finally {
    submitBtn.disabled = false;
    btnText.textContent = "Run Harvest Prediction";
    btnSpinner.style.display = "none";
  }
}

function showError(title, message, advice = "") {
  const placeholder = document.getElementById("result-placeholder");
  const errorBanner = document.getElementById("result-error");
  const successCard = document.getElementById("result-success");
  const adviceEl = document.getElementById("error-advice");

  placeholder.style.display = "none";
  successCard.style.display = "none";
  errorBanner.style.display = "block";

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
  const btn = event.target;
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.textContent;
    btn.textContent = "Copied!";
    setTimeout(() => { btn.textContent = orig; }, 1500);
  }).catch(err => {
    alert("Failed to copy JSON: " + err);
  });
}
