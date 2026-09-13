import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

class Settings:
    PROJECT_NAME: str = "HoneyChain Yield Production ML Microservice"
    PROJECT_DESCRIPTION: str = (
        "REST API serving the HoneyChain Harvest Window Prediction LightGBM Model"
    )
    VERSION: str = "1.0.0"
    MODEL_VERSION: str = "yield-production-v1"
    
    HOST: str = os.getenv("HOST", "0.0.0.0")
    PORT: int = int(os.getenv("PORT", "5002"))
    DEBUG: bool = os.getenv("DEBUG", "false").lower() in ("true", "1", "yes")
    
    MODEL_PATH: Path = BASE_DIR / os.getenv("MODEL_PATH", "harvest_window_lgbm.pkl")
    FEATURE_CONFIG_PATH: Path = BASE_DIR / os.getenv("FEATURE_CONFIG_PATH", "feature_config.json")
    
    # Biological telemetry boundaries
    MIN_REAL_DAYS: int = 6
    RECOMMENDED_HISTORY_DAYS: int = 14
    DEFAULT_MARGIN_DAYS: int = 5
    
    # CORS configuration
    ALLOWED_ORIGINS: list[str] = [
        origin.strip() for origin in os.getenv("CORS_ORIGINS", "*").split(",") if origin.strip()
    ]

settings = Settings()
