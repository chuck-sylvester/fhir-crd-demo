# ---------------------------------------------------------------------------
# provider-ehr/app/models.py
# ---------------------------------------------------------------------------
# Pydantic data models that represent the structures described in the API
# contract. Models are used by fhir_factory.py when assembling the outgoing
# requests and by cds_client.py when parsing the incoming response.

# Third-party dependencies
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


# ---- Outgoing Request Models ----

class CdsHooksContext(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    user_id: str          # FHIR reference of ordering clinician
    patient_id: str       # FHIR logical id of patient
    encounter_id: str | None = None  # Optional; FHIR encounter id
    draft_orders: dict    # FHIR Bundle containing draft ServiceRequest


class CdsHooksRequest(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    hook: str                  # Always "order-sign" for this project
    hook_instance: str         # UUID generated fresh for each CRD invocation
    fhir_server: str | None = None  # Placeholder EHR FHIR endpoint URL
    context: CdsHooksContext   # A CdsHooksContext instance (a nested model)
    prefetch: dict      # Dictionary of prefetched FHIR resources keyed by name


# ---- Incoming Response Models ----

class CdsSource(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    label: str
    url: str | None = None


class CdsLink(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    label: str
    url: str
    type: str


class CdsCard(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    summary: str
    indicator: str
    source: CdsSource
    detail: str | None = None
    links: list[CdsLink] = []


class CdsHooksResponse(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    cards: list[CdsCard]
