# ---------------------------------------------------------------------------
# provider-ehr/app/cds_client.py
# ---------------------------------------------------------------------------
# Sends the CDS Hooks request to the payer and returns the parsed response.
# It also stores the last request and response in module-level state for
# the debug screens.
# ---------------------------------------------------------------------------

import httpx

from app.config import settings
from app.models import CdsHooksRequest, CdsHooksResponse

_last_request: dict | None = None
_last_response: dict | None = None


def get_last_request() -> dict | None:
    return _last_request


def get_last_response() -> dict | None:
    return _last_response


async def send_crd_request(request: CdsHooksRequest) -> CdsHooksResponse:
    global _last_request, _last_response

    url = settings.payer_crd_url + "/cds-services/crd-order-sign"
    payload = request.model_dump(by_alias=True)

    async with httpx.AsyncClient() as client:
        response = await client.post(url, json=payload, timeout=10.0)
        response.raise_for_status()

    _last_request = payload
    _last_response = response.json()

    return CdsHooksResponse.model_validate(_last_response)
