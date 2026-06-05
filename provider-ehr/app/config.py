# -----------------------------------------------------------------
# provider_ehr/app/config.py
# -----------------------------------------------------------------
# FastAPI application configuration using Pydantic
# -----------------------------------------------------------------

from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings (BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Application
    app_name: str = "Provider EHR (Python)"
    app_description: str = "app description"
    app_version: str = "0.0.0.0"
    app_env: str = "development"

    # Logging
    log_level: str = "INFO"

    # Debug Settings
    app_debug: bool = True

    # Payer CRD Info
    payer_crd_url: str

# Module-level singleton - instantiated once when module is first imported
settings = Settings()