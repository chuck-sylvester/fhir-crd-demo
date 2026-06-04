# fhir-crd-demo

A polyglot reference application demonstrating a Coverage Requirements Discovery (CRD) workflow between a simulated provider EHR and a simulated payer CRD service.

---

## Overview

This project implements the system-to-system collaboration described by the HL7 Da Vinci Coverage Requirements Discovery (CRD) Implementation Guide. When a clinician drafts a clinical order, the provider's EHR sends a CDS Hooks request to the payer's CRD service, which evaluates coverage requirements and returns guidance cards for display in the clinical workflow.

The demonstration scenario: a clinician orders a surveillance colonoscopy for a high-risk patient. The payer evaluates whether the patient's documented family history qualifies for a shortened screening interval and returns coverage guidance, documentation requirements, and prior authorization expectations.

---

## Applications

The project consists of two independently runnable applications that communicate only over HTTP.

### Provider EHR Simulator (`provider-ehr/`)

A Python/FastAPI application acting as the CDS Hooks client. It provides a simulated clinician workflow — patient chart, draft order, and CDS Cards display — and assembles and sends CDS Hooks `order-sign` requests to the payer.

**Stack:** Python 3.12, FastAPI, HTMX, Jinja2, HTTPX, Pydantic, Tailwind CSS

**Default port:** 8000

### Payer CRD Service (`payer-crd/`)

A PHP/LAMP application acting as the CDS Hooks server. It exposes CDS Hooks discovery and service endpoints, evaluates payer-specific coverage rules, and returns CDS Cards.

**Stack:** PHP 8.5, Apache HTTP Server, PHP-FPM

**Default port:** 8080

---

## Standards

- HL7 FHIR R4
- CDS Hooks `order-sign`
- HL7 Da Vinci CRD Implementation Guide (STU 2.x)

---

## Quick Start

Start the PHP payer service first, then the Python EHR.

**PHP Payer CRD Service:**

```bash
brew services start php      # PHP-FPM on port 9000
brew services start httpd    # Homebrew Apache on port 8080
```

**Python Provider EHR:**

```bash
cd provider-ehr
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Open the EHR simulator at `http://localhost:8000` and navigate to the patient chart to trigger the CRD workflow.

---

## Repository Structure

```text
fhir-crd-demo/
|-- docs/
|   |-- guides/                  # Learning guides and implementation references
|   |-- reference/               # External reference material
|   |-- spec/                    # Project and application specifications
|-- payer-crd/                   # PHP/LAMP payer CRD service
|-- provider-ehr/                # Python provider EHR simulator
|-- .gitignore
|-- README.md
```

---

## Documentation

| Document | Description |
|----------|-------------|
| `docs/spec/fhir-crd-demo-spec.md` | Project-level architecture and design specification |
| `docs/spec/cds-hooks-api-contract.md` | CDS Hooks request and response payload contract |
| `docs/spec/provider-ehr-spec.md` | Provider EHR application design specification |
| `docs/spec/payer-crd-spec.md` | Payer CRD service design specification |

---

## Implementation Status

| Phase | Description | Status |
|-------|-------------|--------|
| Phase 1 | Minimal end-to-end CRD demo — static fixtures, basic request/response exchange, CDS Cards rendered in EHR UI | In progress |
| Phase 2 | Rule depth — average-risk vs high-risk branches, debug screens, focused unit tests | Planned |
| Phase 3 | Standards alignment — FHIR profile conformance, `order-select`, richer discovery metadata | Planned |
| Phase 4 | Future extensions — SMART on FHIR, HAPI FHIR Server, DTR, PAS | Planned |

---

## Reference Specifications

- [HL7 Da Vinci CRD Implementation Guide](https://www.hl7.org/fhir/us/davinci-crd/)
- [CDS Hooks Specification](https://cds-hooks.org)
- [CMS Interoperability and Prior Authorization Final Rule (CMS-0057-F)](https://www.cms.gov/newsroom/fact-sheets/cms-interoperability-and-prior-authorization-final-rule-cms-0057-f)

---

## License

This project is intended for educational and demonstration purposes. All patient data is synthetic.
