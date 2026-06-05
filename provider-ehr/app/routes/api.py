# ---------------------------------------------------------------------
# provider-ehr/app/routes/api.py
# ---------------------------------------------------------------------
# Debug JSON routes for development inspection of the CDS Hooks
# request/response cycle.
#
# All routes in this module return JSON, not HTML. They are intended
# for direct browser access or API tools (curl, Postman, etc.) during
# development and are active in all environments in Phase 1.
#
# Registered in app/main.py via:
#   app.include_router(api.router, tags=["debug"])
#
# Available endpoints:
#   GET /debug/last-crd-request   — last outgoing CDS Hooks payload
#   GET /debug/last-crd-response  — last incoming CDS Cards payload
# ---------------------------------------------------------------------

# Standard library imports
import json
import logging

# Third-party imports
from fastapi import APIRouter
from fastapi.responses import Response

# App modules
from app import cds_client
from app.colors import YELLOW, RESET


logger = logging.getLogger(__name__)
logger.debug(f"{YELLOW}Debug API router started{RESET}")

# The "/debug" prefix is applied to every route defined in this router,
# so individual route paths only need the suffix (e.g. "/last-crd-request").
router = APIRouter(prefix="/debug")


def _json_response(data: dict) -> Response:
    """Return a pretty-printed JSON response.

    FastAPI's default JSONResponse does not indent its output. Using
    json.dumps with indent=2 produces formatted JSON that is readable
    directly in a browser or terminal without a separate formatter.
    """
    return Response(
        content=json.dumps(data, indent=2),
        media_type="application/json",
    )


# ---------------------------------------------------------------------------
# GET /debug/last-crd-request
# ---------------------------------------------------------------------------
# Returns the last CDS Hooks order-sign request that was sent to the payer.
# This is the exact JSON payload that was posted, serialized with camelCase
# field names matching the CDS Hooks wire format.
#
# Returns a descriptive message object if no request has been made yet in
# the current server session (i.e. the CRD trigger has not been used).
# ---------------------------------------------------------------------------
@router.get("/last-crd-request", name="debug_last_crd_request")
async def last_crd_request():
    """Return the last outgoing CDS Hooks request payload as pretty-printed JSON."""
    logger.debug(f"{YELLOW}GET /debug/last-crd-request{RESET}")

    payload = cds_client.get_last_request()

    if payload is None:
        # No request has been sent since the server started. This is expected
        # before the clinician triggers CRD for the first time.
        return _json_response({
            "message": "No CDS Hooks request has been sent in this server session. "
                       "Trigger CRD from the patient chart to populate this endpoint."
        })

    return _json_response(payload)


# ---------------------------------------------------------------------------
# GET /debug/last-crd-response
# ---------------------------------------------------------------------------
# Returns the last CDS Cards response received from the payer. This is the
# raw parsed JSON body exactly as the payer returned it, before Pydantic
# model validation.
#
# Returns a descriptive message object if no response has been received yet.
# ---------------------------------------------------------------------------
@router.get("/last-crd-response", name="debug_last_crd_response")
async def last_crd_response():
    """Return the last incoming CDS Cards response payload as pretty-printed JSON."""
    logger.debug(f"{YELLOW}GET /debug/last-crd-response{RESET}")

    payload = cds_client.get_last_response()

    if payload is None:
        # No response has been received since the server started.
        return _json_response({
            "message": "No CDS Hooks response has been received in this server session. "
                       "Trigger CRD from the patient chart to populate this endpoint."
        })

    return _json_response(payload)
