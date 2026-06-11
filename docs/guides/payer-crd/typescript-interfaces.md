# TypeScript Interfaces — Learning Guide and Implementation Reference

For `payer-crd/src/types/cdsHooks.ts`

---

## How to Use This Document

This document has two parts:

**Part 1 — Learning Reference (Sections 1–9):** Explains TypeScript type system concepts from first principles using simple examples unrelated to the project. Read these sections before writing any code. Each concept is illustrated on its own so it is clear in isolation before you apply it to the actual project types. Where a concept has a direct equivalent in the Python/Pydantic code you have already written, that parallel is noted to help you transfer your existing mental model.

**Part 2 — Implementation Guide (Section 10):** Steps through building `src/types/cdsHooks.ts` for the Payer CRD service. The steps are organized into phases. Each phase produces something verifiable before you move to the next one. Code blocks are complete and ready to copy.

**Prerequisites:** You should have completed Build Sequence steps 1 and 2 (project scaffolding and environment configuration). `bun install` should have succeeded and `src/index.ts` should be runnable with `bun run dev`.

**TypeScript version used in this project:** The version bundled with Bun (currently 5.x). The tsconfig uses `strict: true` and `noUncheckedIndexedAccess: true`. Both of these are explained in Section 9.

---

## Part 1: The TypeScript Type System

### 1.1 What a TypeScript Interface Is — and What It Is Not

A TypeScript **interface** declares the expected shape of a JavaScript object. It names the object type and lists its properties, each with a type annotation. The TypeScript compiler uses these declarations to check your code at build time.

A minimal example:

```typescript
interface Person {
  name: string;
  age: number;
}

function greet(person: Person): string {
  return `Hello, ${person.name}`;
}

greet({ name: "Alice", age: 30 });   // OK
greet({ name: "Bob" });               // Type error: 'age' is missing
greet({ name: "Carol", age: "30" });  // Type error: 'age' must be number
```

The TypeScript compiler rejects the last two calls before any code runs.

**The critical difference from Pydantic:** Pydantic models enforce types **at runtime** — they validate incoming data and raise errors when the data is wrong. TypeScript interfaces enforce types only **at compile time** — they exist only in your source code and are completely erased when Bun compiles TypeScript to JavaScript. There is no runtime equivalent of Pydantic's `ValidationError` in TypeScript.

This has a practical consequence for this project: when the `crd.ts` route handler receives a JSON body from the network, TypeScript does not automatically validate that the body matches `CdsHooksRequest`. The programmer is responsible for manually checking required fields before trusting them. The route handler does this explicitly (step 9.2 in the spec).

**The camelCase advantage:** Python uses snake_case for identifiers and requires Pydantic alias generators to bridge to the camelCase expected in JSON. TypeScript and JavaScript natively use camelCase for identifiers, so the TypeScript interface property names (`hookInstance`, `patientId`, `draftOrders`) match the CDS Hooks JSON wire format directly. No alias configuration is needed.

---

### 1.2 Optional Properties

A property marked with `?:` is optional — the object may or may not include it. When accessed, an optional property has the type `T | undefined` rather than `T`.

```typescript
interface Config {
  host: string;
  port: number;
  timeout?: number;    // Optional; type is number | undefined
}

const a: Config = { host: "localhost", port: 8080 };            // OK
const b: Config = { host: "localhost", port: 8080, timeout: 10 }; // Also OK
```

**Parallel to Python:** `timeout?: number` corresponds directly to `timeout: int | None = None` in a Pydantic model. Both say "this field may be absent." The TypeScript `?:` syntax is more concise.

**When optional matters:** TypeScript (in strict mode) will not let you pass an optional value directly to a function that expects the non-optional type without checking for `undefined` first:

```typescript
function doubleTimeout(config: Config): number {
  return config.timeout * 2;   // Type error: 'timeout' is possibly undefined
}

function doubleTimeoutSafe(config: Config): number {
  return (config.timeout ?? 30) * 2;   // OK: ?? provides a default if undefined
}
```

The `??` operator is the **nullish coalescing** operator. It evaluates to the right-hand side when the left-hand side is `null` or `undefined`. You will see this pattern throughout the rule engine code.

---

### 1.3 Union Types

A **union type** allows a value to be one of several types. The `|` operator forms the union:

```typescript
let id: string | number;
id = "abc-123";   // OK
id = 42;          // Also OK
id = true;        // Type error: boolean is not assignable to string | number
```

**With `null` and `undefined`:** In TypeScript's strict mode, `null` and `undefined` are their own types and are not interchangeable with other types. To declare that a property may be absent or null, you explicitly include them in the union:

```typescript
interface Response {
  data: string | null;   // Must be either a string or null; cannot be undefined
}
```

This project uses `optional property` (`?:`) rather than explicit `| undefined` for absent fields. The two are subtly different:

| Declaration | Means |
|---|---|
| `field?: string` | Property may be absent from the object entirely, or present with a `string` value |
| `field: string \| undefined` | Property must be present in the object, but its value may be `undefined` |

In practice, for JSON data, the `?:` form is almost always the right choice — absent keys in JSON and `undefined` values behave identically in JavaScript.

---

### 1.4 String Literal Types

TypeScript can restrict a value to a specific set of string constants using a **string literal union**:

```typescript
type Direction = 'north' | 'south' | 'east' | 'west';

function move(direction: Direction): void {
  console.log(`Moving ${direction}`);
}

move('north');     // OK
move('up');        // Type error: 'up' is not assignable to type Direction
```

This is TypeScript's equivalent of Python's `Literal['north', 'south', 'east', 'west']` from the `typing` module. The benefit is that if you mistype a value — writing `'nrth'` instead of `'north'` — the compiler catches it immediately rather than letting it reach the rule engine at runtime.

This project uses string literal types for fields where only specific values are valid:

- `CdsCard.indicator`: `'info' | 'warning' | 'critical'`
- `CdsLink.type`: `'absolute' | 'smart'`
- `RuleOutcome`: `'covered-high-risk' | 'missing-documentation' | 'interval-not-met'`

---

### 1.5 Type Aliases — the `type` Keyword

A **type alias** gives a name to any TypeScript type expression. It is declared with the `type` keyword instead of `interface`:

```typescript
type UserId = string;
type Status = 'active' | 'inactive' | 'pending';
type MaybeNumber = number | null;
```

Type aliases can name:
- Primitive types: `type Name = string`
- Union types: `type Status = 'active' | 'inactive'`
- Object shapes (same as `interface`): `type Point = { x: number; y: number }`
- Generic types: `type Nullable<T> = T | null`

**`interface` vs `type` for object shapes:** Both `interface` and `type` can describe object shapes, and for the purposes of this project, the distinction is minor. The convention in this project is:
- Use `interface` for object shapes (FHIR resources, CDS Hooks structures)
- Use `type` for union types and aliases (like `RuleOutcome`)

The practical reason: `interface` declarations can be merged (extended) by other `interface` declarations of the same name, which is useful for extending library types. `type` aliases cannot be merged. For describing FHIR and CDS Hooks shapes, `interface` is the idiomatic choice.

---

### 1.6 Literal Types on Interface Fields

A field in an interface can be typed as a string literal rather than the general `string` type:

```typescript
interface FhirPatient {
  resourceType: 'Patient';   // Must be exactly the string 'Patient'
  id: string;
}

const p: FhirPatient = { resourceType: 'Patient', id: '001' };   // OK
const q: FhirPatient = { resourceType: 'Practitioner', id: '002' }; // Type error
```

This is used for FHIR `resourceType` fields in this project. Each FHIR resource has a `resourceType` field that must match exactly — a `FhirPatient` always has `resourceType: 'Patient'`, a `FhirBundle` always has `resourceType: 'Bundle'`. Narrowing these to string literals lets TypeScript distinguish resource types at compile time and catches mistakes like placing a `Patient` where a `Bundle` is expected.

---

### 1.7 `unknown` vs `any`

TypeScript provides two "escape hatch" types for values whose shape is not known:

**`any`** — opts out of type checking entirely. A value typed as `any` can be passed anywhere and accessed in any way. The TypeScript compiler makes no checks. This is almost always a mistake in strict TypeScript.

**`unknown`** — the type-safe alternative to `any`. A value typed as `unknown` can be assigned from any type, but you cannot do anything with it — access properties, call it as a function, pass it to a typed parameter — without first narrowing it with a type guard or cast.

```typescript
function processValue(x: unknown): void {
  x.toUpperCase();              // Type error: 'x' is unknown
  if (typeof x === 'string') {
    x.toUpperCase();            // OK: TypeScript narrowed x to string
  }
}
```

**Why this project uses `unknown` for untyped FHIR fields:**

FHIR resources contain dozens of fields. The rule engine in this project only reads a small subset of those fields. Typing every FHIR field precisely would add significant complexity without benefit. Instead, the interfaces type only the fields the rule engine actually uses, and leave the rest typed as `unknown`:

```typescript
export interface FhirBundleEntry {
  resource: Record<string, unknown>;   // A FHIR resource: typed loosely
}
```

When the rule engine reads `resource`, it casts it to the specific FHIR type it expects (`as FhirCondition`, `as FhirProcedure`). The rest of the fields in the resource are ignored.

Using `unknown` (rather than `any`) ensures that the compiler still enforces type narrowing when you do work with the value. It is the disciplined way to say "I know this has data in it, but I'm not typing it fully right now."

---

### 1.8 The `Record` Utility Type

`Record<K, V>` is a built-in TypeScript generic that describes an object whose keys are of type `K` and values are of type `V`. It is the TypeScript equivalent of Python's `dict[K, V]`.

Common usage in this project:

```typescript
Record<string, unknown>   // An object with string keys and values of unknown type
```

This is the type used for `FhirBundleEntry.resource` — a FHIR resource object that has string keys but whose values are not precisely typed.

You will also see `Record` used in Hono route handlers for request body parsing.

---

### 1.9 Exporting from a TypeScript Module

TypeScript uses ES module syntax (`export`/`import`). Everything in a module is private by default; only things explicitly exported are accessible to other modules.

**Named exports:** Export each declaration individually:

```typescript
// src/types/cdsHooks.ts
export interface FhirCoding { ... }
export interface CdsCard { ... }
export type RuleOutcome = ...;
```

**Named imports:** Import specific names from a module:

```typescript
// src/rules/colonoscopyRuleEngine.ts
import type { FhirCondition, FhirProcedure, RuleResult, RuleOutcome } from '../types/cdsHooks.js';
```

The `import type` form is a TypeScript-only import — it imports only type information and is erased entirely at compile time. Use `import type` when importing interfaces, type aliases, and other type-level declarations. Use regular `import` when importing values (functions, constants, classes) that are needed at runtime.

**Why `../types/cdsHooks.js` not `../types/cdsHooks.ts`:** Even though the file is named `cdsHooks.ts`, TypeScript with `"moduleResolution": "bundler"` (as configured in this project's `tsconfig.json`) expects import paths to use the `.js` extension. Bun handles the resolution from `.js` to `.ts` at runtime. This is a TypeScript convention, not a mistake.

---

## Part 2: Strict Mode and the TypeScript Configuration

### 2.1 What `"strict": true` Enables

The `tsconfig.json` in this project sets `"strict": true`. This enables a family of TypeScript compiler checks that are individually named but commonly grouped together. The ones most relevant to the code you will write:

**`strictNullChecks`:** `null` and `undefined` are distinct types, not assignable to `string`, `number`, etc. without explicit inclusion in the union. This is why optional properties matter — TypeScript will not let you pass `string | undefined` where `string` is expected.

**`noImplicitAny`:** The compiler raises an error if it cannot infer a type and you have not annotated it. You cannot write `function process(x)` — you must write `function process(x: string)` or similar.

**`strictFunctionTypes`:** Function parameter types are checked contravariantly. This matters when you assign one function type to another.

For the interfaces in `cdsHooks.ts`, strict mode mostly means: you must mark every optional field with `?:` explicitly, and you must use `unknown` rather than leaving fields unannotated.

### 2.2 What `"noUncheckedIndexedAccess": true` Means

This option is not part of `strict` but is configured separately. It changes the type of array index access:

```typescript
const names = ['Alice', 'Bob'];
const first = names[0];
// Without noUncheckedIndexedAccess: first is string
// With noUncheckedIndexedAccess:    first is string | undefined
```

With this option, TypeScript acknowledges that array index access can fail — `names[5]` on a two-element array is `undefined` at runtime — and types the result accordingly. You must check for `undefined` before using an indexed value.

This affects how the rule engine accesses arrays of FHIR resources. You will see patterns like:

```typescript
const entry = bundle.entry[0];
if (entry !== undefined) {
  // use entry safely
}
```

Or using optional chaining:

```typescript
const resource = bundle.entry[0]?.resource;
```

The `?.` operator is **optional chaining** — it short-circuits to `undefined` if the left-hand side is `null` or `undefined`, rather than throwing. You will see this throughout the rule engine and route handler code.

---

## Part 3: FHIR Resource Shapes in TypeScript

### 3.1 Why FHIR Resources Are Typed as Interfaces

FHIR defines each resource type as a named structure with specific fields. TypeScript interfaces map naturally to this pattern: one interface per resource type, with the fields typed precisely for the fields the rule engine uses and `unknown` for the rest.

This project handles four FHIR resource types directly:

| FHIR resource | Interface | Fields used by rule engine |
|---|---|---|
| `Patient` | `FhirPatient` | `id`, `birthDate` |
| `Condition` | `FhirCondition` | `id`, `code.coding[].code`, `code.coding[].system` |
| `Procedure` | `FhirProcedure` | `id`, `status`, `code.coding[].code`, `performedDateTime` |
| `Coverage` | `FhirCoverage` | `id`, `status` |

Fields not listed above — like `Patient.address`, `Patient.telecom`, `Condition.severity` — appear in the FHIR resources sent by the Python EHR but are not read by the rule engine. They are not typed in the interfaces.

### 3.2 Coding and CodeableConcept — the FHIR Type Hierarchy

FHIR uses a two-level structure for coded clinical values like ICD-10 and CPT codes:

- A **`Coding`** is a single code from a single coding system. It has a `system` (the URI identifying the code system), a `code` (the code value), and an optional `display` (human-readable label).
- A **`CodeableConcept`** is a container that holds one or more `Coding` entries for the same concept, plus an optional `text` field for a free-text label.

For example, the ICD-10-CM code Z80.0 for family history of colorectal cancer is represented in FHIR as:

```json
{
  "coding": [
    {
      "system": "http://hl7.org/fhir/sid/icd-10-cm",
      "code": "Z80.0",
      "display": "Family history of malignant neoplasm of digestive organs"
    }
  ],
  "text": "Family history of colorectal cancer"
}
```

The rule engine looks for the high-risk indicator by searching through the `coding` array of a `Condition.code` for a specific `system` + `code` pair. The `FhirCoding` and `FhirCodeableConcept` interfaces model these structures.

### 3.3 Bundle and BundleEntry — the FHIR Container Structure

FHIR uses `Bundle` resources as containers. A `Bundle` has a `type`, an optional `total`, and an `entry` array. Each entry wraps a resource in an object with a `resource` field.

The `draftOrders` in the CDS Hooks context is a Bundle containing the colonoscopy ServiceRequest. The `conditions` and `priorProcedures` in the prefetch are Bundles containing Condition and Procedure resources respectively.

The CRD route handler unwraps the bundle entries to extract the individual resources before passing them to the rule engine:

```typescript
// Unwrap conditions from the prefetch bundle
const conditions = body.prefetch?.conditions?.entry?.map(e => e.resource as FhirCondition) ?? [];
```

The `as FhirCondition` is a **type assertion** — it tells TypeScript to treat the `unknown` resource as `FhirCondition`. The programmer is asserting "I know this entry is a Condition." TypeScript trusts this and will apply `FhirCondition` type checking to it from that point forward.

---

## Part 4: Implementation — `payer-crd/src/types/cdsHooks.ts`

Read Parts 1–3 before beginning. Each step below produces something you can verify before moving to the next one.

**Reference documents:**
- `docs/spec/payer-crd-spec.md` Section 7 — complete interface definitions with all fields
- `docs/spec/cds-hooks-api-contract.md` Section 4 — CDS Hooks wire format for the request
- `docs/spec/cds-hooks-api-contract.md` Section 5–6 — CDS Hooks wire format for the response

---

### Phase 1: File Setup

#### Step 1 — Create the file

The directory `src/types/` was created in Build Sequence step 1. Create `src/types/cdsHooks.ts` as an empty file.

All interfaces and type aliases will go in this single file. There are no imports — `cdsHooks.ts` has no dependencies on other modules in this project. Every declaration in the file will be exported.

**Verify:** Confirm the file exists and is empty:

```bash
ls payer-crd/src/types/cdsHooks.ts
```

---

### Phase 2: FHIR Supporting Types

These are the foundational building blocks used by the FHIR resource interfaces. Define them first because the resource interfaces reference them.

#### Step 2 — Implement `FhirCoding`

`FhirCoding` represents a single coded value from a terminology system.

```typescript
export interface FhirCoding {
  system: string;
  code: string;
  display?: string;
}
```

**What each field does:**

| Field | Type | Required | Purpose |
|---|---|---|---|
| `system` | `string` | Yes | URI identifying the terminology system (e.g. `http://hl7.org/fhir/sid/icd-10-cm` for ICD-10-CM, `http://www.ama-assn.org/go/cpt` for CPT) |
| `code` | `string` | Yes | The code value within that system (e.g. `Z80.0`, `45378`) |
| `display` | `string` | No | Human-readable label for the code; not used by the rule engine |

`display` is optional (`?:`) because FHIR resources in the wild often omit it. The rule engine only checks `system` and `code`.

---

#### Step 3 — Implement `FhirCodeableConcept`

`FhirCodeableConcept` wraps one or more `FhirCoding` entries for the same clinical concept.

```typescript
export interface FhirCodeableConcept {
  coding: FhirCoding[];
  text?: string;
}
```

**What each field does:**

| Field | Type | Required | Purpose |
|---|---|---|---|
| `coding` | `FhirCoding[]` | Yes | Array of codings for this concept; typically one entry in this project's fixtures |
| `text` | `string` | No | Free-text representation of the concept; not used by the rule engine |

`FhirCoding[]` is TypeScript's syntax for "an array of `FhirCoding` objects." This is equivalent to `list[FhirCoding]` in Python.

---

#### Step 4 — Implement `FhirBundleEntry` and `FhirBundle`

```typescript
export interface FhirBundleEntry {
  resource: Record<string, unknown>;
}

export interface FhirBundle {
  resourceType: 'Bundle';
  type: string;
  total?: number;
  entry: FhirBundleEntry[];
}
```

**Key design decisions:**

`FhirBundleEntry.resource` is typed as `Record<string, unknown>` — a general-purpose object with string keys. The actual value is a FHIR resource of some specific type, but the `FhirBundleEntry` interface does not know which type. The route handler applies a type assertion (`as FhirCondition`, `as FhirProcedure`) when it reads resources from the bundle entries.

`FhirBundle.resourceType` is typed as the string literal `'Bundle'` rather than `string`. This means TypeScript will only accept an object as a `FhirBundle` if its `resourceType` property is exactly the string `'Bundle'`. Using the literal type prevents accidentally placing a Patient or Condition object where a Bundle is expected.

---

### Phase 3: FHIR Resource Types

These interfaces describe the specific FHIR resources that the CDS Hooks prefetch delivers to the rule engine.

#### Step 5 — Implement `FhirPatient`

```typescript
export interface FhirPatient {
  resourceType: 'Patient';
  id: string;
  birthDate?: string;
  gender?: string;
  name?: Array<{ family?: string; given?: string[] }>;
}
```

**What the rule engine uses:**

| Field | Purpose |
|---|---|
| `id` | Identifies the patient |
| `birthDate` | Used by `calculateAge()` to determine patient age |

`gender` and `name` are included in the interface because the Python EHR fixture includes them, but the colonoscopy rule engine does not use them. Including them avoids type assertion failures if other code accesses them.

**Note on `name`:** The FHIR `HumanName` type is complex. Here it is typed inline as an anonymous object shape: `Array<{ family?: string; given?: string[] }>`. Both `family` and `given` are optional because FHIR allows name parts to be omitted. This is an example of TypeScript's inline object type syntax — you can write an object shape anywhere a type annotation is expected, without declaring a named interface.

---

#### Step 6 — Implement `FhirCondition`

```typescript
export interface FhirCondition {
  resourceType: 'Condition';
  id: string;
  code?: FhirCodeableConcept;
  clinicalStatus?: FhirCodeableConcept;
}
```

**What the rule engine uses:**

| Field | Purpose |
|---|---|
| `id` | Identifies the condition |
| `code` | Contains the ICD-10-CM coding; rule engine searches for `Z80.0` in `code.coding` |

`code` is optional because FHIR allows Conditions without a code (the code may be in a narrative). In practice this project's fixtures always include a code, but the interface must match the FHIR spec. The rule engine handles missing `code` gracefully by returning `false` from `hasHighRiskCondition`.

---

#### Step 7 — Implement `FhirProcedure`

```typescript
export interface FhirProcedure {
  resourceType: 'Procedure';
  id: string;
  status: string;
  code?: FhirCodeableConcept;
  performedDateTime?: string;
}
```

**What the rule engine uses:**

| Field | Purpose |
|---|---|
| `id` | Identifies the procedure |
| `status` | FHIR procedure status (`completed`, `in-progress`, etc.) — used to filter for completed procedures |
| `code` | Contains the CPT coding; rule engine searches for `45378` (colonoscopy) |
| `performedDateTime` | ISO 8601 date string; used by `yearsSince()` to calculate time since the prior procedure |

`performedDateTime` is optional because FHIR allows procedures with a date range (`performedPeriod`) rather than a point in time. This project's fixtures always use `performedDateTime`, but the interface is correct for the FHIR spec.

---

#### Step 8 — Implement `FhirCoverage`

```typescript
export interface FhirCoverage {
  resourceType: 'Coverage';
  id: string;
  status: string;
}
```

`FhirCoverage` is minimal in Phase 1. The rule engine does not use coverage data to make decisions — it receives the Coverage resource in the prefetch to confirm coverage is present, but the colonoscopy rule logic does not branch on coverage status. Only `id` and `status` are typed.

---

### Phase 4: CDS Hooks Request Types

These interfaces model the JSON body that the Python EHR sends to `POST /cds-services/crd-order-sign`. They are used in the CRD route handler to type the parsed request body.

#### Step 9 — Implement `CdsHooksContext`

```typescript
export interface CdsHooksContext {
  userId: string;
  patientId: string;
  encounterId?: string;
  draftOrders: FhirBundle;
}
```

**Comparison with the Python Pydantic model:**

| TypeScript (this file) | Python (`app/models.py`) |
|---|---|
| `userId: string` | `user_id: str` (alias: `userId`) |
| `patientId: string` | `patient_id: str` (alias: `patientId`) |
| `encounterId?: string` | `encounter_id: str \| None = None` (alias: `encounterId`) |
| `draftOrders: FhirBundle` | `draft_orders: dict` (alias: `draftOrders`) |

The TypeScript names match the JSON wire format directly (camelCase). The Python names use snake_case with aliases. Both describe the same structure.

`draftOrders` is typed as `FhirBundle` here rather than the generic `dict` used on the Python side. The Python side passes the bundle through without inspecting it; the TypeScript side may read its entries (though the colonoscopy rule engine primarily uses the prefetch resources, not `draftOrders` directly).

---

#### Step 10 — Implement `CdsHooksPrefetch`

```typescript
export interface CdsHooksPrefetch {
  patient?: FhirPatient;
  conditions?: FhirBundle;
  coverage?: FhirCoverage;
  priorProcedures?: FhirBundle;
}
```

All four prefetch keys are optional (`?:`) because a CDS Hooks client may send any subset of prefetch resources, or no prefetch at all. The CRD route handler uses the nullish coalescing operator (`??`) to substitute empty arrays when a prefetch key is absent:

```typescript
const conditions = body.prefetch?.conditions?.entry?.map(...) ?? [];
```

Each prefetch key corresponds to a key declared in the discovery response's `prefetch` template (see `fixtures/cds-discovery.json`). The Python EHR populates all four keys for the colonoscopy scenario.

Note that `conditions` and `priorProcedures` are typed as `FhirBundle` — the prefetch delivers these as FHIR search result bundles, not as individual resources. The route handler unwraps the bundle entries to extract the individual `FhirCondition` and `FhirProcedure` resources before passing them to the rule engine.

---

#### Step 11 — Implement `CdsHooksRequest`

```typescript
export interface CdsHooksRequest {
  hook: string;
  hookInstance: string;
  fhirServer?: string;
  context: CdsHooksContext;
  prefetch?: CdsHooksPrefetch;
}
```

**What each field does:**

| Field | Type | Required | Purpose |
|---|---|---|---|
| `hook` | `string` | Yes | Must be `'order-sign'`; validated by the route handler |
| `hookInstance` | `string` | Yes | UUID unique to this invocation; used for correlation, not by the rule engine |
| `fhirServer` | `string` | No | EHR FHIR endpoint URL; not dereferenced by the payer in Phase 1 |
| `context` | `CdsHooksContext` | Yes | The clinical context; presence is validated by the route handler |
| `prefetch` | `CdsHooksPrefetch` | No | FHIR resources bundled by the EHR; rule engine uses all four keys |

`prefetch` is optional at the TypeScript level because the CDS Hooks specification does not require prefetch. However, the colonoscopy rule engine depends on the prefetch resources to evaluate the scenario. When prefetch is absent, the rule engine receives empty arrays and returns `'missing-documentation'`.

---

### Phase 5: CDS Hooks Response Types

These interfaces model the JSON body that the payer returns in response to a CDS Hooks request. They describe the CDS Cards that the Python EHR renders in the clinician UI.

#### Step 12 — Implement `CdsSource`

```typescript
export interface CdsSource {
  label: string;
  url?: string;
}
```

`CdsSource` appears inside each `CdsCard` and identifies the payer service. `label` is the display name; `url` is a link to the payer service's information page (optional in Phase 1).

---

#### Step 13 — Implement `CdsLink`

```typescript
export interface CdsLink {
  label: string;
  url: string;
  type: 'absolute' | 'smart';
}
```

`CdsLink` represents a clickable link displayed alongside a card in the EHR UI. The `type` field is a string literal union — CDS Hooks defines only two valid values:

- `'absolute'` — a plain URL; the EHR opens it in a new tab or embedded frame
- `'smart'` — a SMART on FHIR application launch URL; the EHR initiates an OAuth launch sequence

Phase 1 uses only `'absolute'` links (placeholder DTR documentation URLs). The literal union type ensures that any attempt to write `type: 'smart-app'` or `type: 'link'` is caught by the compiler.

---

#### Step 14 — Implement `CdsCard`

```typescript
export interface CdsCard {
  summary: string;
  indicator: 'info' | 'warning' | 'critical';
  source: CdsSource;
  detail?: string;
  links?: CdsLink[];
}
```

**What each field does:**

| Field | Type | Required | Purpose |
|---|---|---|---|
| `summary` | `string` | Yes | Short card headline rendered prominently in the EHR UI |
| `indicator` | literal union | Yes | Severity level; drives visual styling in the EHR template |
| `source` | `CdsSource` | Yes | Identifies the payer service that produced this card |
| `detail` | `string` | No | Markdown text providing clinical detail; rendered below the summary |
| `links` | `CdsLink[]` | No | Action links; may be absent for cards that carry no link |

`indicator` is typed as `'info' | 'warning' | 'critical'` rather than `string`. The card factory only produces `'info'` and `'warning'` cards in Phase 1, but the type includes `'critical'` for completeness with the CDS Hooks specification.

`links` uses `CdsLink[]` — an array of `CdsLink` objects. It is optional (`?:`) rather than defaulting to `[]` because the CDS Hooks specification allows cards with no links at all, and the response JSON should omit the key rather than send an empty array.

---

#### Step 15 — Implement `CdsHooksResponse`

```typescript
export interface CdsHooksResponse {
  cards: CdsCard[];
}
```

`CdsHooksResponse` is the top-level envelope. The CRD route handler assembles this object and returns it as the HTTP response body. The Python EHR parses this structure using its `CdsHooksResponse` Pydantic model.

This is the simplest interface in the file — a single required field containing an array of cards. CDS Hooks also defines an optional `systemActions` field for Phase 3+ features; it is omitted here.

---

### Phase 6: Rule Engine Types

These types are used exclusively within `src/rules/colonoscopyRuleEngine.ts` and by the card factory that consumes its output. They are defined here so that `cdsHooks.ts` remains the single source of type definitions for the entire payer-crd application.

#### Step 16 — Implement `RuleOutcome`

```typescript
export type RuleOutcome =
  | 'covered-high-risk'
  | 'missing-documentation'
  | 'interval-not-met';
```

`RuleOutcome` is a type alias (not an interface) because it is a union of string literals, not an object shape. The three values correspond to the three branches the colonoscopy rule engine can reach:

| Outcome | Condition | Card produced |
|---|---|---|
| `'covered-high-risk'` | High-risk indicator present and colonoscopy interval met | `info` card |
| `'missing-documentation'` | High-risk indicator absent | `warning` card |
| `'interval-not-met'` | High-risk indicator present but interval not yet met | `warning` card (built inline) |

---

#### Step 17 — Implement `RuleResult`

```typescript
export interface RuleResult {
  highRiskIndicator: boolean;
  patientAge: number | null;
  yearsSincePriorProcedure: number | null;
  meetsIntervalRequirement: boolean;
  outcome: RuleOutcome;
}
```

**What each field does:**

| Field | Type | Purpose |
|---|---|---|
| `highRiskIndicator` | `boolean` | `true` if a high-risk ICD-10 code (Z80.0) is present in the conditions |
| `patientAge` | `number \| null` | Patient age in years; `null` if `birthDate` is absent from the Patient resource |
| `yearsSincePriorProcedure` | `number \| null` | Years since the most recent prior colonoscopy; `null` if no prior procedure was found |
| `meetsIntervalRequirement` | `boolean` | `true` if the interval since the last procedure satisfies the payer's rule |
| `outcome` | `RuleOutcome` | The final rule decision; used by the card factory to select the correct card template |

`patientAge` and `yearsSincePriorProcedure` use `number | null` (not `number | undefined`). In TypeScript, `null` and `undefined` have slightly different semantics. `null` is the conventional choice when a value is **intentionally absent** — the calculation was attempted but the required input was not available. `undefined` is more commonly used for uninitialized or missing fields. The rule engine fills these fields deliberately, so `null` is the appropriate signal for "not applicable."

---

### Phase 7: Verification

#### Step 18 — Verify the file compiles without errors

From the `payer-crd/` directory, use Bun to check that the file is syntactically valid TypeScript by importing it from the existing `src/index.ts`:

Add this line temporarily to `src/index.ts`, below the existing imports:

```typescript
import type { CdsHooksRequest, CdsHooksResponse, RuleResult, RuleOutcome } from './types/cdsHooks.js';
```

Then run:

```bash
bun run dev
```

Expected: the server starts without any TypeScript errors. The line `Payer CRD listening on port 8080` should appear in the terminal.

If you see a TypeScript error, the error message will include the file name, line number, and a description of what is wrong. Common causes are covered in Appendix A.

After verifying, remove the temporary import from `src/index.ts` — it will be added back properly when the route handlers are implemented.

---

#### Step 19 — Verify all exports are accessible

Create a temporary file `src/types/verify.ts` and add the following:

```typescript
import type {
  FhirCoding,
  FhirCodeableConcept,
  FhirBundleEntry,
  FhirBundle,
  FhirPatient,
  FhirCondition,
  FhirProcedure,
  FhirCoverage,
  CdsHooksContext,
  CdsHooksPrefetch,
  CdsHooksRequest,
  CdsSource,
  CdsLink,
  CdsCard,
  CdsHooksResponse,
  RuleOutcome,
  RuleResult,
} from './cdsHooks.js';

// Construct a representative object using several of the interfaces
const coding: FhirCoding = {
  system: 'http://hl7.org/fhir/sid/icd-10-cm',
  code: 'Z80.0',
};

const condition: FhirCondition = {
  resourceType: 'Condition',
  id: 'cond-001',
  code: {
    coding: [coding],
  },
};

const card: CdsCard = {
  summary: 'High-risk history supports 5-year interval',
  indicator: 'info',
  source: { label: 'Demo Payer' },
};

const outcome: RuleOutcome = 'covered-high-risk';

const result: RuleResult = {
  highRiskIndicator: true,
  patientAge: 62,
  yearsSincePriorProcedure: 5.3,
  meetsIntervalRequirement: true,
  outcome,
};

console.log('Types verified:', condition.id, card.indicator, result.outcome);
```

Run the verify file:

```bash
bun src/types/verify.ts
```

Expected output: `Types verified: cond-001 info covered-high-risk`

If the file runs without TypeScript errors, all interfaces and type aliases are correctly defined and exported. Delete `src/types/verify.ts` after verification — it is not part of the project.

---

#### Step 20 — Verify string literal types enforce valid values

Still in the verify file (before deleting it), try introducing a deliberate type error to confirm the compiler catches it:

```typescript
// This should produce a TypeScript error — add it temporarily
const badCard: CdsCard = {
  summary: 'Test',
  indicator: 'urgent',    // 'urgent' is not a valid indicator
  source: { label: 'Test' },
};
```

Run `bun src/types/verify.ts` again. Expected: a TypeScript error similar to:

```
error: Type '"urgent"' is not assignable to type '"info" | "warning" | "critical"'
```

This confirms that the string literal union type on `indicator` is working. Remove the bad line and delete the verify file.

---

## Appendix A: Common TypeScript Errors in This File

| Error message | Likely cause |
|---|---|
| `Type 'string' is not assignable to type '"info" \| "warning" \| "critical"'` | A field typed with a string literal union received a value that is not one of the allowed strings; check spelling and case |
| `Property 'X' does not exist on type 'FhirY'` | You are accessing a field that is not declared in the interface; either add it to the interface or use a type assertion |
| `Object literal may only specify known properties` | You included a field in an object literal that is not in the interface; remove the extra field or add it to the interface |
| `Type 'string \| undefined' is not assignable to type 'string'` | You are passing an optional field where a required `string` is expected; add a nullish check (`?? ''` or `if (x !== undefined)`) |
| `Property 'X' is possibly undefined` | `noUncheckedIndexedAccess` flagged an array index access; use optional chaining (`array[i]?.field`) or check for `undefined` |
| `Cannot find module './types/cdsHooks.js'` | The import path is wrong; confirm the file is at `src/types/cdsHooks.ts` and the import uses `.js` extension |
| `Type 'X' is missing the following properties from type 'FhirY'` | A required field is absent in an object literal or assignment; add the missing field |
| `Module '"./types/cdsHooks.js"' has no exported member 'X'` | The name is not exported from `cdsHooks.ts`; check spelling and confirm the `export` keyword is present |

---

## Appendix B: Interface Summary — Quick Reference

```
cdsHooks.ts — all exports

FHIR Supporting Types
  FhirCoding            { system, code, display? }
  FhirCodeableConcept   { coding: FhirCoding[], text? }
  FhirBundleEntry       { resource: Record<string, unknown> }
  FhirBundle            { resourceType: 'Bundle', type, total?, entry: FhirBundleEntry[] }

FHIR Resource Types
  FhirPatient           { resourceType: 'Patient', id, birthDate?, gender?, name? }
  FhirCondition         { resourceType: 'Condition', id, code?, clinicalStatus? }
  FhirProcedure         { resourceType: 'Procedure', id, status, code?, performedDateTime? }
  FhirCoverage          { resourceType: 'Coverage', id, status }

CDS Hooks Request Types
  CdsHooksContext       { userId, patientId, encounterId?, draftOrders: FhirBundle }
  CdsHooksPrefetch      { patient?, conditions?, coverage?, priorProcedures? }
  CdsHooksRequest       { hook, hookInstance, fhirServer?, context, prefetch? }

CDS Hooks Response Types
  CdsSource             { label, url? }
  CdsLink               { label, url, type: 'absolute' | 'smart' }
  CdsCard               { summary, indicator: 'info'|'warning'|'critical', source, detail?, links? }
  CdsHooksResponse      { cards: CdsCard[] }

Rule Engine Types
  RuleOutcome           'covered-high-risk' | 'missing-documentation' | 'interval-not-met'
  RuleResult            { highRiskIndicator, patientAge, yearsSincePriorProcedure,
                          meetsIntervalRequirement, outcome: RuleOutcome }
```

---

## Appendix C: TypeScript vs Python Pydantic — Comparison Table

| Concept | TypeScript (`cdsHooks.ts`) | Python (`app/models.py`) |
|---|---|---|
| Named object shape | `interface Foo { ... }` | `class Foo(BaseModel): ...` |
| Required field | `name: string` | `name: str` |
| Optional field | `name?: string` | `name: str \| None = None` |
| String literal constraint | `indicator: 'info' \| 'warning'` | `indicator: Literal['info', 'warning']` |
| Union type | `string \| number` | `str \| int` |
| Null-or-missing | `number \| null` | `int \| None` |
| Array of type | `FhirCoding[]` | `list[FhirCoding]` |
| Arbitrary object | `Record<string, unknown>` | `dict` |
| Type alias | `type X = 'a' \| 'b'` | `X = Literal['a', 'b']` |
| Runtime validation | None (compile-time only) | `Model.model_validate(data)` |
| camelCase bridging | Not needed (TypeScript is already camelCase) | `alias_generator=to_camel` in `model_config` |
| Export | `export interface Foo` | `from app.models import Foo` |
