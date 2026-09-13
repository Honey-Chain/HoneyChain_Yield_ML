from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field, field_validator


class DailyTelemetryReading(BaseModel):
    timestamp: str = Field(
        ...,
        description="Date or ISO timestamp of the reading (e.g. '2026-05-01' or '2026-05-01T00:00:00Z')",
        examples=["2026-05-01"]
    )
    weight: Optional[float] = Field(
        default=None,
        description="Daily average hive weight in kilograms (kg)",
        ge=0.0,
        le=200.0,
        examples=[54.2]
    )
    temperature: Optional[float] = Field(
        default=None,
        description="Daily mean ambient temperature in degrees Celsius (°C)",
        ge=-40.0,
        le=60.0,
        examples=[23.5]
    )
    humidity: Optional[float] = Field(
        default=None,
        description="Daily mean relative humidity percentage (%)",
        ge=0.0,
        le=100.0,
        examples=[65.0]
    )
    flow: Optional[float] = Field(
        default=None,
        description="Daily total bee entry/exit traffic count",
        examples=[180.0]
    )


class PredictRequest(BaseModel):
    hiveId: Optional[str] = Field(
        default="HIVE-001",
        description="Unique identifier of the beehive",
        examples=["HIVE-KV-201"]
    )
    days_into_flow: int = Field(
        ...,
        description="Number of days the active nectar flow has been running (tracked by backend)",
        ge=0,
        examples=[14]
    )
    history: List[DailyTelemetryReading] = Field(
        ...,
        min_length=1,
        description="Chronological sequence of continuous daily telemetry records ending today (min 6 required, 14+ recommended)"
    )
    margin: Optional[int] = Field(
        default=5,
        description="Error margin in days to compute harvest window boundary range",
        ge=1,
        le=15
    )

    @field_validator("days_into_flow")
    @classmethod
    def validate_days_into_flow(cls, v: int) -> int:
        if v < 0:
            raise ValueError("days_into_flow cannot be negative")
        return v


class DirectFeaturesPredictRequest(BaseModel):
    hiveId: Optional[str] = Field(default="HIVE-001", description="Unique identifier of the beehive")
    features: Dict[str, float] = Field(
        ...,
        description="Pre-calculated 22-dimensional feature vector"
    )
    margin: Optional[int] = Field(default=5, ge=1, le=15)


class PredictionDetails(BaseModel):
    expectedHarvestWindowDays: int = Field(
        ...,
        description="Expected remaining days until harvest / flow conclusion",
        examples=[12]
    )
    harvestWindowRange: str = Field(
        ...,
        description="Recommended operational harvest window range in days (e.g. '7-17 days')",
        examples=["7-17 days"]
    )
    minDays: int = Field(
        ...,
        description="Lower bound of expected harvest window",
        examples=[7]
    )
    maxDays: int = Field(
        ...,
        description="Upper bound of expected harvest window",
        examples=[17]
    )


class PredictResponse(BaseModel):
    success: bool = Field(..., description="Whether prediction succeeded or failed")
    status: str = Field(..., description="Status code: OK, INSUFFICIENT_HISTORY, INVALID_INPUT, or ERROR")
    hiveId: Optional[str] = Field(default=None, description="Hive identifier")
    prediction: Optional[PredictionDetails] = Field(
        default=None,
        description="Prediction result details when status is OK"
    )
    confidence: Optional[str] = Field(
        default="LOW",
        description="Confidence indicator (LOW as dictated by Leave-One-Flow-Out CV error bounds)"
    )
    note: Optional[str] = Field(
        default=None,
        description="Biological and operational guidance for the beekeeper"
    )
    message: Optional[str] = Field(
        default=None,
        description="Detailed diagnostic or error message"
    )
    model: str = Field(default="yield-production-v1", description="Model identifier and version tag")
    timestamp: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat(),
        description="Inference timestamp (UTC)"
    )


class HealthResponse(BaseModel):
    status: str = Field(..., examples=["healthy"])
    service: str = Field(..., examples=["HoneyChain Yield Production ML Microservice"])
    version: str = Field(..., examples=["1.0.0"])
    model_loaded: bool = Field(..., examples=[True])
    model_version: str = Field(..., examples=["yield-production-v1"])
    timestamp: str = Field(...)


class ModelInfoResponse(BaseModel):
    name: str
    version: str
    target: str
    algorithm: str
    hyperparameters: Dict[str, Any]
    minimum_history_days: int
    recommended_history_days: int
    features: List[str]
    performance_metrics: Dict[str, Any]
    operational_guidance: Dict[str, Any]
