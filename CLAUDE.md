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

**Payer CRD guides** (`docs/guides/payer-crd/`):
- `dev-environment-setup.md` — Bun + Hono project setup, stack comparison with Python EHR, OCI deployment
- `typescript-interfaces.md` — CDS Hooks and FHIR R4 TypeScript interfaces (`src/types/cdsHooks.ts`)
- `colonoscopy-rule-engine.md` — Rule engine design, date arithmetic, array methods, implementation (`src/rules/colonoscopyRuleEngine.ts`)

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

## Bun Tooling

When working in `payer-crd/`, use Bun APIs and CLI commands instead of Node.js equivalents:

| Avoid | Use instead |
|---|---|
| `node <file>` / `ts-node <file>` | `bun <file>` |
| `jest` / `vitest` | `bun test` |
| `webpack` / `esbuild` | `bun build <file>` |
| `npm install` / `yarn` / `pnpm install` | `bun install` |
| `npm run <script>` | `bun run <script>` |
| `npx <package>` | `bunx <package>` |

Preferred Bun APIs:

- `Bun.serve()` — HTTP server; do not use `express`
- `Bun.file()` — file reads; do not use `node:fs` readFile/writeFile
- `bun:sqlite` — SQLite; do not use `better-sqlite3`
- `Bun.redis` — Redis; do not use `ioredis`
- `Bun.sql` — Postgres; do not use `pg` or `postgres.js`
- `Bun.$` — shell commands; do not use `execa`
- Bun loads `.env` automatically at startup — do not use `dotenv`

## Implementation Phases

- **Phase 1 (current):** Minimal end-to-end — static fixtures, basic request/response exchange, CDS Cards rendered in EHR UI
- **Phase 2:** Rule depth — average-risk vs high-risk branches, debug screens, focused unit tests
- **Phase 3:** Standards alignment — FHIR profile conformance, `order-select`, richer discovery metadata
- **Phase 4:** Future extensions — SMART on FHIR, HAPI FHIR Server, DTR, PAS, RAG-assisted rule lookup

## Phase 1 Implementation Status

### Provider EHR (Python)

Phase 1 implementation complete (tests and Dockerfile remain).

**Complete:**
- Directory structure, `requirements.txt`, `.env` / `.env.example`
- `config.py`, `models.py`, `colors.py`
- All five FHIR fixture files in `app/fixtures/`
- `fhir_factory.py` — fixture loader and CDS Hooks request assembler
- `cds_client.py` — outbound HTTPX client with last-request/last-response state
- `main.py` — FastAPI application factory with static mount and router registration
- `routes/clinician.py` — `GET /`, `GET /patients/{patient_id}`, `POST /orders/colonoscopy/crd`
- `routes/api.py` — `GET /debug/last-crd-request`, `GET /debug/last-crd-response`
- `templates/base.html`, `dashboard.html`, `patient_chart.html`, `cds_cards.html`

**Not started:**
- `tests/` directory (test_fhir_factory.py, test_cds_client.py, test_routes.py)
- `Dockerfile`

### Payer CRD (Bun + Hono)

Implementation in progress. See `docs/spec/payer-crd-spec.md` Section 14 for the full build sequence.

**Complete:**
- Directory structure, `package.json`, `tsconfig.json`, `.env` / `.env.example`
- `src/types/cdsHooks.ts` — all TypeScript interfaces and rule engine types
- `src/index.ts` — Hono app scaffold with `Bun.serve()`

**Not started:**
- `fixtures/` — `cds-discovery.json`, `cards-covered-high-risk.json`, `cards-missing-documentation.json`
- `src/routes/discovery.ts`, `src/routes/crd.ts`
- `src/rules/colonoscopyRuleEngine.ts`
- `src/cards/cardFactory.ts`
- `tests/` directory

---

## Reference Specifications

- [Da Vinci CRD Implementation Guide](https://www.hl7.org/fhir/us/davinci-crd/)
- [CDS Hooks Specification](https://cds-hooks.org)
- [CMS-0057-F Final Rule](https://www.cms.gov/newsroom/fact-sheets/cms-interoperability-and-prior-authorization-final-rule-cms-0057-f)
