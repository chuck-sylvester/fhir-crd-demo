# Colonoscopy Rule Engine — Learning Guide and Implementation Reference

For `payer-crd/src/rules/colonoscopyRuleEngine.ts`

---

## How to Use This Document

This document has two parts:

**Part 1 — Learning Reference (Sections 1–6):** Explains the domain context, JavaScript date arithmetic, array methods, and TypeScript patterns required to implement the rule engine from first principles. Each concept is illustrated with simple examples unrelated to the project before being applied to the actual implementation. Where a concept has a Python equivalent you already know from the provider-ehr implementation, that parallel is noted.

**Part 2 — Implementation Guide (Section 7):** Steps through building `src/rules/colonoscopyRuleEngine.ts` in phases. Each phase produces something verifiable before you proceed to the next. Code blocks are complete and ready to copy.

**Prerequisites:** `src/types/cdsHooks.ts` must be complete (Build Sequence Step 3). The TypeScript interfaces `FhirPatient`, `FhirCondition`, `FhirProcedure`, `FhirCoverage`, `RuleResult`, and `RuleOutcome` are imported from that file.

---

## Part 1: Domain Context

### 1.1 What a Payer Rule Engine Is

A **rule engine** is a module that takes clinical data as input, evaluates it against a set of payer-defined coverage policies, and produces a structured decision as output. It contains no networking, no file I/O, and no HTTP concerns — it is a pure function from clinical data to a decision record.

In this project, the rule engine occupies the middle of a three-stage pipeline:

```
CRD route handler
  └── extracts FHIR resources from the request body
        └── passes them to the rule engine         ← this module
              └── returns a RuleResult
                    └── card factory reads RuleResult
                          └── returns CDS Cards to the route handler
```

The rule engine does not know how the FHIR resources arrived (HTTP, fixture file, or a live FHIR server). The card factory does not know how the decision was reached. This separation makes the rule engine independently testable — the unit tests in Step 10 pass FHIR resource objects directly, with no HTTP server involved.

### 1.2 The Clinical Scenario

The scenario this rule engine evaluates is a **colonoscopy coverage requirements determination** for a patient with a suspected family history of colorectal cancer.

**The clinical question:** Does this patient's draft colonoscopy order meet the payer's coverage criteria, and is prior authorization required?

**The payer's rule:** Colonoscopy screening intervals depend on patient risk classification:

| Classification | Condition | Covered interval |
|---|---|---|
| High-risk | Family history of colorectal cancer (ICD-10-CM Z80.0) | Every 5 years |
| Average-risk | No qualifying high-risk indicator | Every 10 years |

**What the rule engine checks:**
1. Is the patient classified as high-risk? (Is Z80.0 in the condition list?)
2. When was the patient's last colonoscopy? (Is there a prior Procedure with CPT 45378?)
3. Has enough time passed since the prior procedure to meet the coverage interval?

**The three possible outcomes:**

| Outcome | Meaning | Card returned |
|---|---|---|
| `covered-high-risk` | Z80.0 present; interval since last colonoscopy is ≥ 5 years | `info` card: order is covered |
| `missing-documentation` | Z80.0 absent; high-risk classification cannot be confirmed | `warning` card: documentation required |
| `interval-not-met` | Z80.0 present; last colonoscopy was < 5 years ago | `warning` card: too soon to rescreen |

### 1.3 Why These Specific Codes

**ICD-10-CM Z80.0** is the diagnosis code for "Family history of malignant neoplasm of digestive organs." The `Z80` category covers family history of primary malignant neoplasms; the `.0` subcategory specifies the digestive organs (which includes the colon). This is the standard code a clinician adds to a patient's problem list to document a colorectal cancer family history.

**CPT 45378** is the procedure code for "Colonoscopy, flexible, proximal to splenic flexure; diagnostic." CPT (Current Procedural Terminology) codes are maintained by the American Medical Association and are the standard for billing outpatient procedures in the United States.

Both codes are checked against their respective coding systems by URI:

| Code | System URI |
|---|---|
| Z80.0 | `http://hl7.org/fhir/sid/icd-10-cm` |
| 45378 | `http://www.ama-assn.org/go/cpt` |

---

## Part 2: JavaScript Date Arithmetic

### 2.1 The JavaScript `Date` Object

JavaScript's built-in `Date` object represents a point in time. It stores time internally as a count of milliseconds since the **Unix epoch** — midnight UTC on January 1, 1970.

```typescript
// Current date and time
const now = new Date();

// A specific date, parsed from an ISO 8601 string
const birthDate = new Date('1971-01-15');

// The underlying millisecond timestamp
console.log(now.getTime());       // e.g. 1748000000000
console.log(birthDate.getTime()); // e.g. 32400000000
```

Two key constructors:
- `new Date()` — the current moment
- `new Date(isoString)` — a specific moment parsed from an ISO 8601 string (`'YYYY-MM-DD'` or `'YYYY-MM-DDThh:mm:ssZ'`)

### 2.2 Computing Elapsed Time

The simplest way to compute the time between two dates is to subtract their millisecond timestamps:

```typescript
const start = new Date('2020-01-01');
const end   = new Date('2025-06-01');
const elapsed = end.getTime() - start.getTime(); // milliseconds
```

To convert milliseconds to years, divide by the number of milliseconds in a year. The rule engine uses **365.25 days per year** to account for leap years:

```typescript
const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;
const elapsedYears = elapsed / MS_PER_YEAR;
console.log(elapsedYears); // approximately 5.41
```

This gives a **fractional** year count, which is what `yearsSince()` returns. The comparison `yearsSincePriorProcedure >= 5` is then a simple numeric comparison — no special date library is needed.

### 2.3 Computing Full Years for Patient Age

The millisecond-division approach works for interval checking but is slightly imprecise for age in full years — a person born on December 31 has not "turned" a year older until that date arrives each year, regardless of how many milliseconds have elapsed.

The precise approach extracts the year, month, and day components separately and adjusts for whether the birthday has occurred yet this calendar year:

```typescript
function calculateAge(birthDate: string): number {
  const today = new Date();
  const birth = new Date(birthDate);

  let age = today.getFullYear() - birth.getFullYear();

  // Subtract 1 if the birthday hasn't occurred yet this year
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }

  return age;
}
```

**`getFullYear()`** returns the four-digit year (e.g. `2025`).
**`getMonth()`** returns 0–11 (January is 0, December is 11).
**`getDate()`** returns the day of the month (1–31).

The adjustment works by checking: has the birth month passed yet this year? If not (or if it's the same month but the day hasn't come yet), decrement age by one.

**Parallel to Python:** Python's `datetime` module uses `datetime.date.today()` and `(today - birth).days / 365.25` for a similar calculation, or a more precise approach using `relativedelta` from `dateutil`. The JavaScript approach above does not require any external package.

### 2.4 `Date` Parsing Pitfalls

ISO 8601 date strings (`'YYYY-MM-DD'`) are parsed as **UTC midnight** by `new Date()`. This means the local time equivalent depends on your timezone offset. For example, `new Date('1971-01-15')` in UTC-5 is interpreted as January 14, 1971 at 7:00 PM local time.

In this project, the date comparisons are relative (elapsed time between two dates), so timezone offsets cancel out. Both dates are parsed the same way, so the offset does not affect the result. This is a common pitfall only when you need to display or compare a date against a local calendar date — not a concern for interval arithmetic.

---

## Part 3: Array Methods for Data Extraction

### 3.1 `.some()` — Does Any Element Match?

`Array.prototype.some(predicate)` returns `true` if **at least one** element in the array satisfies the predicate function. It short-circuits — it stops checking as soon as it finds a match.

```typescript
const numbers = [3, 7, 12, 4];

const hasEven = numbers.some(n => n % 2 === 0);
console.log(hasEven); // true — 12 and 4 are even; stops at 12
```

In the rule engine, `.some()` is used twice:

1. To check whether any condition in the conditions array has the Z80.0 code:
   ```typescript
   conditions.some(condition =>
     condition.code?.coding.some(coding =>
       coding.system === ICD10_SYSTEM && coding.code === 'Z80.0'
     ) ?? false
   )
   ```
   The outer `.some()` iterates over conditions; the inner `.some()` iterates over codings within each condition's `code.coding` array.

2. To check whether a procedure's code matches a specific CPT code (inside `findMostRecentProcedure`).

**Parallel to Python:** `.some()` is equivalent to Python's `any(predicate(x) for x in iterable)`.

### 3.2 `.filter()` — Keep Only Matching Elements

`Array.prototype.filter(predicate)` returns a **new array** containing only the elements for which the predicate returns `true`. It does not mutate the original array.

```typescript
const words = ['apple', 'banana', 'apricot', 'cherry'];
const aWords = words.filter(w => w.startsWith('a'));
console.log(aWords); // ['apple', 'apricot']
console.log(words);  // ['apple', 'banana', 'apricot', 'cherry'] — unchanged
```

In `findMostRecentProcedure`, `.filter()` narrows the full list of procedures to only those whose CPT code matches:

```typescript
const matching = procedures.filter(p =>
  p.code?.coding.some(c => c.system === CPT_SYSTEM && c.code === cptCode) ?? false
);
```

**Parallel to Python:** `.filter()` corresponds to Python's list comprehension `[x for x in iterable if predicate(x)]` or `filter(predicate, iterable)`.

### 3.3 `.reduce()` — Fold an Array to a Single Value

`Array.prototype.reduce(callback)` iterates over an array, accumulating a single result. Without an initial value, the first element is used as the starting accumulator and iteration begins at the second element.

A simple maximum finder:

```typescript
const numbers = [3, 7, 2, 9, 4];
const max = numbers.reduce((acc, current) => current > acc ? current : acc);
console.log(max); // 9
```

In `findMostRecentProcedure`, `.reduce()` finds the procedure with the most recent `performedDateTime` by comparing timestamps:

```typescript
matching.reduce((mostRecent, current) => {
  const mostDate = new Date(mostRecent.performedDateTime ?? '').getTime();
  const curDate  = new Date(current.performedDateTime ?? '').getTime();
  return curDate > mostDate ? current : mostRecent;
});
```

Each iteration compares the current procedure's date against the running "most recent" and keeps whichever is newer. The result after all iterations is the single procedure with the latest date.

**Why not `.sort()` instead?** `.sort()` is a valid alternative but sorts the entire array and has `O(n log n)` complexity. `.reduce()` scans the array once at `O(n)`. For a small number of procedures the difference is negligible, but `.reduce()` is more semantically precise — it says "find the maximum" rather than "sort and take the first."

**Why not sort + index access?** `[...matching].sort(...)[0]` would require a spread to avoid mutating the original array (`.sort()` sorts in place), and with `noUncheckedIndexedAccess: true` the `[0]` access returns `FhirProcedure | undefined`, requiring an additional nullish check. The `.reduce()` approach avoids both concerns.

**Parallel to Python:** `.reduce()` corresponds to Python's `functools.reduce(function, iterable)`.

---

## Part 4: Optional Chaining and the Non-Null Assertion

### 4.1 Optional Chaining in Depth (`?.`)

The `?.` operator short-circuits a property access or method call chain when the left-hand side is `null` or `undefined`, returning `undefined` instead of throwing.

```typescript
interface Company {
  name: string;
  address?: {
    city?: string;
  };
}

const company: Company = { name: 'Acme' };

// Without optional chaining — throws if address is undefined
const city1 = company.address.city;   // TypeError: Cannot read properties of undefined

// With optional chaining — returns undefined safely
const city2 = company.address?.city;  // undefined
```

In the rule engine, optional chaining appears wherever a FHIR resource field is optional:

```typescript
condition.code?.coding          // coding array, or undefined if code is absent
p.code?.coding.some(...)        // false chain if code is absent
patient?.birthDate              // birthDate string, or undefined if patient is absent
```

The `?.` operator can also chain across multiple levels:

```typescript
// Safe even if condition.code or condition.code.coding is undefined
const hasCoding = condition.code?.coding.some(c => c.code === 'Z80.0') ?? false;
```

### 4.2 Nullish Coalescing with `?.` (`?? false`)

Optional chaining combined with `??` provides a default value when the chain short-circuits:

```typescript
const result = condition.code?.coding.some(c => c.code === 'Z80.0') ?? false;
```

When `condition.code` is `undefined`, the `?.` short-circuits and the left side of `??` is `undefined`. The `??` operator then returns the right-hand side, `false`. This collapses the two-step check (is `code` present? does any coding match?) into a single expression.

This is the pattern used in `hasHighRiskCondition` and inside the `.filter()` call in `findMostRecentProcedure`.

### 4.3 The Non-Null Assertion Operator (`!`)

The `!` suffix tells the TypeScript compiler "I know this value is not `null` or `undefined` — trust me." It is a compile-time-only assertion; it does not add any runtime check.

```typescript
function process(value: string | undefined): number {
  return value!.length;   // TypeScript accepts this; runtime throws if value is actually undefined
}
```

In the rule engine, it appears in one place:

```typescript
const yearsSincePriorProcedure = priorProcedure
  ? yearsSince(priorProcedure.performedDateTime!)
  : null;
```

`FhirProcedure.performedDateTime` is typed as `string | undefined` because FHIR allows procedures without a point-in-time date (using `performedPeriod` instead). However, `findMostRecentProcedure` only returns procedures that were matched by CPT code, and the demo fixtures always supply `performedDateTime`. The `!` asserts that by the time this line executes, `performedDateTime` is present.

**When to use `!` vs. a runtime check:** Use `!` when you have context that TypeScript cannot infer — here, the fixture structure guarantees the field is present. In Phase 2 or 3, if the rule engine must handle real-world FHIR data where `performedDateTime` may genuinely be absent, the `!` should be replaced with a proper check.

---

## Part 5: Pure Functions and Exported Helpers

### 5.1 What Makes a Function Pure

A **pure function** is one that:
1. Returns the same output for the same input every time
2. Has no side effects — it does not modify external state, write to a file, make a network call, or mutate its arguments

```typescript
// Pure — same inputs always produce the same output; no side effects
function add(a: number, b: number): number {
  return a + b;
}

// Impure — depends on external state (the current time)
function greeting(): string {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning' : 'Good afternoon';
}
```

**Note:** `calculateAge()` and `yearsSince()` technically depend on the current date via `new Date()`, making them impure in the strict sense. In practice this is unavoidable for date-relative calculations, and their unit tests use known dates that are far enough apart that the current date does not affect the expected outcome.

### 5.2 Why Helpers Are Exported

The four helper functions (`hasHighRiskCondition`, `calculateAge`, `findMostRecentProcedure`, `yearsSince`) are all exported from the module. There are two reasons:

**Testability:** By exporting the helpers, the unit tests in `tests/rules/colonoscopyRuleEngine.test.ts` can call each helper directly with precisely crafted inputs and verify its output in isolation. If a test for `evaluate()` fails, the helper-level tests tell you exactly which step failed — the high-risk check, the age calculation, the procedure lookup, or the interval comparison.

**Separation of concerns:** Each helper encapsulates one specific computation. `hasHighRiskCondition` knows about ICD-10 codes. `findMostRecentProcedure` knows about procedure filtering and date comparison. `evaluate()` composes them — it contains the rule logic but delegates the mechanics to the helpers. This makes the rule logic readable as a high-level description of the business rules.

**Parallel to Python:** This is similar to the design of `fhir_factory.py`, where individual builder functions (`build_patient_prefetch`, `build_conditions_prefetch`, etc.) are exported and can be called independently in tests.

---

## Part 6: Module-Level Constants and `as const`

### 6.1 Why Constants Are Module-Level

The rule configuration values (`highRiskIntervalYears: 5`, `colonoscopyCptCode: '45378'`, etc.) and the coding system URIs are defined as module-level constants rather than inside the `evaluate` function. Two reasons:

1. **Readability:** The configuration is visible at the top of the file, making it easy to find and change business rules without reading through function bodies.
2. **Reuse:** The CPT system URI is used in both `findMostRecentProcedure` and (potentially) in future helper functions. Defining it once avoids typo-prone duplication of the URI string.

### 6.2 `as const` for Immutable Configuration

The `as const` assertion makes an object literal deeply immutable at the TypeScript type level:

```typescript
const config = {
  highRiskIntervalYears: 5,
  colonoscopyCptCode: '45378',
} as const;
```

Without `as const`, TypeScript infers the type of `config.highRiskIntervalYears` as `number` — it could be reassigned to any number. With `as const`, TypeScript infers it as the literal type `5` — immutable.

```typescript
config.highRiskIntervalYears = 10;  // Type error with as const — assignment to read-only property
```

For configuration that should never change at runtime, `as const` expresses that intent in the type system. It is the TypeScript equivalent of Python's convention of using ALL_CAPS for constants.

---

## Part 7: Implementation — `payer-crd/src/rules/colonoscopyRuleEngine.ts`

Read Parts 1–6 before beginning. Each phase produces something verifiable before you proceed to the next.

**Reference documents:**
- `docs/spec/payer-crd-spec.md` Section 10 — function signatures, rule configuration, and logic sequence
- `docs/spec/cds-hooks-api-contract.md` Section 7 — demo fixed values (coding system URIs, resource ids)

---

### Phase 1: File Setup

#### Step 1 — Create the file and add imports

Create `src/rules/colonoscopyRuleEngine.ts`. The module has one import — a type-only import that brings in six interfaces from `cdsHooks.ts`:

```typescript
import type {
  FhirPatient,
  FhirCondition,
  FhirProcedure,
  FhirCoverage,
  RuleResult,
  RuleOutcome,
} from '../types/cdsHooks.js';
```

All six names are type-only imports. They are erased at compile time and add no runtime overhead.

**Verify:** Run `bun src/rules/colonoscopyRuleEngine.ts` from `payer-crd/`. An empty file with only imports should produce no output and no error.

---

#### Step 2 — Define module-level constants

Add these below the imports. They are not exported — they are internal implementation details of this module.

```typescript
const ICD10_SYSTEM = 'http://hl7.org/fhir/sid/icd-10-cm';
const CPT_SYSTEM   = 'http://www.ama-assn.org/go/cpt';

const config = {
  highRiskIntervalYears:    5,
  averageRiskIntervalYears: 10,
  colonoscopyCptCode:       '45378',
  highRiskIcd10Codes:       ['Z80.0'],
} as const;
```

**What each constant does:**

| Constant | Purpose |
|---|---|
| `ICD10_SYSTEM` | URI for the ICD-10-CM coding system; matched against `coding.system` in conditions |
| `CPT_SYSTEM` | URI for the CPT coding system; matched against `coding.system` in procedures |
| `config.highRiskIntervalYears` | Payer's minimum years between colonoscopies for high-risk patients |
| `config.averageRiskIntervalYears` | Payer's minimum years between colonoscopies for average-risk patients |
| `config.colonoscopyCptCode` | CPT code `45378` identifying a colonoscopy procedure |
| `config.highRiskIcd10Codes` | Array of ICD-10 codes that classify a patient as high-risk; currently only Z80.0 |

---

### Phase 2: Helper Functions

Implement the helpers before `evaluate()`. Each one is independently verifiable.

#### Step 3 — Implement `hasHighRiskCondition`

```typescript
export function hasHighRiskCondition(conditions: FhirCondition[]): boolean {
  return conditions.some(condition =>
    condition.code?.coding.some(coding =>
      coding.system === ICD10_SYSTEM &&
      config.highRiskIcd10Codes.includes(coding.code)
    ) ?? false
  );
}
```

**Walk-through:**

The outer `.some()` iterates over each `FhirCondition`. For each condition, the inner `.some()` iterates over each `FhirCoding` in `condition.code.coding`. A match requires both the `system` URI and the `code` value to be correct. Using `config.highRiskIcd10Codes.includes(coding.code)` rather than `coding.code === 'Z80.0'` allows future high-risk codes to be added to the config array without changing this function.

The `?? false` handles the case where `condition.code` is absent — the `?.` short-circuits to `undefined`, and `?? false` converts that to the boolean `false`.

**Verify from a Bun shell:**

```typescript
import { hasHighRiskCondition } from './src/rules/colonoscopyRuleEngine.ts';

const z80Condition = {
  resourceType: 'Condition' as const,
  id: 'test-1',
  code: {
    coding: [{ system: 'http://hl7.org/fhir/sid/icd-10-cm', code: 'Z80.0' }],
  },
};

console.log(hasHighRiskCondition([z80Condition]));   // true
console.log(hasHighRiskCondition([]));               // false
```

---

#### Step 4 — Implement `calculateAge`

```typescript
export function calculateAge(birthDate: string): number {
  const today = new Date();
  const birth = new Date(birthDate);
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}
```

This returns the patient's age in **full completed years** — it does not count a birthday until that date has actually arrived in the current calendar year.

For the demo patient (born `1971-01-15`), this returns `54` when called in 2025 after January 15, or `53` if called before January 15.

**Verify:**

```typescript
import { calculateAge } from './src/rules/colonoscopyRuleEngine.ts';

// A birth date far enough in the past that the current date doesn't affect the result
console.log(calculateAge('1971-01-15'));   // 54 (in 2025 after Jan 15)
console.log(calculateAge('2000-01-01'));   // 25 (in 2025 after Jan 1)
```

---

#### Step 5 — Implement `yearsSince`

```typescript
export function yearsSince(dateString: string): number {
  const past = new Date(dateString);
  const now  = new Date();
  return (now.getTime() - past.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
}
```

This returns **fractional years** — for example, `5.3` means five years and roughly four months have elapsed. The result is used in the comparison `yearsSincePriorProcedure >= config.highRiskIntervalYears`. A value of `5.0` or greater satisfies the five-year requirement; a value of `4.9` does not.

The divisor `365.25 * 24 * 60 * 60 * 1000` breaks down as:
- `365.25` — average days per year accounting for leap years
- `24` — hours per day
- `60 * 60` — seconds per hour
- `1000` — milliseconds per second

**Verify:**

```typescript
import { yearsSince } from './src/rules/colonoscopyRuleEngine.ts';

// A date exactly 5 years ago: result should be approximately 5.0
// Adjust the year to be 5 years before your current year
console.log(yearsSince('2020-06-01'));  // approximately 5.0 (when run in mid-2025)
```

---

#### Step 6 — Implement `findMostRecentProcedure`

```typescript
export function findMostRecentProcedure(
  procedures: FhirProcedure[],
  cptCode: string
): FhirProcedure | null {
  const matching = procedures.filter(p =>
    p.code?.coding.some(c => c.system === CPT_SYSTEM && c.code === cptCode) ?? false
  );
  if (matching.length === 0) return null;
  return matching.reduce((mostRecent, current) => {
    const mostDate = new Date(mostRecent.performedDateTime ?? '').getTime();
    const curDate  = new Date(current.performedDateTime ?? '').getTime();
    return curDate > mostDate ? current : mostRecent;
  });
}
```

**Walk-through:**

`filter()` narrows the full procedures list to only those whose `code.coding` array contains an entry with the correct CPT system URI and the target CPT code. Procedures without a matching code are discarded.

If no procedures remain after filtering, the function returns `null` immediately — there is no prior procedure to evaluate.

`reduce()` without an initial value uses the first element of `matching` as the starting accumulator. This is safe because the empty case is already handled above. Each iteration compares the accumulated "most recent" procedure against the current one by converting their `performedDateTime` strings to millisecond timestamps. The one with the higher timestamp (more recent date) wins.

`performedDateTime ?? ''` supplies an empty string if `performedDateTime` is absent. `new Date('')` produces an `Invalid Date`, whose `.getTime()` returns `NaN`. Comparisons involving `NaN` always return `false`, so a procedure without a date effectively loses every comparison and will not be selected as most recent. This is the correct behavior — a procedure without a date cannot satisfy the interval requirement.

**Verify:**

```typescript
import { findMostRecentProcedure } from './src/rules/colonoscopyRuleEngine.ts';

const makeProcedure = (id: string, date: string) => ({
  resourceType: 'Procedure' as const,
  id,
  status: 'completed',
  code: { coding: [{ system: 'http://www.ama-assn.org/go/cpt', code: '45378' }] },
  performedDateTime: date,
});

const procedures = [
  makeProcedure('proc-1', '2019-03-10'),
  makeProcedure('proc-2', '2015-06-22'),
];

const result = findMostRecentProcedure(procedures, '45378');
console.log(result?.id);   // 'proc-1' — more recent

console.log(findMostRecentProcedure([], '45378'));           // null
console.log(findMostRecentProcedure(procedures, '99999'));   // null — no CPT match
```

---

### Phase 3: The `evaluate` Function

#### Step 7 — Implement `evaluate`

```typescript
export function evaluate(
  patient: FhirPatient | undefined,
  conditions: FhirCondition[],
  procedures: FhirProcedure[],
  coverage: FhirCoverage | undefined
): RuleResult {
  const highRiskIndicator = hasHighRiskCondition(conditions);
  const patientAge = patient?.birthDate ? calculateAge(patient.birthDate) : null;

  const priorProcedure = findMostRecentProcedure(procedures, config.colonoscopyCptCode);
  const yearsSincePriorProcedure = priorProcedure
    ? yearsSince(priorProcedure.performedDateTime!)
    : null;

  let meetsIntervalRequirement: boolean;
  if (yearsSincePriorProcedure === null) {
    meetsIntervalRequirement = true;
  } else if (highRiskIndicator) {
    meetsIntervalRequirement = yearsSincePriorProcedure >= config.highRiskIntervalYears;
  } else {
    meetsIntervalRequirement = yearsSincePriorProcedure >= config.averageRiskIntervalYears;
  }

  let outcome: RuleOutcome;
  if (highRiskIndicator && meetsIntervalRequirement) {
    outcome = 'covered-high-risk';
  } else if (!highRiskIndicator) {
    outcome = 'missing-documentation';
  } else {
    outcome = 'interval-not-met';
  }

  return {
    highRiskIndicator,
    patientAge,
    yearsSincePriorProcedure,
    meetsIntervalRequirement,
    outcome,
  };
}
```

**Walk-through, line by line:**

| Lines | What they do |
|---|---|
| `highRiskIndicator` | Delegates to `hasHighRiskCondition`; the result drives every subsequent branch |
| `patientAge` | Uses optional chaining: if `patient` is undefined or `patient.birthDate` is absent, result is `null`; otherwise delegates to `calculateAge` |
| `priorProcedure` | Delegates to `findMostRecentProcedure` to locate the most recent colonoscopy |
| `yearsSincePriorProcedure` | If a prior procedure was found, delegates to `yearsSince`; `!` asserts `performedDateTime` is present (safe for Phase 1 fixtures); if no procedure, `null` |
| `meetsIntervalRequirement` | Three branches: no prior procedure → `true` (first screening is always covered); high-risk → check against 5-year threshold; average-risk → check against 10-year threshold |
| `outcome` | Three branches matching the three `RuleOutcome` values; order matters — `missing-documentation` is checked with `!highRiskIndicator` before `interval-not-met` so the third branch only fires when high-risk is confirmed but the interval is not yet met |

**Note on `coverage`:** The `coverage` parameter is accepted but not used in Phase 1. It is present in the signature because real payer systems would use the coverage resource to determine which plan the patient is on and apply plan-specific rules. In Phase 2 or Phase 3, this parameter would drive additional branching.

---

### Phase 4: Verification

#### Step 8 — Verify the module imports cleanly

```bash
bun -e "import { evaluate, hasHighRiskCondition, calculateAge, findMostRecentProcedure, yearsSince } from './src/rules/colonoscopyRuleEngine.ts'; console.log('OK')"
```

Expected output: `OK`

---

#### Step 9 — Verify the demo scenario (high-risk, covered)

This reproduces the fixture data the Python EHR sends. Run from `payer-crd/`:

```typescript
import { evaluate } from './src/rules/colonoscopyRuleEngine.ts';

const patient = {
  resourceType: 'Patient' as const,
  id: 'demo-patient-001',
  birthDate: '1971-01-15',
};

const conditions = [{
  resourceType: 'Condition' as const,
  id: 'demo-condition-fam-hx-crc',
  code: {
    coding: [{
      system: 'http://hl7.org/fhir/sid/icd-10-cm',
      code: 'Z80.0',
      display: 'Family history of malignant neoplasm of digestive organs',
    }],
  },
}];

// Prior procedure 5+ years ago
const procedures = [{
  resourceType: 'Procedure' as const,
  id: 'demo-prior-colonoscopy',
  status: 'completed',
  code: {
    coding: [{
      system: 'http://www.ama-assn.org/go/cpt',
      code: '45378',
    }],
  },
  performedDateTime: '2019-06-01',
}];

const result = evaluate(patient, conditions, procedures, undefined);

console.log('outcome:             ', result.outcome);                  // covered-high-risk
console.log('highRiskIndicator:   ', result.highRiskIndicator);       // true
console.log('meetsInterval:       ', result.meetsIntervalRequirement); // true
console.log('yearsSinceProcedure: ', result.yearsSincePriorProcedure?.toFixed(1)); // ~6.0
```

---

#### Step 10 — Verify the missing-documentation scenario

```typescript
import { evaluate } from './src/rules/colonoscopyRuleEngine.ts';

// Same patient, no conditions — Z80.0 is absent
const result = evaluate(
  { resourceType: 'Patient' as const, id: 'demo-patient-001', birthDate: '1971-01-15' },
  [],   // No conditions
  [],   // No prior procedures
  undefined
);

console.log('outcome:', result.outcome);             // missing-documentation
console.log('highRisk:', result.highRiskIndicator);  // false
```

---

## Appendix A: Common Errors

| Error | Likely cause |
|---|---|
| `Cannot find module '../types/cdsHooks.js'` | File path is wrong or `cdsHooks.ts` does not exist; verify `src/types/cdsHooks.ts` is present |
| TypeScript error on `config.highRiskIcd10Codes.includes(...)` | If `as const` is applied, the array is `readonly`; `.includes()` works on `readonly` arrays in TypeScript — if you see an error, check that `config` has `as const` and not a manual type annotation |
| `reduce` call flagged as possibly empty | You removed the `if (matching.length === 0) return null` guard; it must appear before the `reduce` call |
| `yearsSince` returns a negative number | The date string passed is in the future; check the `performedDateTime` value in your test data |
| `hasHighRiskCondition` returns `false` for a known Z80.0 condition | The `system` URI in the test data does not exactly match `ICD10_SYSTEM`; check for typos or missing hyphens in the URI string |
| TypeScript error: `Object literal may only specify known properties` on `FhirCondition` | A test object includes a field not in the `FhirCondition` interface; remove it or add it to the interface |

---

## Appendix B: Rule Engine Quick Reference

```
colonoscopyRuleEngine.ts — exports

Constants (module-private)
  ICD10_SYSTEM   'http://hl7.org/fhir/sid/icd-10-cm'
  CPT_SYSTEM     'http://www.ama-assn.org/go/cpt'
  config         { highRiskIntervalYears: 5, averageRiskIntervalYears: 10,
                   colonoscopyCptCode: '45378', highRiskIcd10Codes: ['Z80.0'] }

Helper Functions (exported for unit testing)
  hasHighRiskCondition(conditions)          → boolean
  calculateAge(birthDate)                   → number  (full years)
  yearsSince(dateString)                    → number  (fractional years)
  findMostRecentProcedure(procedures, cpt)  → FhirProcedure | null

Primary Export
  evaluate(patient, conditions, procedures, coverage) → RuleResult

Rule Logic Summary
  highRiskIndicator       hasHighRiskCondition(conditions)
  patientAge              calculateAge(birthDate) or null
  priorProcedure          findMostRecentProcedure(procedures, '45378')
  yearsSincePrior         yearsSince(priorProcedure.performedDateTime!) or null

  meetsIntervalRequirement:
    no prior procedure   → true
    high-risk            → yearsSincePrior >= 5
    average-risk         → yearsSincePrior >= 10

  outcome:
    highRisk && meetsInterval   → 'covered-high-risk'
    !highRisk                   → 'missing-documentation'
    highRisk && !meetsInterval  → 'interval-not-met'
```
