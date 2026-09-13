import json
import logging
from typing import Any, Dict, List, Optional, Tuple
import joblib
import numpy as np
import pandas as pd

from app.config import settings
from app.schemas import (
    DailyTelemetryReading,
    PredictionDetails,
    PredictResponse,
)

logger = logging.getLogger(__name__)


class YieldPredictionService:
    def __init__(self) -> None:
        self.model: Any = None
        self.features: List[str] = []
        self.feature_config: Dict[str, Any] = {}
        self.is_loaded: bool = False
        self._load_artifacts()

    def _load_artifacts(self) -> None:
        """Loads serialized model and feature configurations from disk."""
        try:
            if settings.FEATURE_CONFIG_PATH.exists():
                with open(settings.FEATURE_CONFIG_PATH, "r", encoding="utf-8") as f:
                    self.feature_config = json.load(f)
                    self.features = self.feature_config.get("FEATURES", [])
            else:
                logger.warning(
                    f"feature_config.json not found at {settings.FEATURE_CONFIG_PATH}, using fallback list."
                )
                self.features = [
                    'weight', 'weight_change_1d', 'gain_rate_3d', 'gain_rate_7d', 'gain_rate_14d',
                    'weight_std_3d', 'weight_std_7d', 'weight_std_14d', 'gain_accel', 'weight_vs_14d',
                    'flow', 'flow_roll_3d', 'flow_roll_7d', 'flow_abs_7d', 'temperature', 'temp_roll_7d',
                    'temp_roll_14d', 'humidity', 'humid_roll_7d', 'doy_sin', 'doy_cos', 'days_into_flow'
                ]

            if settings.MODEL_PATH.exists():
                self.model = joblib.load(settings.MODEL_PATH)
                self.is_loaded = True
                logger.info(f"Loaded LightGBM model successfully from {settings.MODEL_PATH}")
            else:
                logger.error(f"Model file not found at {settings.MODEL_PATH}")
                self.is_loaded = False
        except Exception as e:
            logger.error(f"Failed to load model artifacts: {e}", exc_info=True)
            self.is_loaded = False

    def build_live_features(self, history_df: pd.DataFrame) -> Tuple[Optional[pd.DataFrame], Optional[str]]:
        """
        Builds the 21 computable rolling features from chronological daily telemetry.
        Matches the training feature engineering logic to eliminate train-serve skew.
        """
        g = history_df.sort_values('timestamp').reset_index(drop=True).copy()

        n_real_days = g['weight'].notna().sum()
        if n_real_days < settings.MIN_REAL_DAYS:
            return None, f"Only {n_real_days} real day(s) of weight data, need at least {settings.MIN_REAL_DAYS}."

        g['weight_change_1d'] = g['weight'].diff()
        for w in [3, 7, 14]:
            g[f'gain_rate_{w}d'] = g['weight_change_1d'].rolling(w, min_periods=2).mean()
            g[f'weight_std_{w}d'] = g['weight_change_1d'].rolling(w, min_periods=2).std()

        g['gain_accel'] = g['gain_rate_3d'] - g['gain_rate_7d']
        g['weight_vs_14d'] = g['weight'] - g['weight'].rolling(14, min_periods=4).mean()
        g['flow_roll_3d'] = g['flow'].rolling(3, min_periods=2).mean()
        g['flow_roll_7d'] = g['flow'].rolling(7, min_periods=3).mean()
        g['flow_abs_7d'] = g['flow'].abs().rolling(7, min_periods=3).mean()
        g['temp_roll_7d'] = g['temperature'].rolling(7, min_periods=3).mean()
        g['temp_roll_14d'] = g['temperature'].rolling(14, min_periods=4).mean()
        g['humid_roll_7d'] = g['humidity'].rolling(7, min_periods=3).mean()

        doy = g['timestamp'].dt.dayofyear
        g['doy_sin'] = np.sin(2 * np.pi * doy / 365.0)
        g['doy_cos'] = np.cos(2 * np.pi * doy / 365.0)

        row = g.iloc[[-1]].copy()

        computable = [f for f in self.features if f != 'days_into_flow']
        missing_mask = row[computable].isna()
        if missing_mask.any(axis=1).iloc[0]:
            missing_cols = row[computable].columns[missing_mask.iloc[0]].tolist()
            return None, f"Feature computation failed: {missing_cols} resulted in NaN."

        return row, None

    def predict(
        self,
        history: List[DailyTelemetryReading],
        days_into_flow: int,
        hive_id: Optional[str] = "HIVE-001",
        margin: Optional[int] = None
    ) -> PredictResponse:
        """
        Executes model prediction given raw telemetry history and active flow state.
        """
        if not self.is_loaded or self.model is None:
            return PredictResponse(
                success=False,
                status="ERROR",
                hiveId=hive_id,
                message="Model is not loaded or weights artifact is missing.",
                model=settings.MODEL_VERSION
            )

        if days_into_flow < 0:
            return PredictResponse(
                success=False,
                status="INVALID_INPUT",
                hiveId=hive_id,
                message=f"days_into_flow cannot be negative. Received: {days_into_flow}",
                model=settings.MODEL_VERSION
            )

        if len(history) < settings.MIN_REAL_DAYS:
            return PredictResponse(
                success=False,
                status="INSUFFICIENT_HISTORY",
                hiveId=hive_id,
                message=f"History contains only {len(history)} record(s). A strict minimum of {settings.MIN_REAL_DAYS} continuous daily records is required.",
                model=settings.MODEL_VERSION
            )

        # Convert to DataFrame
        try:
            records = [r.model_dump() if hasattr(r, "model_dump") else dict(r) for r in history]
            df = pd.DataFrame(records)
            df['timestamp'] = pd.to_datetime(df['timestamp'])
            for col in ['weight', 'temperature', 'humidity', 'flow']:
                df[col] = pd.to_numeric(df[col], errors='coerce')
        except Exception as e:
            return PredictResponse(
                success=False,
                status="INVALID_INPUT",
                hiveId=hive_id,
                message=f"Failed to parse history telemetry data: {str(e)}",
                model=settings.MODEL_VERSION
            )

        row, err = self.build_live_features(df)
        if err:
            return PredictResponse(
                success=False,
                status="INSUFFICIENT_HISTORY",
                hiveId=hive_id,
                message=err,
                model=settings.MODEL_VERSION
            )

        row['days_into_flow'] = days_into_flow
        
        try:
            predicted_days = float(self.model.predict(row[self.features])[0])
            predicted_days_rounded = max(0, int(round(predicted_days)))
            margin_days = margin if margin is not None else settings.DEFAULT_MARGIN_DAYS
            min_days = max(0, predicted_days_rounded - margin_days)
            max_days = predicted_days_rounded + margin_days

            return PredictResponse(
                success=True,
                status="OK",
                hiveId=hive_id,
                prediction=PredictionDetails(
                    expectedHarvestWindowDays=predicted_days_rounded,
                    harvestWindowRange=f"{min_days}-{max_days} days",
                    minDays=min_days,
                    maxDays=max_days
                ),
                confidence="LOW",
                note="Typical error +/-5 days, worst observed ~19 days. Re-check daily as the flow develops.",
                model=settings.MODEL_VERSION
            )
        except Exception as e:
            logger.error(f"Inference execution failed: {e}", exc_info=True)
            return PredictResponse(
                success=False,
                status="ERROR",
                hiveId=hive_id,
                message=f"Inference computation error: {str(e)}",
                model=settings.MODEL_VERSION
            )

    def predict_direct_features(
        self,
        features: Dict[str, float],
        hive_id: Optional[str] = "HIVE-001",
        margin: Optional[int] = None
    ) -> PredictResponse:
        """
        Executes prediction directly from a 22-dimensional precomputed feature map.
        """
        if not self.is_loaded or self.model is None:
            return PredictResponse(
                success=False,
                status="ERROR",
                hiveId=hive_id,
                message="Model is not loaded or weights artifact is missing.",
                model=settings.MODEL_VERSION
            )

        missing_keys = [f for f in self.features if f not in features]
        if missing_keys:
            return PredictResponse(
                success=False,
                status="INVALID_INPUT",
                hiveId=hive_id,
                message=f"Missing required feature keys: {missing_keys}",
                model=settings.MODEL_VERSION
            )

        try:
            row_df = pd.DataFrame([{f: features[f] for f in self.features}])
            predicted_days = float(self.model.predict(row_df[self.features])[0])
            predicted_days_rounded = max(0, int(round(predicted_days)))
            margin_days = margin if margin is not None else settings.DEFAULT_MARGIN_DAYS
            min_days = max(0, predicted_days_rounded - margin_days)
            max_days = predicted_days_rounded + margin_days

            return PredictResponse(
                success=True,
                status="OK",
                hiveId=hive_id,
                prediction=PredictionDetails(
                    expectedHarvestWindowDays=predicted_days_rounded,
                    harvestWindowRange=f"{min_days}-{max_days} days",
                    minDays=min_days,
                    maxDays=max_days
                ),
                confidence="LOW",
                note="Typical error +/-5 days, worst observed ~19 days. Re-check daily as the flow develops.",
                model=settings.MODEL_VERSION
            )
        except Exception as e:
            return PredictResponse(
                success=False,
                status="ERROR",
                hiveId=hive_id,
                message=f"Direct feature inference failed: {str(e)}",
                model=settings.MODEL_VERSION
            )

    def get_sample_scenarios(self) -> Dict[str, Any]:
        """
        Generates realistic synthetic telemetry datasets representing biological flow scenarios.
        """
        def generate(
            days: int,
            start_w: float,
            gain_mean: float,
            temp: float,
            humid: float,
            flow: float,
            start_date: str = "2026-05-01",
            neg_end: bool = False,
            add_nans: bool = False,
            fluctuate: bool = False
        ):
            dates = pd.date_range(start_date, periods=days, freq="D")
            np.random.seed(42)
            gains = np.random.normal(gain_mean, 0.2 if not fluctuate else 0.8, days)
            if neg_end and days > 2:
                gains[-2:] = -0.5
            else:
                gains = np.clip(gains, -1.0, None)
            weights = start_w + np.cumsum(gains)

            history = []
            for i in range(days):
                is_nan = add_nans and (3 <= i <= 4)
                history.append({
                    "timestamp": dates[i].strftime("%Y-%m-%d"),
                    "weight": None if is_nan else round(float(weights[i]), 2),
                    "temperature": None if is_nan else round(float(np.random.normal(temp, 1.5)), 1),
                    "humidity": None if is_nan else round(float(np.clip(np.random.normal(humid, 3.0), 10, 98)), 1),
                    "flow": None if is_nan else round(float(max(0, np.random.normal(flow, 15))), 1)
                })
            return history

        return {
            "early_strong_flow": {
                "name": "Early Strong Nectar Flow (Surge)",
                "category": "flow_phases",
                "badge": "Surge",
                "description": "Rapid weight gain (~1.5 kg/day) early in the nectar flow. Model predicts a substantial harvest window remaining.",
                "hiveId": "HIVE-SURGE-01",
                "days_into_flow": 14,
                "history": generate(15, 55.0, 1.5, 25.0, 60.0, 250.0)
            },
            "peak_mid_flow": {
                "name": "Peak Mid-Season Flow (Sustained)",
                "category": "flow_phases",
                "badge": "Peak Flow",
                "description": "25 days of sustained high honey intake (~1.2 kg/day) with massive foraging traffic and optimal temperatures.",
                "hiveId": "HIVE-PEAK-02",
                "days_into_flow": 24,
                "history": generate(25, 52.0, 1.2, 26.0, 58.0, 320.0)
            },
            "plateauing_flow": {
                "name": "Plateauing Nectar Flow (Dying Flow)",
                "category": "flow_phases",
                "badge": "Harvest Imminent",
                "description": "Weight gain has ground to <0.08 kg/day after 35 days. Triggers an imminent harvest alert (0-5 days).",
                "hiveId": "HIVE-PLATEAU-03",
                "days_into_flow": 34,
                "history": generate(35, 65.0, 0.08, 28.0, 55.0, 50.0)
            },
            "heatwave_drought": {
                "name": "Extreme Heatwave & Drought Stress",
                "category": "environmental",
                "badge": "Thermal Stress",
                "description": "Searing ambient heat (40°C) with 15% humidity. Flora nectar dries up, stalling colony production and shortening the flow.",
                "hiveId": "HIVE-HEAT-04",
                "days_into_flow": 15,
                "history": generate(16, 56.0, 0.1, 40.0, 15.0, 30.0)
            },
            "monsoon_stall": {
                "name": "Monsoon / Continuous Rain Confinement",
                "category": "environmental",
                "badge": "Rain Stall",
                "description": "Continuous overcast rain with 92% humidity and chilled temperatures. Colony confined indoors; flow activity halts.",
                "hiveId": "HIVE-RAIN-05",
                "days_into_flow": 16,
                "history": generate(18, 58.0, 0.0, 17.0, 92.0, 15.0)
            },
            "autumn_late_flow": {
                "name": "Autumn Late Season Bloom",
                "category": "environmental",
                "badge": "Autumn",
                "description": "Late-season flow (September/October) with cooler temperatures (18°C) and shorter daylight hours testing seasonal day-of-year encoding.",
                "hiveId": "HIVE-AUTUMN-06",
                "days_into_flow": 12,
                "history": generate(16, 50.0, 0.6, 18.0, 68.0, 140.0, start_date="2026-09-01")
            },
            "cold_start": {
                "name": "Severe Cold Start (<6 Days Telemetry)",
                "category": "edge_cases",
                "badge": "Rejection Test",
                "description": "Only 3 days of telemetry. Gracefully fails with INSUFFICIENT_HISTORY because minimum rolling window requirements are unmet.",
                "hiveId": "HIVE-COLD-07",
                "days_into_flow": 2,
                "history": generate(3, 50.0, 0.5, 24.0, 60.0, 100.0)
            },
            "borderline_min_days": {
                "name": "Borderline Cold Start (Exact 6-Day Min)",
                "category": "edge_cases",
                "badge": "Boundary Test",
                "description": "Exactly 6 days of data. Demonstrates the strict lower threshold where rolling calculations first become computable.",
                "hiveId": "HIVE-BORDER-08",
                "days_into_flow": 5,
                "history": generate(6, 50.0, 0.5, 24.0, 60.0, 110.0)
            },
            "negative_gain": {
                "name": "Negative Gain / Store Consumption",
                "category": "edge_cases",
                "badge": "Store Drawdown",
                "description": "Weight drops at the end of the window as bees consume internal honey stores, reducing the expected harvest window.",
                "hiveId": "HIVE-CONSUME-09",
                "days_into_flow": 15,
                "history": generate(16, 60.0, 0.8, 22.0, 65.0, 150.0, neg_end=True)
            },
            "sensor_gap": {
                "name": "Intermittent Sensor Outage (Missing Days)",
                "category": "edge_cases",
                "badge": "Sensor Fault",
                "description": "Simulates IoT hardware downtime with missing values mid-sequence. Rolling aggregations bridge the sensor outage if surrounding data suffices.",
                "hiveId": "HIVE-OUTAGE-10",
                "days_into_flow": 15,
                "history": generate(16, 54.0, 0.5, 24.0, 60.0, 120.0, add_nans=True)
            }
        }


prediction_service = YieldPredictionService()
