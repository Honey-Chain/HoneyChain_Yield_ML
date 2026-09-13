# HoneyChain - Yield Production ML Microservice

Production-grade machine learning microservice for the **HoneyChain** ecosystem, providing real-time **Expected Harvest Window (Days Remaining)** predictions for active apiary nectar flows.

[![Python](https://img.shields.io/badge/Python-3.12-3776AB.svg?style=flat&logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.110+-009688.svg?style=flat&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![LightGBM](https://img.shields.io/badge/LightGBM-4.3+-brightgreen.svg?style=flat)](https://lightgbm.readthedocs.io/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED.svg?style=flat&logo=docker&logoColor=white)](https://www.docker.com/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## 1. Overview & Machine Learning Core

This service encapsulates the HoneyChain Harvest Window prediction model. Rather than predicting volatile absolute mass in kilograms (which suffers from severe hardware covariate shift due to physical differences in tare weights across hive boxes and scales), the model predicts a **temporal target**: the remaining duration (in days) of an active nectar flow.

- **Model Artifact**: `harvest_window_lgbm.pkl` (Serialized LightGBM Regressor)
- **Model Version**: `yield-production-v1`
- **Target Metric**: `days_to_flow_end` (Expected remaining days until harvest / flow plateau)
- **Model Hyperparameters**: `n_estimators=300, learning_rate=0.05, max_depth=4, num_leaves=15, min_child_samples=10, subsample=0.8, colsample_bytree=0.8, random_state=42`
- **Validation Strategy**: Leave-One-Flow-Out Cross-Validation (LOFO-CV) evaluated over 8 ground-truth flows across Wurzburg and Schwartau apiaries.
- **Model Performance**:
  - Baseline MAE: $\approx 6.31$ days
  - Model MAE: $\approx 5.01 - 5.5$ days ($R^2 \approx 0.140$)
  - Typical Operational Error Margin: $\pm 5$ days (worst observed case: $\approx 19.8$ days)
  - Confidence Rating: `LOW` (Reflects biological nature of small ground-truth flow sample size; clients must present the **range** rather than raw point estimate).

---

## 2. Architecture & Data Pipeline

```
[ ESP32 Apiary Gateway ]
          │ (10-min sensor pings: weight, temp, humidity, bee flow)
          ▼
[ HoneyChain Backend ] ── Hourly & Daily Aggregation
          │
          │ Daily summaries (min 6 days, 14+ recommended) + days_into_flow
          ▼
[ HoneyChain_Yield_ML Microservice (FastAPI :5002) ]
          │
          ├──> Preprocessing Pipeline (app/service.py)
          │    - 1-day weight diffs & rolling gain rates (3d, 7d, 14d)
          │    - Weight volatility & standard deviations (3d, 7d, 14d)
          │    - Gain acceleration (3d gain rate - 7d gain rate)
          │    - Rolling bee flow (3d, 7d, absolute 7d)
          │    - Environmental moving averages (temperature, humidity)
          │    - Seasonal cyclical encodings (sin/cos day-of-year)
          │
          ├──> LightGBM Regressor (harvest_window_lgbm.pkl)
          │
          ▼
[ Structured Prediction Response ]
  • expectedHarvestWindowDays: 12
  • harvestWindowRange: "7-17 days"
  • confidence: "LOW"
```

### Telemetry Preprocessing & Feature Engineering
To eliminate train-serve skew, the service dynamically engineers the **22 biological and physical rolling features** from daily continuous telemetry:

| Feature Category | Features | Description |
|---|---|---|
| **Weight Dynamics** | `weight`, `weight_change_1d`, `gain_rate_3d`, `gain_rate_7d`, `gain_rate_14d`, `weight_std_3d`, `weight_std_7d`, `weight_std_14d`, `gain_accel`, `weight_vs_14d` | Real-time hive mass velocity, stability, and nectar accumulation acceleration |
| **Colony Foraging Activity** | `flow`, `flow_roll_3d`, `flow_roll_7d`, `flow_abs_7d` | Moving averages and absolute traffic through the hive entrance |
| **Microclimate & Weather** | `temperature`, `temp_roll_7d`, `temp_roll_14d`, `humidity`, `humid_roll_7d` | Ambient environmental conditions dictating nectar secretion |
| **Seasonal / Solar** | `doy_sin`, `doy_cos` | Cyclical trigonometric encoding of Day-of-Year |
| **Flow State** | `days_into_flow` | Integer counter of days since nectar flow detection |

---

## 3. REST API Specification

### Endpoints Overview

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Microservice health check and model loading state |
| `GET` | `/model-info` | Detailed model metadata, feature list, and performance metrics |
| `POST` | `/predict` | **Primary Endpoint**: Predicts harvest window from telemetry history |
| `POST` | `/predict/features` | Direct inference with pre-computed 22-dimensional feature vector |
| `GET` | `/api/sample-data` | Pre-built test scenarios (Early flow, plateauing, cold start) |
| `GET` | `/` | Built-in interactive browser testing frontend |
| `GET` | `/docs` | Interactive Swagger / OpenAPI documentation |

---

### `POST /predict` (Primary Endpoint)

#### Request Headers
```http
Content-Type: application/json
```

#### Request Body
```json
{
  "hiveId": "HIVE-KV-201",
  "days_into_flow": 14,
  "margin": 5,
  "history": [
    {
      "timestamp": "2026-05-01",
      "weight": 52.4,
      "temperature": 23.5,
      "humidity": 65.0,
      "flow": 180.0
    },
    ... (requires >= 6 daily records; 14+ records recommended)
  ]
}
```

#### Response: Success (200 OK)
```json
{
  "success": true,
  "status": "OK",
  "hiveId": "HIVE-KV-201",
  "prediction": {
    "expectedHarvestWindowDays": 12,
    "harvestWindowRange": "7-17 days",
    "minDays": 7,
    "maxDays": 17
  },
  "confidence": "LOW",
  "note": "Typical error +/-5 days, worst observed ~19 days. Re-check daily as the flow develops.",
  "model": "yield-production-v1",
  "timestamp": "2026-09-13T08:58:30.123456+00:00"
}
```

#### Response: Cold Start Rejection (200 OK)
```json
{
  "success": false,
  "status": "INSUFFICIENT_HISTORY",
  "hiveId": "HIVE-KV-201",
  "message": "Only 3 real day(s) of weight data, need at least 6.",
  "model": "yield-production-v1",
  "timestamp": "2026-09-13T08:58:30.123456+00:00"
}
```

#### Response: Invalid Input (422 Unprocessable Entity)
```json
{
  "detail": [
    {
      "type": "greater_than_equal",
      "loc": ["body", "days_into_flow"],
      "msg": "Input should be greater than or equal to 0"
    }
  ]
}
```

---

## 4. HoneyChain Backend Integration

A dedicated, ready-to-import TypeScript client is provided at [`integration/honeychain_client.ts`](integration/honeychain_client.ts).

### Usage in Node.js / Express Backend

```typescript
import { yieldPredictionClient } from './services/yieldPredictionService';

// Inside your scheduled daily evaluation cron or route handler:
app.get('/api/hives/:hiveId/harvest-forecast', async (req, res) => {
  try {
    const { hiveId } = req.params;

    // 1. Retrieve continuous daily summaries from MongoDB (ending today)
    const dailyRecords = await DailyTelemetryModel.find({ hiveId })
      .sort({ date: 1 })
      .limit(30);

    const history = dailyRecords.map(r => ({
      timestamp: r.date.toISOString().split('T')[0],
      weight: r.meanWeight,
      temperature: r.meanTemperature,
      humidity: r.meanHumidity,
      flow: r.totalBeeFlow
    }));

    // 2. Track flow state: days since 7-day avg weight gain hit >= 0.20 kg/day
    const daysIntoFlow = await calculateDaysIntoFlow(hiveId);

    // 3. Request forecast from ML microservice
    const result = await yieldPredictionClient.predictHarvestWindow(
      hiveId,
      daysIntoFlow,
      history,
      5 // optional margin in days
    );

    if (result.success && result.prediction) {
      // NOTE: Always present harvestWindowRange to manage beekeeper expectations
      return res.json({
        hiveId,
        harvestWindow: result.prediction.harvestWindowRange,
        expectedDays: result.prediction.expectedHarvestWindowDays,
        confidence: result.confidence,
        note: result.note
      });
    } else {
      return res.status(400).json({
        error: result.status,
        message: result.message
      });
    }
  } catch (error: any) {
    return res.status(500).json({ error: 'INTERNAL_ERROR', message: error.message });
  }
});
```

---

## 5. Local Development & Verification

### Prerequisites
- Python 3.12+
- Git

### Quick Setup

```bash
# 1. Clone repository
git clone https://github.com/Dhritish-Mukherjee/HoneyChain_Yield_ML.git
cd HoneyChain_Yield_ML

# 2. Create virtual environment
python3 -m venv .venv
source .venv/bin/activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Copy environment configuration
cp .env.example .env

# 5. Start the development server
uvicorn app.main:app --host 0.0.0.0 --port 5002 --reload
```

Open `http://localhost:5002/` in your browser to access the interactive testing interface.

### Running Test Suites

```bash
# Run FastAPI endpoint and integration test suite
pytest -v tests/test_api.py

# Run biological sanity and edge-case validation suite
python test_model.py
```

---

## 6. Testing Frontend & Biological Scenarios

The service includes a built-in validation dashboard at `/`:

### Multi-Theme Visual Modes
Switch between four tailored UI themes with automatic `localStorage` persistence:
- 🍯 **Honey Amber**: Classic golden apiary palette (default).
- 🌙 **Dark Apiary**: Sleek low-glare slate and dark mode for apiary field checks.
- 🌿 **Forest Green**: Organic emerald palette matching natural flora and forage.
- ⚡ **Cyber Apiary**: Modern tech blue/cyan dashboard layout.

### 10 Biological & Environmental Presets
Presets are categorized into three operational groups:

#### 🌸 Flow Phases
1. **Early Strong Nectar Flow (Surge)**: Day 14 into flow, 15 days history gaining ~1.5 kg/day. Verifies long harvest window remaining.
2. **Peak Mid-Season Flow (Sustained)**: Day 24 into flow, 25 days history, high continuous foraging activity (320 count/day).
3. **Plateauing Flow (Dying Flow)**: Day 34 into flow, 35 days history gaining <0.08 kg/day. Triggers imminent harvest recommendation (0–5 days).

#### 🌦️ Climate & Stress Conditions
4. **Extreme Heatwave & Drought**: High ambient heat (40°C) with 15% humidity. Verifies shortened flow duration from floral drying.
5. **Monsoon / Continuous Rain Confinement**: 92% humidity with cold temperatures (17°C). Tests flow stall during weather confinement.
6. **Autumn Late-Season Bloom**: Late September/October flow testing trigonometric day-of-year cyclical encoding (`doy_sin`/`doy_cos`).

#### ⚠️ Edge Cases & Hardware Diagnostics
7. **Severe Cold Start (<6 Days)**: Only 3 days of telemetry. Verifies graceful failure with `INSUFFICIENT_HISTORY`.
8. **Borderline Cold Start (Exact 6-Day Min)**: Exactly 6 days of telemetry. Tests the mathematical threshold of rolling statistics.
9. **Negative Gain / Store Consumption**: Hive weight drops at flow tail as bees consume stores.
10. **Intermittent Sensor Outage**: Missing IoT readings mid-sequence. Tests robustness of rolling window aggregations against packet loss.

### Additional Features
- **Flow Timeline Visualizer**: Real-time progress bar displaying elapsed flow days vs predicted remaining window.
- **Direct Feature Mode**: Switch to the "Direct Features" tab to test model inference directly against a 22-dimensional feature vector.
- **One-Click JSON Formatter & Copy**: Formats input telemetry and copies structured output JSON.

---

## 7. Deployment Instructions

### Option A: Docker (Recommended)

```bash
# Build the Docker image
docker build -t honeychain-yield-ml:latest .

# Run container on port 5002
docker run -d --name honeychain-yield-ml -p 5002:5002 honeychain-yield-ml:latest

# Or using docker-compose
docker-compose up -d
```

Check health:
```bash
curl -s http://localhost:5002/health | jq
```

### Option B: Render Deployment

This repository includes a `render.yaml` blueprint:
1. Connect the `HoneyChain_Yield_ML` repository in your [Render Dashboard](https://dashboard.render.com).
2. Render automatically detects `render.yaml` and deploys as a Python Web Service.
3. Configure environment variable `PORT=5002` (or let Render assign dynamically).
4. Update `YIELD_ML_SERVICE_URL` in the HoneyChain backend with your Render URL.

### Option C: Railway / Heroku / VPS

The included `Procfile` allows instant one-click deployment:
```text
web: uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-5002}
```

---

## 8. Repository File Structure

```text
HoneyChain_Yield_ML/
├── app/
│   ├── __init__.py
│   ├── config.py                 # Environment and application settings
│   ├── schemas.py                # Pydantic v2 validation contracts
│   ├── service.py                # Core inference service and biological presets
│   ├── main.py                   # FastAPI application & route declarations
│   └── static/
│       ├── index.html            # Testing frontend dashboard
│       ├── app.js                # Frontend scenario loader and client
│       └── style.css             # Lightweight, responsive styling
├── integration/
│   └── honeychain_client.ts      # Ready-to-import TypeScript HoneyChain client
├── tests/
│   ├── __init__.py
│   └── test_api.py               # Complete pytest test suite (10 test cases)
├── Dockerfile                    # Production multi-stage Docker build
├── .dockerignore                 # Docker ignore filters
├── docker-compose.yml            # Local container orchestration
├── Procfile                      # Process declaration for PaaS
├── render.yaml                   # Render Blueprint specification
├── requirements.txt              # Pinned Python dependencies
├── .env.example                  # Environment template
├── .gitignore                    # Git ignore rules
├── harvest_window_lgbm.pkl       # Serialized LightGBM model weights
├── feature_config.json           # Canonical feature definitions
├── inference.py                  # Standalone inference helper
├── test_model.py                 # Biological edge-case validation script
└── README.md                     # Microservice documentation
```

---

## 9. License

This microservice is maintained under the MIT License for the HoneyChain decentralized apiary intelligence platform.
