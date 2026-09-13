from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.schemas import (
    DirectFeaturesPredictRequest,
    HealthResponse,
    ModelInfoResponse,
    PredictRequest,
    PredictResponse,
)
from app.service import prediction_service

app = FastAPI(
    title=settings.PROJECT_NAME,
    description=settings.PROJECT_DESCRIPTION,
    version=settings.VERSION,
    docs_url="/docs",
    redoc_url="/redoc",
)

# Configure CORS for HoneyChain backend and web portals
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static files for testing frontend
STATIC_DIR = Path(__file__).resolve().parent / "static"
if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/", include_in_schema=False)
async def serve_index():
    """Serves the interactive validation frontend."""
    index_file = STATIC_DIR / "index.html"
    if index_file.exists():
        return FileResponse(str(index_file))
    return JSONResponse(
        content={
            "message": "HoneyChain Yield Production ML Microservice is running.",
            "docs": "/docs",
            "health": "/health"
        }
    )


@app.get("/health", response_model=HealthResponse, tags=["Monitoring"])
async def health_check() -> HealthResponse:
    """
    Service health check endpoint.
    Reports API readiness and model artifact loading state.
    """
    return HealthResponse(
        status="healthy" if prediction_service.is_loaded else "degraded",
        service=settings.PROJECT_NAME,
        version=settings.VERSION,
        model_loaded=prediction_service.is_loaded,
        model_version=settings.MODEL_VERSION,
        timestamp=datetime.now(timezone.utc).isoformat()
    )


@app.get("/model-info", response_model=ModelInfoResponse, tags=["Metadata"])
async def get_model_info() -> ModelInfoResponse:
    """
    Returns complete metadata on the trained LightGBM model, feature definitions,
    data requirements, error margins, and biological constraints.
    """
    params = {}
    if prediction_service.model is not None and hasattr(prediction_service.model, "get_params"):
        params = {k: str(v) for k, v in prediction_service.model.get_params().items()}

    return ModelInfoResponse(
        name="HoneyChain Beehive Harvest Window Predictor",
        version=settings.MODEL_VERSION,
        target="days_to_flow_end (Expected Harvest Window in days)",
        algorithm="LightGBM Regressor (LGBMRegressor)",
        hyperparameters=params,
        minimum_history_days=settings.MIN_REAL_DAYS,
        recommended_history_days=settings.RECOMMENDED_HISTORY_DAYS,
        features=prediction_service.features,
        performance_metrics={
            "validation_strategy": "Leave-One-Flow-Out Cross-Validation (LOFO-CV)",
            "mean_absolute_error_days": 5.01,
            "baseline_mae_days": 6.31,
            "typical_error_margin_days": settings.DEFAULT_MARGIN_DAYS,
            "worst_case_error_days": 19.8,
            "r2_score": 0.140
        },
        operational_guidance={
            "inference_frequency": "Run once per day at 23:59 per active hive",
            "display_recommendation": "Always display the harvestWindowRange rather than raw days",
            "flow_detection_threshold": ">= 0.20 kg/day 7-day average gain marks flow start",
            "flow_termination_threshold": "< 0.05 kg/day 7-day average gain marks flow end"
        }
    )


@app.post("/predict", response_model=PredictResponse, tags=["Inference"])
async def predict_harvest_window(request: PredictRequest) -> PredictResponse:
    """
    Main prediction endpoint for HoneyChain backend.
    Accepts daily telemetry readings and active flow duration, executes
    rolling feature transformations, and returns the expected harvest window.
    """
    response = prediction_service.predict(
        history=request.history,
        days_into_flow=request.days_into_flow,
        hive_id=request.hiveId,
        margin=request.margin
    )
    return response


@app.post("/predict/features", response_model=PredictResponse, tags=["Inference"])
async def predict_from_features(request: DirectFeaturesPredictRequest) -> PredictResponse:
    """
    Direct prediction endpoint accepting a precomputed 22-dimensional feature vector.
    Primarily intended for model evaluation, benchmarking, and unit testing.
    """
    response = prediction_service.predict_direct_features(
        features=request.features,
        hive_id=request.hiveId,
        margin=request.margin
    )
    return response


@app.get("/api/sample-data", tags=["Testing"])
async def get_sample_telemetry() -> Dict[str, Any]:
    """
    Provides pre-built biological scenario payloads for manual verification,
    frontend testing, and integration sandbox calls.
    """
    return prediction_service.get_sample_scenarios()


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "success": False,
            "status": "ERROR",
            "message": f"Internal server error: {str(exc)}",
            "model": settings.MODEL_VERSION,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
    )
