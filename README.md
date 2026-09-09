# Backend Integration Guide: Harvest Window Prediction API (Model 2)

This document provides the backend engineering team with everything required to integrate the **Harvest Window Prediction Model** into the Smart Beehive system. Read this carefully to avoid silent prediction failures.

---

## 1. Core Concept: What this model DOES and DOES NOT do

* **WHAT IT DOES:** Predicts the Expected Harvest Window (**Days Remaining**) until the current nectar flow plateaus.
* **WHAT IT DOES NOT DO:** This model **does not** predict absolute honey yield in kilograms. Attempts to predict absolute kg failed due to variance in physical hive hardware (covariate shift). The temporal dynamics (acceleration/deceleration of weight gain) are universal, which is why we predict *time*, not *mass*. Do not expose a "predicted yield kg" from this model.

**Inference Frequency:** Run this inference script **once per day** (e.g., at 11:59 PM local hive time) for each active hive. The model operates on daily aggregated data; running it more frequently wastes compute.

---

## 2. The Handoff Package

You are receiving four specific files. Keep them together in the same directory:

1. `harvest_window_lgbm.pkl`: The trained LightGBM model weights.
2. `inference.py`: The standalone Python script containing `predict_harvest_window()` and the exact rolling-feature logic used during training. **Do not rewrite this feature engineering yourself.**
3. `feature_config.json`: The strict order of features expected by the model.
4. `requirements.txt`: The strict Python environment dependencies (`lightgbm`, `pandas`, `scikit-learn`, `joblib`, `numpy`).

---

## 3. The Data Pipeline (Your Responsibility)

The backend receives raw IoT telemetry every 10 minutes. You must aggregate this into daily summaries before running the prediction.

### Phase A: Daily Aggregation
Group the incoming 10-minute pings into daily (24-hour) buckets.
* `weight` (kg): Daily **Mean**.
* `temperature` (°C): Daily **Mean**.
* `humidity` (%): Daily **Mean**.
* `flow` (net bees): Daily **Sum**.

### Phase B: Flow State Tracking (`days_into_flow`)
The model requires a `days_into_flow` integer. It does not calculate this automatically; the backend must maintain this state.

* **Flow Start:** A flow becomes active when the hive's 7-day rolling average weight gain rate hits **`>= 0.20 kg/day`**. Start counting `days_into_flow` from this day.
* **Flow End:** A flow is considered over when the 7-day rolling average drops below **`< 0.05 kg/day`** (or if there is a 5+ day sensor outage, or it has run 75+ days). Reset the counter.

---

## 4. 🚨 CRITICAL BUG: The 14-Day "Cold Start" Rule 🚨

**You must strictly enforce a minimum of 14 days of history before calling the prediction script.**

There is a known bug in the model's internal data validation. While it gracefully rejects `< 4 days` of data, if you feed it between 5 and 13 days, the internal Pandas `rolling(14, min_periods=4)` functions will quietly compute noisy, unstable averages. The model will **incorrectly** return a prediction instead of an error.

**Your Action Item:** Before calling `predict_harvest_window()`, wrap it in an `if` block:
```python
if len(history_df) < 14:
    return {"status": "INSUFFICIENT_HISTORY", "message": "Backend blocked: <14 days of data"}
```

---

## 5. Input & Output Schema

### Function Call
```python
from inference import predict_harvest_window

# Executing Prediction
result = predict_harvest_window(history_df, days_into_flow)
```

### Input Arguments

1. `history_df` (Pandas DataFrame):
   * Must contain **at least 14 days** of historical daily summaries.
   * Must end on the current day.
   * Must be sorted oldest to newest.
   * Required columns: `timestamp` (datetime), `weight` (float), `temperature` (float), `humidity` (float), `flow` (float/int).

2. `days_into_flow` (Integer):
   * How many days the nectar flow has been active (calculated by your backend logic in Phase B).

### Output Response

**Success Response:**
```json
{
  "status": "OK",
  "expectedHarvestWindowDays": 8
}
```

**Failure Response (Caught by `inference.py` internal checks):**
```json
{
  "status": "INSUFFICIENT_HISTORY",
  "message": "Not enough history to compute: ['gain_rate_14d', 'temp_roll_14d']"
}
```

---

## 6. Testing the Integration

To ensure your integration is working:
1. Verify that your API layer blocks queries with `< 14 days` of history.
2. Feed a synthetic `history_df` showing 20 days of rapid, accelerating weight gain (+1.5kg/day). It should return a high number of days remaining.
3. Feed a synthetic `history_df` showing 30 days of weight gain that has recently flatlined. It should return a very small window (e.g., 2-5 days remaining), signaling an imminent harvest.

---

## 7. Model Quality — Use the Right Number

If communicating accuracy to stakeholders or UI designers, use the correct metric. Two different numbers appear in the training logs:

| Metric | Value | What it actually measures |
|---|---|---|
| **Leave-one-flow-out CV MAE** | **5.01 days** (baseline 6.31 days) | Tested on a nectar flow the model never saw during training. **This is the real accuracy estimate — quote this one.** |
| In-sample residual std | 0.26 days | Computed by predicting on the *same* data the model was fit on. **Do not quote this as accuracy anywhere.** It just means the model memorized its training data perfectly. |

---

## 8. Known Limitations

Be aware of these limitations when setting product expectations:
- **Trained on only 8 nectar-flow events, across 2 hives, in Germany.** This is a very small sample. Expect real-world performance to vary meaningfully on new hives in different climates.
- **Cross-hive generalization is genuinely weak for some flows.** One held-out flow had an MAE of over 15 days. The model does not currently know when it's facing an unusual flow shape versus a typical one.
- **No real harvest log exists yet.** All flow events used in training were *inferred* from the weight curve's shape — not confirmed by a beekeeper logging a harvest. 
- **Ambient temperature, not brood-nest temperature.** This is a limitation inherited from the sensor hardware.

---

## 9. Why There is No Weather API or GPS Field

Both were considered during planning and explicitly dropped:
- **Weather API:** The hive-level temperature and humidity sensors already capture more precise, hive-specific environmental signals than a district-wide weather API.
- **GPS/Location:** Only meaningful once comparing many hives across different regions. For a single-hive or single-region deployment, it adds complexity with no model benefit yet.

**If you add real weather forecast data later, it cannot simply be substituted into an existing feature.** (e.g., injecting a live weather forecast value into `temp_roll_7d`). A forecast is a fundamentally different quantity than a rolling average of past readings. Doing this will silently produce meaningless predictions. Adding forecast data properly requires:
1. Adding it as a new, separately named feature (e.g. `forecast_temp_7d`).
2. Retraining the entire LightGBM model with that column present.
