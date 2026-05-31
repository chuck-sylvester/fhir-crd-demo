# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working in this repository.

## Project Purpose

A polyglot learning sandbox demonstrating a Coverage Requirements Discovery (CRD) workflow between two independently developed applications:

- **Provider EHR Simulator** (`provider-ehr/`) — Python/FastAPI, acts as the CDS Hooks client
- **Payer CRD Service** (`payer-crd/`) — Vanilla PHP/LAMP, acts as the CDS Hooks server

The core scenario: a clinician drafts a colonoscopy order for a high-risk patient, the EHR sends a CDS Hooks `order-sign` request to the payer, and the payer returns CDS Cards describing coverage guidance, documentation requirements, and prior authorization expectations.

## Running the Services

Both services run independently. Start the PHP payer first.

**PHP Payer CRD Service** — runs under Homebrew Apache + PHP-FPM. Requires one-time virtual host setup; see the spec `Local Apache Configuration` section for details.

```bash
brew services start php      # PHP-FPM (port 9000)
brew services start httpd    # Homebrew Apache (port 8080)
```

**Python Provider EHR** (port 8000):

```bash
cd provider-ehr
source venv/bin/activate     # first time: python -m venv venv && pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Trigger the CRD scenario:
```bash
curl -X POST http://localhost:8000/orders/colonoscopy/crd
```

## Architecture

The two applications communicate only over HTTP — PHP never calls Python internals, Python never renders payer logic.

```
Python EHR (port 8000)         PHP Payer (port 8080)
──────────────────────         ─────────────────────
Clinician UI (HTMX/Jinja2)
FHIR context assembly
CDS Hooks request builder ──POST /cds-services/crd-order-sign──>
CDS Cards renderer        <──── CDS Cards response ─────────────
Debug screens (/debug/*)       Rule evaluation engine
                               CDS Hooks discovery (GET /cds-services)
```

**Python key files:**
- `app/main.py` — FastAPI entrypoint
- `app/fhir_factory.py` — assembles FHIR resources from fixtures
- `app/cds_client.py` — sends CDS Hooks requests via HTTPX
- `app/models.py` — Pydantic models for CDS Hooks request/response
- `app/fixtures/` — JSON FHIR resources (Patient, Condition, ServiceRequest, Procedure)

**PHP key files:**
- `public/index.php` — front controller, all requests route here
- `src/CdsHooks/DiscoveryController.php` — serves GET /cds-services
- `src/CdsHooks/CrdServiceController.php` — handles POST /cds-services/crd-order-sign
- `src/CdsHooks/CardFactory.php` — builds CDS Cards responses
- `src/Rules/ColonoscopyRuleEngine.php` — payer rule evaluation
- `config/payer-rules.php` — configurable rule parameters

## Testing

```bash
# Python — run all tests
cd provider-ehr && python -m pytest

# Python — run a single test file
python -m pytest tests/test_fhir_factory.py -v

# PHP — run all tests (PHPUnit)
cd payer-crd && ./vendor/bin/phpunit

# PHP — run a single test file
./vendor/bin/phpunit tests/Rules/ColonoscopyRuleEngineTest.php
```

## Key Domain Concepts

**CDS Hooks `order-sign` request** — sent by the EHR when a clinician signs an order. Contains:
- `context.draftOrders`: FHIR Bundle with the ServiceRequest
- `prefetch`: bundled FHIR resources (Patient, Condition, Coverage, prior Procedure)

**CDS Cards** — the payer response. Card types used in this demo:
- `info` — high-risk family history supports 5-year interval
- `warning` — missing documentation or average-risk classification
- `suggestion` — documentation checklist link (DTR placeholder)

**FHIR resources in the scenario:**
- `Condition` with ICD-10-CM `Z80.0` — family history of colorectal cancer (high-risk indicator)
- `ServiceRequest` with CPT `45378` — the colonoscopy order
- `Procedure` — prior colonoscopy dated 5 years before the current order

## Constraints

- **PHP: no framework.** No Laravel, Symfony, Slim, etc. Composer is allowed for autoloading or dev tooling only.
- **Python stack:** FastAPI + HTMX + Jinja2 + HTTPX + Pydantic + Tailwind CSS. PostgreSQL only if persistence becomes necessary.
- **Strict app separation:** provider and payer are independently runnable with separate configs, tests, and `.env` files. Real `.env` files are never committed; each app has a `.env.example`.
- **Synthetic data only.** All patient data is fixture-based; no real patient data, no production HIPAA controls.
- **Standards baseline:** FHIR R4, CDS Hooks `order-sign`, Da Vinci CRD STU 2.x.

## Implementation Phases

- **Phase 1 (current):** Minimal end-to-end — static fixtures, basic request/response exchange, CDS Cards rendered in EHR UI
- **Phase 2:** Rule depth — average-risk vs high-risk branches, debug screens, focused unit tests
- **Phase 3:** Standards alignment — FHIR profile conformance, `order-select`, richer discovery metadata
- **Phase 4:** Future extensions — SMART on FHIR, HAPI FHIR Server, DTR, PAS, RAG-assisted rule lookup

## Reference Specifications

- [Da Vinci CRD Implementation Guide](https://www.hl7.org/fhir/us/davinci-crd/)
- [CDS Hooks Specification](https://cds-hooks.org)
- [CMS-0057-F Final Rule](https://www.cms.gov/newsroom/fact-sheets/cms-interoperability-and-prior-authorization-final-rule-cms-0057-f)
