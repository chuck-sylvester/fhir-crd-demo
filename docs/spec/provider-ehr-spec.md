# Provider EHR Simulator — Design Specification

## Phase 1: Minimal End-to-End CRD Demo

---

## 1. Overview

The Provider EHR Simulator is a Python web application that plays the role of an Electronic Health Record system in the CRD workflow. It gives a simulated clinician a patient chart view, a draft colonoscopy order interface, and a panel that displays CDS guidance cards returned by the payer.

**The application acts as a CDS Hooks client.** When the clinician triggers coverage requirements discovery, the EHR assembles a CDS Hooks **`order-sign`** request and posts it to the Bun + Hono Payer CRD Service, receives CDS Cards in response, and renders those cards inside the clinical workflow.  

In Phase 1, the FHIR resources included in the **`order-sign`** request — the patient record, active conditions, draft order, prior procedure history, and coverage information — are read from pre-authored JSON files on disk (called fixtures) rather than from a live clinical database or a FHIR server.

**Payload contract reference:** `docs/spec/cds-hooks-api-contract.md`

---

## 2. Phase 1 Scope and Deliverables

| # | Deliverable |
|---|-------------|
| 1 | Patient chart screen displaying the demo patient and the draft colonoscopy order |
| 2 | CRD trigger button that posts to the payer and renders returned CDS Cards inline |
| 3 | Debug screens that expose the last outgoing CDS Hooks request and the last incoming response |
| 4 | FHIR fixture files for Patient, Condition, ServiceRequest, Procedure, and Coverage |
| 5 | Unit tests for fixture loading and CDS Hooks request assembly |
| 6 | Integration test for the CDS client using a mocked payer response |

**Phase 1 acceptance criteria:**

- `GET /patients/demo-patient-001` renders the patient chart without error
- `POST /orders/colonoscopy/crd` contacts the payer, receives CDS Cards, and displays them in the page
- `GET /debug/last-crd-request` returns the JSON payload sent to the payer
- `GET /debug/last-crd-response` returns the JSON cards response received from the payer
- All pytest tests pass

---

## 3. Technology Stack and Dependencies

| Package | Purpose |
|---------|---------|
| `fastapi` | Web framework; routing and ASGI server integration |
| `uvicorn` | ASGI server used to run the FastAPI application |
| `httpx` | Async HTTP client; used at runtime for CDS Hooks requests and in tests via ASGI transport |
| `jinja2` | Server-side HTML templating |
| `aiofiles` | Required by FastAPI for serving static files asynchronously |
| `pydantic` | Data models and validation for CDS Hooks structures |
| `pydantic-settings` | Environment-based configuration loading, including `.env` file support |
| `python-dotenv` | Supplemental `.env` parsing for contexts outside pydantic-settings |
| `pytest` | Test runner |
| `pytest-asyncio` | Async test support |

All dependencies are listed in `requirements.txt` at the root of `provider-ehr/`. Pin versions for reproducibility.

---

## 4. Project Structure

```text
provider-ehr/
|-- app/
|   |-- __init__.py              # Empty package marker
|   |-- main.py                  # FastAPI application factory and startup
|   |-- config.py                # Environment-based settings; module-level settings singleton
|   |-- models.py                # Pydantic models for CDS Hooks structures
|   |-- fhir_factory.py          # Loads fixtures and assembles the CDS Hooks payload
|   |-- cds_client.py            # Sends the CDS Hooks request to the payer via HTTPX
|   |-- colors.py                # ANSI color codes for development terminal output
|   |-- routes/
|   |   |-- clinician.py         # Clinician-facing HTML routes; owns Jinja2Templates setup
|   |   |-- api.py               # Debug JSON routes
|   |-- templates/
|   |   |-- base.html            # HTML layout shell; loads Tailwind and HTMX via CDN
|   |   |-- dashboard.html       # Clinician dashboard (GET /)
|   |   |-- patient_chart.html   # Patient chart and order panel
|   |   |-- cds_cards.html       # CDS Cards partial for HTMX insertion
|   |-- static/
|   |   |-- css/                 # Reserved for future compiled Tailwind output (empty in Phase 1)
|   |   |-- js/                  # Reserved for future local JS assets (empty in Phase 1)
|   |-- fixtures/
|       |-- patient.json
|       |-- condition-family-history.json
|       |-- service-request-colonoscopy.json
|       |-- prior-colonoscopy.json
|       |-- coverage.json
|-- tests/
|   |-- __init__.py
|   |-- test_fhir_factory.py     # Fixture loading and payload assembly
|   |-- test_cds_client.py       # CDS client with mocked payer
|   |-- test_routes.py           # Route smoke tests
|-- .env                         # Local configuration (not committed)
|-- .env.example                 # Committed template of required keys
|-- requirements.txt
|-- Dockerfile
```

---

## 5. Environment Configuration

### 5.1 `.env.example`

Document these required keys (no values):

| Key | Description |
|-----|-------------|
| `APP_NAME` | Application display name, e.g. `Provider EHR (Python)` |
| `APP_DESCRIPTION` | Short description of the application |
| `APP_VERSION` | Application version string, e.g. `0.1.0` |
| `APP_ENV` | Runtime environment label: `development` or `production` |
| `APP_DEBUG` | Enable FastAPI debug mode: `true` or `false` |
| `LOG_LEVEL` | Logging verbosity: `DEBUG`, `INFO`, `WARNING` |
| `PAYER_CRD_URL` | Base URL of the Bun + Hono Payer CRD Service, e.g. `http://localhost:8080` |

### 5.2 `config.py`

Define a Pydantic `Settings` class backed by `pydantic-settings`. It reads from environment variables and the `.env` file.

Fields to expose:

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `app_name` | `str` | `Provider EHR (Python)` | Application display name |
| `app_description` | `str` | `app description` | Short application description |
| `app_version` | `str` | `0.0.0.0` | Application version string |
| `app_env` | `str` | `development` | Runtime environment |
| `app_debug` | `bool` | `True` | FastAPI debug mode flag |
| `log_level` | `str` | `INFO` | Log level string |
| `payer_crd_url` | `str` | — | Base URL of the payer service; no trailing slash; required with no default |

Expose a module-level `settings` instance so other modules import `from app.config import settings` without instantiating `Settings` themselves.

---

## 6. Data Models (`models.py`)

Define Pydantic models that represent the structures described in the API contract. Models are used by `fhir_factory.py` when assembling the outgoing request and by `cds_client.py` when parsing the incoming response.

### 6.1 Field Naming Convention

#### The Problem

CDS Hooks is a JSON protocol. Its specification defines all field names in camelCase: `hookInstance`, `patientId`, `draftOrders`, `fhirServer`. Python's PEP 8 style guide requires attribute names to use snake_case: `hook_instance`, `patient_id`, `draft_orders`, `fhir_server`. These two conventions directly conflict. A Pydantic model must bridge them: Python code should use Python-style names, but JSON serialization must produce the wire format the payer expects.

Not all fields in these models are affected. Fields whose camelCase and snake_case representations are identical — `hook`, `label`, `url`, `type`, `summary`, `indicator`, `detail` — require no special treatment. The fields that do differ are:

| Python snake_case | CDS Hooks JSON camelCase |
|-------------------|--------------------------|
| `hook_instance` | `hookInstance` |
| `fhir_server` | `fhirServer` |
| `user_id` | `userId` |
| `patient_id` | `patientId` |
| `encounter_id` | `encounterId` |
| `draft_orders` | `draftOrders` |

#### Options

**Option A — camelCase field names directly on the model**

Name the Pydantic attributes in camelCase to match the JSON wire format exactly. No alias configuration is needed. Serialization and parsing work correctly by default.

| Pros | Cons |
|------|------|
| Simplest implementation; no alias setup | Violates PEP 8 — camelCase attributes are unconventional in Python |
| Field names map directly to the API contract | Linters will warn about naming violations |
| Easiest to trace between code and spec | Inconsistent with the rest of the Python codebase |

---

**Option B — snake_case field names with explicit `Field(alias=...)` declarations**

Name each attribute in snake_case and attach an explicit `alias` argument declaring the corresponding camelCase JSON key. Requires `model_config = ConfigDict(populate_by_name=True)` so the model can be used with either name.

| Pros | Cons |
|------|------|
| PEP 8 compliant | Verbose — every affected field needs a manual alias declaration |
| Very explicit — the JSON name is visible right next to the Python name | Two names per field can be confusing when reading the code |
| No framework "magic" | Boilerplate grows if more models are added |

---

**Option C — snake_case field names with `alias_generator=to_camel`**

Name all attributes in snake_case. Configure each model class with `alias_generator=to_camel` from `pydantic.alias_generators`. Pydantic automatically derives the camelCase JSON alias for every field at class definition time — no per-field alias declarations are needed. Requires `populate_by_name=True` on the model config so that snake_case names can also be used when constructing model instances from within Python code.

| Pros | Cons |
|------|------|
| PEP 8 compliant throughout | Requires understanding that `user_id` becomes `userId` in JSON |
| Clean — no per-field alias boilerplate | One model_config block required per model class |
| Scales naturally — new fields require no alias work | Slightly less obvious to a reader unfamiliar with alias generators |
| Idiomatic Pydantic v2 pattern used in production codebases | |

---

#### Selected Approach: Option C

This project uses **Option C** — snake_case field names with `alias_generator=to_camel`.

Rationale:

- It produces correct, standards-compliant JSON without any per-field declarations.
- It follows Python naming conventions throughout, keeping the codebase consistent.
- It introduces a real Pydantic v2 pattern (`alias_generator`) that is directly transferable to professional Python API development.
- The `to_camel` function from `pydantic.alias_generators` is a first-party, well-tested utility that handles all the field names in this project correctly.

Every model class that serializes to or parses from the CDS Hooks wire format must include the following model configuration:

```
model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)
```

`populate_by_name=True` allows model instances to be constructed using either the snake_case Python name or the camelCase alias. This is important because `fhir_factory.py` constructs models using Python attribute names, while `cds_client.py` parses JSON responses that arrive with camelCase keys.

The field tables in Sections 6.2 and 6.3 list attributes by their **Python snake_case name**. The corresponding JSON key is the `to_camel` conversion of that name. For fields where the two forms are identical the distinction is irrelevant.

---

### 6.2 Outgoing Request Models

| Model | Purpose |
|-------|---------|
| `CdsHooksRequest` | Top-level request envelope |
| `CdsHooksContext` | The `context` object within the request |

**`CdsHooksContext` fields:**

| Python attribute | JSON key (alias) | Type | Notes |
|-----------------|-----------------|------|-------|
| `user_id` | `userId` | `str` | |
| `patient_id` | `patientId` | `str` | |
| `encounter_id` | `encounterId` | `str \| None` | Optional |
| `draft_orders` | `draftOrders` | `dict` | Raw FHIR Bundle; not further validated in Phase 1 |

**`CdsHooksRequest` fields:**

| Python attribute | JSON key (alias) | Type | Notes |
|-----------------|-----------------|------|-------|
| `hook` | `hook` | `str` | Always `"order-sign"` |
| `hook_instance` | `hookInstance` | `str` | UUID generated at request time |
| `fhir_server` | `fhirServer` | `str \| None` | Optional |
| `context` | `context` | `CdsHooksContext` | |
| `prefetch` | `prefetch` | `dict` | Keys and values as specified in the API contract |

### 6.3 Incoming Response Models

All response model field names are identical in Python and in JSON — no aliasing is needed. The `alias_generator` configuration must still be present on each model class for consistency, but it has no practical effect on these fields.

| Model | Purpose |
|-------|---------|
| `CdsSource` | The `source` object within a card |
| `CdsLink` | A single link within a card |
| `CdsCard` | A single CDS Card |
| `CdsHooksResponse` | Top-level response envelope |

**`CdsSource` fields:**

| Field | Type | Notes |
|-------|------|-------|
| `label` | `str` | |
| `url` | `str \| None` | Optional |

**`CdsLink` fields:**

| Field | Type | Notes |
|-------|------|-------|
| `label` | `str` | |
| `url` | `str` | |
| `type` | `str` | `"absolute"` or `"smart"` |

**`CdsCard` fields:**

| Field | Type | Notes |
|-------|------|-------|
| `summary` | `str` | |
| `indicator` | `str` | `"info"`, `"warning"`, or `"critical"` |
| `source` | `CdsSource` | |
| `detail` | `str \| None` | Optional; Markdown |
| `links` | `list[CdsLink]` | Defaults to empty list |

**`CdsHooksResponse` fields:**

| Field | Type | Notes |
|-------|------|-------|
| `cards` | `list[CdsCard]` | |

---

## 7. FHIR Fixtures

Each file in `app/fixtures/` is a static JSON file representing one FHIR R4 resource. All field values must match the demo scenario fixed values defined in `docs/spec/cds-hooks-api-contract.md` Section 7.

### 7.1 `patient.json`

A FHIR `Patient` resource. Required fields: `resourceType`, `id`, `gender`, `birthDate`, `name`. Also includes `text` (FHIR Narrative with `status: generated`) and `identifier` (Medical Record Number using HL7 v2 table 0203 code `MR`).

### 7.2 `condition-family-history.json`

A FHIR `Condition` resource. The ICD-10-CM code must be `Z80.0`. Include `clinicalStatus`, `verificationStatus`, `code`, and `subject`. See API contract Section 5.3 for exact coding values.

### 7.3 `service-request-colonoscopy.json`

A FHIR `ServiceRequest` resource. Status must be `draft`, intent must be `order`. CPT code must be `45378`. The `authoredOn` field may be a fixed date in the fixture; the factory may override it dynamically.

### 7.4 `prior-colonoscopy.json`

A FHIR `Procedure` resource. Status must be `completed`. CPT code must be `45378`. The `performedDateTime` must be set to a date exactly 5 years before the date used for `authoredOn` in the ServiceRequest.

### 7.5 `coverage.json`

A FHIR `Coverage` resource. Status must be `active`. Beneficiary reference must point to `Patient/demo-patient-001`. Payor display must be `Demo Payer CRD Inc.`

---

## 8. FHIR Factory (`fhir_factory.py`)

`fhir_factory.py` is responsible for loading the fixture files and assembling the CDS Hooks request payload. It has no side effects; it reads from disk and returns structured data.

### 8.1 Responsibilities

- Load all fixture JSON files from `app/fixtures/` at call time (not at import time)
- Assemble the `draftOrders` FHIR Bundle from the ServiceRequest fixture
- Assemble the `prefetch` dictionary from the Patient, Condition, Procedure, and Coverage fixtures
- Wrap multi-resource prefetch entries (conditions, priorProcedures) in FHIR Bundle objects
- Populate the `hookInstance` with a fresh UUID
- Return a fully populated `CdsHooksRequest` model instance

### 8.2 Functions

**`load_fixture(filename: str) -> dict`**

Reads and JSON-parses a single fixture file from `app/fixtures/`. Returns the parsed dictionary. Raises a descriptive error if the file is missing or malformed.

**`build_draft_orders_bundle(service_request: dict) -> dict`**

Constructs a FHIR Bundle of type `collection` wrapping the provided ServiceRequest resource. Returns the bundle as a dictionary.

**`build_conditions_bundle(condition: dict) -> dict`**

Constructs a FHIR Bundle of type `searchset` wrapping the provided Condition resource. Sets `total` to 1. Returns the bundle as a dictionary.

**`build_procedures_bundle(procedure: dict) -> dict`**

Constructs a FHIR Bundle of type `searchset` wrapping the provided Procedure resource. Sets `total` to 1. Returns the bundle as a dictionary.

**`build_crd_request() -> CdsHooksRequest`**

The primary public function. Calls the loader and bundle-builder functions, sets the fixed context values from `docs/spec/cds-hooks-api-contract.md` Section 7, generates a UUID for `hookInstance`, sets `fhirServer` to `http://localhost:8000/fhir` as a placeholder representing the EHR's own FHIR endpoint (the payer does not dereference it in Phase 1), and returns a populated `CdsHooksRequest` instance.

---

## 9. CDS Client (`cds_client.py`)

`cds_client.py` sends the CDS Hooks request to the payer and returns the parsed response. It also stores the last request and response in module-level state for the debug screens.

### 9.1 Responsibilities

- Accept a `CdsHooksRequest` model instance
- Post it as JSON to the payer's CRD endpoint (`settings.payer_crd_url + "/cds-services/crd-order-sign"`)
- Parse the response body into a `CdsHooksResponse` model instance
- Store the serialized request and response in module-level state
- Raise a meaningful exception if the payer is unreachable or returns a non-200 status

### 9.2 Module-Level State

Declare two module-level variables to hold the last request and response payloads for the debug routes. Initialize both to `None`.

| Variable | Type | Purpose |
|----------|------|---------|
| `_last_request` | `dict \| None` | The last outgoing request as a serialized dictionary |
| `_last_response` | `dict \| None` | The last incoming response as a parsed dictionary |

### 9.3 Functions

**`async def send_crd_request(request: CdsHooksRequest) -> CdsHooksResponse`**

Serializes the request model to a JSON-compatible dictionary, posts it via HTTPX to the payer endpoint with a reasonable timeout (10 seconds), updates `_last_request` and `_last_response`, and returns the parsed `CdsHooksResponse`. Raises `httpx.RequestError` if the payer is unreachable and `httpx.HTTPStatusError` if the payer returns a non-2xx response.

**`def get_last_request() -> dict | None`**

Returns the `_last_request` module-level variable.

**`def get_last_response() -> dict | None`**

Returns the `_last_response` module-level variable.

---

## 10. HTTP Routes

### 10.1 Clinician Routes (`routes/clinician.py`)

These routes render HTML responses using Jinja2 templates.

---

**`GET /`** — Dashboard

Returns the clinician dashboard. For Phase 1 this is a simple page with a link to the demo patient chart. No dynamic content required beyond confirming the app is running.

Template: `dashboard.html`

---

**`GET /patients/{patient_id}`** — Patient Chart

Loads the patient fixture and renders the full patient chart. In Phase 1, `patient_id` is always `demo-patient-001`; no lookup logic is needed. The route may hard-redirect any other patient id to the demo patient or return a 404.

The chart displays:
- Patient name, age, and gender derived from the fixture
- The active condition (family history of colorectal cancer)
- The draft colonoscopy order summary
- The prior procedure history (most recent colonoscopy with performed date and elapsed years)
- A "Check Coverage Requirements" trigger button that initiates the CRD flow

The CRD trigger is an HTMX-enhanced button. When clicked it issues an HTTP POST to `/orders/colonoscopy/crd` and swaps the response HTML into a designated target element on the page (the CDS Cards panel).

Template: `patient_chart.html`

---

**`POST /orders/colonoscopy/crd`** — Trigger CRD

This route performs the end-to-end CRD exchange:

1. Calls `fhir_factory.build_crd_request()` to assemble the CDS Hooks request
2. Calls `cds_client.send_crd_request()` to post it to the payer
3. Receives the `CdsHooksResponse`
4. Renders and returns the `cds_cards.html` partial with the card data

The response is an HTML partial, not a full page. HTMX inserts this partial into the CDS Cards panel on the patient chart page without a full page reload.

If the payer is unreachable or returns an error, the route returns an error message fragment (also an HTML partial) suitable for HTMX insertion in the same target panel.

Template: `cds_cards.html` (partial, not extending `base.html`)

---

### 10.2 Debug Routes (`routes/api.py`)

These routes return JSON responses for development inspection. They should be active in all environments in Phase 1.

---

**`GET /debug/last-crd-request`**

Returns the last outgoing CDS Hooks request payload as pretty-printed JSON. If no request has been made yet in the current server session, returns a JSON object with a `message` field explaining that no request has been sent.

---

**`GET /debug/last-crd-response`**

Returns the last incoming CDS Hooks response payload as pretty-printed JSON. If no response has been received yet, returns a similar informational message.

---

## 11. Templates

Templates use Jinja2 syntax. Tailwind CSS is applied for styling via CDN link in `base.html`. HTMX is loaded via CDN link in `base.html`.

### 11.1 `base.html`

The layout shell. Defines the HTML document structure, the `<head>` block with meta tags and CSS and JavaScript CDN links, a simple navigation bar, and a `content` block that child templates override.

### 11.2 `dashboard.html`

Extends `base.html`. The clinician entry point. Displays a status badge confirming the application is running, the application name and description, and a link to the demo patient chart. Provides a clear Phase 1 scope note.

### 11.3 `patient_chart.html`

Extends `base.html`. Displays the following sections:

**Patient header:** Name, date of birth, age (calculated from birth date and current date), and gender.

**Conditions panel:** A list of active conditions. For Phase 1, shows the family history condition with its ICD-10-CM code and display text.

**Draft order panel:** A summary of the pending colonoscopy ServiceRequest, including the CPT code, description, and authored date.

**Prior procedure panel:** A summary of the most recent prior colonoscopy including the performed date and elapsed years.

**CDS trigger section:** A clearly labeled button labeled "Check Coverage Requirements" or similar. This button carries HTMX attributes:
- `hx-post` set to `/orders/colonoscopy/crd`
- `hx-target` set to the CSS selector of the CDS Cards panel `div`
- `hx-swap` set to `innerHTML`
- `hx-indicator` pointing to a loading spinner element

Below the button, a container `div` serves as the HTMX swap target for the CDS Cards partial.

### 11.4 `cds_cards.html`

A partial template — it does not extend `base.html`. It is returned directly by the `POST /orders/colonoscopy/crd` route and inserted into the patient chart by HTMX.

Renders a list of CDS Cards. Each card displays:
- A colored indicator badge (`info` = blue, `warning` = yellow, `critical` = red) matching the card's `indicator` value
- The `summary` text prominently
- The `detail` text rendered as Markdown if present (use a Jinja2 filter or render as preformatted text in Phase 1)
- The `source.label` and `source.url` as a small attribution line
- Any `links` as clickable anchor tags opening in a new tab

If the cards list is empty, display a neutral message indicating that the payer returned no guidance for this order.

---

## 12. Application Entry Point (`main.py`)

`main.py` creates and configures the FastAPI application instance. It is the only file that wires all components together.

Responsibilities:

- Configure Python logging before importing any application modules
- Create the FastAPI application instance with a title, description, and version
- Mount the `app/static/` directory at the `/static` URL path
- Register the clinician router from `routes/clinician.py`
- Register the API/debug router from `routes/api.py`

Jinja2 template configuration belongs in `routes/clinician.py`, not in `main.py`, to avoid circular imports between the application factory and the router modules.

The `main.py` file should contain no business logic. All logic belongs in the modules it imports.

---

## 13. CRD Integration Data Flow

The following sequence describes what happens at runtime when the clinician clicks the CRD trigger:

1. The browser sends `POST /orders/colonoscopy/crd` via HTMX
2. `clinician.py` handles the route
3. `fhir_factory.build_crd_request()` is called:
   - Loads all five fixture files from disk
   - Wraps ServiceRequest in a draftOrders Bundle
   - Wraps Condition in a conditions Bundle
   - Wraps Procedure in a priorProcedures Bundle
   - Generates a UUID for hookInstance
   - Returns a `CdsHooksRequest` model
4. `cds_client.send_crd_request(request)` is called:
   - Serializes the model to a JSON dictionary
   - Stores it in `_last_request`
   - Posts it to `{PAYER_CRD_URL}/cds-services/crd-order-sign` via HTTPX
   - Parses the response into `CdsHooksResponse`
   - Stores it in `_last_response`
   - Returns the parsed response
5. The route passes the cards list to `cds_cards.html` and renders it
6. The rendered partial HTML is returned to the browser
7. HTMX inserts the HTML into the CDS Cards panel

---

## 14. Testing

### 14.1 `tests/test_fhir_factory.py`

| Test | What it verifies |
|------|-----------------|
| Fixture files exist and are valid JSON | Each fixture file loads without error |
| `build_crd_request` returns a `CdsHooksRequest` | The return type is correct |
| `hook` field is `order-sign` | Fixed field value is set correctly |
| `context.patientId` matches the fixture | Patient id flows through correctly |
| `draftOrders` is a FHIR Bundle of type `collection` | Bundle wrapping is correct |
| `prefetch.conditions` is a FHIR Bundle of type `searchset` | Bundle wrapping is correct |
| `prefetch.priorProcedures` is a FHIR Bundle of type `searchset` | Bundle wrapping is correct |
| Condition code in prefetch is `Z80.0` | Fixture content is preserved |
| Procedure CPT code in prefetch is `45378` | Fixture content is preserved |

### 14.2 `tests/test_cds_client.py`

Use `pytest-asyncio` and HTTPX's built-in `MockTransport` to mock the payer endpoint. Do not make real network calls in tests.

| Test | What it verifies |
|------|-----------------|
| `send_crd_request` posts to the correct URL | Outgoing URL is the payer CRD endpoint |
| `send_crd_request` stores request in `_last_request` | Module-level state is updated |
| `send_crd_request` returns a `CdsHooksResponse` with cards | Response is parsed correctly |
| Payer unreachable raises an appropriate error | Error handling works |
| Payer returns non-200 raises an appropriate error | HTTP error handling works |

### 14.3 `tests/test_routes.py`

Use FastAPI's `TestClient` with an overridden dependency or a mocked `cds_client.send_crd_request`.

| Test | What it verifies |
|------|-----------------|
| `GET /patients/demo-patient-001` returns 200 | Route exists and renders |
| `GET /patients/demo-patient-001` contains patient name | Template renders fixture data |
| `POST /orders/colonoscopy/crd` returns 200 with mocked payer | CRD flow completes |
| `GET /debug/last-crd-request` returns JSON | Debug route works |
| `GET /debug/last-crd-response` returns JSON | Debug route works |

---

## 15. Build Sequence

Follow this order when implementing Phase 1. Each step has a verifiable outcome before proceeding.

| Step | Task | Verify | Status |
|------|------|--------|--------|
| 1 | Create `provider-ehr/` directory structure as shown in Section 4 | All directories and `__init__.py` files exist | Complete |
| 2 | Populate `requirements.txt` with all dependencies from Section 3 | `pip install -r requirements.txt` succeeds | Complete |
| 3 | Create `.env` and `.env.example` with keys from Section 5.1 | `.env` has `PAYER_CRD_URL=http://localhost:8080` | Complete |
| 4 | Implement `config.py` | `from app.config import settings; settings.payer_crd_url` works in a Python shell | Complete |
| 5 | Create all five fixture JSON files in `app/fixtures/` | Each file is valid JSON; field values match API contract Section 7 | Complete |
| 6 | Implement `models.py` | Pydantic model imports succeed with no errors | Complete |
| 7 | Implement `fhir_factory.py` | `python -c "from app.fhir_factory import build_crd_request; print(build_crd_request())"` prints a model | Complete |
| 8 | Run `test_fhir_factory.py` tests | All tests pass | Not started |
| 9 | Create `base.html` with CDN links for Tailwind and HTMX | HTML is valid; CDN resources load in browser | Complete |
| 10 | Create `dashboard.html` extending `base.html` | `GET /` renders status badge and patient link | Complete |
| 11 | Implement `main.py` with static mount and router registration | `uvicorn app.main:app --reload --port 8000` starts without error | Complete |
| 12 | Implement `GET /` and `GET /patients/{patient_id}` in `routes/clinician.py` | Browser shows patient chart at `http://localhost:8000/patients/demo-patient-001` | Complete |
| 13 | Create `patient_chart.html` displaying all fixture data | Patient name, condition, order, prior procedure, and CRD button appear on the page | Complete |
| 14 | Implement `cds_client.py` | Module imports succeed; `_last_request` and `_last_response` are `None` at startup | Complete |
| 15 | Implement `POST /orders/colonoscopy/crd` in `routes/clinician.py` | With the payer running, clicking the button returns cards | Complete |
| 16 | Create `cds_cards.html` partial | Cards render in the page panel with correct indicator colors | Not started |
| 17 | Implement `routes/api.py` debug routes | `GET /debug/last-crd-request` and `GET /debug/last-crd-response` return JSON | Complete |
| 18 | Run full test suite | `python -m pytest` passes | Not started |
| 19 | Run end-to-end manual test | Full browser workflow from patient chart to CDS Cards with real payer | Not started |
