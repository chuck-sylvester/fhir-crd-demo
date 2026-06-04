# fhir-crd-demo

**fhir-crd-demo** is a reference application that demonstrates a Coverage Requirements Discovery (CRD) workflow between two independently developed applications:

1. A provider EHR simulator built with a modern Python web stack.
2. An external payer simulator built with a vanilla PHP 8.5 LAMP stack.

The project is intended to model the system-to-system collaboration described by the HL7 Da Vinci Coverage Requirements Discovery implementation guide. It is also intended to support learning around CMS burden reduction policy, CDS Hooks, FHIR resource modeling, and pragmatic healthcare interoperability architecture.

This is a demonstration and learning project. It is not a production prior authorization system, not a complete CMS-0057-F compliance implementation, and not intended to process real patient data.

The initial implementation will use synthetic fixture data rather than full FHIR server persistence. A future extension may integrate the provider EHR simulator directly with a HAPI FHIR Server, as opposed to using a traditional relational database as the data-serving application. The reason for this future approach is to learn more about using HAPI FHIR with a simulated EHR application. If added, the project may host a local HAPI FHIR Server using Docker and may also support connecting to an external HAPI FHIR Server.

The application will have the ability to run in a local development environment, using Docker / Docker Desktop on a macOS laptop where useful. The project may also be deployed to Oracle Cloud Infrastructure (OCI) in a "lift-and-shift" configuration, with the Python EHR application and the PHP payer application running in dedicated virtual machines within a personal OCI account. Networking and permissions will be configured so that both applications run properly, are accessible by users through an Internet browser connection, and have the required visibility and permissions to collaborate within the CRD workflow. Details around local and OCI deployment will be defined and documented in separate specification documents, to be created later.

## Standards Baseline

The reference application will use a stable standards baseline that includes:

- HL7 FHIR R4.
- CDS Hooks `order-sign` for the initial workflow.
- CDS Hooks `order-select` as a likely follow-on workflow.
- HL7 Da Vinci Coverage Requirements Discovery (CRD) Implementation Guide (stable version).

CRD, DTR, and PAS should be treated as related but distinct implementation guide areas:

- CRD supports coverage requirements discovery during care planning or ordering.
- DTR supports documentation templates and rules collection.
- PAS supports prior authorization submission workflows.

This project begins with CRD discovery behavior only. DTR-style links and PAS-oriented behavior should remain placeholders or later extensions unless a future specification expands their scope.

## Learning Goals

This project is designed to strengthen skills and understanding in the following areas:

1. CMS burden reduction and prior authorization modernization initiatives.
2. Coverage Requirements Discovery (CRD) workflows.
3. CDS Hooks request and response patterns.
4. Practical system-to-system API design across different technology stacks.
5. Connectathon-style implementation thinking and conformance-oriented design.

## Project Overview and Context

Administrative delays in prior authorization place a significant burden on the United States healthcare ecosystem. The Centers for Medicare & Medicaid Services (CMS) Interoperability and Prior Authorization Final Rule (CMS-0057-F) requires impacted payers to support improved interoperability and prior authorization processes through FHIR APIs and related operational changes.

The HL7 Da Vinci Project created the Coverage Requirements Discovery (CRD) implementation guide to help providers discover payer-specific coverage requirements while clinical orders are being created. CRD uses CDS Hooks so an EHR can ask a payer service for coverage guidance, documentation requirements, and prior authorization expectations at the point of care.

This project simulates that collaboration locally:

- The Python provider EHR application acts as the CRD client.
- The PHP/LAMP payer application acts as the CRD server.
- The EHR sends a CDS Hooks request when a clinician drafts or signs an order.
- The payer evaluates the clinical context and returns CDS Cards for display in the EHR workflow.

## Core Use Case: High-Risk Screening Colonoscopy

The demonstration simulates a clinical encounter where a patient visits a primary care physician to schedule a surveillance colonoscopy.

### Clinical Scenario

**Patient Profile:** 55-year-old male who is concerned about his risk for colorectal cancer. The only known family history is his father, who was diagnosed with colorectal cancer when he was 80 and succumbed to the illness when he was 82. Given this, the patient's provider has classified this as a high risk.

**Clinical History:** The patient had a clean screening colonoscopy 5 years ago.

**The Conflict:** Average-risk screening colonoscopies may be subject to a 10-year frequency interval, while high-risk patients may qualify for a shorter 5-year interval.

**The Goal:** When the clinician drafts or signs the colonoscopy order, the EHR invokes the payer's CRD service to determine whether the payer recognizes the high-risk exception, whether documentation is required, and whether formal prior authorization may be needed.

## Technical Architecture

The system consists of two primary applications. Each application has a distinct ownership boundary, technology stack, configuration file, and documentation area.

```text
+------------------------------------------------------------+
| Provider Environment                                       |
|                                                            |
|  Clinician UI                                              |
|      |                                                     |
|      | draft/sign colonoscopy order                        |
|      v                                                     |
|  Python Provider EHR Simulator                             |
|  FastAPI + HTMX + Jinja2 + HTTPX                           |
|  http://localhost:8000                                     |
+--------------------------|---------------------------------+
                           |
                           | CDS Hooks HTTP POST
                           | order-sign or order-select
                           v
+------------------------------------------------------------+
| Payer Environment                                          |
|                                                            |
|  PHP/LAMP External Payer CRD Service                       |
|  Apache + PHP 8.5 + optional MariaDB                       |
|  http://localhost:8080                                     |
|                                                            |
|  - CDS Hooks discovery metadata                            |
|  - CRD service endpoint                                    |
|  - Payer rule evaluation                                   |
|  - CDS Cards response generation                           |
+------------------------------------------------------------+
```

### Application Responsibilities

#### Provider EHR Simulator: Python

Directory: `provider-ehr/`

Default port: `8000`

Technology stack:

- Python 3.12.
- FastAPI for application routes and API endpoints.
- Jinja2 templates for server-rendered screens.
- HTMX for lightweight interactive UI behavior.
- HTTPX for outbound HTTP calls to the payer CRD service.
- Pydantic for request, response, and internal data models.
- Tailwind CSS for styling.
- PostgreSQL only if persistent local state becomes useful.

Responsibilities:

- Provide the clinician-facing workflow.
- Display the patient chart and draft colonoscopy order.
- Assemble FHIR resources needed by the CRD request.
- Build a CDS Hooks request for `order-sign` and, optionally, `order-select`.
- Send the request to the PHP payer CRD service.
- Receive CDS Cards from the payer.
- Render payer guidance inside the simulated EHR workflow.
- Record demo events locally for debugging and learning, if persistence is enabled.

#### External Payer CRD Service: PHP/LAMP

Directory: `payer-crd/`

Default port: `8080`

Technology stack:

- PHP 8.5.
- Apache HTTP Server.
- MariaDB only if payer rules, plans, or audit records need persistence.
- Plain PHP front controller and routing.
- No Laravel, Symfony, Slim, or other PHP application framework.
- Composer only if useful for autoloading, development tooling, or standards-based helper packages.

Responsibilities:

- Expose CDS Hooks discovery metadata.
- Expose one or more CRD service endpoints.
- Receive CDS Hooks requests from the Python EHR simulator.
- Validate the basic shape of incoming CDS Hooks payloads.
- Evaluate payer-specific rules for the colonoscopy scenario.
- Return valid CDS Cards describing coverage guidance, documentation requirements, and possible prior authorization expectations.
- Provide static or generated links to future DTR questionnaire artifacts when appropriate.

## System Collaboration Model

The provider EHR and payer service should be treated as separate applications that communicate over HTTP. The Python application should not call PHP as an internal helper, and the PHP application should not render the EHR UI.

```text
Python Provider EHR                  PHP/LAMP Payer CRD Service
-------------------                  --------------------------
Owns clinician UI                    Owns payer coverage logic
Builds FHIR context                  Receives CDS Hooks request
Posts CDS Hooks request       --->   Evaluates payer rules
Receives CDS Cards            <---   Returns CDS Cards
Displays payer guidance              Does not render EHR screens
```

## CRD Workflow Sequence

```text
1. Clinician opens the patient chart in the Python EHR simulator.

2. Clinician drafts a colonoscopy ServiceRequest.

3. Python EHR gathers relevant clinical context:
   - Patient demographics
   - Coverage details
   - Family history condition
   - Prior colonoscopy history
   - Draft colonoscopy order

4. Python EHR builds a CDS Hooks request.

5. Python EHR posts the request to the PHP payer CRD endpoint.

6. PHP payer validates the request shape and extracts relevant facts:
   - Patient age
   - Diagnosis/risk indicator
   - Procedure code
   - Prior procedure timing
   - Coverage or plan information, if modeled

7. PHP payer evaluates local rule logic.

8. PHP payer returns CDS Cards.

9. Python EHR renders the cards in the clinician workflow.

10. Clinician sees whether the order appears covered, requires documentation,
    or may require prior authorization.
```

## Request and Response Flow

```text
+-----------+       +-------------+       +----------------+
| Clinician |       | Python EHR  |       | PHP Payer CRD  |
+-----------+       +-------------+       +----------------+
      |                    |                       |
      | Draft order        |                       |
      |------------------->|                       |
      |                    | Build FHIR context    |
      |                    | locally               |
      |                    | CDS Hooks request     |
      |                    |---------------------->|
      |                    |                       | Validate payload
      |                    |                       | Evaluate rules
      |                    | CDS Cards response    |
      |                    |<----------------------|
      | View guidance      |                       |
      |<-------------------|                       |
      |                    |                       |
```

## Data Specification and Payload Mapping

When the clinician drafts or signs the colonoscopy order, the Python EHR compiles a CDS Hooks payload. The initial implementation should focus on **`order-sign`**, with `order-select` as a likely follow-on workflow if earlier discovery is desired.

### Critical FHIR Resources

- `Patient`: Contains demographics required for the scenario.
- `Encounter`: Represents the clinical encounter context, if modeled.
- `Practitioner` or `PractitionerRole`: Represents current ordering user for CDS Hooks context.
- `Organization`: Represents provider or payer organizations where useful.
- `Coverage`: Identifies the patient's payer or plan when the demo is ready to model plan-specific behavior.
- `Condition`: Represents the risk-relevant diagnosis or family history.
  - ICD-10-CM `Z80.0`: Family history of malignant neoplasm of digestive organs.
- `ServiceRequest`: Represents the ordered colonoscopy.
  - `CPT 45378`: Colonoscopy, flexible, proximal to splenic flexure; diagnostic.
- `Procedure`: Represents previous colonoscopy date (5 years before current order in demo scenario).

### CDS Hooks Request Contents

The first version should include enough structure to demonstrate the workflow without overbuilding conformance features.

Initial **`order-sign`** request elements:

- `hook`: `order-sign`.
- `hookInstance`: Unique request identifier.
- `fhirServer`: Local or simulated FHIR server URL, if modeled.
- `fhirAuthorization`: Omitted or mocked for first version unless SMART/FHIR authorization is added.
- `context.userId`: Required current user reference, such as `PractitionerRole/demo-clinician`.
- `context.patientId`: Required current patient id.
- `context.encounterId`: Optional current encounter id, if modeled.
- `context.draftOrders`: Required FHIR Bundle containing the draft colonoscopy `ServiceRequest`.
- `prefetch`: Includes bundled FHIR resources needed by the payer rule engine.

For `order-select`, if added later, the request should account for the fact that selected order details may be less complete than they are at `order-sign`.

### Expected Payer Response

The PHP payer service evaluates the payload and returns CDS Cards.

Example card outcomes:

- **Information card:** Confirms that the high-risk family history supports a 5-year screening interval under the simulated payer rule.
- **Documentation card:** Provides a link to a future DTR questionnaire or documentation checklist for audit support.
- **Warning card:** Used in alternate scenarios where required risk documentation is missing or the patient appears average risk.
- **Prior authorization card:** Used in alternate scenarios where the simulated payer requires prior authorization before scheduling.

## Demo Boundaries

The project should clearly limit its scope.

In scope for the initial demonstration:

- Local provider-to-payer CRD workflow.
- Synthetic patient and order data.
- CDS Hooks request and response exchange.
- Rule-based PHP payer response logic.
- EHR rendering of returned CDS Cards.
- Text or JSON fixtures for scenario data.

Out of scope for the initial demonstration:

- Real patient data.
- Production HIPAA controls.
- Real payer eligibility verification.
- Real prior authorization submission.
- Full CMS-0057-F compliance.
- Full FHIR server persistence.
- Production-grade terminology validation.
- Complete DTR or PAS implementation.
- Real SMART on FHIR authorization.

## Project and Documentation Layout

The repository should remain intentionally simple at the root level. The root directory should provide project-level orientation only, while each application owns its implementation details, documentation, local configuration, and future app-specific specification.

Root-level files should be limited to broad project concerns such as:

- `README.md`: Overall demonstration overview, quick-start summary, and links into each application.
- `.gitignore`: Shared ignore rules for Python, PHP, local environment files, dependency folders, logs, and generated artifacts.
- `docs/`: Project-level documentation, including specifications and reference material

Each application should be self-contained:

- `provider-ehr/`: Python EHR simulator application, including its own tests, dependencies, and environment configuration.
- `payer-crd/`: PHP/LAMP payer CRD service application, including its own tests, dependencies, and environment configuration.

Recommended configuration pattern:

- Each app may have its own local `.env` file for development settings.
- Real `.env` files should not be committed.
- Each app should include a committed `.env.example` file that documents required configuration keys.

## Repository Structure

The following structure is a proposed initial layout. It may be refined during implementation as long as the provider and payer applications remain independently runnable and clearly separated.

```text
fhir-crd-demo/
|-- docs/                             # Project-wide documents
|   |-- reference/                    # Useful reference material
|   |-- spec/                         # High-level and detailed technical specifications
|       |-- fhir-crd-demo-spec.md
|       |-- cds-hooks-api-contract.md
|       |-- provider-ehr-spec.md
|       |-- payer-crd-spec.md
|-- payer-crd/                        # PHP/LAMP external payer simulator
|   |-- public/
|   |   |-- index.php                 # Front controller
|   |   |-- .htaccess                 # Apache rewrite rules
|   |-- src/
|   |   |-- Http/
|   |   |   |-- Request.php
|   |   |   |-- Response.php
|   |   |-- CdsHooks/
|   |   |   |-- DiscoveryController.php
|   |   |   |-- CrdServiceController.php
|   |   |   |-- CardFactory.php
|   |   |-- Rules/
|   |       |-- ColonoscopyRuleEngine.php
|   |-- config/
|   |   |-- payer-rules.php
|   |-- fixtures/
|   |   |-- cds-discovery.json
|   |   |-- cards-covered-high-risk.json
|   |   |-- cards-missing-documentation.json
|   |-- tests/
|   |-- .env                          # Local-only configuration, not committed
|   |-- .env.example                  # Committed environment template
|   |-- composer.json                 # Autoloading and dev tooling
|   |-- apache.conf                   # Virtual host template for OCI deployment
|-- provider-ehr/                     # Python provider EHR simulator
|   |-- app/
|   |   |-- __init__.py
|   |   |-- main.py                   # FastAPI application entrypoint
|   |   |-- config.py                 # Settings and payer endpoint configuration
|   |   |-- cds_client.py             # Sends CDS Hooks requests to payer
|   |   |-- fhir_factory.py           # Builds and assembles FHIR resources
|   |   |-- models.py                 # Pydantic models
|   |   |-- routes/
|   |   |   |-- clinician.py          # Clinician-facing routes
|   |   |   |-- api.py                # Debug API endpoints
|   |   |-- templates/
|   |   |   |-- base.html
|   |   |   |-- patient_chart.html
|   |   |   |-- cds_cards.html
|   |   |-- static/
|   |   |   |-- css/
|   |   |   |-- js/
|   |   |-- fixtures/
|   |       |-- patient.json
|   |       |-- condition-family-history.json
|   |       |-- service-request-colonoscopy.json
|   |       |-- prior-colonoscopy.json
|   |       |-- coverage.json
|   |-- tests/
|   |-- .env                          # Local-only configuration, not committed
|   |-- .env.example                  # Committed environment template
|   |-- requirements.txt
|   |-- Dockerfile
|-- .gitignore
|-- README.md
```

## Suggested HTTP Endpoints

### Python Provider EHR

```text
GET  /                          Clinician dashboard or patient list
GET  /patients/{patient_id}      Patient chart
GET  /orders/colonoscopy        Draft colonoscopy order screen
POST /orders/colonoscopy/crd    Trigger CRD request to payer
GET  /debug/last-crd-request    Inspect last outgoing CDS Hooks request
GET  /debug/last-crd-response   Inspect last payer CDS Cards response
```

### PHP Payer CRD Service

```text
GET  /cds-services                     CDS Hooks discovery endpoint
POST /cds-services/crd-order-sign      CRD endpoint for order-sign
POST /cds-services/crd-order-select    Optional future CRD endpoint for order-select
GET  /questionnaires/colonoscopy-risk  Placeholder DTR-style questionnaire/checklist
GET  /debug/rules                      Optional local-only rule inspection endpoint
```

## Development Workflow

The two applications should be runnable and testable independently.

```text
Terminal 1: start PHP/LAMP payer service
Terminal 2: start Python provider EHR service
   Browser: open Python EHR at http://localhost:8000
```

### Prerequisites

- Python 3.12.
- PHP 8.5, installed via Homebrew (`brew install php`).
- Apache HTTP Server, installed via Homebrew (`brew install httpd`).
- MariaDB if persistence is added to the payer application.
- `curl`, Postman, Insomnia, or a similar API testing tool.

### Quick Start: Development Mode

The payer application runs under Homebrew Apache and PHP-FPM. Complete the one-time Apache configuration described in the next section before running these steps for the first time.

1. Clone the repository:

   ```bash
   git clone https://github.com/example/fhir-crd-demo.git
   cd fhir-crd-demo
   ```

2. Start the PHP payer CRD service:

   ```bash
   brew services start php      # PHP-FPM on port 9000
   brew services start httpd    # Homebrew Apache on port 8080
   ```

3. Start the Python EHR application:

   ```bash
   cd provider-ehr
   python3.12 -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   uvicorn app.main:app --reload --port 8000
   ```

4. Open the EHR simulator:

   ```text
   http://localhost:8000
   ```

5. Trigger the colonoscopy CRD scenario from the UI or with curl:

   ```bash
   curl -X POST http://localhost:8000/orders/colonoscopy/crd
   ```

### Local Apache Configuration (macOS)

One-time setup step. Homebrew PHP no longer ships `mod_php`; the current integration approach is PHP-FPM with `mod_proxy_fcgi`, where Apache forwards PHP requests to a separate PHP-FPM process pool.

#### Enable required Apache modules

In `/opt/homebrew/etc/httpd/httpd.conf`, ensure the following `LoadModule` directives are uncommented:

```apache
LoadModule proxy_module lib/httpd/modules/mod_proxy.so
LoadModule proxy_fcgi_module lib/httpd/modules/mod_proxy_fcgi.so
LoadModule rewrite_module lib/httpd/modules/mod_rewrite.so
```

#### Set DocumentRoot and Directory

Rather than using a separate virtual host configuration file, set the `DocumentRoot` and `<Directory>` blocks directly in `/opt/homebrew/etc/httpd/httpd.conf`. Replace the existing `DocumentRoot` and matching `<Directory>` block with:

```apache
DocumentRoot "/path/to/fhir-crd-demo/payer-crd/public"
<Directory "/path/to/fhir-crd-demo/payer-crd/public">
    Options Indexes FollowSymLinks
    AllowOverride All
    Require all granted
</Directory>
```

Replace `/path/to/fhir-crd-demo` with the actual repository path on disk (e.g. `/Users/yourname/swdev/cps/fhir-crd-demo`).

`AllowOverride All` is required so that the `.htaccess` file in `payer-crd/public/` can apply the rewrite rules that route all requests through the front controller (`index.php`).

The `httpd-vhosts.conf` include does **not** need to be enabled for this setup. Leave it commented out in `httpd.conf`.

#### PHP handler

The Homebrew Apache default config includes a global `<FilesMatch>` block that routes all `.php` requests through PHP-FPM:

```apache
<FilesMatch \.php$>
    SetHandler "proxy:fcgi://127.0.0.1:9000"
</FilesMatch>
```

This block handles PHP execution for the payer application automatically; no additional `ProxyPassMatch` directive is needed when using the direct `DocumentRoot` approach.

#### PHP-FPM port

Homebrew PHP-FPM listens on TCP port 9000 by default. Confirm this matches the `SetHandler` directive above by checking the `listen` value in `/opt/homebrew/etc/php/8.5/php-fpm.d/www.conf`.

#### Service management

```bash
brew services start php          # start PHP-FPM
brew services start httpd        # start Apache
brew services stop php httpd     # stop both
brew services restart httpd      # reload Apache after config changes
```

### OCI Deployment (Lift and Shift)

The project is intended to support deployment to Oracle Cloud Infrastructure (OCI) in a lift-and-shift configuration, with each application running in a dedicated virtual machine within the same OCI compartment. A separate deployment specification will cover the full setup; the notes below capture the key structural differences from the local macOS environment.

#### Application placement

- Python provider EHR: dedicated OCI VM, accessible on port 8000 or behind a reverse proxy.
- PHP payer CRD service: dedicated OCI VM, accessible on port 8080 or behind a reverse proxy.
- Both VMs should reside in the same VCN (Virtual Cloud Network) to allow direct inter-application communication over private subnet IPs.

#### PHP/Apache on OCI Linux

On OCI Linux (Oracle Linux or Ubuntu), install Apache and PHP via the OS package manager rather than Homebrew:

```bash
# Oracle Linux 8/9
sudo dnf install httpd php php-fpm

# Ubuntu
sudo apt install apache2 php php-fpm
```

The application code is fully portable. On OCI, **do not edit the main `httpd.conf` directly** for application routing. Instead, drop a dedicated virtual host configuration file into the appropriate conf directory:

- Oracle Linux: `/etc/httpd/conf.d/fhir-crd.conf`
- Ubuntu: `/etc/apache2/sites-available/fhir-crd.conf` (then enable with `a2ensite`)

The committed `payer-crd/apache.conf` file serves as the template for this conf file. Copy it to the appropriate location and update the paths:

```apache
<VirtualHost *:8080>
    DocumentRoot "/var/www/fhir-crd-demo/payer-crd/public"
    ServerName <payer-vm-hostname-or-ip>

    <Directory "/var/www/fhir-crd-demo/payer-crd/public">
        Options Indexes FollowSymLinks
        AllowOverride All
        Require all granted
    </Directory>

    <FilesMatch \.php$>
        SetHandler "proxy:fcgi://127.0.0.1:9000"
    </FilesMatch>
</VirtualHost>
```

Key differences between the Homebrew (macOS) and Linux (OCI) environments:

| | macOS (Homebrew) | OCI Linux |
|---|---|---|
| Apache config approach | `DocumentRoot` set directly in `httpd.conf` | Dedicated conf file in `conf.d/` or `sites-available/` |
| Apache config root | `/opt/homebrew/etc/httpd/` | `/etc/httpd/conf.d/` or `/etc/apache2/sites-available/` |
| Document root convention | local repository path | `/var/www/fhir-crd-demo/payer-crd/public` |
| PHP-FPM socket | TCP `127.0.0.1:9000` | TCP or Unix socket; check `/etc/php-fpm.d/www.conf` |
| Service management | `brew services` | `systemctl enable --now httpd php-fpm` |

#### Networking and firewall

OCI VCN security lists and instance-level firewall rules must permit:

- Inbound to Python EHR VM on port 8000 (or 80/443) from the internet, for clinician browser access.
- Inbound to PHP payer VM on port 8080 from the Python EHR VM's private subnet IP, for CDS Hooks calls.
- Internet-facing access to PHP payer VM is not required; payer-to-provider traffic stays on private subnet.

The payer endpoint URL in the Python EHR application must be configurable via `.env` so that it can point to `http://localhost:8080` locally and to the payer VM's private IP or hostname on OCI.

## Implementation Phases

### Phase 1: Minimal End-to-End CRD Demo

- Create Python EHR shell with patient chart and colonoscopy order screen.
- Create PHP payer shell with CDS Hooks discovery and `order-sign` endpoint.
- Build static FHIR fixtures for the high-risk colonoscopy scenario.
- Send a CDS Hooks request from Python to PHP.
- Return static or lightly rule-driven CDS Cards from PHP.
- Render returned cards in the Python EHR UI.

### Phase 2: Rule Depth and Scenario Variants

- Add payer rule evaluation for average-risk vs high-risk patients.
- Add missing-documentation and prior-authorization-required card responses.
- Add request/response debug screens.
- Add focused unit tests for Python request construction and PHP rule evaluation.

### Phase 3: Standards Alignment

- Improve FHIR resource profiles and payload structure against Da Vinci CRD expectations.
- Add `order-select` alongside `order-sign` if useful.
- Add richer CDS Hooks discovery metadata.
- Add terminology and code system validation where practical.

### Phase 4: Future Learning Extensions

- Add SMART on FHIR launch simulation.
- Add HAPI FHIR Server as an optional local FHIR persistence layer.
- Add DTR questionnaire flow.
- Add PAS-oriented prior authorization submission simulation.
- Explore RAG-assisted policy lookup or payer rule explanation.

## Items for Later Clarification

The following items do not need to be resolved before the initial specification is useful, but they should be clarified in future specification updates:

- The exact Da Vinci CRD STU 2.x version to use as the implementation baseline.
- Whether HAPI FHIR will remain a future extension or become part of an earlier standards-alignment phase.
- The detailed OCI deployment architecture, including VM sizing, networking topology, TLS termination, and whether a reverse proxy (nginx or Apache mod_proxy) will front either application.
- The exact DTR and PAS learning scope, if those extensions are added.

## Quality and Testing Considerations

The initial test strategy should focus on the integration boundaries that make the demo meaningful.

Recommended tests:

- Python unit tests for FHIR fixture loading and CDS Hooks request construction.
- Python integration test that mocks the payer endpoint.
- PHP unit tests for colonoscopy rule evaluation.
- PHP endpoint tests for CDS Hooks discovery and CRD service responses.
- Contract-style JSON fixture tests for request and response examples.
- Manual browser workflow test from patient chart to returned CDS Cards.

Recommended non-functional checks:

- Keep all demo data synthetic.
- Keep payer endpoint URL configurable.
- Log request and response payloads in development mode.
- Avoid hard-coding values that should become scenario fixtures.
- Keep provider and payer responsibilities separate.

## Reference Specifications

- [CMS Interoperability and Prior Authorization Final Rule CMS-0057-F](https://www.cms.gov/newsroom/fact-sheets/cms-interoperability-and-prior-authorization-final-rule-cms-0057-f)
- [HL7 Da Vinci Coverage Requirements Discovery Implementation Guide](https://www.hl7.org/fhir/us/davinci-crd/)
- [Da Vinci CRD Supported Hooks](https://www.hl7.org/fhir/us/davinci-crd/hooks.html)
- [Da Vinci CRD ServiceRequest Profile](https://www.hl7.org/fhir/us/davinci-crd/StructureDefinition-profile-servicerequest.html)
- [CDS Hooks Specification](https://cds-hooks.org)
- [PHP 8.5 Release Information](https://www.php.net/releases/8.5/)
