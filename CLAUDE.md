# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working in this repository.

## Project Purpose

A polyglot learning sandbox demonstrating a Coverage Requirements Discovery (CRD) workflow between two independently developed applications:

- **Provider EHR Simulator** (`provider-ehr/`) — Python/FastAPI, acts as the CDS Hooks client
- **Payer CRD Service** (`payer-crd/`) — Bun + Hono (TypeScript), acts as the CDS Hooks server

The core scenario: a clinician drafts a colonoscopy order for a high-risk patient, the EHR sends a CDS Hooks `order-sign` request to the payer, and the payer returns CDS Cards describing coverage guidance, documentation requirements, and prior authorization expectations.

## Running the Services

Both services run independently. Start the Bun payer first.

**Bun Payer CRD Service** (port 8080):

```bash
cd payer-crd
bun install          # first time only
bun run dev
```

**Python Provider EHR** (port 8000):

```bash
cd provider-ehr
source .venv/bin/activate     # first time: python -m venv .venv && pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Trigger the CRD scenario:
```bash
curl -X POST http://localhost:8000/orders/colonoscopy/crd
```

## Architecture

The two applications communicate only over HTTP — the Bun payer never calls Python internals, Python never renders payer logic.

```
Python EHR (port 8000)         Bun/Hono Payer (port 8080)
──────────────────────         ──────────────────────────
Clinician UI (HTMX/Jinja2)
FHIR context assembly
CDS Hooks request builder ──POST /cds-services/crd-order-sign──>
CDS Cards renderer        <──── CDS Cards response ─────────────
Debug screens (/debug/*)       Rule evaluation engine
                               CDS Hooks discovery (GET /cds-services)
```

**Python key files:**
- `app/main.py` — FastAPI entrypoint
- `app/config.py` — Pydantic-Settings configuration; exposes module-level `settings` singleton
- `app/fhir_factory.py` — assembles FHIR resources from fixtures
- `app/cds_client.py` — sends CDS Hooks requests via HTTPX
- `app/models.py` — Pydantic models for CDS Hooks request/response
- `app/fixtures/` — JSON FHIR resources: `patient.json`, `condition-family-history.json`, `service-request-colonoscopy.json`, `prior-colonoscopy.json`, `coverage.json`

**Bun/Hono key files:**
- `src/index.ts` — application entrypoint; Hono app definition and `Bun.serve()`
- `src/routes/discovery.ts` — GET /cds-services handler
- `src/routes/crd.ts` — POST /cds-services/crd-order-sign handler
- `src/rules/colonoscopyRuleEngine.ts` — payer rule evaluation
- `src/cards/cardFactory.ts` — builds CDS Cards responses
- `src/types/cdsHooks.ts` — TypeScript types for CDS Hooks request/response
- `fixtures/` — JSON: `cds-discovery.json`, `cards-covered-high-risk.json`, `cards-missing-documentation.json`

## Testing

```bash
# Python — run all tests
cd provider-ehr && python -m pytest

# Python — run a single test file
python -m pytest tests/test_fhir_factory.py -v

# Bun payer — run all tests
cd payer-crd && bun test

# Bun payer — run a single test file
bun test tests/rules/colonoscopyRuleEngine.test.ts
```

## Documentation

Guides are in `docs/guides/`, organized by application. Specs are in `docs/spec/`.

**Provider EHR guides** (`docs/guides/provider-ehr/`):
- `pydantic-models.md` — CDS Hooks request/response Pydantic models (`app/models.py`)
- `fhir-factory.md` — FHIR fixture loading and CDS Hooks request assembly (`app/fhir_factory.py`)
- `cds-client.md` — Outbound CDS Hooks HTTP client (`app/cds_client.py`)

**Payer CRD guides** (`docs/guides/payer-crd/`): none yet; to be added when Bun + Hono implementation begins.

**Specs** (`docs/spec/`): `fhir-crd-demo-spec.md`, `cds-hooks-api-contract.md`, `provider-ehr-spec.md`, `payer-crd-spec.md`

## Key Domain Concepts

**CDS Hooks `order-sign` request** — sent by the EHR when a clinician signs an order. Contains:
- `context.draftOrders`: FHIR Bundle with the ServiceRequest
- `prefetch`: bundled FHIR resources (Patient, Condition, Coverage, prior Procedure)

**CDS Cards** — the payer response. Card `indicator` values used in this demo:
- `info` — high-risk family history supports 5-year interval
- `warning` — missing documentation or high-risk classification not confirmed

Each card may include a `links` array with an `absolute` link to a DTR-style documentation checklist (placeholder in Phase 1).

**FHIR resources in the scenario:**
- `Condition` with ICD-10-CM `Z80.0` — family history of colorectal cancer (high-risk indicator)
- `ServiceRequest` with CPT `45378` — the colonoscopy order
- `Procedure` — prior colonoscopy dated 5 years before the current order

## Constraints

- **Bun/Hono stack:** Bun runtime, Hono framework, TypeScript. No heavy full-stack frameworks (no NestJS, AdonisJS, etc.). Native Bun APIs preferred over heavy third-party libraries.
- **Python stack:** FastAPI + HTMX + Jinja2 + HTTPX + Pydantic + Tailwind CSS. PostgreSQL only if persistence becomes necessary.
- **Strict app separation:** provider and payer are independently runnable with separate configs, tests, and `.env` files. Real `.env` files are never committed; each app has a `.env.example`.
- **Synthetic data only.** All patient data is fixture-based; no real patient data, no production HIPAA controls.
- **Standards baseline:** FHIR R4, CDS Hooks `order-sign`, Da Vinci CRD STU 2.x.

## Implementation Phases

- **Phase 1 (current):** Minimal end-to-end — static fixtures, basic request/response exchange, CDS Cards rendered in EHR UI
- **Phase 2:** Rule depth — average-risk vs high-risk branches, debug screens, focused unit tests
- **Phase 3:** Standards alignment — FHIR profile conformance, `order-select`, richer discovery metadata
- **Phase 4:** Future extensions — SMART on FHIR, HAPI FHIR Server, DTR, PAS, RAG-assisted rule lookup

## Phase 1 Implementation Status

### Provider EHR (Python)

Build sequence steps 1–7 are complete. Steps 8–18 are not started.

**Complete:**
- Directory structure, `requirements.txt`, `.env` / `.env.example`
- `config.py` — Pydantic-Settings configuration with module-level `settings` singleton
- All five FHIR fixture files in `app/fixtures/`
- `models.py` — CDS Hooks request and response Pydantic models
- `fhir_factory.py` — fixture loader and CDS Hooks request assembler

**Stub (file exists, implementation empty):**
- `app/main.py`
- `app/cds_client.py`

**Not started:**
- `app/routes/clinician.py`, `app/routes/api.py` (directory exists)
- `app/templates/base.html`, `patient_chart.html`, `cds_cards.html` (directory exists)
- `app/static/` (directory exists, no content)
- `tests/test_fhir_factory.py`, `test_cds_client.py`, `test_routes.py` (no `tests/` directory yet)
- `Dockerfile`

### Payer CRD (Bun + Hono)

Implementation not started. Work begins after the Provider EHR is complete. The tech stack was revised from the original PHP/LAMP design to Bun + Hono + TypeScript on 2026-06-05 for improved market alignment and learning value. The original PHP design is preserved in `docs/spec/payer-crd-spec.md` as a historical reference. The `payer-crd/` directory currently contains only the legacy PHP placeholder files.

---

## Reference Specifications

- [Da Vinci CRD Implementation Guide](https://www.hl7.org/fhir/us/davinci-crd/)
- [CDS Hooks Specification](https://cds-hooks.org)
- [CMS-0057-F Final Rule](https://www.cms.gov/newsroom/fact-sheets/cms-interoperability-and-prior-authorization-final-rule-cms-0057-f)
