# ---------------------------------------------------------------------
# provider-ehr/app/main.py
# ---------------------------------------------------------------------
# Run from provider-ehr root folder:
#       Command: uvicorn app.main:app --reload --port 8000
#    Access via: localhost:8000
#   Stop server: CTRL + C
# ---------------------------------------------------------------------

"""Starting point for FastAPI application instance."""

# Standard library imports
import logging
import os

# Third-party library imports
from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles

# App settings and colors
from app.config import settings
from app.colors import YELLOW, RESET

# Configure Python logging
# Set root logger to use log_level specified in settings object
logging.basicConfig(
    level=settings.log_level.upper(),
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)

logger = logging.getLogger(__name__)

# Print debug info to Uvicorn terminal
print("-" * 60)
print("        APP_NAME:", settings.app_name)
print(" APP_DESCRIPTION:", settings.app_description)
print("     APP_VERSION:", settings.app_version)
print("         APP_ENV:", settings.app_env)
print("    DEBUG STATUS:", settings.app_debug)
print("-" * 60)

# Router imports
from app.routes import api, clinician

# Initialize FastAPI app
app = FastAPI(
    title=settings.app_name,
    description=settings.app_description,
    version=settings.app_version,
    debug=settings.app_debug
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
logger.debug(f"{YELLOW}base directory: {BASE_DIR}{RESET}")

# Mount static files directory
app.mount("/static", StaticFiles(directory=os.path.join(BASE_DIR, "static")), name="static")
logger.debug(f"{YELLOW}static directory: {os.path.join(BASE_DIR, "static")}{RESET}")

# Register routers
app.include_router(clinician.router, tags=["clinician"])
app.include_router(api.router, tags=["debug"])
