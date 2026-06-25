# Provider EHR Simulator — Developer Guide

This guide walks through the complete implementation of the Python Provider EHR Simulator from start to finish. Every section is self-contained: background is provided inline, and all code is copy-paste ready with full comments. Work through the sections in order without needing to consult any other document.

Each section is labelled with a status:

- **[COMPLETE]** — the file already exists; read it and understand it before moving on
- **[CREATE]** — you will create this file by following the steps in the section
- **[UPDATE]** — the file exists but needs additional code added to it

---

## Table of Contents

1. Background and Architecture
2. Project Configuration
3. Application Settings
4. ANSI Color Codes
5. Pydantic Data Models
6. FHIR Fixtures
7. FHIR Factory
8. CDS Client
9. Application Entry Point
10. HTML Templates
11. Routes
12. Testing
13. End-to-End Verification

---

## Section 1 — Background and Architecture

### 1.1 What This Service Does

The Provider EHR Simulator is a Python web application that plays the role of an Electronic Health Record system in a Coverage Requirements Discovery (CRD) workflow. It gives a simulated clinician a patient chart view, a draft colonoscopy order, and a panel that displays coverage guidance cards returned by the payer.

**The application acts as a CDS Hooks client.** When the clinician triggers coverage discovery, the EHR assembles a structured JSON request and sends it to the Bun + Hono Payer CRD Service. The payer evaluates its rules and returns CDS Cards — structured messages that the EHR renders inline on the patient chart, without a page reload.

In Phase 1, the FHIR resources included in the request — patient demographics, active conditions, the draft order, prior procedure history, and insurance coverage — are read from pre-authored JSON files on disk (called fixtures) rather than from a live clinical database or FHIR server.

### 1.2 The CDS Hooks Protocol

CDS Hooks is a lightweight HTTP-based protocol for clinical decision support. It defines a small set of standard events ("hooks") that an EHR fires at specific workflow moments. A server listening for those hooks evaluates the incoming clinical context and returns Cards — structured messages the EHR can display to the clinician.

The hook used in this demo is `order-sign`, which fires when a clinician is about to sign a draft order. The EHR sends the clinical context as a JSON POST request to the payer; the payer evaluates it and responds with an array of Cards.

**The two CDS Hooks endpoints the payer service implements:**

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/cds-services` | Discovery — advertises what hooks the payer supports |
| `POST` | `/cds-services/crd-order-sign` | CRD — receives an order-sign request and returns Cards |

The EHR service in this guide implements the **client side** of this exchange: it builds and sends the POST request, then receives and renders the response.

### 1.3 CDS Cards

A Card is the unit of communication from payer to EHR. Each card has:

- `summary` — a short (≤ 140 character) plain-text title
- `indicator` — urgency level: `info`, `warning`, or `critical`
- `source` — identifies the payer
- `detail` — optional extended explanation in Markdown format
- `links` — optional external URLs (e.g., a documentation checklist)

This application receives and renders two types of cards from the payer:

| Scenario | Indicator | Meaning |
|----------|-----------|---------|
| Z80.0 condition present, prior procedure ≥ 5 years ago | `info` | Order appears covered; high-risk interval confirmed |
| Z80.0 condition absent | `warning` | Missing documentation; high-risk classification not confirmed |
| Z80.0 present, prior procedure < 5 years ago | `warning` | Prior colonoscopy too recent for the 5-year high-risk interval |

### 1.4 FHIR Resources

FHIR (Fast Healthcare Interoperability Resources) is the data standard used to represent clinical information. Every FHIR resource is a JSON object with a `resourceType` field that identifies its type. The resources assembled by this application:

**Patient** — the person receiving care. Includes demographics (name, birth date, gender) and a medical record number identifier.

**Condition** — a clinical condition or diagnosis. The ICD-10-CM code `Z80.0` (Family history of malignant neoplasm of digestive organs) identifies the patient as high-risk for colorectal cancer.

**ServiceRequest** — the draft colonoscopy order. The `status` is `draft` and the CPT code `45378` identifies it as a colonoscopy. The `authoredOn` date is set to today's date at runtime.

**Procedure** — a completed prior colonoscopy. The `performedDateTime` is set to a date 5 years before the current order, representing the patient's last screening.

**Coverage** — the patient's active insurance. Identifies the payer as "Demo Payer CRD Inc."

**Bundle** — a FHIR container for multiple resources. The `draftOrders` field and the `conditions` and `priorProcedures` prefetch entries are each wrapped in a Bundle.

**Clinical codes used in this demo:**

| Standard | Code | Meaning |
|----------|------|---------|
| ICD-10-CM | `Z80.0` | Family history of malignant neoplasm of digestive organs |
| CPT | `45378` | Colonoscopy, flexible, proximal to splenic flexure; diagnostic |

### 1.5 The CDS Hooks Request Payload

When the clinician clicks "Check Coverage Requirements", the EHR assembles and sends a JSON body like the following to the payer:

```json
{
  "hook": "order-sign",
  "hookInstance": "a-uuid-generated-per-invocation",
  "fhirServer": "http://localhost:8000/fhir",
  "context": {
    "userId": "PractitionerRole/demo-clinician",
    "patientId": "demo-patient-001",
    "encounterId": "demo-encounter-001",
    "draftOrders": {
      "resourceType": "Bundle",
      "type": "collection",
      "entry": [
        { "resource": { "resourceType": "ServiceRequest", "status": "draft", "intent": "order",
            "code": { "coding": [{ "system": "http://www.ama-assn.org/go/cpt", "code": "45378" }] },
            "subject": { "reference": "Patient/demo-patient-001" },
            "authoredOn": "2026-06-24" } }
      ]
    }
  },
  "prefetch": {
    "patient": {
      "resourceType": "Patient",
      "id": "demo-patient-001",
      "name": [{ "family": "Doe", "given": ["John"] }],
      "gender": "male",
      "birthDate": "1971-01-15"
    },
    "conditions": {
      "resourceType": "Bundle",
      "type": "searchset",
      "total": 1,
      "entry": [
        { "resource": { "resourceType": "Condition",
            "code": { "coding": [{ "system": "http://hl7.org/fhir/sid/icd-10-cm", "code": "Z80.0" }] } } }
      ]
    },
    "priorProcedures": {
      "resourceType": "Bundle",
      "type": "searchset",
      "total": 1,
      "entry": [
        { "resource": { "resourceType": "Procedure", "status": "completed",
            "code": { "coding": [{ "system": "http://www.ama-assn.org/go/cpt", "code": "45378" }] },
            "performedDateTime": "2021-06-03" } }
      ]
    },
    "coverage": {
      "resourceType": "Coverage",
      "id": "demo-coverage-001",
      "status": "active",
      "beneficiary": { "reference": "Patient/demo-patient-001" },
      "payor": [{ "display": "Demo Payer CRD Inc." }]
    }
  }
}
```

The `prefetch` keys (`patient`, `conditions`, `coverage`, `priorProcedures`) are pre-populated by the EHR from its fixture files. In a production system the EHR would query a live FHIR server to populate these. The payer declared these keys in its discovery response as the resources it requires to evaluate its rules.

### 1.6 Technology Stack

| Component | Choice | Purpose |
|-----------|--------|---------|
| Runtime | Python 3.12 | Application runtime |
| Web framework | FastAPI | Routing, ASGI integration, dependency injection |
| ASGI server | Uvicorn | Runs the FastAPI application |
| HTTP client | HTTPX | Async outbound calls to the payer CRD service |
| Templating | Jinja2 | Server-side HTML rendering |
| UI interactivity | HTMX | Partial-page updates without a JavaScript framework |
| Styling | Tailwind CSS (CDN) + custom CSS | Component styling |
| Data models | Pydantic v2 | Runtime type validation and JSON serialization |
| Configuration | pydantic-settings | Environment variable and `.env` file loading |
| Markdown rendering | markdown library | Converts CDS Card `detail` field to HTML |
| Testing | pytest + pytest-asyncio | Test runner with async test support |

**FastAPI** is a modern Python web framework built on ASGI (Asynchronous Server Gateway Interface). It uses Python type annotations to define request and response schemas, supports `async`/`await` natively, and generates automatic API documentation. It is similar in spirit to Flask but with built-in support for async handlers and Pydantic integration.

**HTMX** allows HTML elements to make HTTP requests and swap parts of the page with the response, using only HTML attributes — no JavaScript required. The CRD trigger button uses HTMX to POST to the server and replace the CDS Cards panel with the response, all without a full page reload.

### 1.7 Two-Application Architecture

```
Python EHR (port 8000)             Bun Payer CRD (port 8080)
──────────────────────             ─────────────────────────
Clinician clicks button
FHIR fixtures loaded
CDS Hooks request assembled ──POST /cds-services/crd-order-sign──►
                                   Validate request body
                                   Extract FHIR resources
                                   Evaluate payer rules
                                   Build CDS Cards
CDS Cards rendered to HTML  ◄────── { "cards": [...] } ──────────
HTMX inserts HTML into page
```

The two services communicate only over HTTP. Neither calls internal functions of the other. Both can be started and stopped independently.

---

## Section 2 — Project Configuration

### 2.1 Directory Structure

```
provider-ehr/
├── app/
│   ├── __init__.py                    [COMPLETE] Package marker
│   ├── main.py                        [COMPLETE] FastAPI app factory
│   ├── config.py                      [COMPLETE] Settings singleton
│   ├── models.py                      [COMPLETE] Pydantic data models
│   ├── fhir_factory.py                [COMPLETE] Fixture loader and request assembler
│   ├── cds_client.py                  [COMPLETE] Outbound HTTPX client
│   ├── colors.py                      [COMPLETE] ANSI color codes for terminal output
│   ├── routes/
│   │   ├── clinician.py               [COMPLETE] HTML routes (GET /, GET /patients/*, POST /orders/*)
│   │   └── api.py                     [COMPLETE] Debug JSON routes
│   ├── templates/
│   │   ├── base.html                  [COMPLETE] HTML layout shell
│   │   ├── dashboard.html             [COMPLETE] Clinician dashboard
│   │   ├── patient_chart.html         [COMPLETE] Patient chart and CRD trigger
│   │   └── cds_cards.html             [COMPLETE] CDS Cards partial for HTMX insertion
│   ├── static/
│   │   └── css/
│   │       └── main.css               [COMPLETE] Custom CSS (nav, layout, button styles)
│   └── fixtures/
│       ├── patient.json               [COMPLETE] FHIR Patient resource
│       ├── condition-family-history.json [COMPLETE] FHIR Condition — ICD-10-CM Z80.0
│       ├── service-request-colonoscopy.json [COMPLETE] FHIR ServiceRequest — CPT 45378
│       ├── prior-colonoscopy.json     [COMPLETE] FHIR Procedure — prior colonoscopy
│       └── coverage.json              [COMPLETE] FHIR Coverage resource
├── tests/
│   ├── __init__.py                    [CREATE]
│   ├── test_fhir_factory.py           [CREATE]
│   ├── test_cds_client.py             [CREATE]
│   └── test_routes.py                 [CREATE]
├── .env                               [COMPLETE] Local config (not committed)
├── .env.example                       [COMPLETE] Committed template
└── requirements.txt                   [COMPLETE]
```

### 2.2 `requirements.txt` [COMPLETE]

`requirements.txt` lists every Python package the application depends on with pinned version numbers. Pinning versions ensures that running `pip install -r requirements.txt` on any machine or at any future date produces the same environment.

```
# -----------------------------------------------------------
# Project Dependencies
# -----------------------------------------------------------

# Core web framework and server
fastapi==0.115.4
uvicorn[standard]==0.32.1

# HTTP client — used at runtime (CDS Hooks requests to payer) and in tests
httpx==0.27.2

# Templating and static file serving
jinja2==3.1.4
aiofiles==24.1.0
markdown==3.7

# Configuration and data models
pydantic==2.9.2
pydantic-settings==2.6.1
python-dotenv==1.0.1

# Testing
pytest==8.3.3
pytest-asyncio==0.24.0
```

`uvicorn[standard]` installs Uvicorn with optional high-performance dependencies (the `uvloop` event loop and `httptools` HTTP parser). The `[standard]` extras bracket is pip's syntax for optional dependency groups defined by the package author.

`aiofiles` is required by FastAPI's `StaticFiles` mount to serve files asynchronously. It does not need to be imported directly in application code.

### 2.3 Environment Configuration [COMPLETE]

`.env` holds local configuration values. `pydantic-settings` reads this file automatically at startup — no explicit loading code is required. The `.env` file is listed in `.gitignore` and is never committed.

**`.env`:**
```
# -----------------------------------------------------------
# provider-ehr environment configuration
# -----------------------------------------------------------

APP_NAME="Provider EHR"
APP_VERSION="0.1.0"
APP_ENV=development
LOG_LEVEL=INFO
PAYER_CRD_URL=http://localhost:8080
```

`.env.example` is a committed template that documents every required key without real values. New contributors copy it to `.env` and fill in their local values.

**`.env.example`:**
```
# -----------------------------------------------------------
# provider-ehr environment configuration
# Copy this file to .env and fill in values for your environment.
# .env is listed in .gitignore and must never be committed.
# -----------------------------------------------------------

# Application display name shown in the browser nav bar
APP_NAME="Provider EHR"

# Application version string
APP_VERSION="0.1.0"

# Runtime environment: development | production
APP_ENV=development

# Log verbosity: DEBUG | INFO | WARNING
LOG_LEVEL=INFO

# Base URL of the Bun + Hono Payer CRD Service; no trailing slash
PAYER_CRD_URL=http://localhost:8080
```

### 2.4 Virtual Environment and Dependencies

From the `provider-ehr/` directory:

```bash
# Create the virtual environment (first time only)
python3 -m venv .venv

# Activate it
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

**Verify the setup:**

```bash
uvicorn app.main:app --reload --port 8000
```

You should see:
```
Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)
```

Press `Ctrl+C` to stop.

---

## Section 3 — Application Settings [COMPLETE]

### 3.1 How pydantic-settings Works

`pydantic-settings` extends Pydantic to read configuration from environment variables and `.env` files. You define a class that inherits from `BaseSettings` and declare each setting as a typed field. When the class is instantiated, `pydantic-settings` reads values from the environment (and from the `.env` file if one exists), validates them against the declared types, and makes them available as typed attributes.

This approach has two advantages over using `os.environ` directly:

1. **Type safety** — values are coerced and validated. A setting declared as `bool` will parse the string `"true"` to the Python boolean `True`.
2. **Defaults** — fields can have default values, reducing the number of required environment variables.

The module-level `settings = Settings()` singleton pattern means every module that needs configuration imports the same pre-validated instance rather than instantiating its own.

### 3.2 Full Annotated File: `app/config.py`

```python
# provider-ehr/app/config.py
# Application configuration using pydantic-settings.

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # SettingsConfigDict tells pydantic-settings where to look for values.
    # env_file=".env" loads the .env file from the current working directory.
    # extra="ignore" silently ignores any keys in .env that are not declared
    # as fields here — useful when .env contains keys for other tools.
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Application identity
    app_name: str = "Provider EHR (Python)"
    app_description: str = "app description"
    app_version: str = "0.0.0.0"
    app_env: str = "development"

    # Logging
    log_level: str = "INFO"

    # FastAPI debug mode — enables detailed error pages and auto-reload hints
    app_debug: bool = True

    # Required: base URL of the payer service, e.g. http://localhost:8080
    # No default — the application will raise an error at startup if this is missing
    payer_crd_url: str


# Module-level singleton — instantiated once when this module is first imported.
# All other modules use: from app.config import settings
settings = Settings()
```

**Verify from a Python shell in `provider-ehr/` (venv activated):**

```python
from app.config import settings
print(settings.payer_crd_url)   # http://localhost:8080
print(settings.app_env)         # development
```

---

## Section 4 — ANSI Color Codes [COMPLETE]

### 4.1 Purpose

`colors.py` defines ANSI escape code constants for colorizing terminal output during development. FastAPI/Uvicorn logs appear in plain text; wrapping log messages with these constants makes specific messages visually distinct in the terminal, which helps during rapid iteration.

These constants are used exclusively in `logger.debug()` calls throughout the application. They have no effect on production behavior.

### 4.2 Full Annotated File: `app/colors.py`

```python
# provider-ehr/app/colors.py
# ANSI escape codes for colorized terminal output.
# Usage: logger.debug(f"{YELLOW}message text{RESET}")

# Foreground (text) colors — \033 is the escape character; [Nm sets color N
RED     = "\033[31m"
GREEN   = "\033[32m"
YELLOW  = "\033[33m"
BLUE    = "\033[34m"
MAGENTA = "\033[35m"
CYAN    = "\033[36m"
WHITE   = "\033[37m"
GRAY    = "\033[90m"
RESET   = "\033[0m"   # resets all color codes back to terminal default

# Background colors
BG_BLACK   = "\033[40m"
BG_RED     = "\033[41m"
BG_GREEN   = "\033[42m"
BG_YELLOW  = "\033[43m"
BG_BLUE    = "\033[44m"
BG_MAGENTA = "\033[45m"
BG_CYAN    = "\033[46m"
BG_WHITE   = "\033[47m"
```

---

## Section 5 — Pydantic Data Models [COMPLETE]

### 5.1 What Pydantic Is

Pydantic is a Python library that enforces type annotations **at runtime**. A class that inherits from `BaseModel` validates every field value when an instance is created, serializes model instances to dictionaries or JSON strings, and parses external data back into typed model instances.

This application uses Pydantic models for two purposes:

1. **Outgoing request** — `fhir_factory.py` constructs `CdsHooksRequest` and `CdsHooksContext` model instances and hands them to `cds_client.py`, which serializes them to JSON for transmission.
2. **Incoming response** — `cds_client.py` parses the payer's JSON response body into a `CdsHooksResponse` model, which wraps a list of `CdsCard` objects. The route handler passes the cards to the Jinja2 template.

### 5.2 The camelCase/snake_case Problem

CDS Hooks is a JSON protocol whose field names are camelCase: `hookInstance`, `patientId`, `draftOrders`, `fhirServer`. Python convention (PEP 8) requires attribute names to use snake_case: `hook_instance`, `patient_id`, `draft_orders`, `fhir_server`.

A Pydantic model must bridge both: Python code uses snake_case internally, but the JSON sent to the payer must use camelCase.

The fields affected in this project:

| Python snake_case | JSON camelCase |
|-------------------|----------------|
| `hook_instance` | `hookInstance` |
| `fhir_server` | `fhirServer` |
| `user_id` | `userId` |
| `patient_id` | `patientId` |
| `encounter_id` | `encounterId` |
| `draft_orders` | `draftOrders` |

Fields where the two conventions produce the same result (`hook`, `label`, `url`, `summary`, `indicator`, `detail`, `cards`) require no special treatment.

### 5.3 The Alias Generator Approach

Rather than declaring an alias on every individual field, an **alias generator** is a function Pydantic calls automatically for every field at class definition time. The function receives the Python snake_case attribute name and returns the corresponding camelCase JSON key.

This project uses `to_camel` from `pydantic.alias_generators`:

```
hook_instance  →  hookInstance
patient_id     →  patientId
draft_orders   →  draftOrders
hook           →  hook           (single word; unchanged)
```

Two model configuration settings work together:

- `alias_generator=to_camel` — enables automatic camelCase aliases for all fields
- `populate_by_name=True` — allows constructing model instances using either the Python snake_case name or the camelCase alias; without this, only the alias would work

When serializing to JSON for transmission to the payer, `model_dump(by_alias=True)` produces camelCase keys. When constructing instances in Python code, snake_case names work directly.

### 5.4 Full Annotated File: `app/models.py`

```python
# provider-ehr/app/models.py
# Pydantic models for the CDS Hooks request/response wire format.

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


# ---- Outgoing Request Models ----------------------------------------

class CdsHooksContext(BaseModel):
    # alias_generator=to_camel: automatically derives camelCase JSON aliases
    # populate_by_name=True: allows construction with either snake_case or camelCase
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    user_id: str               # JSON: userId — FHIR reference of the ordering clinician
    patient_id: str            # JSON: patientId — FHIR logical id of the patient
    encounter_id: str | None = None  # JSON: encounterId — optional FHIR encounter id
    draft_orders: dict         # JSON: draftOrders — FHIR Bundle containing the draft ServiceRequest


class CdsHooksRequest(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    hook: str                       # Always "order-sign" for this project
    hook_instance: str              # JSON: hookInstance — UUID generated per invocation
    fhir_server: str | None = None  # JSON: fhirServer — placeholder EHR FHIR endpoint
    context: CdsHooksContext        # Nested model; Pydantic validates it automatically
    prefetch: dict                  # Dict of prefetched FHIR resources keyed by name


# ---- Incoming Response Models ---------------------------------------
# Field names below are identical in Python and JSON (no aliasing needed),
# but model_config is still declared on each class for consistency.

class CdsSource(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    label: str
    url: str | None = None


class CdsLink(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    label: str
    url: str
    type: str   # "absolute" or "smart"; "type" shadows the Python built-in within this scope


class CdsCard(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    summary: str
    indicator: str               # "info", "warning", or "critical"
    source: CdsSource            # Nested model; automatically constructed from JSON
    detail: str | None = None    # Optional Markdown text; template handles None
    links: list[CdsLink] = []    # Pydantic creates a fresh list per instance


class CdsHooksResponse(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    cards: list[CdsCard]
```

**Verify from a Python shell in `provider-ehr/`:**

```python
from app.models import CdsHooksRequest, CdsHooksContext, CdsHooksResponse

# Test outgoing serialization — confirm camelCase output
ctx = CdsHooksContext(
    user_id="PractitionerRole/demo-clinician",
    patient_id="demo-patient-001",
    draft_orders={"resourceType": "Bundle"}
)
req = CdsHooksRequest(hook="order-sign", hook_instance="test-uuid", context=ctx, prefetch={})
wire = req.model_dump(by_alias=True)
assert "hookInstance" in wire
assert "userId" in wire["context"]
print("Outgoing serialization: OK")

# Test incoming parsing — confirm nested model construction
response = CdsHooksResponse.model_validate({
    "cards": [{"summary": "Test", "indicator": "info",
               "source": {"label": "Demo Payer"}, "links": []}]
})
assert response.cards[0].source.label == "Demo Payer"
print("Incoming parse: OK")
```

---

## Section 6 — FHIR Fixtures [COMPLETE]

### 6.1 What Fixtures Are

Each file in `app/fixtures/` is a static JSON file representing one FHIR R4 resource. They serve as the synthetic patient data for the demo scenario — a 55-year-old male with a family history of colorectal cancer who had a colonoscopy 5 years ago and is now ordering a follow-up.

The FHIR factory loads these files at request time (not at import time) and assembles them into the CDS Hooks request payload. The values in these files are fixed for Phase 1; no database or live FHIR server is involved.

### 6.2 `fixtures/patient.json` [COMPLETE]

The FHIR `Patient` resource represents the person receiving care. The fields used by the rule engine are `id` (to correlate with other resources) and `birthDate` (to calculate patient age).

```json
{
  "resourceType": "Patient",
  "id": "demo-patient-001",
  "text": {
    "status": "generated",
    "div": "<div xmlns='http://www.w3.org/1999/xhtml'>John Doe, male, born 1971-01-15</div>"
  },
  "identifier": [
    {
      "use": "usual",
      "type": {
        "coding": [
          {
            "system": "http://terminology.hl7.org/CodeSystem/v2-0203",
            "code": "MR",
            "display": "Medical Record Number"
          }
        ]
      },
      "system": "http://demo-provider-ehr.example.com/patients",
      "value": "MRN-001"
    }
  ],
  "name": [{ "family": "Doe", "given": ["John"] }],
  "gender": "male",
  "birthDate": "1971-01-15"
}
```

The `text` field is a FHIR Narrative — a human-readable summary of the resource. The `identifier` includes a Medical Record Number (MRN) using the HL7 v2 table 0203 code `MR`.

### 6.3 `fixtures/condition-family-history.json` [COMPLETE]

The FHIR `Condition` resource represents the patient's documented family history of colorectal cancer. The ICD-10-CM code `Z80.0` is the key clinical signal the payer rule engine looks for to classify the patient as high-risk.

```json
{
  "resourceType": "Condition",
  "id": "demo-condition-fam-hx-crc",
  "clinicalStatus": {
    "coding": [
      {
        "system": "http://terminology.hl7.org/CodeSystem/condition-clinical",
        "code": "active"
      }
    ]
  },
  "verificationStatus": {
    "coding": [
      {
        "system": "http://terminology.hl7.org/CodeSystem/condition-ver-status",
        "code": "confirmed"
      }
    ]
  },
  "code": {
    "coding": [
      {
        "system": "http://hl7.org/fhir/sid/icd-10-cm",
        "code": "Z80.0",
        "display": "Family history of malignant neoplasm of digestive organs"
      }
    ]
  },
  "subject": { "reference": "Patient/demo-patient-001" }
}
```

The `clinicalStatus` and `verificationStatus` fields use coded values from FHIR-defined terminology systems. These are included for FHIR R4 conformance; the payer rule engine in Phase 1 evaluates only the `code.coding` array.

### 6.4 `fixtures/service-request-colonoscopy.json` [COMPLETE]

The FHIR `ServiceRequest` represents the draft colonoscopy order. Its `status` is `draft` (not yet signed) and `intent` is `order`. The `authoredOn` field is a placeholder date — the factory overrides it with today's date at runtime.

```json
{
  "resourceType": "ServiceRequest",
  "id": "demo-service-request-colonoscopy",
  "status": "draft",
  "intent": "order",
  "code": {
    "coding": [
      {
        "system": "http://www.ama-assn.org/go/cpt",
        "code": "45378",
        "display": "Colonoscopy, flexible, proximal to splenic flexure; diagnostic"
      }
    ],
    "text": "Colonoscopy, flexible, proximal to splenic flexure; diagnostic"
  },
  "subject": { "reference": "Patient/demo-patient-001" },
  "authoredOn": "2026-06-02"
}
```

The CPT system URI `http://www.ama-assn.org/go/cpt` is the standard FHIR identifier for the AMA's Current Procedural Terminology code system.

### 6.5 `fixtures/prior-colonoscopy.json` [COMPLETE]

The FHIR `Procedure` represents the patient's most recent prior colonoscopy. Its `status` is `completed`. The payer rule engine compares the `performedDateTime` against the current order date to determine whether the required screening interval has elapsed.

```json
{
  "resourceType": "Procedure",
  "id": "demo-prior-colonoscopy",
  "text": {
    "status": "generated",
    "div": "<div xmlns='http://www.w3.org/1999/xhtml'>Colonoscopy, flexible, proximal to splenic flexure; diagnostic (CPT 45378), completed 2021-06-03</div>"
  },
  "status": "completed",
  "code": {
    "coding": [
      {
        "system": "http://www.ama-assn.org/go/cpt",
        "code": "45378",
        "display": "Colonoscopy, flexible, proximal to splenic flexure; diagnostic"
      }
    ],
    "text": "Colonoscopy, flexible, proximal to splenic flexure; diagnostic"
  },
  "subject": { "reference": "Patient/demo-patient-001" },
  "performedDateTime": "2021-06-03"
}
```

The `performedDateTime` of `2021-06-03` is approximately 5 years before a mid-2026 current date, placing the demo scenario at the boundary of the high-risk 5-year interval.

### 6.6 `fixtures/coverage.json` [COMPLETE]

The FHIR `Coverage` resource represents the patient's active insurance. It identifies the payer and links coverage to the patient.

```json
{
  "resourceType": "Coverage",
  "id": "demo-coverage-001",
  "text": {
    "status": "generated",
    "div": "<div xmlns='http://www.w3.org/1999/xhtml'>Coverage: Demo Payer CRD Inc., status active, beneficiary Patient/demo-patient-001</div>"
  },
  "status": "active",
  "beneficiary": { "reference": "Patient/demo-patient-001" },
  "payor": [{ "display": "Demo Payer CRD Inc." }]
}
```

The `Coverage` resource is included in the prefetch for Phase 1 completeness and for future plan-specific rule extensions. The payer rule engine in Phase 1 does not evaluate coverage fields.

---

## Section 7 — FHIR Factory [COMPLETE]

### 7.1 Purpose and Design

`fhir_factory.py` is responsible for loading the fixture files and assembling the complete CDS Hooks request payload. It has no side effects beyond reading files from disk and returning structured data.

The factory exposes four bundle-builder functions and one primary public function:

| Function | Returns |
|----------|---------|
| `load_fixture(filename)` | The parsed fixture as a `dict` |
| `build_draft_orders_bundle(service_request)` | A FHIR `collection` Bundle wrapping the ServiceRequest |
| `build_conditions_bundle(condition)` | A FHIR `searchset` Bundle wrapping the Condition |
| `build_procedures_bundle(procedure)` | A FHIR `searchset` Bundle wrapping the Procedure |
| `build_crd_request()` | A fully populated `CdsHooksRequest` model instance |

**Key design decision:** fixtures are loaded at call time (inside `build_crd_request()`), not at import time. This means each invocation reads fresh files from disk, which makes the factory easy to test in isolation and avoids stale module-level state.

### 7.2 Key Python Patterns

**`pathlib.Path`** — `Path(__file__).parent / "fixtures"` constructs the absolute path to the fixtures directory relative to the module file itself, regardless of the working directory at launch time. This is more robust than `os.path.join` and produces cleaner path syntax.

**`**spread operator`** — `{**service_request, "authoredOn": date.today().isoformat()}` creates a new dictionary that copies all keys from `service_request` and overrides (or adds) `authoredOn`. This is a non-destructive update — the original dict is unchanged.

**`uuid.uuid4()`** — generates a random UUID (Universally Unique Identifier) conforming to RFC 4122. The CDS Hooks specification requires `hookInstance` to uniquely identify each invocation. Converting to `str` gives the standard hyphenated string format: `"550e8400-e29b-41d4-a716-446655440000"`.

### 7.3 Full Annotated File: `app/fhir_factory.py`

```python
# provider-ehr/app/fhir_factory.py
# Loads FHIR fixture files and assembles a CdsHooksRequest ready to send to the payer.

import json
import uuid
from datetime import date
from pathlib import Path

from app.models import CdsHooksContext, CdsHooksRequest

# Resolve the fixtures directory relative to this file's location.
# Using Path(__file__).parent avoids any dependency on the working directory.
_FIXTURES_DIR = Path(__file__).parent / "fixtures"


def load_fixture(filename: str) -> dict:
    """Read and JSON-parse a single fixture file. Raises descriptive errors on failure."""
    path = _FIXTURES_DIR / filename
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        raise FileNotFoundError(f"Fixture file not found: {path}")
    except json.JSONDecodeError as exc:
        raise ValueError(f"Fixture file is not valid JSON: {path}: {exc}") from exc


def build_draft_orders_bundle(service_request: dict) -> dict:
    """Wrap a ServiceRequest in a FHIR collection Bundle for the draftOrders context field."""
    return {
        "resourceType": "Bundle",
        "type": "collection",
        "entry": [{"resource": service_request}],
    }


def build_conditions_bundle(condition: dict) -> dict:
    """Wrap a Condition in a FHIR searchset Bundle for the conditions prefetch key."""
    return {
        "resourceType": "Bundle",
        "type": "searchset",
        "total": 1,
        "entry": [{"resource": condition}],
    }


def build_procedures_bundle(procedure: dict) -> dict:
    """Wrap a Procedure in a FHIR searchset Bundle for the priorProcedures prefetch key."""
    return {
        "resourceType": "Bundle",
        "type": "searchset",
        "total": 1,
        "entry": [{"resource": procedure}],
    }


def build_crd_request() -> CdsHooksRequest:
    """Load all fixtures, assemble FHIR Bundles, and return a populated CdsHooksRequest."""
    patient         = load_fixture("patient.json")
    condition       = load_fixture("condition-family-history.json")
    service_request = load_fixture("service-request-colonoscopy.json")
    procedure       = load_fixture("prior-colonoscopy.json")
    coverage        = load_fixture("coverage.json")

    # Override the fixture's static authoredOn with today's date.
    # The ** spread copies all keys from service_request; "authoredOn" overwrites the fixture value.
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
        hook_instance=str(uuid.uuid4()),   # fresh UUID for each invocation
        fhir_server="http://localhost:8000/fhir",  # placeholder; payer does not dereference this
        context=context,
        prefetch=prefetch,
    )
```

**Verify from a Python shell in `provider-ehr/`:**

```python
from app.fhir_factory import build_crd_request
req = build_crd_request()
print(req.hook)                            # order-sign
print(req.context.patient_id)             # demo-patient-001
print(req.prefetch["conditions"]["type"]) # searchset
```

---

## Section 8 — CDS Client [COMPLETE]

### 8.1 Purpose and Design

`cds_client.py` sends the assembled CDS Hooks request to the payer and returns the parsed response. It also stores the last request and response payloads in module-level state, making them available to the debug routes without any additional infrastructure.

### 8.2 Async HTTP with HTTPX

HTTPX is a modern Python HTTP client that supports `async`/`await` natively. The function `send_crd_request` is declared `async` because network I/O is a blocking operation — using `async with httpx.AsyncClient()` allows the FastAPI event loop to handle other requests while waiting for the payer to respond.

`async with httpx.AsyncClient() as client:` is an asynchronous context manager. It opens a connection pool when entered and closes it cleanly when exited, regardless of whether the request succeeded or raised an exception.

`response.raise_for_status()` checks the HTTP response status code and raises `httpx.HTTPStatusError` if it is 4xx or 5xx. The calling route handler catches this to display an error message to the clinician instead of crashing.

### 8.3 Module-Level State

`_last_request` and `_last_response` are module-level variables that persist for the lifetime of the server process. Each call to `send_crd_request` overwrites them with the most recent payload. The debug routes read them via the `get_last_request()` and `get_last_response()` accessor functions.

The `global` keyword inside `send_crd_request` is required because the function *assigns* to these variables (rebinds them). Without `global`, Python would treat the assignment as creating local variables, leaving the module-level variables unchanged.

### 8.4 Full Annotated File: `app/cds_client.py`

```python
# provider-ehr/app/cds_client.py
# Sends the CDS Hooks request to the payer and returns the parsed response.
# Stores the last request/response in module-level state for debug routes.

import httpx

from app.config import settings
from app.models import CdsHooksRequest, CdsHooksResponse

# Module-level state: persist for the lifetime of the server process.
# None until the first CRD request is made in this session.
_last_request: dict | None = None
_last_response: dict | None = None


def get_last_request() -> dict | None:
    return _last_request


def get_last_response() -> dict | None:
    return _last_response


async def send_crd_request(request: CdsHooksRequest) -> CdsHooksResponse:
    # global declares intent to rebind module-level variables inside this function.
    global _last_request, _last_response

    url = settings.payer_crd_url + "/cds-services/crd-order-sign"

    # model_dump(by_alias=True) serializes using camelCase JSON keys,
    # matching the wire format the payer expects (hookInstance, patientId, etc.)
    payload = request.model_dump(by_alias=True)

    # async with ensures the HTTP connection pool is closed after the request,
    # even if an exception is raised.
    async with httpx.AsyncClient() as client:
        response = await client.post(url, json=payload, timeout=10.0)
        # Raises httpx.HTTPStatusError if the payer returns a 4xx or 5xx status.
        response.raise_for_status()

    _last_request = payload
    _last_response = response.json()

    # model_validate constructs the full nested response model from the parsed JSON dict.
    return CdsHooksResponse.model_validate(_last_response)
```

---

## Section 9 — Application Entry Point [COMPLETE]

### 9.1 How FastAPI Works

FastAPI follows the same request-routing model as Flask but with native async support and Pydantic integration. You:

1. Create an app instance: `app = FastAPI(...)`
2. Register routers (groups of related routes): `app.include_router(router)`
3. Mount static file directories: `app.mount("/static", StaticFiles(...))`
4. Run the app: `uvicorn app.main:app --reload --port 8000`

When a request arrives, FastAPI matches its method and path against registered routes, calls the matching handler, and sends the returned response back to the client.

**Why Jinja2 templates are configured in `clinician.py` and not `main.py`:** Python modules are imported in dependency order. If `main.py` both created the `Jinja2Templates` object and imported `clinician.py`, a circular import could result. Placing template setup in `clinician.py` — the module that uses it — avoids this.

### 9.2 Full Annotated File: `app/main.py`

```python
# provider-ehr/app/main.py
# FastAPI application factory.
# Run from provider-ehr/ with: uvicorn app.main:app --reload --port 8000

import logging
import os

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.colors import YELLOW, RESET

# Configure Python logging before importing any application modules.
# The root logger level is set once here; all child loggers (app.routes.*, etc.) inherit it.
logging.basicConfig(
    level=settings.log_level.upper(),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)

logger = logging.getLogger(__name__)

# Print configuration summary to the Uvicorn terminal on startup.
print("-" * 60)
print("        APP_NAME:", settings.app_name)
print(" APP_DESCRIPTION:", settings.app_description)
print("     APP_VERSION:", settings.app_version)
print("         APP_ENV:", settings.app_env)
print("    DEBUG STATUS:", settings.app_debug)
print("-" * 60)

# Router imports must follow logging configuration so that module-level
# logger.debug() calls in the route files use the configured log level.
from app.routes import api, clinician

app = FastAPI(
    title=settings.app_name,
    description=settings.app_description,
    version=settings.app_version,
    debug=settings.app_debug,
)

# __file__ is the absolute path to this file.
# os.path.dirname gives its directory: .../provider-ehr/app/
# The static directory is at .../provider-ehr/app/static/
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
logger.debug(f"{YELLOW}base directory: {BASE_DIR}{RESET}")

# Mount the static directory at the /static URL prefix.
# StaticFiles serves files from disk; aiofiles (in requirements.txt) handles async I/O.
app.mount(
    "/static",
    StaticFiles(directory=os.path.join(BASE_DIR, "static")),
    name="static",
)
logger.debug(f"{YELLOW}static directory: {os.path.join(BASE_DIR, 'static')}{RESET}")

# Register route modules. include_router adds all routes from each router to the app.
# tags group the routes in FastAPI's auto-generated /docs API documentation.
app.include_router(clinician.router, tags=["clinician"])
app.include_router(api.router, tags=["debug"])
```

---

## Section 10 — HTML Templates [COMPLETE]

### 10.1 Jinja2 Overview

Jinja2 is a Python templating engine. Templates are HTML files with special `{{ }}` and `{% %}` syntax for rendering values and control flow. FastAPI's `Jinja2Templates` class:

- Locates template files in a directory
- Renders them with a context dictionary by calling `templates.TemplateResponse(request, "filename.html", context)`
- Makes context values available in the template by name

**Jinja2 quick reference:**

| Syntax | Purpose |
|--------|---------|
| `{{ value }}` | Render a value |
| `{{ value \| filter }}` | Apply a filter (e.g., `\| capitalize`, `\| default("n/a")`) |
| `{% if condition %}...{% endif %}` | Conditional block |
| `{% for item in list %}...{% endfor %}` | Loop |
| `{% extends "base.html" %}` | Inherit from a parent template |
| `{% block name %}...{% endblock %}` | Define or override a named block |

### 10.2 `app/templates/base.html` [COMPLETE]

`base.html` is the layout shell. Every full-page template extends it. It defines the `<head>` block (CDN links), the navigation bar, and a `content` block that child templates override.

Tailwind CSS is loaded via CDN with the typography plugin enabled (`?plugins=typography`), which provides the `prose` classes used to style Markdown-rendered content in CDS Cards. HTMX is loaded at the bottom of `<body>` so it is available for all page interactions.

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{% block title %}Provider EHR{% endblock %}</title>
    <!-- Tailwind CDN with Typography plugin for prose classes in CDS Cards -->
    <script src="https://cdn.tailwindcss.com?plugins=typography"></script>
    <!-- Custom CSS for nav, layout, button styles, and HTMX spinner -->
    <link rel="stylesheet" href="{{ request.url_for('static', path='css/main.css') }}">
</head>

<body>
    <nav>
        <span class="nav-header">
            <a href="/">{{ app_name | default("Provider EHR") }}</a>
        </span>
    </nav>

    <main>
        {% block content %}{% endblock %}
    </main>

    {% block scripts %}
    <!-- HTMX loaded at end of body — enables hx-post, hx-target, hx-swap attributes -->
    <script src="https://unpkg.com/htmx.org@2.0.0"></script>
    {% endblock %}
</body>
</html>
```

`request.url_for('static', path='css/main.css')` generates the correct URL for the static file regardless of the server's base URL. The `'static'` name matches the `name="static"` argument in `app.mount()`.

### 10.3 `app/templates/dashboard.html` [COMPLETE]

The clinician dashboard is the application entry point. It displays a status badge confirming the app is running and a link to the demo patient's chart.

```html
{% extends "base.html" %}

{% block title %}Dashboard — {{ super() }}{% endblock %}

{% block content %}

<div class="status-card">

    <h1>{{ app_name }}</h1>

    <p>Provider EHR Simulator — CRD Demo</p>

    <div class="status-badge">
        <!-- Unicode filled circle used as a status dot -->
        <span>&#x25CF;</span>
        Application running
    </div>

    <div>
        <p>Phase 1 demo patient:</p>
        <a href="/patients/{{ patient_id }}" class="chart-link">
            Open Patient Chart &rarr;
        </a>
    </div>

</div>

<footer>
    <p>Phase 1 &mdash; Static fixtures &bull; Basic CRD request/response exchange</p>
</footer>

{% endblock %}
```

### 10.4 `app/templates/patient_chart.html` [COMPLETE]

The patient chart displays four clinical panels (patient header, active conditions, draft order, prior procedure) and the CRD trigger section. It extends `base.html`.

**HTMX attributes on the trigger button:**

| Attribute | Value | Effect |
|-----------|-------|--------|
| `hx-post` | `/orders/colonoscopy/crd` | Sends an HTTP POST when clicked |
| `hx-target` | `#cds-cards-panel` | Inserts the response into this element |
| `hx-swap` | `innerHTML` | Replaces the element's inner HTML (not the element itself) |
| `hx-indicator` | `#crd-spinner` | Shows this element while the request is in flight |

The year calculation in the Prior Procedures panel (`service_request.authoredOn[:4] | int - procedure.performedDateTime[:4] | int`) slices the first 4 characters of each ISO 8601 date string to extract the year, casts both to integers using the `| int` filter, and subtracts. This is intentionally approximate — it calculates elapsed calendar years, not exact days.

### 10.5 `app/templates/cds_cards.html` [COMPLETE]

`cds_cards.html` is a **partial** — it does not extend `base.html` and contains no `<html>`, `<head>`, or `<body>` tags. It is returned directly by the `POST /orders/colonoscopy/crd` route and inserted into the `#cds-cards-panel` div by HTMX.

**Context variables provided by the route:**

| Variable | Type | Description |
|----------|------|-------------|
| `cards` | `list[CdsCard]` | List of CDS Card Pydantic model instances; empty on payer error |
| `error` | `str \| None` | Human-readable error message on payer failure; `None` on success |

**The Markdown filter:** The `detail` field on CDS Cards contains Markdown text. The template applies `{{ card.detail | markdown | safe }}` to convert it to HTML. The `markdown` filter is a custom Jinja2 filter registered in `clinician.py` using the Python `markdown` library. The `safe` filter tells Jinja2 to render the result as raw HTML rather than escaping the angle brackets.

**Why the route returns HTTP 200 on payer errors:** HTMX only performs an innerHTML swap when the server responds with a 2xx status. Returning 4xx or 5xx would leave the `#cds-cards-panel` empty with no visible feedback to the clinician. Returning HTTP 200 with an error message in the HTML fragment lets HTMX display the error inline.

---

## Section 11 — Routes [COMPLETE]

### 11.1 `app/routes/clinician.py` [COMPLETE]

`clinician.py` owns all clinician-facing HTML routes. It also owns the `Jinja2Templates` setup and the `markdown` filter registration, keeping template configuration co-located with the code that uses it.

The `Jinja2Templates` object is module-level — created once when the module is imported. `templates.env.filters["markdown"] = md_to_html` registers a custom filter named `"markdown"` that the templates access with the `| markdown` pipe syntax.

```python
# provider-ehr/app/routes/clinician.py
# Clinician-facing HTML routes. Returns HTML responses via Jinja2 templates.

from datetime import date
import logging
import os

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from markdown import markdown as md_to_html

from app import cds_client, fhir_factory
from app.config import settings
from app.colors import YELLOW, RESET

logger = logging.getLogger(__name__)
logger.debug(f"{YELLOW}Router Started{RESET}")

router = APIRouter()

# Resolve the templates directory relative to this file.
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TEMPLATES_DIR = os.path.normpath(os.path.join(BASE_DIR, "..", "templates"))
templates = Jinja2Templates(directory=TEMPLATES_DIR)

# Register the markdown filter so templates can use {{ value | markdown | safe }}
templates.env.filters["markdown"] = md_to_html

# Auto-reload templates on file change in development (no server restart needed)
if settings.app_env == "development":
    templates.env.auto_reload = True


# ---------------------------------------------------------------------------
# GET /
# ---------------------------------------------------------------------------
@router.get("/", response_class=HTMLResponse, name="dashboard")
async def dashboard(request: Request):
    """Render the clinician dashboard."""
    logger.debug(f"{YELLOW}GET /{RESET}")
    context = {
        "app_name": settings.app_name,
        "patient_id": "demo-patient-001",
    }
    return templates.TemplateResponse(request, "dashboard.html", context)


# ---------------------------------------------------------------------------
# GET /patients/{patient_id}
# ---------------------------------------------------------------------------
@router.get("/patients/{patient_id}", response_class=HTMLResponse, name="patient_chart")
async def patient_chart(request: Request, patient_id: str):
    """Render the patient chart for the given patient_id."""
    logger.debug(f"{YELLOW}GET /patients/{patient_id}{RESET}")

    if patient_id != "demo-patient-001":
        logger.warning(f"Unknown patient requested: {patient_id}")
        return HTMLResponse(content="Patient not found.", status_code=404)

    patient         = fhir_factory.load_fixture("patient.json")
    condition       = fhir_factory.load_fixture("condition-family-history.json")
    procedure       = fhir_factory.load_fixture("prior-colonoscopy.json")
    service_request = fhir_factory.load_fixture("service-request-colonoscopy.json")

    # Override the fixture's static authoredOn with today's date.
    today = date.today()
    service_request = {**service_request, "authoredOn": today.isoformat()}

    # Calculate age: subtract one year if the birthday has not yet occurred this year.
    birth_date = date.fromisoformat(patient["birthDate"])
    age = today.year - birth_date.year - (
        (today.month, today.day) < (birth_date.month, birth_date.day)
    )

    context = {
        "patient":         patient,
        "age":             age,
        "condition":       condition,
        "service_request": service_request,
        "procedure":       procedure,
    }
    return templates.TemplateResponse(request, "patient_chart.html", context)


# ---------------------------------------------------------------------------
# POST /orders/colonoscopy/crd
# ---------------------------------------------------------------------------
@router.post("/orders/colonoscopy/crd", response_class=HTMLResponse, name="trigger_crd")
async def trigger_crd(request: Request):
    """Trigger the CRD exchange and return the CDS Cards HTML partial."""
    logger.debug(f"{YELLOW}POST /orders/colonoscopy/crd{RESET}")

    try:
        crd_request  = fhir_factory.build_crd_request()
        cds_response = await cds_client.send_crd_request(crd_request)
        return templates.TemplateResponse(
            request,
            "cds_cards.html",
            {"cards": cds_response.cards, "error": None},
        )

    except httpx.RequestError as exc:
        # Network-level failure: payer unreachable, connection refused, or timed out.
        logger.error(f"Payer unreachable: {exc}")
        return templates.TemplateResponse(
            request,
            "cds_cards.html",
            {"cards": [], "error": f"The payer CRD service is unreachable. "
                                   f"Ensure it is running at {settings.payer_crd_url}."},
        )

    except httpx.HTTPStatusError as exc:
        # Payer responded with a non-2xx HTTP status.
        logger.error(f"Payer returned HTTP {exc.response.status_code}: {exc.response.text}")
        return templates.TemplateResponse(
            request,
            "cds_cards.html",
            {"cards": [], "error": f"The payer CRD service returned an error: "
                                   f"HTTP {exc.response.status_code}."},
        )
```

### 11.2 `app/routes/api.py` [COMPLETE]

`api.py` defines the two debug routes that expose the last CDS Hooks request and response payloads as pretty-printed JSON. These routes are for development inspection — they are active in all environments in Phase 1.

The `prefix="/debug"` on the `APIRouter` prepends `/debug` to every route path in this module, so `"/last-crd-request"` becomes `GET /debug/last-crd-request`.

The `_json_response` helper uses `json.dumps(data, indent=2)` to produce human-readable formatted JSON. FastAPI's default `JSONResponse` does not indent its output; this helper bypasses it for readability.

```python
# provider-ehr/app/routes/api.py
# Debug JSON routes for development inspection of the CDS Hooks request/response cycle.

import json
import logging

from fastapi import APIRouter
from fastapi.responses import Response

from app import cds_client
from app.colors import YELLOW, RESET

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/debug")


def _json_response(data: dict) -> Response:
    """Return a pretty-printed JSON response."""
    return Response(content=json.dumps(data, indent=2), media_type="application/json")


@router.get("/last-crd-request", name="debug_last_crd_request")
async def last_crd_request():
    """Return the last outgoing CDS Hooks request payload."""
    logger.debug(f"{YELLOW}GET /debug/last-crd-request{RESET}")
    payload = cds_client.get_last_request()
    if payload is None:
        return _json_response({
            "message": "No CDS Hooks request has been sent in this server session. "
                       "Trigger CRD from the patient chart to populate this endpoint."
        })
    return _json_response(payload)


@router.get("/last-crd-response", name="debug_last_crd_response")
async def last_crd_response():
    """Return the last incoming CDS Cards response payload."""
    logger.debug(f"{YELLOW}GET /debug/last-crd-response{RESET}")
    payload = cds_client.get_last_response()
    if payload is None:
        return _json_response({
            "message": "No CDS Hooks response has been received in this server session. "
                       "Trigger CRD from the patient chart to populate this endpoint."
        })
    return _json_response(payload)
```

**Verify both debug routes:**

```bash
# Before triggering CRD — should return the "no request yet" message
curl http://localhost:8000/debug/last-crd-request | python3 -m json.tool

# After clicking "Check Coverage Requirements" in the browser:
curl http://localhost:8000/debug/last-crd-request | python3 -m json.tool
curl http://localhost:8000/debug/last-crd-response | python3 -m json.tool
```

---

## Section 12 — Testing [CREATE]

### 12.1 How pytest Works

`pytest` is Python's standard test runner. Test files are named `test_*.py`. Test functions are named `test_*`. pytest discovers and runs them automatically.

**Core functions:**

| Function | Purpose |
|----------|---------|
| `assert expression` | Fails the test if the expression is falsy |
| `pytest.raises(ExceptionType)` | Context manager that asserts an exception is raised |
| `monkeypatch.setattr(obj, "name", value)` | Temporarily replace an attribute for the duration of a test |
| `@pytest.mark.asyncio` | Marks an async test function for `pytest-asyncio` |

**Fixtures** in pytest are functions decorated with `@pytest.fixture` that provide shared setup to multiple tests. They are passed to test functions as parameters by name.

**Running tests:**

```bash
# All tests
python -m pytest

# A single file
python -m pytest tests/test_fhir_factory.py -v

# With verbose output
python -m pytest -v
```

### 12.2 Create `tests/` directory structure

```bash
# From provider-ehr/
touch tests/__init__.py
```

### 12.3 `tests/test_fhir_factory.py` [CREATE]

These are pure unit tests. No network calls are made; no servers are started. Each test passes data to the factory functions and checks the return values.

```python
# tests/test_fhir_factory.py
# Unit tests for app/fhir_factory.py

import pytest
from app.fhir_factory import (
    load_fixture,
    build_draft_orders_bundle,
    build_conditions_bundle,
    build_procedures_bundle,
    build_crd_request,
)
from app.models import CdsHooksRequest


# ---- Fixture loading ----------------------------------------------------

def test_load_patient_fixture():
    patient = load_fixture("patient.json")
    assert isinstance(patient, dict)
    assert patient["resourceType"] == "Patient"
    assert patient["id"] == "demo-patient-001"


def test_load_condition_fixture():
    condition = load_fixture("condition-family-history.json")
    assert condition["resourceType"] == "Condition"
    # Confirm the high-risk ICD-10-CM code is present
    codes = [c["code"] for c in condition["code"]["coding"]]
    assert "Z80.0" in codes


def test_load_service_request_fixture():
    sr = load_fixture("service-request-colonoscopy.json")
    assert sr["resourceType"] == "ServiceRequest"
    assert sr["status"] == "draft"
    codes = [c["code"] for c in sr["code"]["coding"]]
    assert "45378" in codes


def test_load_prior_colonoscopy_fixture():
    procedure = load_fixture("prior-colonoscopy.json")
    assert procedure["resourceType"] == "Procedure"
    assert procedure["status"] == "completed"
    codes = [c["code"] for c in procedure["code"]["coding"]]
    assert "45378" in codes


def test_load_coverage_fixture():
    coverage = load_fixture("coverage.json")
    assert coverage["resourceType"] == "Coverage"
    assert coverage["status"] == "active"


def test_load_fixture_missing_file():
    with pytest.raises(FileNotFoundError):
        load_fixture("does-not-exist.json")


# ---- Bundle builders ----------------------------------------------------

def test_build_draft_orders_bundle():
    service_request = {"resourceType": "ServiceRequest", "id": "sr-1"}
    bundle = build_draft_orders_bundle(service_request)
    assert bundle["resourceType"] == "Bundle"
    assert bundle["type"] == "collection"
    assert bundle["entry"][0]["resource"] == service_request


def test_build_conditions_bundle():
    condition = {"resourceType": "Condition", "id": "c-1"}
    bundle = build_conditions_bundle(condition)
    assert bundle["resourceType"] == "Bundle"
    assert bundle["type"] == "searchset"
    assert bundle["total"] == 1
    assert bundle["entry"][0]["resource"] == condition


def test_build_procedures_bundle():
    procedure = {"resourceType": "Procedure", "id": "p-1"}
    bundle = build_procedures_bundle(procedure)
    assert bundle["resourceType"] == "Bundle"
    assert bundle["type"] == "searchset"
    assert bundle["total"] == 1
    assert bundle["entry"][0]["resource"] == procedure


# ---- build_crd_request --------------------------------------------------

def test_build_crd_request_returns_model():
    req = build_crd_request()
    assert isinstance(req, CdsHooksRequest)


def test_build_crd_request_hook():
    req = build_crd_request()
    assert req.hook == "order-sign"


def test_build_crd_request_patient_id():
    req = build_crd_request()
    assert req.context.patient_id == "demo-patient-001"


def test_build_crd_request_draft_orders_is_collection_bundle():
    req = build_crd_request()
    assert req.context.draft_orders["resourceType"] == "Bundle"
    assert req.context.draft_orders["type"] == "collection"


def test_build_crd_request_conditions_is_searchset_bundle():
    req = build_crd_request()
    conditions = req.prefetch["conditions"]
    assert conditions["resourceType"] == "Bundle"
    assert conditions["type"] == "searchset"


def test_build_crd_request_prior_procedures_is_searchset_bundle():
    req = build_crd_request()
    procedures = req.prefetch["priorProcedures"]
    assert procedures["resourceType"] == "Bundle"
    assert procedures["type"] == "searchset"


def test_build_crd_request_z80_condition_in_prefetch():
    req = build_crd_request()
    entries = req.prefetch["conditions"]["entry"]
    codes = [
        c["code"]
        for e in entries
        for c in e["resource"]["code"]["coding"]
    ]
    assert "Z80.0" in codes


def test_build_crd_request_45378_in_prior_procedures():
    req = build_crd_request()
    entries = req.prefetch["priorProcedures"]["entry"]
    codes = [
        c["code"]
        for e in entries
        for c in e["resource"]["code"]["coding"]
    ]
    assert "45378" in codes


def test_build_crd_request_authored_on_is_today():
    from datetime import date
    req = build_crd_request()
    # authoredOn is set to today in build_crd_request; confirm it matches
    entry = req.context.draft_orders["entry"][0]["resource"]
    assert entry["authoredOn"] == date.today().isoformat()


def test_build_crd_request_hook_instance_is_unique():
    req1 = build_crd_request()
    req2 = build_crd_request()
    assert req1.hook_instance != req2.hook_instance
```

### 12.4 `tests/test_cds_client.py` [CREATE]

These tests verify the CDS client's behavior without making real network calls. `unittest.mock.patch` replaces `httpx.AsyncClient` with a mock object whose `post` method returns a controlled response.

```python
# tests/test_cds_client.py
# Unit tests for app/cds_client.py — uses unittest.mock to avoid real network calls.

import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.cds_client import send_crd_request, get_last_request, get_last_response
from app.fhir_factory import build_crd_request
from app.models import CdsHooksResponse
import app.cds_client as cds_client_module


# A minimal valid CDS Hooks response body from the payer.
MOCK_PAYER_RESPONSE = {
    "cards": [
        {
            "summary": "High-risk family history supports 5-year colonoscopy interval",
            "indicator": "info",
            "source": {"label": "Demo Payer CRD Service", "url": "http://localhost:8080"},
            "detail": "ICD-10-CM Z80.0 confirms high-risk classification.",
            "links": [
                {
                    "label": "Colonoscopy Risk Documentation Checklist",
                    "url": "http://localhost:8080/questionnaires/colonoscopy-risk",
                    "type": "absolute",
                }
            ],
        }
    ]
}


def make_mock_response(status_code: int = 200, body: dict = MOCK_PAYER_RESPONSE):
    """Build a mock HTTPX Response object with controlled status and body."""
    mock_resp = MagicMock()
    mock_resp.status_code = status_code
    mock_resp.json.return_value = body
    # raise_for_status does nothing for 2xx; raises HTTPStatusError for 4xx/5xx
    if status_code >= 400:
        import httpx
        mock_resp.raise_for_status.side_effect = httpx.HTTPStatusError(
            message=f"HTTP {status_code}",
            request=MagicMock(),
            response=mock_resp,
        )
    else:
        mock_resp.raise_for_status.return_value = None
    return mock_resp


@pytest.fixture
def crd_request():
    return build_crd_request()


@pytest.mark.asyncio
async def test_send_crd_request_returns_response_model(crd_request):
    mock_resp = make_mock_response()
    with patch("app.cds_client.httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(return_value=mock_resp)
        mock_client_cls.return_value = mock_client

        result = await send_crd_request(crd_request)

    assert isinstance(result, CdsHooksResponse)
    assert len(result.cards) == 1
    assert result.cards[0].indicator == "info"


@pytest.mark.asyncio
async def test_send_crd_request_posts_to_correct_url(crd_request):
    from app.config import settings
    mock_resp = make_mock_response()
    with patch("app.cds_client.httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(return_value=mock_resp)
        mock_client_cls.return_value = mock_client

        await send_crd_request(crd_request)

        called_url = mock_client.post.call_args[0][0]
        assert called_url == settings.payer_crd_url + "/cds-services/crd-order-sign"


@pytest.mark.asyncio
async def test_send_crd_request_stores_last_request(crd_request):
    mock_resp = make_mock_response()
    with patch("app.cds_client.httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(return_value=mock_resp)
        mock_client_cls.return_value = mock_client

        await send_crd_request(crd_request)

    stored = get_last_request()
    assert stored is not None
    assert stored["hook"] == "order-sign"
    assert "hookInstance" in stored


@pytest.mark.asyncio
async def test_send_crd_request_stores_last_response(crd_request):
    mock_resp = make_mock_response()
    with patch("app.cds_client.httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(return_value=mock_resp)
        mock_client_cls.return_value = mock_client

        await send_crd_request(crd_request)

    stored = get_last_response()
    assert stored is not None
    assert "cards" in stored


@pytest.mark.asyncio
async def test_send_crd_request_raises_on_payer_error(crd_request):
    import httpx
    with patch("app.cds_client.httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(side_effect=httpx.RequestError("connection refused"))
        mock_client_cls.return_value = mock_client

        with pytest.raises(httpx.RequestError):
            await send_crd_request(crd_request)


@pytest.mark.asyncio
async def test_send_crd_request_raises_on_non_200(crd_request):
    import httpx
    mock_resp = make_mock_response(status_code=500)
    with patch("app.cds_client.httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(return_value=mock_resp)
        mock_client_cls.return_value = mock_client

        with pytest.raises(httpx.HTTPStatusError):
            await send_crd_request(crd_request)
```

### 12.5 `tests/test_routes.py` [CREATE]

Route tests use FastAPI's `TestClient` — a synchronous wrapper around the ASGI app that makes HTTP requests in-process without a running server. `cds_client.send_crd_request` is patched with `monkeypatch` so no real payer call is made.

```python
# tests/test_routes.py
# Integration tests for clinician and debug routes.

import pytest
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient

from app.main import app
from app.models import CdsHooksResponse, CdsCard, CdsSource


# Build a minimal mock CdsHooksResponse for use in CRD route tests.
def make_mock_response() -> CdsHooksResponse:
    return CdsHooksResponse(cards=[
        CdsCard(
            summary="High-risk family history supports 5-year interval",
            indicator="info",
            source=CdsSource(label="Demo Payer CRD Service", url="http://localhost:8080"),
            detail="Coverage confirmed.",
            links=[],
        )
    ])


@pytest.fixture
def client():
    return TestClient(app)


# ---- Dashboard ----------------------------------------------------------

def test_dashboard_returns_200(client):
    response = client.get("/")
    assert response.status_code == 200


def test_dashboard_contains_app_name(client):
    response = client.get("/")
    assert "Provider EHR" in response.text


# ---- Patient chart ------------------------------------------------------

def test_patient_chart_returns_200(client):
    response = client.get("/patients/demo-patient-001")
    assert response.status_code == 200


def test_patient_chart_contains_patient_name(client):
    response = client.get("/patients/demo-patient-001")
    assert "Doe" in response.text


def test_patient_chart_contains_icd_code(client):
    response = client.get("/patients/demo-patient-001")
    assert "Z80.0" in response.text


def test_patient_chart_unknown_patient_returns_404(client):
    response = client.get("/patients/unknown-patient-999")
    assert response.status_code == 404


# ---- CRD trigger --------------------------------------------------------

def test_trigger_crd_returns_200_with_mocked_payer(client):
    with patch("app.routes.clinician.cds_client.send_crd_request",
               new_callable=AsyncMock, return_value=make_mock_response()):
        response = client.post("/orders/colonoscopy/crd")
    assert response.status_code == 200


def test_trigger_crd_renders_card_summary(client):
    with patch("app.routes.clinician.cds_client.send_crd_request",
               new_callable=AsyncMock, return_value=make_mock_response()):
        response = client.post("/orders/colonoscopy/crd")
    assert "High-risk family history" in response.text


def test_trigger_crd_renders_error_when_payer_unreachable(client):
    import httpx
    with patch("app.routes.clinician.cds_client.send_crd_request",
               new_callable=AsyncMock,
               side_effect=httpx.RequestError("connection refused")):
        response = client.post("/orders/colonoscopy/crd")
    assert response.status_code == 200
    assert "unreachable" in response.text.lower()


# ---- Debug routes -------------------------------------------------------

def test_debug_last_crd_request_returns_json(client):
    response = client.get("/debug/last-crd-request")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")


def test_debug_last_crd_response_returns_json(client):
    response = client.get("/debug/last-crd-response")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")


def test_debug_last_crd_request_message_before_trigger(client):
    # Before any CRD trigger in this test session the response should include
    # the informational message rather than a payload.
    response = client.get("/debug/last-crd-request")
    body = response.json()
    assert "message" in body
```

### 12.6 `pytest.ini` configuration [CREATE]

`pytest-asyncio` requires a configuration setting to enable async test discovery. Create `provider-ehr/pytest.ini`:

```ini
[pytest]
asyncio_mode = auto
```

### 12.7 Run the Full Test Suite

```bash
python -m pytest
```

All tests should pass. With verbose output:

```bash
python -m pytest -v
```

To run a single file while debugging:

```bash
python -m pytest tests/test_fhir_factory.py -v
```

---

## Section 13 — End-to-End Verification

### 13.1 Start Both Services

Open two terminal windows.

**Terminal 1 — Payer CRD Service:**

```bash
cd payer-crd
bun run dev
```

Expected output: `Payer CRD listening on port 8080`

**Terminal 2 — Provider EHR:**

```bash
cd provider-ehr
source .venv/bin/activate
uvicorn app.main:app --reload --port 8000
```

Expected output: `Uvicorn running on http://127.0.0.1:8000`

### 13.2 Browser Test

Open `http://localhost:8000` in a browser.

1. The dashboard renders with the "Application running" status badge and a link to the demo patient chart.
2. Click **Open Patient Chart →** — the chart renders with the patient header, active conditions (Z80.0), draft order (CPT 45378), prior procedure (2021-06-03), and the CRD trigger section.
3. Click **Check Coverage Requirements** — the spinner appears briefly, then the CDS Cards panel populates with the payer's response. The card should show an `info` indicator and the high-risk coverage confirmation with rendered Markdown (formatted headings and bullet list).

### 13.3 Verify Debug Endpoints

After triggering CRD from the browser:

```bash
# View the request that was sent to the payer
curl http://localhost:8000/debug/last-crd-request | python3 -m json.tool

# View the response received from the payer
curl http://localhost:8000/debug/last-crd-response | python3 -m json.tool
```

Both should return well-formed JSON. The request should include `hookInstance`, `context.userId`, `context.draftOrders`, and the `prefetch` bundle. The response should include `cards[0].indicator`.

### 13.4 Trigger via curl

The CRD exchange can also be triggered without a browser:

```bash
curl -X POST http://localhost:8000/orders/colonoscopy/crd
```

This returns the `cds_cards.html` HTML fragment that HTMX would normally inject into the page — useful for confirming the server-side rendering without opening a browser.

### 13.5 Final Checklist

- [ ] `GET /` returns HTTP 200 with the dashboard and patient link
- [ ] `GET /patients/demo-patient-001` returns HTTP 200 with the full patient chart
- [ ] `GET /patients/unknown-id` returns HTTP 404
- [ ] Clicking "Check Coverage Requirements" renders CDS Cards with formatted Markdown
- [ ] `GET /debug/last-crd-request` returns the outgoing CDS Hooks payload
- [ ] `GET /debug/last-crd-response` returns the payer's CDS Cards payload
- [ ] `python -m pytest` passes all tests
- [ ] Payer unreachable: clicking the CRD button shows the "unreachable" error message inline
