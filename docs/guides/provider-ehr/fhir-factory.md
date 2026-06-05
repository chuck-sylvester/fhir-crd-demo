# FHIR Factory — Learning Guide and Implementation Reference

For `provider-ehr/app/fhir_factory.py`

---

## How to Use This Document

This document has two parts:

**Part 1 — Learning Reference (Sections 1–6):** Explains the Python concepts required to implement `fhir_factory.py` from first principles, using simple examples unrelated to the project. Read these sections before writing any code. Each concept is illustrated on its own so it is clear in isolation before you apply it to the project.

**Part 2 — Implementation Guide (Section 7):** Steps through building `fhir_factory.py` for the Provider EHR application. The steps are organized into phases. Each phase produces something verifiable before you move to the next one. Code blocks are complete and ready to copy.

**Prerequisites:** You should have already implemented `models.py` (guide: `docs/guides/pydantic-models.md`) and created all five fixture JSON files in `app/fixtures/`. Both are assumed to be complete before beginning this guide.

---

## Part 1: What a Factory Module Is

### 1.1 The Factory Pattern

A **factory** is a function (or module) whose sole job is to assemble and return a complex object. The caller does not know or care how the object is assembled — it just calls the function and gets back a fully built result.

`fhir_factory.py` is a factory module: it reads fixture files from disk, composes FHIR data structures from them, and returns a populated `CdsHooksRequest` instance ready to be sent to the payer. The module has no side effects — it does not write to a database, send network requests, or modify any global state. It reads files and returns structured data.

This design makes `fhir_factory.py` easy to test in isolation: you can call `build_crd_request()` in a test without spinning up a server, mocking a database, or configuring any network.

A minimal example of the pattern:

```python
# report_factory.py — assembles a report from parts

def load_header() -> dict:
    return {"title": "Monthly Summary", "period": "2026-06"}

def load_body() -> list:
    return [{"line": "Revenue: $1,200"}, {"line": "Expenses: $400"}]

def build_report() -> dict:
    return {
        "header": load_header(),
        "body": load_body(),
    }
```

The caller calls `build_report()` and receives a complete dict. The loader helpers are internal implementation details.

---

## Part 2: Reading JSON Files from Disk

### 2.1 The `json` Module

Python's standard library includes a `json` module for reading and writing JSON. No installation is required.

**Reading a JSON file into a Python dictionary:**

```python
import json

with open("data.json", encoding="utf-8") as f:
    data = json.load(f)

print(type(data))   # <class 'dict'>
print(data["name"]) # whatever "name" is in the file
```

`json.load(f)` reads from a file object. It returns the JSON value as its corresponding Python type — JSON objects become `dict`, JSON arrays become `list`, JSON strings become `str`, JSON numbers become `int` or `float`, JSON booleans become `bool`, and JSON `null` becomes `None`.

### 2.2 Error Handling

Two errors commonly arise when loading JSON files:

- `FileNotFoundError` — the file does not exist at the given path
- `json.JSONDecodeError` — the file exists but its contents are not valid JSON

In a factory module it is good practice to catch these and raise errors with descriptive messages that tell you which file caused the problem. A bare `FileNotFoundError` from deep inside the call stack is harder to diagnose than `"Fixture file not found: /path/to/file.json"`.

```python
import json

def load_file(path: str) -> dict:
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        raise FileNotFoundError(f"File not found: {path}")
    except json.JSONDecodeError as exc:
        raise ValueError(f"File is not valid JSON: {path}: {exc}") from exc
```

The `from exc` on the last line preserves the original exception as the cause, which is helpful when reading tracebacks.

---

## Part 3: Locating Files Relative to a Python Module

### 3.1 The Problem with Relative Paths

A Python file does not know where it sits in the filesystem unless you tell it. If `fhir_factory.py` contains `open("fixtures/patient.json")`, that path is relative to the **current working directory** at the time the program is run — not relative to `fhir_factory.py` itself. If you run the server from `provider-ehr/` the path resolves correctly; if you run pytest from `provider-ehr/` it also works; but if you ever run from a different directory, it breaks silently.

### 3.2 `__file__` and `pathlib.Path`

Every Python module has a special variable called `__file__` that holds the absolute path to the module's own source file. You can use it to construct paths relative to the module's location, regardless of where the program is run from.

`pathlib.Path` (standard library, no installation required) provides an object-oriented API for file paths. It is the modern replacement for `os.path` string manipulation.

```python
from pathlib import Path

# The absolute path to this source file
print(Path(__file__))
# Example: /Users/chuck/swdev/cps/fhir-crd-demo/provider-ehr/app/fhir_factory.py

# The directory containing this source file
print(Path(__file__).parent)
# Example: /Users/chuck/swdev/cps/fhir-crd-demo/provider-ehr/app

# A file in a sibling subdirectory
print(Path(__file__).parent / "fixtures" / "patient.json")
# Example: /Users/chuck/swdev/cps/fhir-crd-demo/provider-ehr/app/fixtures/patient.json
```

The `/` operator on `Path` objects appends path components. The result is always an absolute `Path` regardless of where the program is invoked.

### 3.3 Module-Level Constant for the Fixtures Directory

Compute the fixtures directory once at module load time by declaring it as a module-level constant. This avoids repeating the `Path(__file__).parent` expression inside every function:

```python
from pathlib import Path

_FIXTURES_DIR = Path(__file__).parent / "fixtures"

def load_fixture(filename: str) -> dict:
    path = _FIXTURES_DIR / filename
    # ... open and read path ...
```

The leading underscore on `_FIXTURES_DIR` signals that this is a module-internal name — callers of `fhir_factory` should not import it directly.

---

## Part 4: FHIR Bundle Structure

### 4.1 What a FHIR Bundle Is

A FHIR **Bundle** is a FHIR resource that acts as a container for other FHIR resources. It is used when you need to transmit a group of resources together in a single JSON object. The CDS Hooks `order-sign` request uses Bundles in two places:

- `context.draftOrders` — wraps the draft ServiceRequest
- `prefetch.conditions` — wraps the patient's active Condition resources
- `prefetch.priorProcedures` — wraps the patient's completed Procedure resources

### 4.2 Bundle Type: `collection`

A `collection` Bundle is a generic container. It makes no claim about why the resources are grouped. Use it for `draftOrders` — the ServiceRequest is simply bundled for transport:

```json
{
  "resourceType": "Bundle",
  "type": "collection",
  "entry": [
    {
      "resource": { ... the ServiceRequest resource ... }
    }
  ]
}
```

### 4.3 Bundle Type: `searchset`

A `searchset` Bundle represents the results of a FHIR search query. Use it for prefetch entries that represent the results of a hypothetical patient query (conditions, priorProcedures). A `searchset` Bundle must include a `total` field indicating how many resources matched:

```json
{
  "resourceType": "Bundle",
  "type": "searchset",
  "total": 1,
  "entry": [
    {
      "resource": { ... the Condition resource ... }
    }
  ]
}
```

The PHP payer rule engine reads the bundle type and uses `total` to quickly determine whether any results are present. An empty `searchset` bundle (`total: 0, entry: []`) is valid and signals that the patient has no matching records.

### 4.4 The `entry` Array

Every bundle contains an `entry` array. Each element of `entry` is an object with at least a `resource` key. The value of `resource` is the FHIR resource being wrapped:

```python
# In Python, an entry list element looks like this:
entry_item = {
    "resource": {
        "resourceType": "Patient",
        "id": "demo-patient-001",
        # ... other fields ...
    }
}
```

The `resource` wrapper is required by the FHIR Bundle specification — you cannot place the resource dict directly in the `entry` array without wrapping it.

---

## Part 5: Generating UUIDs in Python

### 5.1 The `uuid` Module

The CDS Hooks specification requires every request to carry a `hookInstance` — a unique identifier for this specific invocation. Each time the clinician triggers CRD, a fresh UUID must be generated. Python's standard library `uuid` module provides this:

```python
import uuid

# Generate a random UUID (version 4)
new_id = uuid.uuid4()

print(new_id)           # UUID('550e8400-e29b-41d4-a716-446655440000') — a UUID object
print(str(new_id))      # '550e8400-e29b-41d4-a716-446655440000' — a string
print(type(new_id))     # <class 'uuid.UUID'>
print(type(str(new_id)))# <class 'str'>
```

`uuid.uuid4()` returns a `UUID` object, not a string. The Pydantic model field `hook_instance: str` expects a string. Always convert with `str()` before assigning to the model field.

Each call to `uuid.uuid4()` returns a cryptographically random UUID. The chance of a collision across any realistic number of calls is astronomically small — treat each returned value as unique.

---

## Part 6: Getting Today's Date as an ISO String

### 6.1 The `datetime` Module

Python's standard library `datetime` module provides date and time types. The `date` class within it represents a calendar date with year, month, and day.

```python
from datetime import date

today = date.today()
print(today)              # 2026-06-04  (a date object, rendered as ISO 8601)
print(today.isoformat())  # '2026-06-04'  (a string in YYYY-MM-DD format)
print(type(today))        # <class 'datetime.date'>
print(type(today.isoformat()))  # <class 'str'>
```

`date.today()` returns the current local date. `.isoformat()` formats it as the ISO 8601 string `YYYY-MM-DD`, which is the format FHIR uses for date fields.

### 6.2 Dynamic `authoredOn` in the ServiceRequest Fixture

The demo ServiceRequest fixture (`service-request-colonoscopy.json`) contains a fixed `authoredOn` value from when the file was created. The spec requires this field to reflect the **current date at the time of each CRD invocation**, not a stale fixture date.

The factory handles this by loading the fixture into a dictionary and then replacing the `authoredOn` field with today's date before building the Bundle. In Python, the cleanest way to do this without mutating the original dictionary is to create a shallow copy with the field overridden:

```python
from datetime import date

original = {"id": "req-001", "authoredOn": "2026-01-01", "status": "draft"}

# Create a new dict with authoredOn replaced; original is unchanged
updated = {**original, "authoredOn": date.today().isoformat()}

print(updated["authoredOn"])   # Today's date, e.g. '2026-06-04'
print(original["authoredOn"])  # '2026-01-01' — unchanged
```

The `{**original, "key": value}` syntax unpacks all key-value pairs from `original` into a new dict, then sets `"key"` to the new `value`. Any key that appears both in `original` and in the explicit key-value pairs after the `**` unpacking uses the explicitly specified value.

---

## Part 7: Implementation — `provider-ehr/app/fhir_factory.py`

Read Parts 1–6 before beginning. Each step below produces something you can verify before moving to the next step.

**Reference documents:**
- `docs/spec/provider-ehr-spec.md` Section 8 — function signatures and responsibilities
- `docs/spec/cds-hooks-api-contract.md` Sections 4–7 — wire format and fixed demo values

---

### Phase 1: File Setup

#### Step 1 — Create the file and add imports

`fhir_factory.py` already exists as an empty file at `provider-ehr/app/fhir_factory.py`. Open it and add the following content. These are all the imports and the module-level constant the complete module requires.

```python
import json
import uuid
from datetime import date
from pathlib import Path

from app.models import CdsHooksContext, CdsHooksRequest

_FIXTURES_DIR = Path(__file__).parent / "fixtures"
```

**What each import does:**

| Import | Purpose |
|--------|---------|
| `json` | Parses fixture files from JSON strings into Python dictionaries |
| `uuid` | Generates a fresh UUID for each `hookInstance` |
| `date` (from `datetime`) | Produces today's date as an ISO 8601 string for `authoredOn` |
| `Path` (from `pathlib`) | Constructs absolute paths to fixture files relative to this module |
| `CdsHooksContext`, `CdsHooksRequest` (from `app.models`) | The Pydantic models the factory populates and returns |

**Verify:** Open a Python shell from `provider-ehr/` (virtual environment activated) and confirm the imports resolve:

```python
import json, uuid
from datetime import date
from pathlib import Path
from app.models import CdsHooksContext, CdsHooksRequest
print("imports OK")
```

If this raises an `ImportError` on the models line, confirm you are running from the `provider-ehr/` directory with the virtual environment active.

---

### Phase 2: Fixture Loader

#### Step 2 — Implement `load_fixture`

`load_fixture` is the single entry point for reading fixture files from disk. All other functions in this module call it rather than calling `open()` and `json.load()` directly. This centralizes error handling in one place.

Add this function to `fhir_factory.py` below the imports and constant:

```python
def load_fixture(filename: str) -> dict:
    path = _FIXTURES_DIR / filename
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        raise FileNotFoundError(f"Fixture file not found: {path}")
    except json.JSONDecodeError as exc:
        raise ValueError(f"Fixture file is not valid JSON: {path}: {exc}") from exc
```

**Design note:** `load_fixture` receives only the filename (e.g. `"patient.json"`), not the full path. The directory is implicit — all fixtures live in `_FIXTURES_DIR`. This keeps call sites clean: `load_fixture("patient.json")` is more readable than passing a full path every time.

**Verify:** From a Python shell in `provider-ehr/`:

```python
from app.fhir_factory import load_fixture

patient = load_fixture("patient.json")
print(patient["resourceType"])  # Patient
print(patient["id"])            # demo-patient-001
print(patient["name"][0]["family"])  # Doe
```

Also verify the error case:

```python
try:
    load_fixture("does-not-exist.json")
except FileNotFoundError as e:
    print(e)   # Should print a message containing the path
```

---

### Phase 3: Bundle Builders

These three functions wrap a single FHIR resource in a Bundle. Each function takes a Python dict (a loaded fixture) and returns a new Python dict (the Bundle). They do not modify the resource dict passed in.

#### Step 3 — Implement `build_draft_orders_bundle`

This function wraps the ServiceRequest in a `collection` Bundle. Add it below `load_fixture`:

```python
def build_draft_orders_bundle(service_request: dict) -> dict:
    return {
        "resourceType": "Bundle",
        "type": "collection",
        "entry": [
            {"resource": service_request}
        ],
    }
```

**Note:** A `collection` Bundle does not include a `total` field. It is a simple container, not a search result.

**Verify:**

```python
from app.fhir_factory import load_fixture, build_draft_orders_bundle

sr = load_fixture("service-request-colonoscopy.json")
bundle = build_draft_orders_bundle(sr)

print(bundle["resourceType"])       # Bundle
print(bundle["type"])               # collection
print(len(bundle["entry"]))         # 1
print(bundle["entry"][0]["resource"]["resourceType"])  # ServiceRequest
print("total" in bundle)            # False
```

---

#### Step 4 — Implement `build_conditions_bundle`

This function wraps the Condition resource in a `searchset` Bundle. Add it below `build_draft_orders_bundle`:

```python
def build_conditions_bundle(condition: dict) -> dict:
    return {
        "resourceType": "Bundle",
        "type": "searchset",
        "total": 1,
        "entry": [
            {"resource": condition}
        ],
    }
```

**Verify:**

```python
from app.fhir_factory import load_fixture, build_conditions_bundle

cond = load_fixture("condition-family-history.json")
bundle = build_conditions_bundle(cond)

print(bundle["type"])               # searchset
print(bundle["total"])              # 1
print(bundle["entry"][0]["resource"]["resourceType"])  # Condition
# Confirm the ICD-10-CM code is present
code = bundle["entry"][0]["resource"]["code"]["coding"][0]["code"]
print(code)                         # Z80.0
```

---

#### Step 5 — Implement `build_procedures_bundle`

This function wraps the Procedure resource in a `searchset` Bundle. It is structurally identical to `build_conditions_bundle`. Add it below `build_conditions_bundle`:

```python
def build_procedures_bundle(procedure: dict) -> dict:
    return {
        "resourceType": "Bundle",
        "type": "searchset",
        "total": 1,
        "entry": [
            {"resource": procedure}
        ],
    }
```

**Verify:**

```python
from app.fhir_factory import load_fixture, build_procedures_bundle

proc = load_fixture("prior-colonoscopy.json")
bundle = build_procedures_bundle(proc)

print(bundle["type"])               # searchset
print(bundle["total"])              # 1
print(bundle["entry"][0]["resource"]["resourceType"])  # Procedure
# Confirm the CPT code is present
code = bundle["entry"][0]["resource"]["code"]["coding"][0]["code"]
print(code)                         # 45378
```

---

### Phase 4: Request Builder

#### Step 6 — Implement `build_crd_request`

`build_crd_request` is the public function of this module. It calls all the helpers above, assembles the full CDS Hooks request, and returns a populated `CdsHooksRequest` instance.

Add it below `build_procedures_bundle`:

```python
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
```

**Walk-through of each step in the function:**

| Line(s) | What it does |
|---------|-------------|
| Five `load_fixture` calls | Reads each fixture file from disk into a Python dict |
| `service_request = {**service_request, ...}` | Creates a new dict with `authoredOn` replaced by today's date; the fixture file on disk is not modified |
| `CdsHooksContext(...)` | Constructs the nested context model; fixed values come from the API contract Section 7 |
| `prefetch = {...}` | Assembles the prefetch dictionary; `patient` and `coverage` are passed directly as dicts; `conditions` and `priorProcedures` are wrapped in searchset Bundles |
| `str(uuid.uuid4())` | Generates a fresh UUID string for this specific invocation |
| `CdsHooksRequest(...)` | Constructs and returns the top-level request model |

**Note on `authoredOn` override:** The fixture contains a static date from when the file was authored. The CDS Hooks spec and API contract require `authoredOn` to reflect the current date at the time the order is signed. The factory creates a shallow copy of the fixture dict with the field replaced using the `{**dict, key: value}` pattern described in Section 6.2. The original fixture dict (loaded by `load_fixture`) is not mutated.

**Note on prefetch key names:** The prefetch keys (`patient`, `conditions`, `coverage`, `priorProcedures`) must match the keys declared in the payer's CDS Hooks discovery response (documented in `docs/spec/cds-hooks-api-contract.md` Section 3.3). The payer uses these key names to look up resources when evaluating its rules.

---

### Phase 5: Verification

#### Step 7 — Verify the module imports cleanly

From `provider-ehr/` with the virtual environment activated:

```bash
python -c "from app.fhir_factory import build_crd_request, load_fixture, build_draft_orders_bundle, build_conditions_bundle, build_procedures_bundle; print('fhir_factory.py OK')"
```

Expected output: `fhir_factory.py OK`

Any `ImportError` or `SyntaxError` indicates a problem in the file. Fix it before continuing.

---

#### Step 8 — Verify `build_crd_request` returns a populated model

This is the acceptance check from the build sequence. Run from a Python shell in `provider-ehr/`:

```python
from app.fhir_factory import build_crd_request
from app.models import CdsHooksRequest

result = build_crd_request()

# Confirm the return type
assert isinstance(result, CdsHooksRequest), "Expected CdsHooksRequest instance"

# Confirm fixed field values from the API contract
assert result.hook == "order-sign"
assert result.fhir_server == "http://localhost:8000/fhir"
assert result.context.user_id == "PractitionerRole/demo-clinician"
assert result.context.patient_id == "demo-patient-001"
assert result.context.encounter_id == "demo-encounter-001"

# Confirm hookInstance is a non-empty string (UUID)
assert isinstance(result.hook_instance, str)
assert len(result.hook_instance) == 36   # UUID format: 8-4-4-4-12 chars plus dashes

# Confirm draftOrders is a collection Bundle containing the ServiceRequest
draft_orders = result.context.draft_orders
assert draft_orders["resourceType"] == "Bundle"
assert draft_orders["type"] == "collection"
assert draft_orders["entry"][0]["resource"]["resourceType"] == "ServiceRequest"

# Confirm authoredOn is today's date (dynamic override)
from datetime import date
assert draft_orders["entry"][0]["resource"]["authoredOn"] == date.today().isoformat()

# Confirm prefetch keys are present
assert "patient" in result.prefetch
assert "conditions" in result.prefetch
assert "coverage" in result.prefetch
assert "priorProcedures" in result.prefetch

# Confirm prefetch bundles have the correct types
assert result.prefetch["conditions"]["type"] == "searchset"
assert result.prefetch["conditions"]["total"] == 1
assert result.prefetch["priorProcedures"]["type"] == "searchset"
assert result.prefetch["priorProcedures"]["total"] == 1

# Confirm the ICD-10-CM Z80.0 code is in the conditions bundle
condition_code = result.prefetch["conditions"]["entry"][0]["resource"]["code"]["coding"][0]["code"]
assert condition_code == "Z80.0", f"Expected Z80.0, got {condition_code}"

# Confirm the CPT 45378 code is in the priorProcedures bundle
procedure_code = result.prefetch["priorProcedures"]["entry"][0]["resource"]["code"]["coding"][0]["code"]
assert procedure_code == "45378", f"Expected 45378, got {procedure_code}"

print("build_crd_request: all assertions passed")
```

---

#### Step 9 — Verify camelCase serialization of the outgoing request

`cds_client.py` will serialize the request using `model_dump(by_alias=True)` before transmitting it to the payer. Verify that the serialized output has the correct camelCase keys the payer expects:

```python
from app.fhir_factory import build_crd_request

result = build_crd_request()
wire = result.model_dump(by_alias=True)

# Confirm top-level camelCase keys
assert "hook" in wire
assert "hookInstance" in wire
assert "fhirServer" in wire
assert "context" in wire
assert "prefetch" in wire

# Confirm no snake_case keys leaked to the wire format
assert "hook_instance" not in wire
assert "fhir_server" not in wire

# Confirm nested context uses camelCase
assert "userId" in wire["context"]
assert "patientId" in wire["context"]
assert "encounterId" in wire["context"]
assert "draftOrders" in wire["context"]
assert "user_id" not in wire["context"]

print("camelCase serialization: OK")
```

If all assertions pass, `fhir_factory.py` is complete and correct. It is ready to be called by `cds_client.py` and tested by `tests/test_fhir_factory.py`.

---

## Appendix A: Common Errors and What They Mean

| Error | Likely cause |
|-------|-------------|
| `FileNotFoundError: Fixture file not found: ...` | The fixtures directory path is wrong, or a fixture file was not created. Confirm `app/fixtures/` exists and contains all five JSON files. |
| `json.JSONDecodeError` / `ValueError: Fixture file is not valid JSON` | A fixture file has a syntax error. Open it and validate the JSON manually. |
| `ImportError: cannot import name 'CdsHooksRequest' from 'app.models'` | `models.py` is missing or the class name is misspelled. Verify `models.py` is complete. |
| `AssertionError` on `hook_instance` length check | `uuid.uuid4()` was not converted to string with `str()`. The UUID object renders as 36 chars but is not a `str`. |
| `KeyError: 'conditions'` on prefetch access | The prefetch key name does not match what the payer declared in discovery. Keys are case-sensitive: `conditions`, not `Conditions`. |
| `hook_instance` or `fhir_server` appear in `wire` instead of `hookInstance` / `fhirServer` | `model_dump(by_alias=True)` was not passed. The `by_alias=True` argument is required for camelCase output. |
| `authoredOn` in the bundle still shows the old fixture date | The dict copy step `{**service_request, "authoredOn": ...}` was not done, or the result was not assigned back to `service_request`. |

---

## Appendix B: Module Structure Quick Reference

```
fhir_factory.py
│
├── _FIXTURES_DIR              Module-level constant — absolute path to app/fixtures/
│
├── load_fixture(filename)     Reads and parses a fixture file; raises descriptive errors
│
├── build_draft_orders_bundle(service_request)
│                              Returns a FHIR collection Bundle wrapping the ServiceRequest
│
├── build_conditions_bundle(condition)
│                              Returns a FHIR searchset Bundle wrapping the Condition
│
├── build_procedures_bundle(procedure)
│                              Returns a FHIR searchset Bundle wrapping the Procedure
│
└── build_crd_request()        ← public API
                               Loads all fixtures, assembles Bundles, sets context fields,
                               generates hookInstance UUID, returns CdsHooksRequest instance
```

Only `build_crd_request` is part of the public API. The loader and bundle builders are implementation details. External callers (routes, tests, `cds_client.py`) import and call only `build_crd_request`.
