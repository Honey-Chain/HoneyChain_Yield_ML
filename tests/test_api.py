import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.service import prediction_service

client = TestClient(app)


def test_health_endpoint():
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert data["model_loaded"] is True
    assert data["model_version"] == "yield-production-v1"


def test_model_info_endpoint():
    response = client.get("/model-info")
    assert response.status_code == 200
    data = response.json()
    assert data["algorithm"] == "LightGBM Regressor (LGBMRegressor)"
    assert len(data["features"]) == 22
    assert data["minimum_history_days"] == 6


def test_sample_data_endpoint():
    response = client.get("/api/sample-data")
    assert response.status_code == 200
    data = response.json()
    expected_presets = [
        "early_strong_flow", "peak_mid_flow", "plateauing_flow",
        "heatwave_drought", "monsoon_stall", "autumn_late_flow",
        "cold_start", "borderline_min_days", "negative_gain", "sensor_gap"
    ]
    for preset in expected_presets:
        assert preset in data, f"Preset {preset} missing from sample data"
        assert "category" in data[preset]
        assert "badge" in data[preset]
        assert "description" in data[preset]
        assert len(data[preset]["history"]) > 0


def test_predict_all_preset_scenarios():
    response = client.get("/api/sample-data")
    data = response.json()
    for preset_key, sc in data.items():
        payload = {
            "hiveId": sc["hiveId"],
            "days_into_flow": sc["days_into_flow"],
            "history": sc["history"]
        }
        res = client.post("/predict", json=payload)
        assert res.status_code == 200
        res_data = res.json()
        if preset_key == "cold_start":
            assert res_data["success"] is False
            assert res_data["status"] == "INSUFFICIENT_HISTORY"
        else:
            assert res_data["success"] is True
            assert res_data["status"] == "OK"
            assert "expectedHarvestWindowDays" in res_data["prediction"]


def test_predict_early_strong_flow():
    samples = prediction_service.get_sample_scenarios()
    payload = {
        "hiveId": "HIVE-TEST-01",
        "days_into_flow": 14,
        "history": samples["early_strong_flow"]["history"],
        "margin": 5
    }
    response = client.post("/predict", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["status"] == "OK"
    assert "expectedHarvestWindowDays" in data["prediction"]
    assert "harvestWindowRange" in data["prediction"]
    assert data["prediction"]["expectedHarvestWindowDays"] >= 0
    assert data["confidence"] == "LOW"


def test_predict_plateauing_flow():
    samples = prediction_service.get_sample_scenarios()
    payload = {
        "hiveId": "HIVE-TEST-02",
        "days_into_flow": 34,
        "history": samples["plateauing_flow"]["history"],
        "margin": 5
    }
    response = client.post("/predict", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["status"] == "OK"
    # A plateauing flow should predict a low number of remaining days
    assert data["prediction"]["expectedHarvestWindowDays"] <= 10


def test_predict_cold_start_rejection():
    # Cold start with only 3 days
    samples = prediction_service.get_sample_scenarios()
    payload = {
        "hiveId": "HIVE-TEST-03",
        "days_into_flow": 2,
        "history": samples["cold_start"]["history"]
    }
    response = client.post("/predict", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is False
    assert data["status"] == "INSUFFICIENT_HISTORY"
    assert "at least 6" in data["message"] or "strict minimum of 6" in data["message"]


def test_predict_negative_days_into_flow_validation():
    samples = prediction_service.get_sample_scenarios()
    payload = {
        "hiveId": "HIVE-TEST-04",
        "days_into_flow": -5,
        "history": samples["early_strong_flow"]["history"]
    }
    response = client.post("/predict", json=payload)
    # Pydantic validation rejects negative days_into_flow with 422
    assert response.status_code == 422


def test_predict_direct_features():
    # 22 required features
    sample_features = {
        'weight': 62.5,
        'weight_change_1d': 0.8,
        'gain_rate_3d': 0.85,
        'gain_rate_7d': 0.90,
        'gain_rate_14d': 0.75,
        'weight_std_3d': 0.15,
        'weight_std_7d': 0.20,
        'weight_std_14d': 0.25,
        'gain_accel': -0.05,
        'weight_vs_14d': 4.2,
        'flow': 180.0,
        'flow_roll_3d': 175.0,
        'flow_roll_7d': 160.0,
        'flow_abs_7d': 160.0,
        'temperature': 24.5,
        'temp_roll_7d': 23.8,
        'temp_roll_14d': 22.5,
        'humidity': 62.0,
        'humid_roll_7d': 64.0,
        'doy_sin': 0.85,
        'doy_cos': -0.52,
        'days_into_flow': 14.0
    }
    payload = {
        "hiveId": "HIVE-DIRECT-01",
        "features": sample_features,
        "margin": 5
    }
    response = client.post("/predict/features", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["status"] == "OK"
    assert "expectedHarvestWindowDays" in data["prediction"]


def test_predict_direct_features_missing_key():
    payload = {
        "hiveId": "HIVE-DIRECT-02",
        "features": {"weight": 55.0}  # Missing most features
    }
    response = client.post("/predict/features", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is False
    assert data["status"] == "INVALID_INPUT"


def test_frontend_index():
    response = client.get("/")
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    assert "HoneyChain Yield ML Service" in response.text
