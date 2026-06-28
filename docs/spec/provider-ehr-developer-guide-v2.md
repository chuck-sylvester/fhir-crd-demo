# Provider EHR Simulator v2 — Developer Guide

This guide walks through a clean-room implementation of the Python Provider EHR Simulator for the `fhir-crd-demo2` repository. The v2 application keeps the same technology stack as the first version, but uses a new clinical scenario: **Lumbar Spine MRI Coverage Discovery**.

Every section is self-contained. The guide is written for a brand-new empty repository, so every file and directory is labelled **[CREATE]**.

The companion payer guide is `docs/spec/payer-crd-developer-guide-v2.md`.

---

## Table of Contents

1. Background and Architecture
2. Project Configuration
3. Application Settings
4. Pydantic Data Models
5. FHIR Fixtures
6. FHIR Factory
7. CDS Client
8. Application Entry Point
9. Custom Stylesheet
10. HTML Templates
11. Routes
12. Testing
13. End-to-End Verification

---

## Section 1 — Background and Architecture [CREATE]

### 1.1 What This Service Does

The Provider EHR Simulator is a Python web application that plays the role of an Electronic Health Record system in a Coverage Requirements Discovery (CRD) workflow. It gives a simulated clinician a patient chart view, a draft lumbar spine MRI order, and an inline panel that displays coverage guidance cards returned by the payer.

The application acts as a **CDS Hooks client**. When the clinician triggers coverage discovery, the EHR assembles a structured CDS Hooks `order-sign` request and sends it to the Bun + Hono Payer CRD Service. The payer evaluates its coverage rules and returns CDS Cards. The EHR renders those cards into the patient chart without a full page reload.

In v2, all clinical data is synthetic and fixture-based. The EHR does not connect to a database, a FHIR server, SMART authorization, or a real payer.

### 1.2 Clinical Scenario: Lumbar Spine MRI Coverage Discovery

The simulated clinician is ordering an **MRI lumbar spine without contrast** for a patient with persistent low back pain and radiculopathy symptoms. Payers commonly require documentation that conservative therapy has been attempted before advanced imaging is covered, unless red-flag findings are present.

This scenario is intentionally chosen because it exercises a different CRD pattern than the colonoscopy version:

- The order is for diagnostic imaging rather than preventive screening.
- The payer rule focuses on documentation of conservative therapy and red flags.
- The prefetch data includes conditions, observations, procedures, and coverage.
- The payer can return DTR-style questionnaire links as placeholders without implementing DTR.

### 1.3 CDS Hooks Protocol

The hook used in this demo is `order-sign`, which fires when a clinician is about to sign a draft order.

| Method | Path | Owner | Purpose |
|--------|------|-------|---------|
| `GET` | `/cds-services` | Payer CRD | Discovery metadata |
| `POST` | `/cds-services/crd-order-sign` | Payer CRD | CRD evaluation for the draft MRI order |

The Provider EHR implements the client side of this exchange:

1. Build FHIR resources from local fixture files.
2. Wrap those resources in a CDS Hooks request.
3. POST the request to the payer.
4. Parse the CDS Hooks response.
5. Render CDS Cards in the clinician workflow.

### 1.4 Expected Card Outcomes

The payer guide defines the actual rule engine. The EHR must be prepared to render these likely outcomes:

| Outcome | Indicator | Meaning |
|---------|-----------|---------|
| `documentation-sufficient` | `info` | Conservative therapy documentation supports the imaging order |
| `red-flags-present` | `warning` | Red-flag findings support expedited imaging review |
| `documentation-needed` | `warning` | Required conservative therapy documentation is missing or incomplete |
| `prior-auth-likely` | `warning` | Prior authorization is likely; launch placeholder documentation workflow |

### 1.5 FHIR Resources

The EHR assembles these FHIR R4 resources:

| Resource | Purpose |
|----------|---------|
| `Patient` | Synthetic patient demographics |
| `Coverage` | Active payer coverage |
| `ServiceRequest` | Draft MRI lumbar spine order |
| `Condition` | Low back pain and/or radiculopathy diagnoses |
| `Observation` | Conservative therapy duration and red-flag findings |
| `Procedure` | Completed physical therapy or conservative management activity |
| `Bundle` | Container for `draftOrders` and multi-resource prefetch values |

Clinical codes are deliberately limited to the fields consumed by the demo rule engine.

| Standard | Code | Meaning |
|----------|------|---------|
| CPT | `72148` | MRI lumbar spine without contrast |
| ICD-10-CM | `M54.50` | Low back pain, unspecified |
| ICD-10-CM | `M54.16` | Radiculopathy, lumbar region |
| LOINC | `89261-2` | Conservative therapy duration |
| SNOMED CT | `707445000` | Red flag symptom absent/present placeholder for demo use |

### 1.6 Technology Stack

| Component | Choice | Purpose |
|-----------|--------|---------|
| Runtime | Python 3.12 | Application runtime |
| Web framework | FastAPI | Routing and ASGI integration |
| ASGI server | Uvicorn | Local development server |
| HTTP client | HTTPX | Async outbound CDS Hooks request |
| Templating | Jinja2 | Server-rendered clinician UI |
| UI interactivity | HTMX | Partial-page updates |
| Styling | Custom static CSS | Full control over visual design; no Tailwind |
| Data models | Pydantic v2 | Runtime validation and JSON serialization |
| Configuration | pydantic-settings | `.env` and environment loading |
| Markdown rendering | markdown | Render CDS Card `detail` fields |
| Testing | pytest + pytest-asyncio | Unit and route tests |

### 1.7 Two-Application Architecture

```text
--------------------------------------------------------------+
| Provider Environment                                         |
|                                                              |
|  Python Provider EHR Simulator                               |
|  FastAPI + Jinja2 + HTMX + custom CSS + HTTPX                |
|  http://localhost:8000                                       |
|                                                              |
|  - Clinician dashboard                                       |
|  - Patient chart                                             |
|  - Draft lumbar spine MRI order                              |
|  - CDS Hooks client                                          |
|  - CDS Card rendering                                        |
+-----------------------------|--------------------------------+
                              |
                              | POST /cds-services/crd-order-sign
                              v
+--------------------------------------------------------------+
| Payer Environment                                             |
|                                                              |
|  Bun + Hono Payer CRD Service                                 |
|  http://localhost:8080                                        |
|                                                              |
|  - Discovery metadata                                         |
|  - Rule evaluation                                            |
|  - CDS Cards                                                  |
|  - Placeholder DTR questionnaire links                        |
+--------------------------------------------------------------+
```

---

## Section 2 — Project Configuration [CREATE]

### 2.1 Directory Structure

Create this structure inside the new `fhir-crd-demo2` repository:

```text
provider-ehr/
|-- app/
|   |-- __init__.py
|   |-- main.py
|   |-- config.py
|   |-- models.py
|   |-- fhir_factory.py
|   |-- cds_client.py
|   |-- routes/
|   |   |-- __init__.py
|   |   |-- clinician.py
|   |   |-- api.py
|   |-- templates/
|   |   |-- base.html
|   |   |-- dashboard.html
|   |   |-- patient_chart.html
|   |   |-- cds_cards.html
|   |-- static/
|   |   |-- css/
|   |       |-- main.css
|   |-- fixtures/
|       |-- patient.json
|       |-- coverage.json
|       |-- condition-low-back-pain.json
|       |-- condition-lumbar-radiculopathy.json
|       |-- observation-conservative-therapy.json
|       |-- observation-red-flags.json
|       |-- procedure-physical-therapy.json
|       |-- service-request-lumbar-mri.json
|-- tests/
|   |-- __init__.py
|   |-- test_fhir_factory.py
|   |-- test_cds_client.py
|   |-- test_routes.py
|-- .env
|-- .env.example
|-- requirements.txt
```

### 2.2 `requirements.txt`

Create `provider-ehr/requirements.txt`:

```text
fastapi==0.115.4
uvicorn[standard]==0.32.1
httpx==0.27.2
jinja2==3.1.4
aiofiles==24.1.0
markdown==3.7
pydantic==2.9.2
pydantic-settings==2.6.1
python-dotenv==1.0.1
pytest==8.3.3
pytest-asyncio==0.24.0
```

### 2.3 `.env`

Create `provider-ehr/.env` for local development:

```text
APP_NAME="Provider EHR v2"
APP_VERSION="0.1.0"
APP_ENV=development
LOG_LEVEL=INFO
PAYER_CRD_URL=http://localhost:8080
```

### 2.4 `.env.example`

Create `provider-ehr/.env.example`:

```text
# provider-ehr environment configuration
# Copy this file to .env and fill in local values.

APP_NAME="Provider EHR v2"
APP_VERSION="0.1.0"
APP_ENV=development
LOG_LEVEL=INFO
PAYER_CRD_URL=http://localhost:8080
```

### 2.5 Local Setup

Run from `provider-ehr/`:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

---

## Section 3 — Application Settings [CREATE]

Create `provider-ehr/app/config.py`:

```python
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "Provider EHR v2"
    app_version: str = "0.1.0"
    app_env: str = "development"
    log_level: str = "INFO"
    app_debug: bool = True
    payer_crd_url: str


settings = Settings()
```

The module-level `settings` object is imported by route handlers and the CDS client. Keep the payer URL in configuration rather than hardcoding it into the HTTP client.

---

## Section 4 — Pydantic Data Models [CREATE]

Create `provider-ehr/app/models.py`:

```python
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class CdsHooksContext(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    user_id: str
    patient_id: str
    encounter_id: str | None = None
    draft_orders: dict


class CdsHooksRequest(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    hook: str
    hook_instance: str
    fhir_server: str | None = None
    context: CdsHooksContext
    prefetch: dict


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
    links: list[CdsLink] = Field(default_factory=list)


class CdsHooksResponse(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    cards: list[CdsCard]
```

The alias generator is required because CDS Hooks uses camelCase JSON keys while Python code should stay snake_case.

---

## Section 5 — FHIR Fixtures [CREATE]

Create each fixture in `provider-ehr/app/fixtures/`.

### 5.1 `patient.json`

```json
{
  "resourceType": "Patient",
  "id": "demo-patient-001",
  "identifier": [
    {
      "system": "http://example.org/mrn",
      "value": "MRI-0001"
    }
  ],
  "name": [
    {
      "family": "Rivera",
      "given": ["Elena"]
    }
  ],
  "gender": "female",
  "birthDate": "1980-04-12"
}
```

### 5.2 `coverage.json`

```json
{
  "resourceType": "Coverage",
  "id": "demo-coverage-001",
  "status": "active",
  "beneficiary": {
    "reference": "Patient/demo-patient-001"
  },
  "payor": [
    {
      "display": "Demo Payer CRD Inc."
    }
  ],
  "class": [
    {
      "type": {
        "text": "Commercial PPO"
      },
      "value": "DEMO-PPO"
    }
  ]
}
```

### 5.3 `condition-low-back-pain.json`

```json
{
  "resourceType": "Condition",
  "id": "condition-low-back-pain",
  "clinicalStatus": {
    "coding": [
      {
        "system": "http://terminology.hl7.org/CodeSystem/condition-clinical",
        "code": "active"
      }
    ]
  },
  "code": {
    "coding": [
      {
        "system": "http://hl7.org/fhir/sid/icd-10-cm",
        "code": "M54.50",
        "display": "Low back pain, unspecified"
      }
    ],
    "text": "Persistent low back pain"
  },
  "subject": {
    "reference": "Patient/demo-patient-001"
  }
}
```

### 5.4 `condition-lumbar-radiculopathy.json`

```json
{
  "resourceType": "Condition",
  "id": "condition-lumbar-radiculopathy",
  "clinicalStatus": {
    "coding": [
      {
        "system": "http://terminology.hl7.org/CodeSystem/condition-clinical",
        "code": "active"
      }
    ]
  },
  "code": {
    "coding": [
      {
        "system": "http://hl7.org/fhir/sid/icd-10-cm",
        "code": "M54.16",
        "display": "Radiculopathy, lumbar region"
      }
    ],
    "text": "Lumbar radiculopathy"
  },
  "subject": {
    "reference": "Patient/demo-patient-001"
  }
}
```

### 5.5 `observation-conservative-therapy.json`

```json
{
  "resourceType": "Observation",
  "id": "observation-conservative-therapy",
  "status": "final",
  "code": {
    "coding": [
      {
        "system": "http://loinc.org",
        "code": "89261-2",
        "display": "Conservative therapy duration"
      }
    ],
    "text": "Conservative therapy duration"
  },
  "subject": {
    "reference": "Patient/demo-patient-001"
  },
  "valueQuantity": {
    "value": 6,
    "unit": "weeks",
    "system": "http://unitsofmeasure.org",
    "code": "wk"
  }
}
```

### 5.6 `observation-red-flags.json`

```json
{
  "resourceType": "Observation",
  "id": "observation-red-flags",
  "status": "final",
  "code": {
    "coding": [
      {
        "system": "http://snomed.info/sct",
        "code": "707445000",
        "display": "Red flag symptom assessment"
      }
    ],
    "text": "Red flag symptom assessment"
  },
  "subject": {
    "reference": "Patient/demo-patient-001"
  },
  "valueBoolean": false
}
```

### 5.7 `procedure-physical-therapy.json`

```json
{
  "resourceType": "Procedure",
  "id": "procedure-physical-therapy",
  "status": "completed",
  "code": {
    "text": "Supervised physical therapy for low back pain"
  },
  "subject": {
    "reference": "Patient/demo-patient-001"
  },
  "performedPeriod": {
    "start": "2026-04-01",
    "end": "2026-05-13"
  }
}
```

### 5.8 `service-request-lumbar-mri.json`

```json
{
  "resourceType": "ServiceRequest",
  "id": "service-request-lumbar-mri",
  "status": "draft",
  "intent": "order",
  "code": {
    "coding": [
      {
        "system": "http://www.ama-assn.org/go/cpt",
        "code": "72148",
        "display": "MRI lumbar spine without contrast"
      }
    ],
    "text": "MRI lumbar spine without contrast"
  },
  "subject": {
    "reference": "Patient/demo-patient-001"
  },
  "reasonReference": [
    {
      "reference": "Condition/condition-low-back-pain"
    },
    {
      "reference": "Condition/condition-lumbar-radiculopathy"
    }
  ]
}
```

---

## Section 6 — FHIR Factory [CREATE]

Create `provider-ehr/app/fhir_factory.py`:

```python
import json
import uuid
from datetime import date
from pathlib import Path

from app.models import CdsHooksContext, CdsHooksRequest


FIXTURES_DIR = Path(__file__).parent / "fixtures"


def load_fixture(filename: str) -> dict:
    path = FIXTURES_DIR / filename
    with open(path, encoding="utf-8") as fixture_file:
        return json.load(fixture_file)


def bundle(resources: list[dict], bundle_type: str = "searchset") -> dict:
    result = {
        "resourceType": "Bundle",
        "type": bundle_type,
        "entry": [{"resource": resource} for resource in resources],
    }

    if bundle_type == "searchset":
        result["total"] = len(resources)

    return result


def build_crd_request() -> CdsHooksRequest:
    patient = load_fixture("patient.json")
    coverage = load_fixture("coverage.json")
    low_back_pain = load_fixture("condition-low-back-pain.json")
    radiculopathy = load_fixture("condition-lumbar-radiculopathy.json")
    conservative_therapy = load_fixture("observation-conservative-therapy.json")
    red_flags = load_fixture("observation-red-flags.json")
    physical_therapy = load_fixture("procedure-physical-therapy.json")
    service_request = load_fixture("service-request-lumbar-mri.json")

    service_request = {
        **service_request,
        "authoredOn": date.today().isoformat(),
    }

    context = CdsHooksContext(
        user_id="PractitionerRole/demo-clinician",
        patient_id="demo-patient-001",
        encounter_id="demo-encounter-001",
        draft_orders=bundle([service_request], bundle_type="collection"),
    )

    prefetch = {
        "patient": patient,
        "coverage": coverage,
        "conditions": bundle([low_back_pain, radiculopathy]),
        "observations": bundle([conservative_therapy, red_flags]),
        "procedures": bundle([physical_therapy]),
    }

    return CdsHooksRequest(
        hook="order-sign",
        hook_instance=str(uuid.uuid4()),
        fhir_server="http://localhost:8000/fhir",
        context=context,
        prefetch=prefetch,
    )
```

Note: `total` is meaningful for `searchset` bundles. For `collection` bundles, the factory omits `total`.

---

## Section 7 — CDS Client [CREATE]

Create `provider-ehr/app/cds_client.py`:

```python
import httpx

from app.config import settings
from app.models import CdsHooksRequest, CdsHooksResponse


async def send_crd_request(request: CdsHooksRequest) -> CdsHooksResponse:
    url = f"{settings.payer_crd_url.rstrip('/')}/cds-services/crd-order-sign"
    payload = request.model_dump(by_alias=True, exclude_none=True)

    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.post(url, json=payload)
        response.raise_for_status()
        return CdsHooksResponse.model_validate(response.json())
```

The client serializes with `by_alias=True` so `hook_instance` becomes `hookInstance` and `draft_orders` becomes `draftOrders`.

---

## Section 8 — Application Entry Point [CREATE]

Create `provider-ehr/app/main.py`:

```python
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.routes import api, clinician


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    debug=settings.app_debug,
)

app.mount("/static", StaticFiles(directory="app/static"), name="static")
app.include_router(clinician.router)
app.include_router(api.router)
```

Create empty package markers:

```text
provider-ehr/app/__init__.py
provider-ehr/app/routes/__init__.py
```

---

## Section 9 — Custom Stylesheet [CREATE]

Create `provider-ehr/app/static/css/main.css`.

The v2 application intentionally uses a custom stylesheet rather than Tailwind. Keep the CSS organized with comments so the design remains teachable.

```css
:root {
  --color-page: #f6f7f9;
  --color-surface: #ffffff;
  --color-border: #d9dee7;
  --color-text: #1f2937;
  --color-muted: #5f6b7a;
  --color-primary: #2457a6;
  --color-primary-dark: #183f7d;
  --color-info-bg: #e9f3ff;
  --color-warning-bg: #fff4dc;
  --shadow-sm: 0 1px 2px rgba(15, 23, 42, 0.08);
  --radius: 8px;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--color-page);
  color: var(--color-text);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  line-height: 1.5;
}

a {
  color: var(--color-primary);
}

.app-shell {
  min-height: 100vh;
}

.topbar {
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  box-shadow: var(--shadow-sm);
}

.topbar-inner,
.page {
  max-width: 1120px;
  margin: 0 auto;
  padding: 0 24px;
}

.topbar-inner {
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.brand {
  font-weight: 700;
  letter-spacing: 0;
}

.page {
  padding-top: 28px;
  padding-bottom: 48px;
}

.page-title {
  margin: 0 0 6px;
  font-size: 28px;
  line-height: 1.2;
}

.page-subtitle {
  margin: 0 0 24px;
  color: var(--color-muted);
}

.panel {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-sm);
  padding: 20px;
}

.grid-two {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(320px, 420px);
  gap: 20px;
  align-items: start;
}

.section-title {
  margin: 0 0 12px;
  font-size: 18px;
}

.facts {
  display: grid;
  grid-template-columns: 160px 1fr;
  gap: 8px 16px;
  margin: 0;
}

.facts dt {
  color: var(--color-muted);
}

.facts dd {
  margin: 0;
  font-weight: 600;
}

.button-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 42px;
  padding: 0 16px;
  border: 0;
  border-radius: 6px;
  background: var(--color-primary);
  color: #fff;
  font-weight: 700;
  cursor: pointer;
}

.button-primary:hover {
  background: var(--color-primary-dark);
}

.card-list {
  display: grid;
  gap: 12px;
}

.cds-card {
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 16px;
  background: var(--color-surface);
}

.cds-card.info {
  background: var(--color-info-bg);
}

.cds-card.warning {
  background: var(--color-warning-bg);
}

.cds-card h3 {
  margin: 0 0 8px;
  font-size: 16px;
}

.card-detail {
  color: var(--color-text);
}

.error-panel {
  border-color: #e11d48;
  background: #fff1f2;
}

@media (max-width: 800px) {
  .grid-two {
    grid-template-columns: 1fr;
  }

  .facts {
    grid-template-columns: 1fr;
  }
}
```

---

## Section 10 — HTML Templates [CREATE]

### 10.1 `base.html`

Create `provider-ehr/app/templates/base.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{{ app_name | default("Provider EHR v2") }}</title>
    <link rel="stylesheet" href="{{ url_for('static', path='/css/main.css') }}">
    <script src="https://unpkg.com/htmx.org@2.0.4"></script>
  </head>
  <body>
    <div class="app-shell">
      <header class="topbar">
        <div class="topbar-inner">
          <div class="brand">{{ app_name | default("Provider EHR v2") }}</div>
          <nav><a href="/">Dashboard</a></nav>
        </div>
      </header>
      <main class="page">
        {% block content %}{% endblock %}
      </main>
    </div>
  </body>
</html>
```

### 10.2 `dashboard.html`

Create `provider-ehr/app/templates/dashboard.html`:

```html
{% extends "base.html" %}

{% block content %}
  <h1 class="page-title">Clinician Dashboard</h1>
  <p class="page-subtitle">Open the demo patient chart to review and sign a draft lumbar spine MRI order.</p>

  <section class="panel">
    <h2 class="section-title">Scheduled Patient</h2>
    <dl class="facts">
      <dt>Patient</dt>
      <dd>Elena Rivera</dd>
      <dt>Scenario</dt>
      <dd>Lumbar spine MRI coverage discovery</dd>
      <dt>Action</dt>
      <dd><a href="/patients/{{ patient_id }}">Open patient chart</a></dd>
    </dl>
  </section>
{% endblock %}
```

### 10.3 `patient_chart.html`

Create `provider-ehr/app/templates/patient_chart.html`:

```html
{% extends "base.html" %}

{% block content %}
  <h1 class="page-title">{{ patient.name[0].given[0] }} {{ patient.name[0].family }}</h1>
  <p class="page-subtitle">Draft order: MRI lumbar spine without contrast</p>

  <div class="grid-two">
    <section class="panel">
      <h2 class="section-title">Clinical Summary</h2>
      <dl class="facts">
        <dt>Patient ID</dt>
        <dd>{{ patient.id }}</dd>
        <dt>Age</dt>
        <dd>{{ age }}</dd>
        <dt>Coverage</dt>
        <dd>{{ coverage.payor[0].display }}</dd>
        <dt>Diagnosis</dt>
        <dd>{{ conditions[0].code.text }}; {{ conditions[1].code.text }}</dd>
        <dt>Conservative therapy</dt>
        <dd>{{ conservative_therapy.valueQuantity.value }} {{ conservative_therapy.valueQuantity.unit }}</dd>
        <dt>Red flags</dt>
        <dd>{% if red_flags.valueBoolean %}Present{% else %}Not documented{% endif %}</dd>
      </dl>
    </section>

    <aside class="panel">
      <h2 class="section-title">Coverage Requirements</h2>
      <p>Run CRD before signing the order.</p>
      <button
        class="button-primary"
        hx-post="/orders/lumbar-mri/crd"
        hx-target="#cds-card-panel"
        hx-swap="innerHTML">
        Check Coverage Requirements
      </button>
      <div id="cds-card-panel" class="card-list" style="margin-top: 16px;"></div>
    </aside>
  </div>
{% endblock %}
```

### 10.4 `cds_cards.html`

Create `provider-ehr/app/templates/cds_cards.html`:

```html
{% if error %}
  <div class="cds-card error-panel">
    <h3>Unable to complete coverage discovery</h3>
    <p>{{ error }}</p>
  </div>
{% elif cards %}
  {% for card in cards %}
    <article class="cds-card {{ card.indicator }}">
      <h3>{{ card.summary }}</h3>
      {% if card.detail %}
        <div class="card-detail">{{ card.detail | markdown | safe }}</div>
      {% endif %}
      {% if card.links %}
        <ul>
          {% for link in card.links %}
            <li><a href="{{ link.url }}" target="_blank" rel="noreferrer">{{ link.label }}</a></li>
          {% endfor %}
        </ul>
      {% endif %}
    </article>
  {% endfor %}
{% else %}
  <div class="cds-card info">
    <h3>No payer guidance returned</h3>
    <p>The payer returned an empty CDS Cards array.</p>
  </div>
{% endif %}
```

---

## Section 11 — Routes [CREATE]

### 11.1 `routes/clinician.py`

Create `provider-ehr/app/routes/clinician.py`:

```python
from datetime import date
import os

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from markdown import markdown as md_to_html

from app import cds_client, fhir_factory
from app.config import settings


router = APIRouter()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TEMPLATES_DIR = os.path.normpath(os.path.join(BASE_DIR, "..", "templates"))
templates = Jinja2Templates(directory=TEMPLATES_DIR)
templates.env.filters["markdown"] = md_to_html

if settings.app_env == "development":
    templates.env.auto_reload = True


@router.get("/", response_class=HTMLResponse)
async def dashboard(request: Request):
    return templates.TemplateResponse(
        request,
        "dashboard.html",
        {"app_name": settings.app_name, "patient_id": "demo-patient-001"},
    )


@router.get("/patients/{patient_id}", response_class=HTMLResponse)
async def patient_chart(request: Request, patient_id: str):
    if patient_id != "demo-patient-001":
        return HTMLResponse(content="Patient not found.", status_code=404)

    patient = fhir_factory.load_fixture("patient.json")
    coverage = fhir_factory.load_fixture("coverage.json")
    conditions = [
        fhir_factory.load_fixture("condition-low-back-pain.json"),
        fhir_factory.load_fixture("condition-lumbar-radiculopathy.json"),
    ]
    conservative_therapy = fhir_factory.load_fixture("observation-conservative-therapy.json")
    red_flags = fhir_factory.load_fixture("observation-red-flags.json")

    today = date.today()
    birth_date = date.fromisoformat(patient["birthDate"])
    age = today.year - birth_date.year - (
        (today.month, today.day) < (birth_date.month, birth_date.day)
    )

    return templates.TemplateResponse(
        request,
        "patient_chart.html",
        {
            "app_name": settings.app_name,
            "patient": patient,
            "age": age,
            "coverage": coverage,
            "conditions": conditions,
            "conservative_therapy": conservative_therapy,
            "red_flags": red_flags,
        },
    )


@router.post("/orders/lumbar-mri/crd", response_class=HTMLResponse)
async def trigger_crd(request: Request):
    try:
        crd_request = fhir_factory.build_crd_request()
        cds_response = await cds_client.send_crd_request(crd_request)
        return templates.TemplateResponse(
            request,
            "cds_cards.html",
            {"cards": cds_response.cards, "error": None},
        )
    except httpx.RequestError:
        return templates.TemplateResponse(
            request,
            "cds_cards.html",
            {
                "cards": [],
                "error": f"The payer CRD service is unreachable at {settings.payer_crd_url}.",
            },
        )
    except httpx.HTTPStatusError as exc:
        return templates.TemplateResponse(
            request,
            "cds_cards.html",
            {
                "cards": [],
                "error": f"The payer CRD service returned HTTP {exc.response.status_code}.",
            },
        )
```

### 11.2 `routes/api.py`

Create `provider-ehr/app/routes/api.py`:

```python
from fastapi import APIRouter

from app import fhir_factory


router = APIRouter(prefix="/debug")


@router.get("/sample-crd-request")
async def sample_crd_request():
    request = fhir_factory.build_crd_request()
    return request.model_dump(by_alias=True, exclude_none=True)
```

---

## Section 12 — Testing [CREATE]

Create `provider-ehr/tests/test_fhir_factory.py`:

```python
from app import fhir_factory


def test_build_crd_request_contains_lumbar_mri_order():
    request = fhir_factory.build_crd_request()
    payload = request.model_dump(by_alias=True, exclude_none=True)

    assert payload["hook"] == "order-sign"
    order = payload["context"]["draftOrders"]["entry"][0]["resource"]
    codes = order["code"]["coding"]
    assert any(code["code"] == "72148" for code in codes)


def test_prefetch_contains_observations_and_procedures():
    request = fhir_factory.build_crd_request()
    payload = request.model_dump(by_alias=True, exclude_none=True)

    assert "observations" in payload["prefetch"]
    assert "procedures" in payload["prefetch"]
```

Create `provider-ehr/tests/test_routes.py`:

```python
import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.mark.asyncio
async def test_dashboard_renders():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/")

    assert response.status_code == 200
    assert "Clinician Dashboard" in response.text
```

Run tests:

```bash
pytest
```

---

## Section 13 — End-to-End Verification [CREATE]

Start the payer first:

```bash
cd payer-crd
bun install
bun run dev
```

Start the EHR in another terminal:

```bash
cd provider-ehr
source .venv/bin/activate
uvicorn app.main:app --reload --port 8000
```

Open:

```text
http://localhost:8000
```

Expected behavior:

1. Dashboard renders.
2. Patient chart opens for Elena Rivera.
3. The chart displays the lumbar MRI order context.
4. Clicking **Check Coverage Requirements** sends a CDS Hooks request.
5. The payer returns CDS Cards.
6. HTMX inserts the cards into the patient chart.

The implementation is complete when `pytest` passes and the end-to-end CRD workflow renders payer guidance in the browser.
