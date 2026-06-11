# ------------------------------------------------------------------------------
# provider-ehr/app/fhir_factory.py
# ------------------------------------------------------------------------------
# Factory module to read fixture files, composes FHIR data structures from them,
# and returns a populated CdsHooksRequest instance read to be sent to payer.
# ------------------------------------------------------------------------------

import json
import uuid
from datetime import date
from pathlib import Path

from app.models import CdsHooksContext, CdsHooksRequest

_FIXTURES_DIR = Path(__file__).parent / "fixtures"


def load_fixture(filename: str) -> dict:
    path = _FIXTURES_DIR / filename
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        raise FileNotFoundError(f"Fixture file not found: {path}")
    except json.JSONDecodeError as exc:
        raise ValueError(f"Fixture file is not valid JSON: {path}: {exc}") from exc


def build_draft_orders_bundle(service_request: dict) -> dict:
    return {
        "resourceType": "Bundle",
        "type": "collection",
        "entry": [{"resource": service_request}],
    }


def build_conditions_bundle(condition: dict) -> dict:
    return {
        "resourceType": "Bundle",
        "type": "searchset",
        "total": 1,
        "entry": [{"resource": condition}],
    }


def build_procedures_bundle(procedure: dict) -> dict:
    return {
        "resourceType": "Bundle",
        "type": "searchset",
        "total": 1,
        "entry": [{"resource": procedure}],
    }


def build_crd_request() -> CdsHooksRequest:
    patient = load_fixture("patient.json")
    condition = load_fixture("condition-family-history.json")
    service_request = load_fixture("service-request-colonoscopy.json")
    procedure = load_fixture("prior-colonoscopy.json")
    coverage = load_fixture("coverage.json")

    service_request = {**service_request, "authoredOn": date.today().isoformat()}

    context = CdsHooksContext(
        user_id="PractitionerRole/demo-clinician",
        patient_id="demo-patient-001",
        encounter_id="demo-encounter-001",
        draft_orders=build_draft_orders_bundle(service_request),
    )

    prefetch = {
        "patient": patient,
        "conditions": build_conditions_bundle(condition),
        "coverage": coverage,
        "priorProcedures": build_procedures_bundle(procedure),
    }

    return CdsHooksRequest(
        hook="order-sign",
        hook_instance=str(uuid.uuid4()),
        fhir_server="http://localhost:8000/fhir",
        context=context,
        prefetch=prefetch,
    )
