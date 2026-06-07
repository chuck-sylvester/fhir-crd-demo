# Dev Environment Setup — Learning Guide and Implementation Reference

For `payer-crd/` — Build Sequence Step 1

---

## How to Use This Document

This document has two parts:

**Part 1 — Learning Reference (Sections 1–5):** Explains Bun and Hono from first principles using simple examples unrelated to the project. Read these sections before writing any code. Each concept is illustrated on its own so it is clear in isolation before you apply it to the project. Section 5 maps the payer stack against the provider-ehr stack you already know.

**Part 2 — Implementation Guide (Section 6):** Steps through Build Sequence Step 1 from `docs/spec/payer-crd-spec.md` Section 14: creating the project directory structure, initializing `package.json`, installing Hono, and configuring TypeScript. Each phase produces something verifiable before you proceed to the next.

**Appendix A** covers OCI deployment considerations for lift-and-shift to an Oracle Cloud Infrastructure Linux VM.

**Bun version targeted by this project: 1.x (latest stable)**

---

## Part 1: What Bun Is

### 1.1 Bun as a JavaScript/TypeScript Runtime

Bun is a JavaScript and TypeScript runtime, like Node.js — but it is not built on V8 (Chrome's engine). Bun is built on JavaScriptCore, the engine that powers Safari. On Apple Silicon Macs, this typically means faster startup times and lower memory use than equivalent Node.js processes.

Beyond being a runtime, Bun bundles four tools into a single binary:

| Tool | What it replaces | What it does |
|------|-----------------|--------------|
| Runtime | `node` | Executes `.js` and `.ts` files directly — no compile step needed |
| Package manager | `npm` / `yarn` / `pnpm` | Installs packages from the npm registry into `node_modules/` |
| Bundler | `esbuild` / `webpack` | Bundles multiple source files into a deployable artifact |
| Test runner | `jest` / `vitest` | Runs test files matching `*.test.ts` patterns |

For this project, the relevant tools are the **runtime**, **package manager**, and **test runner**. The bundler is not used.

Bun is a drop-in replacement for Node.js in most scenarios. Any npm package that does not use Node.js-specific internals (native addons, certain `fs` APIs) works in Bun without modification.

### 1.2 How Bun Runs TypeScript

Bun executes TypeScript files directly without requiring a separate compilation step. When you run `bun src/index.ts`, Bun strips the type annotations at load time and executes the resulting JavaScript. TypeScript type errors do not stop execution — Bun is not a type checker. Type checking is done separately with `tsc --noEmit` (or your editor's TypeScript language server).

This is the workflow:

```
bun run dev          ← runs the app, no tsc step needed
tsc --noEmit         ← checks types only, produces no output files
bun test             ← runs *.test.ts files the same way
```

Your editor (VS Code) runs the TypeScript language server in the background and shows type errors as you type. The explicit `tsc --noEmit` command is useful in CI or when you want to verify the whole project at once.

### 1.3 `package.json` in a Bun Project

`package.json` in a Bun project is identical in structure to a Node.js project's `package.json`. Bun reads and writes it using the same format. The key sections for this project:

```json
{
  "name": "payer-crd",
  "version": "1.0.0",
  "scripts": {
    "dev":   "bun run --watch src/index.ts",
    "start": "bun run src/index.ts",
    "test":  "bun test"
  },
  "dependencies": {
    "hono": "^4.x.x"
  },
  "devDependencies": {
    "@types/bun": "latest"
  }
}
```

**Scripts:**

| Script | How to run | What it does |
|--------|-----------|--------------|
| `dev` | `bun run dev` | Starts the server and restarts automatically when any source file changes (`--watch` flag) |
| `start` | `bun run start` | Starts the server once; used in production or OCI deployments |
| `test` | `bun test` | Runs all `*.test.ts` files found under the project root |

**`@types/bun`:** This package provides TypeScript type definitions for Bun's built-in APIs (`Bun.file()`, `Bun.serve()`, `Bun.env`, etc.). Without it, TypeScript does not know those APIs exist and reports type errors when you use them.

### 1.4 `bun install` vs `npm install`

`bun install` reads `package.json`, resolves dependency versions, downloads packages into `node_modules/`, and writes a `bun.lockb` lockfile. It is the Bun equivalent of `npm install`.

| Command | What it does |
|---------|-------------|
| `bun install` | Install all dependencies declared in `package.json` |
| `bun add hono` | Add `hono` to `dependencies` and install it |
| `bun add -d @types/bun` | Add `@types/bun` to `devDependencies` and install it |
| `bun remove hono` | Remove `hono` and uninstall it |

`bun.lockb` is a binary lockfile that records exact resolved versions. Commit it to git — it ensures every developer and every deployment installs exactly the same versions. Do not edit it manually.

---

## Part 2: What Hono Is

### 2.1 Hono as a Web Framework

Hono (炎 — "flame" in Japanese) is a lightweight TypeScript web framework designed to run on multiple JavaScript runtimes: Bun, Deno, Cloudflare Workers, Node.js, and others. The same Hono application code runs unchanged across all of these environments.

For this project, Hono runs on Bun. Its primary job is HTTP routing: matching incoming requests to handler functions by method and path.

### 2.2 The Hono Application Model

A Hono application is an instance of the `Hono` class. You register route handlers on it, then pass its `fetch` method to the runtime's HTTP server.

```typescript
import { Hono } from 'hono';

const app = new Hono();

// Register a route: GET /hello
app.get('/hello', (c) => {
  return c.text('Hello, world!');
});

// Start the server (Bun-specific)
Bun.serve({
  port: 8080,
  fetch: app.fetch,
});

console.log('Listening on port 8080');
```

Key points:
- `app.get(path, handler)` registers a GET route
- `app.post(path, handler)` registers a POST route
- The handler receives a **context object** `c` and returns a `Response`
- `Bun.serve({ fetch: app.fetch })` wires Bun's HTTP server to Hono's router

### 2.3 The Context Object (`c`)

Every route handler receives a single argument conventionally named `c` (for "context"). It provides methods to read the request and build the response.

**Reading the request:**

```typescript
app.post('/orders', async (c) => {
  const body = await c.req.json();      // Parse JSON body
  const token = c.req.header('Authorization'); // Read a header
  const id = c.req.param('id');         // Read a path parameter
  // ...
});
```

**Building responses:**

```typescript
// JSON response (most common in this project)
return c.json({ cards: [] }, 200);

// Plain text response
return c.text('Not found', 404);

// Error responses
return c.json({ error: 'Bad request' }, 400);
```

`c.json(data, status)` serializes `data` to JSON and sets `Content-Type: application/json`. The status code defaults to `200` if omitted.

### 2.4 Hono Route Registration Patterns

Routes are registered directly on the `Hono` instance. For this project there are only two routes, so a router file per route is the pattern used (matching what the spec prescribes in `src/routes/`).

```typescript
// src/routes/discovery.ts
import { Hono } from 'hono';

const discovery = new Hono();

discovery.get('/cds-services', async (c) => {
  const data = await Bun.file('fixtures/cds-discovery.json').json();
  return c.json(data, 200);
});

export default discovery;
```

```typescript
// src/index.ts
import { Hono } from 'hono';
import discovery from './routes/discovery';

const app = new Hono();
app.route('/', discovery);   // Mount the discovery router

Bun.serve({ port: 8080, fetch: app.fetch });
```

`app.route('/', subRouter)` merges the sub-router's routes into the main app at the given prefix. Using `'/'` here means the sub-router's paths are unchanged (`/cds-services` remains `/cds-services`).

### 2.5 Hono's Built-in 404 Behavior

Hono returns an HTTP 404 response automatically for any request that does not match a registered route. No manual 404 handler is required. This satisfies Build Sequence Step 7.

---

## Part 3: Bun's Built-in APIs Used in This Project

### 3.1 `Bun.serve()`

`Bun.serve()` starts an HTTP server. It replaces the boilerplate of `http.createServer()` from Node.js.

```typescript
Bun.serve({
  port: Number(Bun.env.PORT) || 8080,
  fetch: app.fetch,
});
```

- `port` — the port to listen on
- `fetch` — a function that receives a `Request` and returns a `Response`; Hono's `app.fetch` satisfies this interface

### 3.2 `Bun.file()`

`Bun.file(path)` returns a lazy `BunFile` handle. The file is not read until you call a method on it. Two methods are used in this project:

```typescript
// Read as parsed JSON
const data = await Bun.file('fixtures/cds-discovery.json').json();

// Read as a string
const text = await Bun.file('fixtures/cds-discovery.json').text();
```

Paths are resolved relative to the **current working directory** — the directory from which you ran `bun run dev` or `bun test`. Always run these commands from `payer-crd/`.

### 3.3 `Bun.env`

`Bun.env` is a plain object containing all environment variables. Bun automatically loads `.env` from the current working directory at startup — no `dotenv` package is required.

```typescript
const port = Number(Bun.env.PORT) || 8080;
const payerName = Bun.env.PAYER_NAME ?? 'Demo Payer CRD Service';
```

Use `??` (nullish coalescing) to provide a default when the variable is undefined. Use `||` when you also want to catch an empty string `""`.

---

## Part 4: TypeScript Configuration for Bun + Hono

### 4.1 `tsconfig.json` Purpose

`tsconfig.json` configures the TypeScript compiler. In a Bun project it serves two purposes:

1. Controls what `tsc --noEmit` checks
2. Controls what the VS Code TypeScript language server checks (editor type errors)

Bun itself does not read `tsconfig.json` when executing files — it always strips types. But `tsconfig.json` is still required for a correct editor experience.

### 4.2 The `tsconfig.json` for This Project

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "types": ["bun-types"],
    "lib": ["ESNext"],
    "outDir": "dist",
    "skipLibCheck": true
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

**Key options:**

| Option | Why |
|--------|-----|
| `"target": "ESNext"` | Target modern JavaScript; Bun supports all ESNext features |
| `"module": "ESNext"` | Use ES module `import`/`export` syntax |
| `"moduleResolution": "bundler"` | Tells TypeScript to resolve modules the way Bun (and bundlers) do; required for Hono and `@types/bun` to resolve correctly |
| `"strict": true` | Enables all strict type checks — catches more errors |
| `"noUncheckedIndexedAccess": true` | Array index access (e.g., `arr[0]`) returns `T \| undefined` instead of `T`; prevents a common class of runtime errors |
| `"types": ["bun-types"]` | Loads Bun's global type definitions (`Bun.file`, `Bun.serve`, etc.) |
| `"skipLibCheck": true` | Skips type-checking of `.d.ts` files in `node_modules/`; avoids noise from transitive dependencies |

`"noUncheckedIndexedAccess": true` has a practical consequence: when you write `conditions[0]`, TypeScript types it as `FhirCondition | undefined` rather than `FhirCondition`. You must check for `undefined` before using the value. This is intentional — it forces you to handle the case where an array is empty.

---

## Part 5: Provider EHR and Payer CRD — Stack Comparison

### 5.1 Is "Uvicorn vs Bun" the Right Comparison?

Short answer: partially correct, but the comparison is not one-to-one. Uvicorn and `Bun.serve()` fill the same role (the HTTP server layer), and FastAPI and Hono fill the same role (the web framework layer). But Bun replaces far more than just Uvicorn — it also replaces the Python runtime, pip, and pytest.

The full picture, layer by layer:

| Responsibility | Provider EHR (Python) | Payer CRD (Bun + Hono) |
|---|---|---|
| Language runtime | Python (via system or `pyenv`) | Bun |
| Package manager | pip (`requirements.txt`) | bun (`package.json`, `bun.lockb`) |
| HTTP server | **Uvicorn** | **`Bun.serve()`** |
| Web framework + routing | **FastAPI** | **Hono** |
| Test runner | pytest | `bun test` |
| Environment loading | `python-dotenv` (or manual) | Built into Bun (reads `.env` automatically) |

The middle two rows — HTTP server and web framework — are where the architectural comparison is closest, so they are covered in detail in Sections 5.2 and 5.3.

### 5.2 The HTTP Server Layer: Uvicorn ↔ `Bun.serve()`

Both Uvicorn and `Bun.serve()` occupy the same layer in their respective stacks: they are the process that opens a TCP socket, speaks the HTTP/1.1 protocol, and hands each parsed request to the web framework.

**Uvicorn** is a standalone Python package (`pip install uvicorn`). It implements the ASGI (Asynchronous Server Gateway Interface) specification — a standard contract that defines how a Python async HTTP server and a Python async web framework communicate. FastAPI is an ASGI application; Uvicorn is an ASGI server. The two are decoupled: you could swap Uvicorn for another ASGI server (Hypercorn, Daphne) without changing a line of FastAPI code.

The ASGI interface is a Python-internal protocol — it never appears in your application code. You just see it on the command line:

```zsh
uvicorn app.main:app --reload --port 8000
#        ^^^^^^^^^ the ASGI application object Uvicorn calls
```

**`Bun.serve()`** is a built-in function in the Bun runtime — no package installation required. It implements the WHATWG Fetch API standard: it expects a function that accepts a `Request` object and returns a `Response` object. Hono's `app.fetch` satisfies this interface. Like the ASGI separation, `Bun.serve()` does not know about routes — it just calls `app.fetch(request)` and returns whatever the framework returns.

```typescript
Bun.serve({
  port: 8080,
  fetch: app.fetch,   // Hono's router, called for every request
});
```

**Key practical difference:** Uvicorn is a separate process you install and run; `Bun.serve()` is a function call in your own `src/index.ts`. In the Python stack, Uvicorn *owns* the process and *calls* your app. In the Bun stack, *your* `src/index.ts` owns the process and *calls* `Bun.serve()`.

**Development reload:**

| App | Dev command | How reload works |
|-----|------------|-----------------|
| Provider EHR | `uvicorn app.main:app --reload` | Uvicorn watches Python files and restarts the ASGI app |
| Payer CRD | `bun run --watch src/index.ts` | Bun watches source files and restarts the process |

Both give you the same experience — edit a file, the server restarts automatically.

### 5.3 The Web Framework Layer: FastAPI ↔ Hono

FastAPI and Hono occupy the same layer: they match incoming requests to handler functions by HTTP method and path, and they provide helpers for reading request data and building responses.

**Routing syntax comparison:**

```python
# FastAPI (provider-ehr)
from fastapi import FastAPI
app = FastAPI()

@app.get("/patients/{patient_id}")
async def get_patient(patient_id: str):
    return {"id": patient_id}

@app.post("/orders/colonoscopy/crd")
async def trigger_crd():
    ...
```

```typescript
// Hono (payer-crd)
import { Hono } from 'hono';
const app = new Hono();

app.get('/patients/:patientId', (c) => {
  const patientId = c.req.param('patientId');
  return c.json({ id: patientId });
});

app.post('/cds-services/crd-order-sign', async (c) => {
  ...
});
```

The ideas are identical — method + path → handler function. The differences are:
- FastAPI uses decorators (`@app.get`); Hono uses method calls (`app.get(...)`)
- FastAPI injects path parameters as function arguments; Hono provides them via `c.req.param()`
- FastAPI returns plain Python objects that it serializes automatically; Hono requires an explicit `c.json(...)` call

**Request body parsing comparison:**

```python
# FastAPI — Pydantic model declared as a parameter; FastAPI parses and validates automatically
@app.post("/orders")
async def create_order(body: CdsHooksRequest):
    print(body.hook_instance)   # already a validated CdsHooksRequest instance
```

```typescript
// Hono — parse manually; TypeScript type assertion, no runtime validation
app.post('/orders', async (c) => {
  const body = await c.req.json() as CdsHooksRequest;
  console.log(body.hookInstance);  // runtime type is plain object; TypeScript trusts the assertion
});
```

This is the most significant behavioral difference: FastAPI validates the incoming JSON against the Pydantic model at runtime and returns a `422 Unprocessable Entity` automatically if the body is malformed. Hono does not — `c.req.json()` returns a plain JavaScript object, and the `as CdsHooksRequest` TypeScript cast is compile-time only. The CRD route handler in `src/routes/crd.ts` performs its own field presence checks (Step 9.2 in the spec) to fill this gap.

**404 handling:**

Both frameworks return HTTP 404 automatically for unregistered routes — no manual handler needed in either app.

### 5.4 Summary: What Changes, What Stays the Same

When moving from working on `provider-ehr` to working on `payer-crd`, the conceptual model is the same:

- A process listens on a port (Uvicorn / `Bun.serve()`)
- An application object routes requests to handlers (FastAPI app / Hono app)
- Handlers read the request and return a structured response

What changes is where responsibility lives. In the Python stack, routing, validation, and serialization are handled by the framework (FastAPI + Pydantic). In the Bun/Hono stack, the framework handles routing and response serialization, but input validation is the application code's job.

---

## Part 6: Implementation — Build Sequence Step 1

Read Parts 1–5 before beginning. Each phase below produces something you can verify before proceeding to the next.

**Reference:** `docs/spec/payer-crd-spec.md` Section 4 (project structure) and Section 14 Step 1.

---

### Phase 1: Install Bun on macOS Apple Silicon

#### Step 1 — Install Bun via the official installer

Open a new Terminal window (Apple Terminal, zsh). Run the official install script:

```zsh
curl -fsSL https://bun.sh/install | bash
```

The installer:
1. Downloads the Apple Silicon (`aarch64`) build of Bun
2. Places the `bun` binary at `~/.bun/bin/bun`
3. Appends a `PATH` entry to your `~/.zshrc`

After the installer completes, reload your shell config:

```zsh
source ~/.zshrc
```

**Verify:**

```zsh
bun --version
```

Expected: a version string such as `1.x.x`. Any `1.x` release is acceptable.

If the command is not found, confirm that `~/.bun/bin` is in `$PATH`:

```zsh
echo $PATH | tr ':' '\n' | grep bun
```

If the line is missing, add it manually and reload:

```zsh
echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

#### Step 2 — Confirm native ARM64 binary

Bun on Apple Silicon runs natively (not under Rosetta). Confirm:

```zsh
file $(which bun)
```

Expected output includes `arm64`. If it shows `x86_64`, the wrong build was installed — reinstall from a shell that is not running under Rosetta.

#### Step 3 — Install the VS Code Bun extension (optional but recommended)

In VS Code, install the **Bun for Visual Studio Code** extension (publisher: `oven-bun`). It adds:
- Bun-specific debugger integration
- Correct `bun test` output parsing in the Test Explorer

The TypeScript language server built into VS Code handles type checking automatically once `tsconfig.json` is in place — no separate TypeScript extension is required for this project.

---

### Phase 2: Create the Directory Structure

#### Step 4 — Navigate to the project root

```zsh
cd ~/swdev/cps/fhir-crd-demo/payer-crd
```

All subsequent commands in this section run from `payer-crd/`.

#### Step 5 — Create the source directories

The `payer-crd/` directory currently contains only a legacy `public/` placeholder and an empty `src/`. Create the full structure prescribed by the spec:

```zsh
mkdir -p src/routes src/rules src/cards src/types
mkdir -p fixtures
mkdir -p tests/rules tests/routes
```

**Verify:**

```zsh
find . -type d | sort
```

Expected output (`.git` and `node_modules` excluded):

```
.
./fixtures
./public
./src
./src/cards
./src/routes
./src/rules
./src/types
./tests
./tests/routes
./tests/rules
```

---

### Phase 3: Initialize `package.json` and Install Dependencies

#### Step 6 — Initialize `package.json`

```zsh
bun init -y
```

`bun init -y` creates `package.json` with default values and skips interactive prompts. It also creates `tsconfig.json` and a stub `index.ts` — you will replace both in later steps.

**Inspect the generated file:**

```zsh
cat package.json
```

Bun generates something similar to:

```json
{
  "name": "payer-crd",
  "module": "index.ts",
  "type": "module",
  "devDependencies": {
    "@types/bun": "latest"
  }
}
```

#### Step 7 — Add the `scripts` block

Open `package.json` and replace its contents with the following. This sets the project name, removes the `"module"` field (not needed), and adds the three scripts from the spec:

```json
{
  "name": "payer-crd",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev":   "bun run --watch src/index.ts",
    "start": "bun run src/index.ts",
    "test":  "bun test"
  },
  "devDependencies": {
    "@types/bun": "latest"
  }
}
```

#### Step 8 — Install Hono

```zsh
bun add hono
```

This adds `hono` to `dependencies` in `package.json`, downloads it into `node_modules/`, and writes the version to `bun.lockb`.

**Verify the installed version:**

```zsh
bun pm ls | grep hono
```

Expected: a line showing `hono` with a `4.x.x` version. Hono follows semver; any `4.x` release is compatible.

**Verify `package.json` was updated:**

```zsh
cat package.json
```

The `dependencies` section should now include `"hono": "^4.x.x"`.

#### Step 9 — Run `bun install` to finalize the lockfile

```zsh
bun install
```

This resolves all dependencies (including `@types/bun` from `devDependencies`) and writes the final `bun.lockb`. After this command, your `node_modules/` is complete.

**Verify:**

```zsh
ls node_modules | grep hono
ls node_modules | grep bun
```

Both `hono` and `@types` (containing `bun`) should appear.

---

### Phase 4: Configure TypeScript

#### Step 10 — Replace `tsconfig.json`

`bun init` generates a minimal `tsconfig.json`. Replace it with the configuration from Part 4:

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "types": ["bun-types"],
    "lib": ["ESNext"],
    "outDir": "dist",
    "skipLibCheck": true
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

#### Step 11 — Create a minimal `src/index.ts` to verify TypeScript resolution

`bun init` creates an `index.ts` at the project root. Delete it and create the file at the correct path:

```zsh
rm -f index.ts
```

Create `src/index.ts` with the following minimal content. This is a placeholder that will be replaced in Build Sequence Step 4, but it verifies that Bun, Hono, and TypeScript all resolve correctly:

```typescript
import { Hono } from 'hono';

const app = new Hono();

app.get('/', (c) => c.text('payer-crd starting up'));

const port = Number(Bun.env.PORT) || 8080;

Bun.serve({
  port,
  fetch: app.fetch,
});

console.log(`Payer CRD listening on port ${port}`);
```

**Verify TypeScript resolves without errors:**

```zsh
bunx tsc --noEmit
```

Expected: no output (no errors). Any error at this stage is a configuration problem — the most common causes are shown in Appendix B.

---

### Phase 5: Environment Files

#### Step 12 — Populate `.env`

An empty `.env` already exists in `payer-crd/`. Populate it with the local development values:

```
APP_ENV=development
LOG_LEVEL=DEBUG
PAYER_NAME=Demo Payer CRD Service
PAYER_BASE_URL=http://localhost:8080
PORT=8080
```

`.env` is not committed to git. Confirm it is excluded:

```zsh
grep -r "\.env$" ../.gitignore 2>/dev/null || grep -r "\.env$" .gitignore 2>/dev/null || echo "check .gitignore manually"
```

#### Step 13 — Create `.env.example`

Create `payer-crd/.env.example` with the same keys but no values (or placeholder strings):

```
APP_ENV=development
LOG_LEVEL=DEBUG
PAYER_NAME=
PAYER_BASE_URL=
PORT=8080
```

`.env.example` is committed to git. It documents the required variables without exposing real values.

---

### Phase 6: End-to-End Verification

#### Step 14 — Start the development server

```zsh
bun run dev
```

Expected output:

```
Payer CRD listening on port 8080
```

The server watches source files and restarts when they change.

#### Step 15 — Test the server from a second Terminal tab

Open a second Terminal window or tab (`Cmd+T`). From any directory:

```zsh
curl -i http://localhost:8080/
```

Expected response:

```
HTTP/1.1 200 OK
content-type: text/plain;charset=UTF-8
...

payer-crd starting up
```

#### Step 16 — Verify 404 for unknown routes

```zsh
curl -i http://localhost:8080/unknown-path
```

Expected: HTTP 404. Hono returns this automatically.

#### Step 17 — Stop the server

Return to the first Terminal tab and press `Ctrl+C`.

Build Sequence Step 1 is complete. The project has a verified directory structure, working `package.json` with Hono installed, correct `tsconfig.json`, and a running dev server.

**Proceed to Build Sequence Step 2:** Populate `.env` keys (already done in Step 12 above) and continue to Step 3 (TypeScript interfaces).

---

## Appendix A: OCI Lift-and-Shift Deployment

This section covers the additional considerations for deploying the `payer-crd` service to an Oracle Cloud Infrastructure (OCI) VM running Oracle Linux or Ubuntu. The Bun application code itself does not change.

### A.1 Install Bun on the OCI VM

Bun's Linux installer is the same curl command as macOS:

```bash
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc   # or ~/.zshrc if zsh is the default shell
bun --version
```

On OCI's Oracle Linux 8/9, `curl` is available by default. On Ubuntu, `curl` is typically pre-installed; if not: `sudo apt install -y curl`.

**Architecture note:** OCI VMs come in two shapes — AMD64 (`x86_64`) and ARM64 (Ampere A1). Bun's installer detects the architecture automatically and downloads the correct binary. On an Ampere A1 VM (ARM64), Bun runs natively — this is the same silicon family as Apple Silicon and performance characteristics are similar.

### A.2 Copying the Project to the VM

Use `rsync` or `scp` from your Mac to transfer the project. The most important exclusion is `node_modules/` — never transfer it:

```zsh
rsync -avz --exclude='node_modules' --exclude='.env' \
  ~/swdev/cps/fhir-crd-demo/payer-crd/ \
  opc@<vm-ip>:~/payer-crd/
```

On the VM, run `bun install` to reinstall dependencies from `bun.lockb`:

```bash
cd ~/payer-crd
bun install
```

Create `.env` on the VM manually with production values (do not transfer `.env` from your Mac).

### A.3 Running as a Long-lived Process

For development on the VM, `bun run start` is sufficient. For a persistent service that survives SSH disconnection and restarts on reboot, use `systemd`:

Create `/etc/systemd/system/payer-crd.service`:

```ini
[Unit]
Description=Payer CRD Service
After=network.target

[Service]
Type=simple
User=opc
WorkingDirectory=/home/opc/payer-crd
ExecStart=/home/opc/.bun/bin/bun run src/index.ts
EnvironmentFile=/home/opc/payer-crd/.env
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable payer-crd
sudo systemctl start payer-crd
sudo systemctl status payer-crd
```

### A.4 Firewall and Port Configuration

OCI VMs have two layers of network control:

1. **OCI Security List or Network Security Group (NSG):** Configured in the OCI Console. Open TCP port 8080 (or whichever port `PORT` is set to) for inbound traffic from the Python EHR's IP.

2. **OS-level firewall (`firewalld` on Oracle Linux):**

```bash
sudo firewall-cmd --permanent --add-port=8080/tcp
sudo firewall-cmd --reload
```

On Ubuntu, use `ufw`:

```bash
sudo ufw allow 8080/tcp
```

### A.5 Updating the Python EHR to Point at the OCI VM

When the payer runs on OCI instead of `localhost`, update the Python EHR's `provider-ehr/.env`:

```
CRD_SERVICE_URL=http://<vm-public-ip>:8080/cds-services/crd-order-sign
```

No code changes are needed — `config.py` reads this from the environment.

---

## Appendix B: Common Setup Errors

| Error | Likely cause | Fix |
|-------|-------------|-----|
| `bun: command not found` | `~/.bun/bin` not in `$PATH` | Add `export PATH="$HOME/.bun/bin:$PATH"` to `~/.zshrc` and run `source ~/.zshrc` |
| `Cannot find module 'hono'` from TypeScript | `bun install` not run, or ran from wrong directory | `cd payer-crd && bun install` |
| `tsc --noEmit` error: `Cannot find name 'Bun'` | `@types/bun` missing or `types` not set in `tsconfig.json` | Confirm `"types": ["bun-types"]` is in `compilerOptions`; run `bun install` |
| `tsc --noEmit` error: `moduleResolution` | Wrong `moduleResolution` value | Set `"moduleResolution": "bundler"` in `tsconfig.json` |
| `bun run dev` exits immediately | Syntax error in `src/index.ts` | Check the terminal output for the TypeScript parse error |
| `curl` returns `Connection refused` | Server is not running, or wrong port | Confirm `bun run dev` is running in the first terminal tab; confirm `PORT` matches |
| `bun.lockb` conflict in git | Two developers ran `bun add` with different versions | Accept the newer `bun.lockb` and run `bun install` to sync |
