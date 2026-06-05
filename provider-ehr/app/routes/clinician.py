# ---------------------------------------------------------------------
# provider-ehr/app/routes/clinician.py
# ---------------------------------------------------------------------
# Handles all clinician-initiated routes. Returns HTML responses
# rendered via Jinja2 templates.
#
# Registered in app/main.py via:
#   app.include_router(clinician.router, tags=["clinician"])
# ---------------------------------------------------------------------

# Standard library imports
from datetime import date
import logging
import os

# Third-party imports
import httpx
from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

# App modules
from app import cds_client, fhir_factory
from app.config import settings
from app.colors import YELLOW, RESET


logger = logging.getLogger(__name__)
logger.debug(f"{YELLOW}Router Started{RESET}")

router = APIRouter()

# ---------------------------------------------------------------------------
# Templates setup
# ---------------------------------------------------------------------------
# Resolve the templates directory relative to this file's location so the
# path is correct regardless of the working directory at launch time.
# clinician.py lives at app/routes/clinician.py, so ".." steps up one level
# to app/, giving app/templates/. os.path.normpath collapses the ".." so
# the logged path is clean and readable.
# ---------------------------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TEMPLATES_DIR = os.path.normpath(os.path.join(BASE_DIR, "..", "templates"))
templates = Jinja2Templates(directory=TEMPLATES_DIR)
logger.debug(f"{YELLOW}Templates directory: {TEMPLATES_DIR}{RESET}")

# Disable Jinja2 template caching in development so edits to .html files are
# reflected immediately without restarting the server.
if settings.app_env == "development":
    templates.env.auto_reload = True


# ---------------------------------------------------------------------------
# GET /
# ---------------------------------------------------------------------------
# Clinician dashboard — the EHR simulator entry point.
# Phase 1: a minimal welcome page with a link to the demo patient chart.
# ---------------------------------------------------------------------------
@router.get("/", response_class=HTMLResponse, name="dashboard")
async def dashboard(request: Request):
    """Render the clinician dashboard."""
    logger.debug(f"{YELLOW}GET /{RESET}")

    context = {
        "app_name": settings.app_name,
        # The patient id is hardcoded in Phase 1; the dashboard links to it directly.
        "patient_id": "demo-patient-001",
    }
    return templates.TemplateResponse(request, "dashboard.html", context)


# ---------------------------------------------------------------------------
# GET /patients/{patient_id}
# ---------------------------------------------------------------------------
# Patient chart — displays demographics, active conditions, draft order,
# prior procedure history, and the CRD trigger button.
#
# Phase 1: only demo-patient-001 is supported. Any other patient_id returns
# a plain 404. All chart data is loaded from the fixture files on disk.
# ---------------------------------------------------------------------------
@router.get("/patients/{patient_id}", response_class=HTMLResponse, name="patient_chart")
async def patient_chart(request: Request, patient_id: str):
    """Render the patient chart for the given patient_id."""
    logger.debug(f"{YELLOW}GET /patients/{patient_id}{RESET}")

    if patient_id != "demo-patient-001":
        logger.warning(f"Unknown patient requested: {patient_id}")
        return HTMLResponse(content="Patient not found.", status_code=404)

    # Load each fixture file independently so the chart can display all sections.
    patient         = fhir_factory.load_fixture("patient.json")
    condition       = fhir_factory.load_fixture("condition-family-history.json")
    procedure       = fhir_factory.load_fixture("prior-colonoscopy.json")
    service_request = fhir_factory.load_fixture("service-request-colonoscopy.json")

    # Override authoredOn to today so the draft order date on the chart matches
    # what will be sent to the payer when CRD is triggered.
    today = date.today()
    service_request = {**service_request, "authoredOn": today.isoformat()}

    # Calculate the patient's current age from the FHIR birthDate field.
    # Subtract 1 if the birthday has not yet occurred this calendar year.
    birth_date = date.fromisoformat(patient["birthDate"])
    age = today.year - birth_date.year - (
        (today.month, today.day) < (birth_date.month, birth_date.day)
    )

    context = {
        "patient":          patient,
        "age":              age,
        "condition":        condition,
        "service_request":  service_request,
        "procedure":        procedure,
    }
    return templates.TemplateResponse(request, "patient_chart.html", context)


# ---------------------------------------------------------------------------
# POST /orders/colonoscopy/crd
# ---------------------------------------------------------------------------
# CRD trigger — performs the full CDS Hooks exchange with the payer.
#
# This route is invoked by the HTMX trigger button on the patient chart:
#   hx-post="/orders/colonoscopy/crd"
#   hx-target="#cds-cards-panel"
#   hx-swap="innerHTML"
#
# Steps:
#   1. Assemble the CDS Hooks order-sign request from fixture data.
#   2. POST it to the payer's CRD endpoint via the async HTTPX client.
#   3. Return the cds_cards.html partial for HTMX to insert into the page.
#
# Error handling: payer errors return 200 with an error message in the
# same partial so HTMX inserts the message inline rather than navigating
# away or leaving the panel empty.
# ---------------------------------------------------------------------------
@router.post("/orders/colonoscopy/crd", response_class=HTMLResponse, name="trigger_crd")
async def trigger_crd(request: Request):
    """Trigger the CRD exchange and return the CDS Cards HTML partial."""
    logger.debug(f"{YELLOW}POST /orders/colonoscopy/crd{RESET}")

    try:
        # Step 1: build the CDS Hooks request from FHIR fixtures.
        crd_request = fhir_factory.build_crd_request()
        logger.debug(
            f"{YELLOW}CDS Hooks request assembled "
            f"(hookInstance: {crd_request.hook_instance}){RESET}"
        )

        # Step 2: send the request to the payer and await the CDS Cards response.
        cds_response = await cds_client.send_crd_request(crd_request)
        logger.debug(
            f"{YELLOW}CDS response received: {len(cds_response.cards)} card(s){RESET}"
        )

        # Step 3: render and return the cards partial.
        return templates.TemplateResponse(
            request,
            "cds_cards.html",
            {"cards": cds_response.cards, "error": None},
        )

    except httpx.RequestError as exc:
        # Network-level failure: payer is unreachable, connection refused, or timed out.
        logger.error(f"Payer unreachable: {exc}")
        return templates.TemplateResponse(
            request,
            "cds_cards.html",
            {
                "cards": [],
                "error": (
                    f"The payer CRD service is unreachable. "
                    f"Ensure it is running at {settings.payer_crd_url}."
                ),
            },
        )

    except httpx.HTTPStatusError as exc:
        # The payer responded but with a non-2xx HTTP status code.
        logger.error(
            f"Payer returned HTTP {exc.response.status_code}: {exc.response.text}"
        )
        return templates.TemplateResponse(
            request,
            "cds_cards.html",
            {
                "cards": [],
                "error": (
                    f"The payer CRD service returned an error: "
                    f"HTTP {exc.response.status_code}."
                ),
            },
        )
