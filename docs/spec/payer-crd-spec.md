# PHP Payer CRD Service — Design Specification

## Phase 1: Minimal End-to-End CRD Demo

---

## 1. Overview

The PHP Payer CRD Service simulates an external payer's Coverage Requirements Discovery endpoint. It implements the server side of the CDS Hooks protocol: it advertises its services via a discovery endpoint, receives CDS Hooks `order-sign` requests from the Python EHR Simulator, evaluates payer-specific coverage rules against the submitted clinical context, and returns CDS Cards describing coverage guidance, documentation requirements, and prior authorization expectations.

The application is implemented in plain PHP 8.5 with no application framework. A custom front controller in `public/index.php` handles all routing. Composer is used only for PSR-4 autoloading.

**Payload contract reference:** `docs/spec/cds-hooks-api-contract.md`

---

## 2. Phase 1 Scope and Deliverables

| # | Deliverable |
|---|-------------|
| 1 | CDS Hooks discovery endpoint returning the `crd-order-sign` service metadata |
| 2 | CRD service endpoint accepting `order-sign` requests and returning CDS Cards |
| 3 | Colonoscopy rule engine evaluating high-risk vs. missing-documentation scenarios |
| 4 | Card factory producing well-formed CDS Cards from rule outcomes |
| 5 | Fixture JSON files for discovery metadata and card templates |
| 6 | PHPUnit tests for the rule engine and both endpoint controllers |

**Phase 1 acceptance criteria:**

- `GET /cds-services` returns HTTP 200 with a valid CDS Hooks discovery response listing the `crd-order-sign` service
- `POST /cds-services/crd-order-sign` with a valid payload returns HTTP 200 with at least one CDS Card
- The high-risk path (Z80.0 present) returns an `info` card confirming coverage
- The missing-documentation path (Z80.0 absent) returns a `warning` card
- Unknown routes return HTTP 404
- All PHPUnit tests pass

---

## 3. Technology Stack

| Component | Choice | Notes |
|-----------|--------|-------|
| Language | PHP 8.5 | Installed via Homebrew on macOS; via OS package manager on OCI Linux |
| HTTP server | Apache HTTP Server (Homebrew) | Handles all requests; configured in `httpd.conf` |
| PHP execution | PHP-FPM on TCP port 9000 | Apache proxies `.php` requests to FPM via `mod_proxy_fcgi` |
| URL routing | `public/.htaccess` + `public/index.php` | All requests rewrite to the front controller |
| Autoloading | Composer PSR-4 | `src/` namespace mapped to `App\` |
| Testing | PHPUnit | Installed as a Composer `require-dev` dependency |
| Framework | None | No Laravel, Symfony, Slim, or other PHP framework |

---

## 4. Project Structure

```text
payer-crd/
├── public/
│   ├── index.php                # Front controller — entry point for all requests
│   └── .htaccess                # Apache mod_rewrite rules routing to index.php
├── src/
│   ├── Http/
│   │   ├── Request.php          # Parses the incoming HTTP request
│   │   └── Response.php         # Builds and sends the HTTP response
│   ├── CdsHooks/
│   │   ├── DiscoveryController.php      # Handles GET /cds-services
│   │   ├── CrdServiceController.php     # Handles POST /cds-services/crd-order-sign
│   │   └── CardFactory.php              # Constructs CDS Card arrays from rule outcomes
│   └── Rules/
│       └── ColonoscopyRuleEngine.php    # Evaluates payer rules against FHIR context
├── config/
│   └── payer-rules.php          # Configurable rule thresholds and code lists
├── fixtures/
│   ├── cds-discovery.json       # Discovery metadata returned by GET /cds-services
│   ├── cards-covered-high-risk.json     # Template card for the high-risk covered scenario
│   └── cards-missing-documentation.json # Template card for the missing documentation scenario
├── tests/
│   ├── Rules/
│   │   └── ColonoscopyRuleEngineTest.php
│   └── CdsHooks/
│       ├── DiscoveryControllerTest.php
│       └── CrdServiceControllerTest.php
├── vendor/                      # Composer-managed; not committed
├── .env                         # Local configuration (not committed)
├── .env.example                 # Committed template of required keys
├── apache.conf                  # Virtual host template for OCI deployment
└── composer.json
```

---

## 5. Environment Configuration

### 5.1 `.env.example`

Document these keys (no values):

| Key | Description |
|-----|-------------|
| `APP_ENV` | Runtime environment: `development` or `production` |
| `LOG_LEVEL` | Verbosity: `DEBUG`, `INFO`, `WARNING` |
| `PAYER_NAME` | Display name of the payer used in card source labels |
| `PAYER_BASE_URL` | Base URL of this service, e.g. `http://localhost:8080` |

### 5.2 Loading `.env` in the Front Controller

PHP has no built-in `.env` loader. In `index.php`, read the `.env` file manually using `parse_ini_file()` or `file()` and populate `$_ENV`. This is sufficient for Phase 1 without adding a Composer dependency.

Keep the loader simple: read the `.env` file line by line, split on `=`, and call `putenv()` for each valid key-value pair. Skip blank lines and lines beginning with `#`.

---

## 6. Composer and Autoloading (`composer.json`)

Composer serves two purposes in Phase 1:

1. PSR-4 autoloading of the `src/` directory under the `App\` namespace
2. Installing PHPUnit as a development dependency

The `composer.json` file must declare:

- `name`: A suitable package name for the project
- `require`: An empty object (no runtime dependencies)
- `require-dev`: PHPUnit (version compatible with PHP 8.5, currently PHPUnit 11.x)
- `autoload.psr-4`: Mapping `"App\\"` to `"src/"`
- `autoload-dev.psr-4`: Mapping `"App\\Tests\\"` to `"tests/"`

After editing `composer.json`, run `composer install` to generate `vendor/autoload.php` and `composer dump-autoload` after any namespace changes.

The front controller (`index.php`) must `require_once` the Composer autoloader as its first statement.

---

## 7. Apache Configuration

### 7.1 `.htaccess` (`public/.htaccess`)

This file enables URL rewriting so that all requests — including those to `/cds-services` and `/cds-services/crd-order-sign` — route through `index.php`.

Required directives:

- Enable the rewrite engine
- Exclude real files and directories from rewriting (so that any static assets served directly from `public/` are not rewritten)
- Rewrite everything else to `index.php`, preserving the query string

This file only takes effect if `AllowOverride All` is set for the `public/` directory in the Apache configuration, which is required by the project setup described in the top-level spec.

### 7.2 `apache.conf`

A virtual host template committed to the repository for OCI deployment reference. For local development on macOS, the Apache configuration is managed in `httpd.conf` directly (see the top-level spec's `Local Apache Configuration` section). The `apache.conf` file is not loaded during local development.

---

## 8. Front Controller (`public/index.php`)

`index.php` is the single entry point for all HTTP requests. It is responsible for:

1. Loading the Composer autoloader
2. Loading the `.env` file into the environment
3. Parsing the incoming request method and path
4. Dispatching to the appropriate controller
5. Sending the response

### 8.1 Request Parsing

Extract the request path from `$_SERVER['REQUEST_URI']`. Strip any query string component using `parse_url()`. Normalize the path by trimming trailing slashes and converting to lowercase.

### 8.2 Route Table

Define a route table as a two-level associative array: the first key is the HTTP method (`GET`, `POST`), the second key is the normalized path, and the value is the fully qualified controller class name.

Phase 1 route table:

| Method | Path | Controller |
|--------|------|------------|
| `GET` | `/cds-services` | `App\CdsHooks\DiscoveryController` |
| `POST` | `/cds-services/crd-order-sign` | `App\CdsHooks\CrdServiceController` |
| `GET` | `/questionnaires/colonoscopy-risk` | *(inline placeholder — returns a static JSON stub)* |
| `GET` | `/debug/rules` | *(inline placeholder — returns the payer-rules config as JSON)* |

### 8.3 Dispatch Logic

After building the route table, the front controller:

1. Creates a `Request` object from the current server globals
2. Looks up the route in the table using the request method and path
3. If a matching controller class is found: instantiates it and calls its `handle(Request $request): Response` method, then calls `$response->send()`
4. If the method matches but the path does not: sends a 404 JSON response
5. If the method is not in the route table: sends a 405 JSON response

All responses — including error responses — use `Content-Type: application/json`.

---

## 9. HTTP Abstractions

### 9.1 `src/Http/Request.php` — Class `App\Http\Request`

Wraps the PHP superglobals into a clean object with read-only accessor methods.

**Constructor:**

Reads from `$_SERVER`, `$_GET`, and `php://input` at construction time. Parses the raw body as JSON if the `Content-Type` header is `application/json`. Stores the parsed body internally.

**Public methods:**

| Method | Return type | Description |
|--------|-------------|-------------|
| `getMethod(): string` | string | Returns the HTTP method in uppercase: `GET`, `POST`, etc. |
| `getPath(): string` | string | Returns the normalized URL path without query string |
| `getHeader(string $name): ?string` | string or null | Returns the value of a named request header, or null if absent |
| `getBody(): array` | array | Returns the parsed JSON body as an associative array; returns an empty array if the body is absent or unparseable |
| `getBodyRaw(): string` | string | Returns the raw request body string |

### 9.2 `src/Http/Response.php` — Class `App\Http\Response`

Represents an HTTP response and provides a method to send it to the client.

**Constructor:**

Accepts a status code (integer), a body (array to be JSON-encoded), and an optional array of additional headers.

**Public methods:**

| Method | Return type | Description |
|--------|-------------|-------------|
| `send(): void` | void | Sets the HTTP status code with `http_response_code()`, sets response headers with `header()`, encodes the body with `json_encode()`, and echoes it |

The `send()` method always sets `Content-Type: application/json`. It uses `JSON_PRETTY_PRINT` in development mode and compact encoding in production mode, determined by the `APP_ENV` environment variable.

---

## 10. Controllers

### 10.1 `src/CdsHooks/DiscoveryController.php` — Class `App\CdsHooks\DiscoveryController`

Handles `GET /cds-services`.

**`handle(Request $request): Response`**

Loads `fixtures/cds-discovery.json` and returns its contents as the body of a 200 response. The fixture contains the complete discovery response body as defined in `docs/spec/cds-hooks-api-contract.md` Section 3.3.

The controller does not inspect the request body or any query parameters.

### 10.2 `src/CdsHooks/CrdServiceController.php` — Class `App\CdsHooks\CrdServiceController`

Handles `POST /cds-services/crd-order-sign`.

**`handle(Request $request): Response`**

Performs the end-to-end CRD request processing:

1. Calls a private `validateRequest()` method to check that the required top-level fields are present (`hook`, `hookInstance`, `context`)
2. If validation fails, returns a 400 response with a descriptive error message
3. Extracts the FHIR resources from the request body
4. Instantiates `ColonoscopyRuleEngine` and calls `evaluate()` with the extracted resources
5. Instantiates `CardFactory` and calls the appropriate card-building method based on the rule outcome
6. Returns a 200 response with the cards array wrapped in the `{"cards": [...]}` envelope

**Private helper methods:**

| Method | Description |
|--------|-------------|
| `validateRequest(array $body): bool` | Returns true if required fields are present and `hook` equals `order-sign` |
| `extractPatient(array $body): array` | Returns the Patient resource from `prefetch.patient` |
| `extractConditions(array $body): array` | Returns the array of Condition resources from `prefetch.conditions.entry[].resource` |
| `extractProcedures(array $body): array` | Returns the array of Procedure resources from `prefetch.priorProcedures.entry[].resource` |
| `extractCoverage(array $body): array` | Returns the Coverage resource from `prefetch.coverage` |

Each extraction method returns an empty array (or empty object) rather than throwing if the key is absent, so the rule engine can handle missing prefetch data gracefully.

---

## 11. Rule Engine (`src/Rules/ColonoscopyRuleEngine.php`)

Class `App\Rules\ColonoscopyRuleEngine`.

The rule engine evaluates the clinical facts extracted from the CDS Hooks request and returns a structured outcome that drives card selection.

### 11.1 Constructor

Accepts the rule configuration array loaded from `config/payer-rules.php`. Store it internally.

### 11.2 Public Method

**`evaluate(array $patient, array $conditions, array $procedures, array $coverage): array`**

Runs all rule checks and returns an associative array (the "rule outcome") containing the following keys:

| Key | Type | Description |
|-----|------|-------------|
| `highRiskIndicator` | bool | True if the Z80.0 condition code is present in the conditions array |
| `patientAge` | int or null | Patient age in years calculated from `birthDate`; null if birthDate is absent |
| `yearsSincePriorProcedure` | float or null | Elapsed years since the most recent qualifying prior procedure; null if no prior procedure found |
| `meetsIntervalRequirement` | bool | True if `yearsSincePriorProcedure` is null (no prior) or meets the applicable interval threshold |
| `outcome` | string | One of: `covered-high-risk`, `missing-documentation`, `interval-not-met` |

### 11.3 Private Helper Methods

| Method | Description |
|--------|-------------|
| `calculateAge(string $birthDate): int` | Calculates full years between the birth date and the current date using PHP `DateTime` |
| `hasHighRiskCondition(array $conditions): bool` | Searches the conditions array for a coding with system `http://hl7.org/fhir/sid/icd-10-cm` and code `Z80.0` |
| `findMostRecentProcedure(array $procedures, string $cptCode): ?array` | Filters the procedures array for a matching CPT code and returns the one with the most recent `performedDateTime`; returns null if none found |
| `calculateYearsSince(string $dateString): float` | Calculates the elapsed years between the given date and the current date using PHP `DateTime` |

### 11.4 Rule Logic

The `evaluate()` method applies rules in this order:

1. Call `hasHighRiskCondition()` to set `highRiskIndicator`
2. Call `calculateAge()` using `patient.birthDate` (if present) to set `patientAge`
3. Call `findMostRecentProcedure()` using the CPT code from `payer-rules.php` to find the prior procedure
4. If a prior procedure is found, call `calculateYearsSince()` using its `performedDateTime` to set `yearsSincePriorProcedure`
5. Determine `meetsIntervalRequirement`:
   - If no prior procedure: `true` (first procedure, no interval constraint)
   - If `highRiskIndicator` is true: check that `yearsSincePriorProcedure >= highRiskIntervalYears` from config
   - If `highRiskIndicator` is false: check that `yearsSincePriorProcedure >= averageRiskIntervalYears` from config
6. Determine `outcome`:
   - `highRiskIndicator` is true and `meetsIntervalRequirement` is true → `covered-high-risk`
   - `highRiskIndicator` is false → `missing-documentation`
   - `highRiskIndicator` is true and `meetsIntervalRequirement` is false → `interval-not-met`

---

## 12. Payer Rules Configuration (`config/payer-rules.php`)

A PHP file that returns an associative array of configurable rule parameters. The rule engine loads this array at construction time.

| Key | Type | Phase 1 Value | Description |
|-----|------|---------------|-------------|
| `highRiskIntervalYears` | int | `5` | Minimum years between colonoscopies for high-risk patients |
| `averageRiskIntervalYears` | int | `10` | Minimum years between colonoscopies for average-risk patients |
| `colonoscopyCptCode` | string | `45378` | CPT code identifying a colonoscopy procedure |
| `highRiskIcd10Codes` | array of string | `['Z80.0']` | ICD-10-CM codes that qualify a patient as high-risk |

---

## 13. Card Factory (`src/CdsHooks/CardFactory.php`)

Class `App\CdsHooks\CardFactory`.

The card factory constructs CDS Card arrays based on the rule outcome. It loads card templates from the fixture files and populates dynamic fields.

**Constructor:** No arguments.

**Public methods:**

| Method | Returns | Description |
|--------|---------|-------------|
| `buildCardsForOutcome(array $ruleOutcome): array` | array of card arrays | Dispatches to the appropriate card builder based on `$ruleOutcome['outcome']` |
| `buildCoveredHighRiskCards(): array` | array of card arrays | Loads `fixtures/cards-covered-high-risk.json` and returns its `cards` array |
| `buildMissingDocumentationCards(): array` | array of card arrays | Loads `fixtures/cards-missing-documentation.json` and returns its `cards` array |
| `buildIntervalNotMetCards(array $ruleOutcome): array` | array of card arrays | Builds a warning card indicating the screening interval has not been met; uses `yearsSincePriorProcedure` from the rule outcome |

The response envelope (`{"cards": [...]}`) is assembled by `CrdServiceController`, not by `CardFactory`. The factory returns only the inner array of card objects.

---

## 14. Fixtures

Fixture files are static JSON stored in `fixtures/`. They are loaded at runtime by the controllers and card factory.

### 14.1 `fixtures/cds-discovery.json`

Contains the complete CDS Hooks discovery response body. Must match the discovery response definition in `docs/spec/cds-hooks-api-contract.md` Section 3.

Top-level structure: `{ "services": [ { ... } ] }`

The single service entry must include all fields from API contract Section 3.3, including the prefetch template keys.

### 14.2 `fixtures/cards-covered-high-risk.json`

Contains a pre-built CDS Cards response body for the high-risk covered scenario.

Top-level structure: `{ "cards": [ { ... } ] }`

Card content must match the High-Risk Coverage Info Card definition in `docs/spec/cds-hooks-api-contract.md` Section 6.1.

### 14.3 `fixtures/cards-missing-documentation.json`

Contains a pre-built CDS Cards response body for the missing documentation scenario.

Top-level structure: `{ "cards": [ { ... } ] }`

Card content must match the Missing Documentation Warning Card definition in `docs/spec/cds-hooks-api-contract.md` Section 6.2.

---

## 15. Namespace and Autoloading Map

| PHP Namespace | Directory |
|---------------|-----------|
| `App\Http` | `src/Http/` |
| `App\CdsHooks` | `src/CdsHooks/` |
| `App\Rules` | `src/Rules/` |
| `App\Tests` | `tests/` |

---

## 16. Testing

PHPUnit is installed as a Composer development dependency. The test suite is configured in `phpunit.xml` at the project root.

`phpunit.xml` must declare:
- `testsuites`: A single suite pointing to the `tests/` directory
- `bootstrap`: `vendor/autoload.php`
- `colors`: `true`

### 16.1 `tests/Rules/ColonoscopyRuleEngineTest.php`

Tests are pure unit tests — no HTTP, no file I/O (mock or inline the config array).

| Test | What it verifies |
|------|-----------------|
| High-risk condition code Z80.0 is detected | `hasHighRiskCondition()` returns true when Z80.0 is present |
| Non-matching condition code is not detected | `hasHighRiskCondition()` returns false for other codes |
| Patient age is calculated correctly | `calculateAge()` returns correct integer for a known birth date |
| Most recent prior procedure is found | `findMostRecentProcedure()` returns the newest when multiple are present |
| No qualifying procedure returns null | `findMostRecentProcedure()` returns null when none match the CPT code |
| `evaluate()` returns `covered-high-risk` for high-risk patient with 5-year interval | Full rule evaluation for the demo scenario |
| `evaluate()` returns `missing-documentation` when Z80.0 is absent | Missing documentation path |
| `evaluate()` returns `interval-not-met` for high-risk patient with recent procedure | Interval not met path |

### 16.2 `tests/CdsHooks/DiscoveryControllerTest.php`

| Test | What it verifies |
|------|-----------------|
| `handle()` returns a Response with status 200 | HTTP status code |
| Response body contains `services` key | Discovery response structure |
| `services[0].hook` is `order-sign` | Correct hook declared |
| `services[0].id` is `crd-order-sign` | Correct service id |
| `services[0].prefetch` contains required keys | Prefetch template declared |

### 16.3 `tests/CdsHooks/CrdServiceControllerTest.php`

Use a minimal hand-crafted request body that mirrors the demo scenario fixtures. Do not depend on a running Python EHR.

| Test | What it verifies |
|------|-----------------|
| Valid request with Z80.0 returns 200 with `info` card | High-risk covered path end-to-end |
| Valid request without Z80.0 returns 200 with `warning` card | Missing documentation path end-to-end |
| Request missing `hook` field returns 400 | Validation rejects malformed request |
| Request with `hook` != `order-sign` returns 400 | Validation rejects wrong hook |
| Response body contains `cards` key | Response envelope is correct |

---

## 17. Build Sequence

Follow this order when implementing Phase 1. Each step has a verifiable outcome before proceeding.

| Step | Task | Verify | Status |
|------|------|--------|--------|
| 1 | Create `payer-crd/` directory structure as shown in Section 4 | All directories exist | Not started |
| 2 | Create `composer.json` with PSR-4 autoloading and PHPUnit dev dependency | `composer install` succeeds; `vendor/autoload.php` exists | Not started |
| 3 | Create `.env` and `.env.example` with keys from Section 5.1 | `.env` has `APP_ENV=development` and `PAYER_BASE_URL=http://localhost:8080` | Partial — `.env` exists; `.env.example` not created |
| 4 | Verify Apache and PHP-FPM are running and serving `public/index.php` | `curl http://localhost:8080` returns the placeholder HTML | Complete |
| 5 | Implement `src/Http/Request.php` and `src/Http/Response.php` | Classes are autoloaded without error | Not started |
| 6 | Implement the `.htaccess` rewrite rules | `curl http://localhost:8080/cds-services` routes to `index.php` (confirmed via a temporary echo in index.php) | Not started |
| 7 | Create `config/payer-rules.php` with values from Section 12 | File returns the expected array when `require`d | Not started |
| 8 | Create `fixtures/cds-discovery.json` matching the API contract | File is valid JSON; content matches Section 3.3 of the contract | Not started |
| 9 | Implement `src/CdsHooks/DiscoveryController.php` | `curl http://localhost:8080/cds-services` returns the discovery JSON | Not started |
| 10 | Implement the front controller routing in `public/index.php` | GET /cds-services dispatches to the controller; unknown routes return 404 | Not started — `public/index.php` is a static HTML placeholder |
| 11 | Write and run `DiscoveryControllerTest` | PHPUnit tests pass | Not started |
| 12 | Implement `src/Rules/ColonoscopyRuleEngine.php` | Class instantiates and `evaluate()` returns the correct structure | Not started |
| 13 | Write and run `ColonoscopyRuleEngineTest` | PHPUnit tests pass | Not started |
| 14 | Create `fixtures/cards-covered-high-risk.json` and `fixtures/cards-missing-documentation.json` matching the API contract | Files are valid JSON; content matches Sections 6.1 and 6.2 of the contract | Not started |
| 15 | Implement `src/CdsHooks/CardFactory.php` | `buildCardsForOutcome()` returns the correct card array for each outcome | Not started |
| 16 | Implement `src/CdsHooks/CrdServiceController.php` | `POST /cds-services/crd-order-sign` with a hand-crafted JSON body returns CDS Cards | Not started |
| 17 | Write and run `CrdServiceControllerTest` | PHPUnit tests pass | Not started |
| 18 | Run full PHPUnit suite | `./vendor/bin/phpunit` passes all tests | Not started |
| 19 | Perform end-to-end test with the Python EHR | `POST /orders/colonoscopy/crd` from the EHR produces CDS Cards in the browser | Not started |
