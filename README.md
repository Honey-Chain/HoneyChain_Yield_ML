# Smart Beehive ML: Harvest Window Prediction API

## 1. Executive Summary

This machine learning microservice predicts the **Expected Harvest Window (Days Remaining)** for an active beehive during a nectar flow.

* **Temporal vs. Absolute Targets:** This model predicts a *temporal* target, NOT absolute honey yield in kilograms. Absolute mass predictions suffer from hardware covariate shift due to physical differences in tare weights across hive boxes. Temporal dynamics (weight acceleration and deceleration) transfer universally.
* **Inference Frequency:** Beehives operate on a 24-hour biological cycle. Run this inference script **once per day** (e.g., at 23:59) for each active hive. Running it more frequently wastes compute power and violates the daily resolution of the training data.

---

## 2. Telemetry Ingestion & Aggregation

The model strictly requires daily historical summaries. Raw 10-minute IoT sensor pings must be aggregated in a two-step process before inference:

* **Step 1: Hourly Aggregation**
Group the incoming 10-minute pings into 1-hour buckets.
* `weight`, `temperature`, `humidity`: Calculate the **Mean** (Average).
* `flow`: Calculate the **Sum** (Total bee movement in/out).

* **Step 2: Daily Aggregation**
Group the 24 hourly buckets into a single daily summary. The resulting database table or dataframe must have exactly one row per day per hive.

---

## 3. Flow State Tracking (`days_into_flow`)

The model evaluates *active nectar flows*. The backend is responsible for tracking when a flow starts and providing the `days_into_flow` integer to the model.

* **Flow Start:** A flow is considered active when the 7-day average weight gain hits `>= 0.20 kg/day`.
* **Flow End:** A flow is considered terminated when the 7-day average weight gain drops to `< 0.05 kg/day`.
* **Backend Responsibility:** Maintain a state counter of how many days the current flow has been active, and pass this exact integer at inference time.

---

## 4. Model Inference Architecture

To prevent train-serve skew, the backend **must not** engineer the rolling features. The `build_live_features` function inside `inference.py` computes all complex rolling averages (e.g., 3-day, 7-day, 14-day metrics) dynamically right before prediction using the same mathematical logic as the training loop.

* **No External Forecasts:** The model evaluates internal hive physics. Do not substitute future Weather API forecasts into the historical `temperature` fields.

---

## 5. API Payload Contract

### Input Schema

Pass `history_df` and `days_into_flow` to the `predict_harvest_window()` function:

1. `history_df` (Pandas DataFrame): Minimum 6 days of continuous daily summaries ending today, sorted oldest to newest. Required columns: `timestamp`, `weight`, `temperature`, `humidity`, `flow`.
2. `days_into_flow` (Integer): Tracked state from the backend flow-detection logic.

### Output Schema

The API returns a dictionary explicitly exposing error bounds to ensure UI safety. **The frontend MUST display the `harvestWindowRange` rather than the raw integer to accurately manage beekeeper expectations.**

**Success Response:**

```json
{
  "status": "OK",
  "expectedHarvestWindowDays": 20,
  "harvestWindowRange": "15-25 days",
  "confidence": "LOW",
  "note": "Typical error +/- 5 days, worst observed ~19 days. Re-check as the flow develops."
}
```

**Error Response (Cold Start Violation):**
The model requires a strict minimum of **6 days** of history to calculate baseline rolling averages safely. If insufficient data is passed, it fails gracefully:

```json
{
  "status": "INSUFFICIENT_HISTORY",
  "message": "Only 2 real day(s) of weight data, need at least 6."
}
```

**Error Response (Invalid Flow State):**
If the backend attempts to pass a negative value for `days_into_flow`, the inference script explicitly blocks it to prevent logical failures.

```json
{
  "status": "INVALID_INPUT",
  "message": "days_into_flow cannot be negative. Received: -5"
}
```

---

## 6. System Accuracy & Known Limitations

This model was rigorously evaluated using Leave-One-Flow-Out Cross-Validation.

* **Average Performance:** The Mean Absolute Error (MAE) is roughly **~5.5 days**.
* **Worst-Case Boundary:** In highly erratic or atypical nectar flows, the worst-case error can reach up to **~19.8 days**.
* **The Sample Size Ceiling:** Extensive ablation testing revealed that expanding the historical window from 6 days to 30 days yields negligible improvements in accuracy. The error ceiling is dictated by the small volume of ground-truth nectar flow events available for training (8 total flows across 2 hives), not data recency.
* **Cold Start Requirement:** To balance operational flexibility with stability, the system requires a hard minimum of **6 days** of continuous telemetry.
* **Future Iterations:** Scaling the training dataset across a wider diversity of hardware profiles and seasons is the primary path to tightening the worst-case error bound.

---

## 7. File Manifest & Dependencies

Ensure the following files are located in the same directory as the backend worker:

* `harvest_window_lgbm.pkl`: The serialized LightGBM model weights.
* `inference.py`: The execution script containing `build_live_features` and `predict_harvest_window`.
* `requirements.txt`: Strict Python environment dependencies (`lightgbm`, `pandas`, `numpy`, `scikit-learn`, `joblib`).
