# CDS Hooks API Contract

## Phase 1 — order-sign Demo Scenario

This document defines the exact JSON structures exchanged between the Python Provider EHR Simulator and the PHP Payer CRD Service. Both applications must produce and consume messages that conform to this contract. Either side may use this document as the authoritative reference when validating payload shape.

---

## 1. Notation

| Symbol | Meaning |
|--------|---------|
| **Required** | Field must be present in every valid message |
| **Optional** | Field may be omitted; the receiving side must handle its absence gracefully |
| `string` | JSON string value |
| `integer` | JSON integer value |
| `boolean` | JSON boolean value |
| `object` | JSON object |
| `array` | JSON array |
| `uuid` | RFC 4122 UUID string |
| `url` | Absolute HTTP or HTTPS URL string |
| `date` | ISO 8601 date string, format `YYYY-MM-DD` |
| `dateTime` | ISO 8601 datetime string, format `YYYY-MM-DDThh:mm:ssZ` |
| FHIR R4 types | Follow HL7 FHIR R4 specifications at https://hl7.org/fhir/R4/ |

---

## 2. Endpoints Summary

| Method | Path | Owner | Purpose |
|--------|------|-------|---------|
| `GET` | `/cds-services` | PHP Payer | CDS Hooks discovery |
| `POST` | `/cds-services/crd-order-sign` | PHP Payer | CRD service for order-sign |

---

## 3. CDS Hooks Discovery

### 3.1 Request

A plain HTTP `GET` to `/cds-services`. No request body. No required headers beyond standard HTTP.

### 3.2 Response

HTTP 200. Content-Type: `application/json`.

The response envelope contains a single top-level field:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `services` | array of Service | Required | One entry per CDS service offered by the payer |

**Service object fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `hook` | string | Required | The CDS Hooks hook this service responds to |
| `id` | string | Required | Unique identifier for this service within this payer |
| `title` | string | Optional | Human-readable display name |
| `description` | string | Optional | Plain-text description of what the service does |
| `prefetch` | object | Optional | Keys are short names; values are FHIR query templates using `{{context.patientId}}` substitution |

### 3.3 Demo Service Definition

For Phase 1 the payer exposes exactly one service. The values below are fixed for the demo scenario.

| Field | Value |
|-------|-------|
| `hook` | `order-sign` |
| `id` | `crd-order-sign` |
| `title` | `CRD Coverage Requirements Discovery` |
| `description` | `Evaluates coverage requirements and prior authorization expectations for draft orders` |

**Prefetch templates declared by the payer service:**

| Key | FHIR Query Template |
|-----|---------------------|
| `patient` | `Patient/{{context.patientId}}` |
| `conditions` | `Condition?patient={{context.patientId}}&clinical-status=active` |
| `coverage` | `Coverage?patient={{context.patientId}}&status=active` |
| `priorProcedures` | `Procedure?patient={{context.patientId}}&status=completed` |

The Python EHR does not query a live FHIR server in Phase 1. It populates the prefetch keys above with static fixture data regardless of which queries the payer declares.

---

## 4. CDS Hooks order-sign

### 4.1 Request

HTTP `POST` to `/cds-services/crd-order-sign`.

- Content-Type: `application/json`
- Body: a CDS Hooks request object

**Top-level request fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `hook` | string | Required | Always `order-sign` |
| `hookInstance` | uuid | Required | Unique identifier for this specific invocation |
| `fhirServer` | url | Optional | Base URL of the EHR FHIR server. Included in Phase 1 as a placeholder; the payer does not dereference it |
| `fhirAuthorization` | object | Optional | SMART on FHIR authorization token. Omitted in Phase 1 |
| `context` | object | Required | Hook-specific clinical context |
| `prefetch` | object | Optional | Pre-fetched FHIR resources; keyed by the names declared in discovery |

**Context object fields (`context`):**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `userId` | string | Required | FHIR reference to the current user. Format: `ResourceType/id` |
| `patientId` | string | Required | FHIR `Patient` logical id |
| `encounterId` | string | Optional | FHIR `Encounter` logical id |
| `draftOrders` | FHIR Bundle | Required | A FHIR R4 Bundle (type `collection`) containing the draft `ServiceRequest` resource |

**Prefetch object fields (`prefetch`):**

| Key | Type | Description |
|-----|------|-------------|
| `patient` | FHIR Patient | The patient resource |
| `conditions` | FHIR Bundle (searchset) | Active conditions for the patient |
| `coverage` | FHIR Coverage | The patient's active coverage record |
| `priorProcedures` | FHIR Bundle (searchset) | Completed procedures for the patient |

**Demo fixed context values:**

| Field | Value |
|-------|-------|
| `hook` | `order-sign` |
| `fhirServer` | `http://localhost:8000/fhir` |
| `context.userId` | `PractitionerRole/demo-clinician` |
| `context.patientId` | `demo-patient-001` |
| `context.encounterId` | `demo-encounter-001` |

### 4.2 Response

HTTP 200. Content-Type: `application/json`.

**Top-level response fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `cards` | array of Card | Required | Zero or more CDS Cards. An empty array is a valid response |

**Card object fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `uuid` | uuid | Optional | Unique identifier for this card |
| `summary` | string | Required | Short plain-text summary. Must be 140 characters or fewer |
| `detail` | string | Optional | Extended explanation. Supports GitHub Flavored Markdown |
| `indicator` | string | Required | Urgency level. One of: `info`, `warning`, `critical` |
| `source` | Source object | Required | Identifies the originating service |
| `suggestions` | array of Suggestion | Optional | Proposed actions the clinician may take. Not used in Phase 1 |
| `selectionBehavior` | string | Conditional | Required when `suggestions` is present. One of: `at-most-one`, `any` |
| `overrideReasons` | array of Coding | Optional | Reasons a clinician can provide if overriding the card. Not used in Phase 1 |
| `links` | array of Link | Optional | External URLs relevant to the card |

**Source object fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `label` | string | Required | Display name for the source |
| `url` | url | Optional | URL to the source organization or service |
| `icon` | url | Optional | URL to a 100×100 PNG icon |
| `topic` | FHIR Coding | Optional | Coded topic for the card |

**Link object fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `label` | string | Required | Display label for the link |
| `url` | url | Required | Destination URL |
| `type` | string | Required | One of: `absolute`, `smart`. Phase 1 uses `absolute` only |
| `appContext` | string | Conditional | Required only when `type` is `smart`. Not used in Phase 1 |

---

## 5. FHIR Resource Schemas

These schemas define the structure and required fields for each FHIR resource used in the demo payload. Only fields relevant to the Phase 1 scenario are listed. All resources conform to FHIR R4.

### 5.1 Bundle

Used for `context.draftOrders` and for multi-resource prefetch entries (`conditions`, `priorProcedures`).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `resourceType` | string | Required | Always `Bundle` |
| `id` | string | Optional | Logical id for this bundle |
| `type` | string | Required | `collection` for draftOrders; `searchset` for prefetch results |
| `total` | integer | Conditional | Required for `searchset` bundles; count of matching entries |
| `entry` | array | Required | Array of bundle entry objects |

**Bundle entry object:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `resource` | FHIR resource | Required | The contained FHIR resource |

### 5.2 Patient

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `resourceType` | string | Required | Always `Patient` |
| `id` | string | Required | Logical id |
| `gender` | string | Required | `male`, `female`, `other`, or `unknown` |
| `birthDate` | date | Required | ISO 8601 date. Used by the payer rule engine to calculate patient age |
| `name` | array of HumanName | Required | At least one name entry |

**HumanName object:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `family` | string | Required | Family (last) name |
| `given` | array of string | Required | Given (first and middle) names |

### 5.3 Condition

Represents a clinical condition or diagnosis. In this scenario, used for the high-risk family history indicator.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `resourceType` | string | Required | Always `Condition` |
| `id` | string | Required | Logical id |
| `clinicalStatus` | CodeableConcept | Required | Must include a coding with code `active` from the condition-clinical system |
| `verificationStatus` | CodeableConcept | Required | Must include a coding with code `confirmed` from the condition-ver-status system |
| `code` | CodeableConcept | Required | ICD-10-CM code identifying the condition |
| `subject` | Reference | Required | Reference to the Patient resource |

**CodeableConcept for `code` (family history indicator):**

| Field | Value |
|-------|-------|
| `coding[0].system` | `http://hl7.org/fhir/sid/icd-10-cm` |
| `coding[0].code` | `Z80.0` |
| `coding[0].display` | `Family history of malignant neoplasm of digestive organs` |

**CodeableConcept for `clinicalStatus`:**

| Field | Value |
|-------|-------|
| `coding[0].system` | `http://terminology.hl7.org/CodeSystem/condition-clinical` |
| `coding[0].code` | `active` |

**CodeableConcept for `verificationStatus`:**

| Field | Value |
|-------|-------|
| `coding[0].system` | `http://terminology.hl7.org/CodeSystem/condition-ver-status` |
| `coding[0].code` | `confirmed` |

### 5.4 ServiceRequest

Represents the draft colonoscopy order placed by the clinician.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `resourceType` | string | Required | Always `ServiceRequest` |
| `id` | string | Required | Logical id |
| `status` | string | Required | `draft` for an unsigned order |
| `intent` | string | Required | `order` |
| `code` | CodeableConcept | Required | CPT code identifying the procedure |
| `subject` | Reference | Required | Reference to the Patient resource |
| `authoredOn` | dateTime | Required | Date the order was created |

**CodeableConcept for `code` (colonoscopy):**

| Field | Value |
|-------|-------|
| `coding[0].system` | `http://www.ama-assn.org/go/cpt` |
| `coding[0].code` | `45378` |
| `coding[0].display` | `Colonoscopy, flexible, proximal to splenic flexure; diagnostic` |

### 5.5 Procedure

Represents the patient's prior colonoscopy, used to evaluate the screening interval.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `resourceType` | string | Required | Always `Procedure` |
| `id` | string | Required | Logical id |
| `status` | string | Required | `completed` |
| `code` | CodeableConcept | Required | CPT code for colonoscopy (same coding as ServiceRequest) |
| `subject` | Reference | Required | Reference to the Patient resource |
| `performedDateTime` | dateTime | Required | Date the procedure was performed. Used to calculate years elapsed |

### 5.6 Coverage

Represents the patient's insurance coverage. Minimal in Phase 1; used for future plan-specific rule extensions.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `resourceType` | string | Required | Always `Coverage` |
| `id` | string | Required | Logical id |
| `status` | string | Required | `active` |
| `beneficiary` | Reference | Required | Reference to the Patient resource |
| `payor` | array of Reference | Required | At least one payor entry |

**Payor entry (Phase 1, display-only):**

| Field | Value |
|-------|-------|
| `display` | `Demo Payer CRD Inc.` |

---

## 6. CDS Card Definitions

The PHP payer returns cards from this defined set based on rule evaluation outcomes.

### 6.1 High-Risk Coverage Info Card

Returned when the payer rule engine confirms the patient qualifies for the high-risk 5-year screening interval.

| Field | Value |
|-------|-------|
| `indicator` | `info` |
| `summary` | `High-risk family history supports 5-year colonoscopy screening interval` |
| `detail` | Extended Markdown explaining that ICD-10-CM Z80.0 (family history of colorectal cancer) qualifies this patient for a 5-year surveillance interval under the simulated payer's coverage policy, that the prior procedure date satisfies the interval requirement, and that the order appears covered without prior authorization |
| `source.label` | `Demo Payer CRD Service` |
| `source.url` | `http://localhost:8080` |
| `links[0].label` | `Colonoscopy Risk Documentation Checklist` |
| `links[0].url` | `http://localhost:8080/questionnaires/colonoscopy-risk` |
| `links[0].type` | `absolute` |

### 6.2 Missing Documentation Warning Card

Returned when the payer rule engine cannot confirm the high-risk classification because the Z80.0 condition code is absent from the prefetch.

| Field | Value |
|-------|-------|
| `indicator` | `warning` |
| `summary` | `Documentation required: high-risk classification not confirmed` |
| `detail` | Extended Markdown explaining that a 5-year colonoscopy interval requires documented high-risk criteria, that no qualifying family history condition (Z80.0) was found in the submitted clinical context, that without this documentation the order may be subject to standard 10-year average-risk interval rules, and that the clinician should attach supporting documentation before submitting |
| `source.label` | `Demo Payer CRD Service` |
| `source.url` | `http://localhost:8080` |
| `links[0].label` | `Colonoscopy Risk Documentation Checklist` |
| `links[0].url` | `http://localhost:8080/questionnaires/colonoscopy-risk` |
| `links[0].type` | `absolute` |

---

## 7. Demo Scenario Fixed Values

These values are used consistently across both applications and all fixture files.

**Patient:**

| Field | Value |
|-------|-------|
| Resource id | `demo-patient-001` |
| Family name | `Doe` |
| Given name | `John` |
| Gender | `male` |
| Birth date | `1971-01-15` |

**Condition (family history):**

| Field | Value |
|-------|-------|
| Resource id | `demo-condition-fam-hx-crc` |
| ICD-10-CM code | `Z80.0` |
| Subject reference | `Patient/demo-patient-001` |

**ServiceRequest (draft colonoscopy):**

| Field | Value |
|-------|-------|
| Resource id | `demo-service-request-colonoscopy` |
| CPT code | `45378` |
| Status | `draft` |
| Intent | `order` |
| Authored on | Current date at time of invocation (set dynamically by the Python EHR) |
| Subject reference | `Patient/demo-patient-001` |

**Procedure (prior colonoscopy):**

| Field | Value |
|-------|-------|
| Resource id | `demo-prior-colonoscopy` |
| CPT code | `45378` |
| Status | `completed` |
| Performed date | 5 years before the current date (set as a fixed date in the fixture) |
| Subject reference | `Patient/demo-patient-001` |

**Coverage:**

| Field | Value |
|-------|-------|
| Resource id | `demo-coverage-001` |
| Status | `active` |
| Beneficiary reference | `Patient/demo-patient-001` |
| Payor display | `Demo Payer CRD Inc.` |

**Encounter (context only, not a prefetch resource in Phase 1):**

| Field | Value |
|-------|-------|
| Encounter id | `demo-encounter-001` |

**Clinician (context only):**

| Field | Value |
|-------|-------|
| User reference | `PractitionerRole/demo-clinician` |
