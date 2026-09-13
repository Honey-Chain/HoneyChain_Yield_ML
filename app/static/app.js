let sampleData = {};

document.addEventListener("DOMContentLoaded", () => {
  checkHealth();
  fetchSampleData();

  const textarea = document.getElementById("telemetry-json");
  textarea.addEventListener("input", updateRecordCount);
});

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
    // Default to early strong flow
    loadPreset("early_strong_flow");
  } catch (err) {
    console.error("Failed to load sample scenarios:", err);
  }
}

function loadPreset(key) {
  if (!sampleData || !sampleData[key]) return;
  const scenario = sampleData[key];

  document.getElementById("hive-id").value = scenario.hiveId || "HIVE-001";
  document.getElementById("days-into-flow").value = scenario.days_into_flow;
  document.getElementById("margin").value = 5;

  const jsonStr = JSON.stringify(scenario.history, null, 2);
  document.getElementById("telemetry-json").value = jsonStr;
  updateRecordCount();
}

function updateRecordCount() {
  const text = document.getElementById("telemetry-json").value.trim();
  const countBadge = document.getElementById("record-count");
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      countBadge.textContent = `${parsed.length} day(s)`;
      if (parsed.length < 6) {
        countBadge.style.background = "#fee2e2";
        countBadge.style.color = "#b91c1c";
      } else if (parsed.length < 14) {
        countBadge.style.background = "#fef3c7";
        countBadge.style.color = "#b45309";
      } else {
        countBadge.style.background = "#dcfce7";
        countBadge.style.color = "#15803d";
      }
      return;
    }
  } catch (e) {
    // invalid json
  }
  countBadge.textContent = "invalid JSON";
  countBadge.style.background = "#fee2e2";
  countBadge.style.color = "#b91c1c";
}

function formatJSON() {
  const textarea = document.getElementById("telemetry-json");
  try {
    const parsed = JSON.parse(textarea.value);
    textarea.value = JSON.stringify(parsed, null, 2);
    updateRecordCount();
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

  // Read inputs
  const hiveId = document.getElementById("hive-id").value.trim();
  const daysIntoFlow = parseInt(document.getElementById("days-into-flow").value, 10);
  const margin = parseInt(document.getElementById("margin").value, 10);
  const rawJson = document.getElementById("telemetry-json").value.trim();

  let history = [];
  try {
    history = JSON.parse(rawJson);
    if (!Array.isArray(history)) {
      throw new Error("Telemetry history must be a JSON array of daily readings.");
    }
  } catch (err) {
    showError("JSON Validation Failed", err.message);
    return;
  }

  // Set loading state
  submitBtn.disabled = true;
  btnText.textContent = "Predicting...";
  btnSpinner.style.display = "inline-block";

  const payload = {
    hiveId: hiveId,
    days_into_flow: daysIntoFlow,
    history: history,
    margin: margin
  };

  try {
    const response = await fetch("/predict", {
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

      document.getElementById("res-range").textContent = result.prediction.harvestWindowRange;
      document.getElementById("res-days").textContent = `${result.prediction.expectedHarvestWindowDays} days`;
      document.getElementById("res-confidence").textContent = result.confidence || "LOW";
      document.getElementById("res-hive").textContent = result.hiveId || hiveId;
      document.getElementById("res-model").textContent = result.model;
      document.getElementById("res-timestamp").textContent = result.timestamp ? new Date(result.timestamp).toLocaleTimeString() : "Now";
      document.getElementById("res-note").textContent = result.note || "Check daily as flow develops.";
    } else {
      showError(
        `Prediction Failed (${result.status || "ERROR"})`,
        result.message || "Model rejected telemetry data or encountered an unexpected error."
      );
    }
  } catch (err) {
    showError("Network / API Error", err.message);
    rawBox.textContent = JSON.stringify({ error: err.message }, null, 2);
  } finally {
    submitBtn.disabled = false;
    btnText.textContent = "Run Harvest Prediction";
    btnSpinner.style.display = "none";
  }
}

function showError(title, message) {
  const placeholder = document.getElementById("result-placeholder");
  const errorBanner = document.getElementById("result-error");
  const successCard = document.getElementById("result-success");

  placeholder.style.display = "none";
  successCard.style.display = "none";
  errorBanner.style.display = "block";

  document.getElementById("error-title").textContent = title;
  document.getElementById("error-message").textContent = message;
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
