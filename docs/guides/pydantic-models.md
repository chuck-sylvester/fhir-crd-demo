# Pydantic Models — Learning Guide and Implementation Reference

For `provider-ehr/app/models.py`

---

## How to Use This Document

This document has two parts:

**Part 1 — Learning Reference (Sections 1–5):** Explains Pydantic concepts from first principles using simple examples that are unrelated to the project. Read these sections before writing any code. Each concept is illustrated on its own so it is clear in isolation before you apply it to the actual project models.

**Part 2 — Implementation Guide (Section 6):** Steps through building `models.py` for the Provider EHR application. The steps are organized into phases. Each phase produces something verifiable before you move to the next one. Code blocks are complete and ready to copy.

**Pydantic version used in this project: 2.9.x**

---

## Part 1: What Pydantic Is

### 1.1 The Problem Pydantic Solves

Python's type annotations (`:str`, `:int`, etc.) are hints for tools and developers. At runtime, plain Python does not enforce them. The following code runs without error even though the types are wrong:

```python
name: str = 42       # Python accepts this silently
age: int = "hello"   # Python accepts this too
```

Pydantic enforces types **at runtime**. When you create a Pydantic model instance, Pydantic validates every value against its declared type before the instance is created. If a value is wrong, Pydantic raises a `ValidationError` immediately with a clear message — before the bad data travels anywhere in the application.

This is especially important in a web application that receives JSON from external sources, because external data cannot be trusted to have the correct shape or types.

### 1.2 What a Pydantic Model Is

A Pydantic model is a Python class that inherits from `BaseModel`. Each attribute declared on the class with a type annotation becomes a validated, managed field. The model:

- Enforces types when an instance is created
- Provides methods for **serialization** — converting the model to a Python dictionary or JSON string
- Provides methods for **parsing** — building a model instance from a dictionary or JSON string

Simple example — a model representing a person:

```python
from pydantic import BaseModel

class Person(BaseModel):
    name: str
    age: int
    email: str | None = None   # Optional; defaults to None if not provided

# Valid construction
p = Person(name="Alice", age=30)
print(p.name)    # Alice
print(p.age)     # 30
print(p.email)   # None

# Pydantic coerces compatible types where possible
p2 = Person(name="Bob", age="25")   # The string "25" is coerced to the integer 25
print(p2.age)    # 25  (int, not str)

# Invalid construction raises ValidationError immediately
p3 = Person(name="Carol", age="not-a-number")   # Raises ValidationError
```

### 1.3 Pydantic v1 vs v2

This project uses Pydantic **v2**. Many tutorials and Stack Overflow answers cover v1. The two versions are not compatible — the API changed significantly in v2. When reading external resources, watch for these differences:

| v1 (old) | v2 (this project) |
|---|---|
| `class Config:` nested inside the model | `model_config = ConfigDict(...)` as a class variable |
| `.dict()` | `.model_dump()` |
| `.json()` | `.model_dump_json()` |
| `parse_obj(data)` | `Model.model_validate(data)` |
| `parse_raw(json_str)` | `Model.model_validate_json(json_str)` |
| `@validator` decorator | `@field_validator` decorator |

If a code example uses `class Config:` or `.dict()`, it was written for v1 and needs adaptation before use in this project.

---

## Part 2: Fields, Defaults, and Optional Values

### 2.1 Required Fields

A field declared with a type annotation and no default value is **required**. Pydantic raises a `ValidationError` if a required field is missing when the model is constructed.

```python
from pydantic import BaseModel

class Order(BaseModel):
    order_id: str      # Required — must be provided
    quantity: int      # Required — must be provided
    note: str = ""     # Optional — defaults to an empty string
```

### 2.2 Optional Fields That Can Be None

Use `str | None = None` to declare a field that may be absent entirely. The `| None` part makes `None` a valid type for the field. The `= None` sets the default so the field does not need to be supplied when constructing the model.

```python
from pydantic import BaseModel

class Order(BaseModel):
    order_id: str
    note: str | None = None     # Absent is valid; becomes None if not supplied
```

`None` and an empty string are different things. A missing optional field is `None`, not `""`.

### 2.3 The `Field()` Function

`Field()` provides additional control over a field beyond the type annotation. Common uses include setting a description, enforcing value constraints, or declaring an alias (covered in Part 4). `Field()` replaces the default value when used:

```python
from pydantic import BaseModel, Field

class Order(BaseModel):
    order_id: str = Field(description="Unique identifier for the order")
    quantity: int = Field(ge=1, description="Must be at least 1")
    note: str | None = Field(default=None, description="Optional order note")
```

`ge=1` means "greater than or equal to 1" — Pydantic will reject any `quantity` below 1 with a `ValidationError`.

---

## Part 3: Serialization and Parsing

This section covers moving data between Pydantic models and the formats that cross application boundaries: Python dictionaries and JSON strings.

### 3.1 Constructing from Keyword Arguments

The standard way to create a model instance directly in Python code:

```python
from pydantic import BaseModel

class Person(BaseModel):
    name: str
    age: int

p = Person(name="Alice", age=30)
```

### 3.2 Parsing from a Dictionary — `model_validate()`

Use this when you have a Python dictionary, such as one returned by a JSON parser. This is the correct v2 method:

```python
data = {"name": "Alice", "age": 30}
p = Person.model_validate(data)
```

### 3.3 Parsing from a JSON String — `model_validate_json()`

Use this when you have a raw JSON string and want to skip the intermediate dictionary step:

```python
json_str = '{"name": "Alice", "age": 30}'
p = Person.model_validate_json(json_str)
```

### 3.4 Serializing to a Dictionary — `model_dump()`

Produces a Python dictionary from the model instance. Nested models are recursively converted to nested dictionaries:

```python
p = Person(name="Alice", age=30)
d = p.model_dump()
print(d)    # {'name': 'Alice', 'age': 30}
```

### 3.5 Serializing to a JSON String — `model_dump_json()`

Produces a JSON string directly:

```python
p = Person(name="Alice", age=30)
j = p.model_dump_json()
print(j)    # '{"name":"Alice","age":30}'
```

### 3.6 The `by_alias=True` Parameter

When aliases are configured (covered in Part 4), `model_dump()` and `model_dump_json()` use Python attribute names by default. To produce output using the alias names — which is required when sending JSON to an external service that expects camelCase — pass `by_alias=True`:

```python
d = instance.model_dump(by_alias=True)
j = instance.model_dump_json(by_alias=True)
```

This parameter is critical in this project. The `cds_client.py` module must pass `by_alias=True` when serializing the outgoing CDS Hooks request so that the payer receives field names in the camelCase format the CDS Hooks specification requires.

---

## Part 4: Aliases and the Naming Convention Bridge

This is the most important section for this project. The implementation of `models.py` depends on understanding it fully.

### 4.1 The Problem

CDS Hooks is a JSON protocol. Its specification defines all field names in camelCase: `hookInstance`, `patientId`, `draftOrders`, `fhirServer`. Python convention (PEP 8) requires attribute names to use snake_case: `hook_instance`, `patient_id`, `draft_orders`, `fhir_server`.

A Pydantic model must bridge the two: Python code uses snake_case to maintain Python conventions, but JSON on the wire uses camelCase to satisfy the CDS Hooks specification.

Not all field names in these models are affected. Fields where camelCase and snake_case are identical — `hook`, `label`, `url`, `type`, `summary`, `indicator`, `detail`, `cards` — require no special treatment. The fields that differ are:

| Python snake_case attribute | CDS Hooks JSON camelCase key |
|---|---|
| `hook_instance` | `hookInstance` |
| `fhir_server` | `fhirServer` |
| `user_id` | `userId` |
| `patient_id` | `patientId` |
| `encounter_id` | `encounterId` |
| `draft_orders` | `draftOrders` |

### 4.2 What an Alias Is

An alias is a second name for a Pydantic field — the name used in JSON, as opposed to the name used in Python code. When an alias is set:

- Pydantic uses the alias when parsing incoming JSON that has the alias as a key
- Pydantic uses the alias when serializing output with `by_alias=True`

### 4.3 Alias Generator

Rather than declaring an alias on every individual field, an **alias generator** is a function that Pydantic calls automatically for every field at class definition time. The function receives the Python attribute name and returns the corresponding alias.

This project uses `to_camel`, imported from `pydantic.alias_generators`. It converts snake_case to camelCase using the standard rules:

```
hook_instance  →  hookInstance
patient_id     →  patientId
draft_orders   →  draftOrders
fhir_server    →  fhirServer
hook           →  hook           (unchanged — no underscores)
label          →  label          (unchanged)
```

### 4.4 `populate_by_name=True`

By default, when an alias generator is active, Pydantic only accepts the alias name when constructing or parsing a model — not the Python attribute name. This would mean writing `CdsHooksContext(userId="...", patientId="...", draftOrders={})` in Python, which defeats the purpose of snake_case.

Setting `populate_by_name=True` in the model configuration allows construction using **either** the Python attribute name **or** the alias. Always set this when using an alias generator.

### 4.5 `model_config` and `ConfigDict`

Model configuration in Pydantic v2 is set via a class variable named `model_config`, assigned a `ConfigDict` instance. Place it at the very top of the class body, before any field declarations.

```python
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

class ExampleModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True
    )

    hook_instance: str
    patient_id: str
```

With this configuration in place:

| Operation | Works? |
|---|---|
| `ExampleModel(hook_instance="abc", patient_id="123")` | Yes — snake_case construction |
| `ExampleModel(hookInstance="abc", patientId="123")` | Yes — alias construction |
| `ExampleModel.model_validate({"hookInstance": "abc", "patientId": "123"})` | Yes — parsing camelCase JSON |
| `instance.model_dump()` | Returns `{"hook_instance": "abc", "patient_id": "123"}` |
| `instance.model_dump(by_alias=True)` | Returns `{"hookInstance": "abc", "patientId": "123"}` |
| `instance.model_dump_json(by_alias=True)` | Returns `'{"hookInstance":"abc","patientId":"123"}'` |

---

## Part 5: Nested Models

### 5.1 Using a Model as a Field Type

A Pydantic model can appear as the type annotation of a field in another model. Pydantic validates the nested model automatically when the outer model is constructed or parsed.

```python
from pydantic import BaseModel

class Address(BaseModel):
    street: str
    city: str

class Person(BaseModel):
    name: str
    address: Address
```

When constructing from a dictionary — such as parsed JSON — Pydantic creates the nested model automatically:

```python
data = {
    "name": "Alice",
    "address": {"street": "123 Main St", "city": "Springfield"}
}
p = Person.model_validate(data)
print(p.address.city)      # Springfield
print(type(p.address))     # <class 'Address'>
```

### 5.2 Lists of Models

A field can be typed as a list of models:

```python
from pydantic import BaseModel

class Item(BaseModel):
    name: str
    price: float

class Cart(BaseModel):
    items: list[Item] = []
```

Pydantic validates each element of the list against `Item`. The empty list default is safe — Pydantic creates a new list for each `Cart` instance rather than sharing one list object across all instances (a subtle issue in plain Python dataclasses that Pydantic handles automatically).

### 5.3 Serialization with Nested Models

`model_dump()` and `model_dump_json()` serialize the full structure recursively. The `by_alias=True` parameter applies at every level of nesting:

```python
cart = Cart(items=[Item(name="Widget", price=9.99)])
print(cart.model_dump())
# {'items': [{'name': 'Widget', 'price': 9.99}]}
```

---

## Part 6: Implementation — `provider-ehr/app/models.py`

Read Parts 1–5 before beginning. Each step below produces something you can verify before moving to the next step.

**Reference documents:**
- `docs/spec/provider-ehr-spec.md` Section 6 — model definitions, field tables, and naming convention rationale
- `docs/spec/cds-hooks-api-contract.md` Sections 4.1 and 4.2 — CDS Hooks wire format

---

### Phase 1: File Setup

#### Step 1 — Create the file and add imports

Create `provider-ehr/app/models.py`. Add the following at the top of the file. These are the only imports the complete module requires.

```python
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel
```

**Verify:** Open a Python shell from the `provider-ehr/` directory (virtual environment activated) and confirm the imports resolve:

```python
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel
print("imports OK")
```

If this raises an `ImportError`, confirm that `pydantic==2.9.2` is installed: `pip show pydantic`.

---

### Phase 2: Outgoing Request Models

These models represent the CDS Hooks `order-sign` request that the EHR assembles and sends to the payer. `fhir_factory.py` constructs instances of these models; `cds_client.py` serializes them to JSON for transmission.

#### Step 2 — Implement `CdsHooksContext`

`CdsHooksContext` represents the `context` object nested inside the top-level request. It carries the clinical identifiers required by the CDS Hooks `order-sign` hook specification.

Add this class to `models.py` below the imports:

```python
class CdsHooksContext(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    user_id: str
    patient_id: str
    encounter_id: str | None = None
    draft_orders: dict
```

**What each field does:**

| Attribute | JSON alias | Purpose |
|---|---|---|
| `user_id` | `userId` | FHIR reference of the ordering clinician |
| `patient_id` | `patientId` | FHIR logical id of the patient |
| `encounter_id` | `encounterId` | Optional; FHIR encounter id |
| `draft_orders` | `draftOrders` | FHIR Bundle containing the draft ServiceRequest |

`draft_orders` is typed as `dict` because the full FHIR Bundle structure is not validated at the model level in Phase 1. The bundle is assembled by `fhir_factory.py` and passed through without further schema enforcement.

**Verify:** From a Python shell in `provider-ehr/`:

```python
from app.models import CdsHooksContext

ctx = CdsHooksContext(
    user_id="PractitionerRole/demo-clinician",
    patient_id="demo-patient-001",
    draft_orders={}
)

# Check snake_case access
print(ctx.user_id)         # PractitionerRole/demo-clinician
print(ctx.encounter_id)    # None

# Check camelCase serialization
print(ctx.model_dump(by_alias=True))
# Expected: {'userId': 'PractitionerRole/demo-clinician',
#            'patientId': 'demo-patient-001',
#            'encounterId': None,
#            'draftOrders': {}}
```

---

#### Step 3 — Implement `CdsHooksRequest`

`CdsHooksRequest` is the top-level request envelope. It wraps the hook identifier, a unique per-invocation id, the clinical context, and the prefetched FHIR resources.

Add this class below `CdsHooksContext`:

```python
class CdsHooksRequest(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    hook: str
    hook_instance: str
    fhir_server: str | None = None
    context: CdsHooksContext
    prefetch: dict
```

**What each field does:**

| Attribute | JSON alias | Purpose |
|---|---|---|
| `hook` | `hook` | Always `"order-sign"` for this project |
| `hook_instance` | `hookInstance` | UUID generated fresh for each CRD invocation |
| `fhir_server` | `fhirServer` | Placeholder EHR FHIR endpoint URL; not dereferenced by the payer in Phase 1 |
| `context` | `context` | A `CdsHooksContext` instance; Pydantic validates it as a nested model |
| `prefetch` | `prefetch` | Dictionary of prefetched FHIR resources keyed by name |

**Note on the nested context field:** Because `context` is typed as `CdsHooksContext`, Pydantic validates it automatically. When serializing `CdsHooksRequest` with `by_alias=True`, the alias generator applies recursively — the `context` dictionary in the output uses `userId`, `patientId`, etc.

**Verify:** From a Python shell in `provider-ehr/`:

```python
from app.models import CdsHooksRequest, CdsHooksContext

ctx = CdsHooksContext(
    user_id="PractitionerRole/demo-clinician",
    patient_id="demo-patient-001",
    draft_orders={"resourceType": "Bundle"}
)

req = CdsHooksRequest(
    hook="order-sign",
    hook_instance="test-uuid-1234",
    context=ctx,
    prefetch={}
)

output = req.model_dump(by_alias=True)

# Confirm top-level aliases
assert "hookInstance" in output
assert "fhirServer" in output

# Confirm nested context aliases
assert output["context"]["userId"] == "PractitionerRole/demo-clinician"
assert output["context"]["draftOrders"] == {"resourceType": "Bundle"}

print("CdsHooksRequest verified")
```

---

### Phase 3: Incoming Response Models

These models represent the CDS Cards response returned by the payer. `cds_client.py` parses the payer's JSON into these models. The `routes/clinician.py` route passes the parsed cards to the Jinja2 template for rendering.

Implement the response models **bottom-up** — define simpler models before the models that contain them.

#### Step 4 — Implement `CdsSource`

`CdsSource` represents the `source` object inside a CDS Card. It identifies the payer service that produced the card.

Add this class below `CdsHooksRequest`:

```python
class CdsSource(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    label: str
    url: str | None = None
```

Neither `label` nor `url` contains underscores, so the alias generator produces identical names. The `model_config` declaration is still required for consistency — all wire-format models in this module carry the same configuration.

---

#### Step 5 — Implement `CdsLink`

`CdsLink` represents a single entry in the `links` array of a CDS Card. Each link is a clickable URL displayed to the clinician alongside the card.

Add this class below `CdsSource`:

```python
class CdsLink(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    label: str
    url: str
    type: str
```

**Note on `type`:** `type` is a Python built-in name. Using it as a Pydantic field attribute is legal and works correctly. Be aware that within any methods you might add to this class, `type` would shadow the built-in. This is acceptable for Phase 1 given the simplicity of the model.

---

#### Step 6 — Implement `CdsCard`

`CdsCard` represents a single CDS Card. It nests `CdsSource` and a list of `CdsLink` objects.

Add this class below `CdsLink`:

```python
class CdsCard(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    summary: str
    indicator: str
    source: CdsSource
    detail: str | None = None
    links: list[CdsLink] = []
```

**Key points:**

- `source` is typed as `CdsSource` — Pydantic constructs it automatically from the nested dictionary in the payer's JSON response
- `links` defaults to `[]` — a card with no links is valid; Pydantic creates a fresh empty list for each card instance
- `detail` is optional Markdown text — it may be absent from the payer's response; the template must handle `None`
- `indicator` will be one of `"info"`, `"warning"`, or `"critical"` — the template uses this value to select styling

---

#### Step 7 — Implement `CdsHooksResponse`

`CdsHooksResponse` is the top-level envelope of the payer's response. It wraps the list of cards.

Add this class below `CdsCard`:

```python
class CdsHooksResponse(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    cards: list[CdsCard]
```

**How this is used in `cds_client.py`:** After HTTPX receives the HTTP response from the payer, parsing it into this model requires one call:

```python
CdsHooksResponse.model_validate(response.json())
```

`response.json()` (provided by HTTPX) converts the response body to a Python dictionary. `model_validate` then recursively constructs the full nested structure — `CdsHooksResponse` containing `CdsCard` objects, each containing a `CdsSource` and zero or more `CdsLink` objects. All validation happens automatically in this single call.

---

### Phase 4: Verification

#### Step 8 — Verify the full module imports cleanly

From `provider-ehr/` with the virtual environment activated:

```bash
python -c "from app.models import CdsHooksRequest, CdsHooksContext, CdsHooksResponse, CdsCard, CdsSource, CdsLink; print('models.py OK')"
```

Expected output: `models.py OK`

Any `ImportError` or `SyntaxError` here indicates a problem in the file itself. Fix it before proceeding.

---

#### Step 9 — Verify round-trip parsing of a payer response

This test confirms that a realistic payer response body parses correctly into the full nested model structure. Run from a Python shell in `provider-ehr/`:

```python
from app.models import CdsHooksResponse, CdsCard, CdsSource, CdsLink

# Simulate the JSON body a payer would return
payer_response_data = {
    "cards": [
        {
            "summary": "High-risk family history supports 5-year colonoscopy interval",
            "indicator": "info",
            "source": {
                "label": "Demo Payer CRD Service",
                "url": "http://localhost:8080"
            },
            "detail": "ICD-10-CM Z80.0 confirms high-risk classification.",
            "links": [
                {
                    "label": "Colonoscopy Risk Documentation Checklist",
                    "url": "http://localhost:8080/questionnaires/colonoscopy-risk",
                    "type": "absolute"
                }
            ]
        }
    ]
}

# Parse into the model
response = CdsHooksResponse.model_validate(payer_response_data)

# Verify structure and types
assert isinstance(response.cards[0], CdsCard)
assert isinstance(response.cards[0].source, CdsSource)
assert isinstance(response.cards[0].links[0], CdsLink)

# Verify field access using Python snake_case names
assert response.cards[0].summary == "High-risk family history supports 5-year colonoscopy interval"
assert response.cards[0].indicator == "info"
assert response.cards[0].source.label == "Demo Payer CRD Service"
assert response.cards[0].links[0].url == "http://localhost:8080/questionnaires/colonoscopy-risk"
assert response.cards[0].links[0].type == "absolute"

print("Round-trip parse: OK")
```

---

#### Step 10 — Verify round-trip serialization of an outgoing request

This test confirms the outgoing request serializes with correct camelCase field names. Run from a Python shell in `provider-ehr/`:

```python
from app.models import CdsHooksRequest, CdsHooksContext

ctx = CdsHooksContext(
    user_id="PractitionerRole/demo-clinician",
    patient_id="demo-patient-001",
    encounter_id="demo-encounter-001",
    draft_orders={"resourceType": "Bundle", "type": "collection", "entry": []}
)

req = CdsHooksRequest(
    hook="order-sign",
    hook_instance="550e8400-e29b-41d4-a716-446655440000",
    fhir_server="http://localhost:8000/fhir",
    context=ctx,
    prefetch={"patient": {"resourceType": "Patient", "id": "demo-patient-001"}}
)

# Serialize with camelCase aliases for wire transmission
wire_output = req.model_dump(by_alias=True)

# Confirm top-level camelCase keys are present
assert "hook" in wire_output
assert "hookInstance" in wire_output
assert "fhirServer" in wire_output
assert "context" in wire_output
assert "prefetch" in wire_output

# Confirm nested context also uses camelCase
assert "userId" in wire_output["context"]
assert "patientId" in wire_output["context"]
assert "encounterId" in wire_output["context"]
assert "draftOrders" in wire_output["context"]

# Confirm no snake_case keys leaked into the wire output
assert "hook_instance" not in wire_output
assert "fhir_server" not in wire_output
assert "user_id" not in wire_output["context"]

print("Outgoing serialization: OK")
```

If all assertions pass, `models.py` is complete and correct. It is ready to be used by `fhir_factory.py` in Step 7 of the build sequence.

---

## Appendix A: Common Pydantic v2 Errors and What They Mean

| Error message | Likely cause |
|---|---|
| `ValidationError: Field required` | A required field (no default) was not provided at construction time |
| `ValidationError: Input should be a valid string` | A value of the wrong type was passed for a `str` field |
| `ValidationError: Input should be a valid integer` | A non-numeric string was passed for an `int` field |
| `ImportError: cannot import name 'to_camel'` | Wrong import path — use `from pydantic.alias_generators import to_camel` |
| `model_dump()` returns snake_case but camelCase expected | You omitted `by_alias=True` — use `model_dump(by_alias=True)` |
| `model_validate` fails on camelCase input | Confirm `alias_generator=to_camel` is in `model_config`, not in a `Field()` call |
| `AttributeError: 'dict' object has no attribute 'model_dump'` | You are holding a dict, not a model instance — call `Model.model_validate(data)` first |

---

## Appendix B: Quick Reference — Key Pydantic v2 Methods

| Method | What it does |
|---|---|
| `Model(field=value, ...)` | Construct an instance from keyword arguments |
| `Model.model_validate(dict)` | Construct an instance by parsing a Python dictionary |
| `Model.model_validate_json(str)` | Construct an instance by parsing a JSON string |
| `instance.model_dump()` | Serialize to a dict using Python attribute names |
| `instance.model_dump(by_alias=True)` | Serialize to a dict using JSON alias names (camelCase) |
| `instance.model_dump_json()` | Serialize to a JSON string using Python attribute names |
| `instance.model_dump_json(by_alias=True)` | Serialize to a JSON string using JSON alias names (camelCase) |
