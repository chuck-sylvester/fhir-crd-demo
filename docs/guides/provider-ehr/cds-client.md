# CDS Client — Learning Guide and Implementation Reference

For `provider-ehr/app/cds_client.py`

---

## How to Use This Document

This document has two parts:

**Part 1 — Learning Reference (Sections 1–6):** Explains the Python and library concepts required to implement `cds_client.py` from first principles, using simple examples unrelated to the project. Read these sections before writing any code. Each concept is illustrated on its own so it is clear in isolation before you apply it to the project.

**Part 2 — Implementation Guide (Section 7):** Steps through building `cds_client.py` for the Provider EHR application. The steps are organized into phases. Each phase produces something verifiable before you move to the next one. Code blocks are complete and ready to copy.

**Prerequisites:** You should have already implemented `models.py` (guide: `docs/guides/pydantic-models.md`) and `fhir_factory.py` (guide: `docs/guides/fhir-factory.md`). Both are assumed to be complete and working before beginning this guide.

---

## Part 1: What an HTTP Client Module Is

### 1.1 The Pattern

An **HTTP client module** is a module whose job is to take a prepared, structured request object, transmit it over HTTP to an external service, and return a parsed structured response object. The caller does not know or care how the HTTP connection is made — it calls the function and gets back a typed result.

`cds_client.py` is an HTTP client module: it accepts a `CdsHooksRequest` model, serializes it to JSON, posts it to the payer endpoint, deserializes the response JSON into a `CdsHooksResponse` model, and returns that model. It also records what it sent and what it received into module-level variables so the debug routes can expose them.

This design separates concerns cleanly:

- `fhir_factory.py` knows how to build the request — it knows nothing about networking
- `cds_client.py` knows how to transmit the request — it knows nothing about how the request was built
- The routes know how to render the response — they know nothing about how it arrived

A minimal example of the pattern:

```python
# weather_client.py — fetches weather data from an external API

import httpx

async def get_temperature(city: str) -> float:
    async with httpx.AsyncClient() as client:
        response = await client.get(f"https://api.example.com/weather?city={city}")
        response.raise_for_status()
        data = response.json()
        return data["temperature"]
```

The caller calls `get_temperature("Springfield")` and receives a float. The HTTP mechanics are hidden inside the module.

---

## Part 2: Async/Await in Python

### 2.1 The Problem Async Solves

When a Python function makes a network request, the program must wait for the remote server to respond before the function can continue. In a synchronous program, this wait blocks the entire Python process — no other code can run while the network call is in flight. In a web server handling many concurrent requests, blocking is costly: a 200 ms network call that blocks means the server is idle for 200 ms per request.

Python's `async`/`await` feature solves this by allowing Python to switch to other work while waiting for I/O. Instead of blocking, an async function **suspends** at the `await` point, yields control back to the event loop, and **resumes** when the I/O completes. Other requests can be handled during that pause.

### 2.2 `async def` and `await`

A function declared with `async def` is called a **coroutine function**. Calling it does not run the function — it returns a coroutine object. The coroutine runs when you `await` it.

```python
import asyncio

async def greet(name: str) -> str:
    return f"Hello, {name}"

# You cannot call a coroutine like a regular function from synchronous code
# result = greet("Alice")   # This returns a coroutine object, NOT the string

# You must await it inside another async function
async def main():
    result = await greet("Alice")
    print(result)   # Hello, Alice

asyncio.run(main())
```

Rules:
- `await` can only be used inside an `async def` function
- Any function that does I/O and needs to be non-blocking should be declared `async def`
- FastAPI automatically handles the event loop — you declare your route handlers as `async def` and FastAPI runs them correctly

### 2.3 Why `cds_client.py` Uses Async

The `send_crd_request` function makes an outgoing HTTP call to the PHP payer. This is a network I/O operation. Declaring it `async def` and using `await` for the HTTPX call means the FastAPI server can continue handling other requests while waiting for the payer to respond — it does not freeze.

The getter functions (`get_last_request`, `get_last_response`) perform no I/O — they just return a variable. They are declared as regular synchronous functions.

---

## Part 3: HTTPX — the Async HTTP Client

### 3.1 What HTTPX Is

**HTTPX** is a modern Python HTTP client library. It is the async-capable successor to the widely used `requests` library. The `requests` library is synchronous and cannot be used with `await`. HTTPX supports both synchronous and asynchronous usage, and is the HTTP client chosen for this project.

HTTPX is already installed in this project (`requirements.txt` includes `httpx`). No additional installation is needed.

### 3.2 The `AsyncClient` Context Manager

The standard way to use HTTPX asynchronously is with `httpx.AsyncClient` as a context manager. The `async with` block opens a connection pool, runs the body, then cleanly closes all connections when the block exits — even if an exception is raised.

```python
import httpx

async def fetch_data(url: str) -> dict:
    async with httpx.AsyncClient() as client:
        response = await client.get(url)
        return response.json()
```

`async with` is the async version of `with`. The `__aenter__` and `__aexit__` methods of `AsyncClient` are coroutines, so they require the `async` prefix.

### 3.3 Making a POST Request with a JSON Body

`client.post()` sends an HTTP POST request. The `json=` parameter accepts a Python dictionary and handles JSON serialization and the `Content-Type: application/json` header automatically:

```python
import httpx

async def create_item(url: str, payload: dict) -> dict:
    async with httpx.AsyncClient() as client:
        response = await client.post(url, json=payload)
        return response.json()
```

This is equivalent to manually serializing with `json.dumps()` and setting the header, but more concise and less error-prone.

### 3.4 Setting a Timeout

Network requests can hang if the remote server is slow or unreachable. Always set a timeout so the call fails fast and returns a clear error rather than blocking indefinitely.

Pass `timeout=` as a float representing seconds:

```python
response = await client.post(url, json=payload, timeout=10.0)
```

A timeout of `10.0` means HTTPX will raise `httpx.TimeoutException` if the server does not respond within 10 seconds. `TimeoutException` is a subclass of `httpx.RequestError`, which is the error type the spec instructs you to let propagate.

### 3.5 Reading the Response

| Operation | Code | Returns |
|-----------|------|---------|
| HTTP status code | `response.status_code` | `int` (e.g. `200`, `404`) |
| Response body as dict | `response.json()` | `dict` |
| Response body as text | `response.text` | `str` |
| Response headers | `response.headers` | dict-like object |

`response.json()` parses the response body as JSON and returns a Python dictionary. It does not validate the shape of the response — that is Pydantic's job, done in the next step.

---

## Part 4: HTTP Error Handling with HTTPX

### 4.1 Two Categories of Error

HTTPX distinguishes two categories of HTTP error:

**`httpx.RequestError`** — a transport-level failure. The request never reached the server, or no response arrived. Examples:
- The server is not running (`Connection refused`)
- A DNS lookup failed
- The request timed out

**`httpx.HTTPStatusError`** — the server responded, but with a non-2xx status code (4xx client error, 5xx server error). The response arrived; the error is in its content.

These two categories require different handling in production code. For Phase 1, the spec says to let both propagate — the route handler can catch them and render an error message to the clinician.

### 4.2 `raise_for_status()`

By default, HTTPX does **not** raise an exception when the server returns a 4xx or 5xx status code. It returns the response object normally, and your code would need to check `response.status_code` manually.

`response.raise_for_status()` is a convenience method that raises `httpx.HTTPStatusError` if the status code indicates an error. Call it immediately after receiving the response, before reading the body:

```python
async def fetch_with_error_check(url: str) -> dict:
    async with httpx.AsyncClient() as client:
        response = await client.get(url)
        response.raise_for_status()   # raises HTTPStatusError on 4xx or 5xx
        return response.json()        # only reached if status was 2xx
```

`HTTPStatusError` carries the response object so you can inspect the status code and body in an except handler:

```python
try:
    response = await client.post(url, json=payload, timeout=10.0)
    response.raise_for_status()
except httpx.HTTPStatusError as exc:
    print(exc.response.status_code)   # e.g. 500
    print(exc.response.text)          # the error body
```

### 4.3 Error Handling Strategy for `cds_client.py`

The spec instructs `send_crd_request` to:
- Let `httpx.RequestError` propagate (payer unreachable)
- Let `httpx.HTTPStatusError` propagate (payer returned non-2xx)

This means `cds_client.py` does **not** catch these exceptions. It calls `raise_for_status()` and then returns normally. The caller (the route handler in `routes/clinician.py`) is responsible for catching them and rendering an error message. This keeps the CDS client focused on the happy path.

---

## Part 5: Module-Level State

### 5.1 What Module-Level State Is

A **module-level variable** is a variable declared at the top level of a Python file — outside any class or function. It is initialized once when the module is first imported, and then lives in memory for the entire lifetime of the running process.

```python
# counter.py

_count: int = 0   # module-level variable; initialized to 0 at import time

def increment():
    global _count
    _count += 1

def get_count() -> int:
    return _count
```

Any code that imports `counter` and calls `increment()` changes the same `_count`. The state persists between calls within one server session.

### 5.2 The `global` Keyword

When you assign to a variable inside a function, Python creates a **local** variable by default. It does not modify the module-level variable with the same name. To assign to a module-level variable from inside a function, declare it as `global` first:

```python
_value = "original"

def update():
    global _value          # tell Python we mean the module-level _value
    _value = "updated"     # now this modifies the module-level variable

def read():
    return _value          # reading works without global; Python looks up the scope chain

update()
print(read())              # "updated"
```

Without the `global` declaration, the assignment `_value = "updated"` inside `update()` would create a new local variable and leave the module-level `_value` unchanged.

### 5.3 Why `cds_client.py` Uses Module-Level State

`cds_client.py` stores the last outgoing request and last incoming response in two module-level variables (`_last_request` and `_last_response`). The debug routes call `get_last_request()` and `get_last_response()` to retrieve these for display.

This is a deliberate simplification appropriate for a demo application. In a production system you might store this state in a database, a cache, or structured logging — but for Phase 1, module-level state is simple, requires no infrastructure, and works correctly for a single-process development server.

The convention of prefixing with an underscore (`_last_request`, not `last_request`) signals that these are internal implementation details of the module — external callers should use the getter functions, not import the variables directly.

---

## Part 6: Serializing a Pydantic Model to a JSON-Compatible Dictionary

### 6.1 What "JSON-Compatible Dictionary" Means

HTTPX's `json=` parameter accepts a Python dictionary and serializes it to a JSON string internally. This means the value you pass to `json=` must be a plain Python dictionary containing only JSON-serializable types — strings, numbers, booleans, `None`, lists, and other plain dicts.

A Pydantic model instance is **not** a plain dictionary. You must serialize it first. The correct method is `model_dump(by_alias=True)`:

```python
from app.models import CdsHooksRequest

# WRONG — a Pydantic model is not a plain dict
response = await client.post(url, json=my_cds_request)   # TypeError

# CORRECT — serialize to a plain dict with camelCase keys
wire_payload = my_cds_request.model_dump(by_alias=True)
response = await client.post(url, json=wire_payload)
```

### 6.2 Why `by_alias=True` Is Required

The Pydantic models in this project use `alias_generator=to_camel` so that Python attributes are snake_case and JSON keys are camelCase. Without `by_alias=True`, `model_dump()` returns a dict with snake_case keys (`hook_instance`, `fhir_server`) — which is not what the CDS Hooks specification requires. With `by_alias=True`, it returns camelCase keys (`hookInstance`, `fhirServer`) as expected by the payer.

This was covered in the Pydantic Models guide (Section 3.6) and verified in the FHIR Factory guide (Step 9). In `cds_client.py`, calling `model_dump(by_alias=True)` is the critical step that bridges the Python-facing model and the JSON wire format.

---

## Part 7: Implementation — `provider-ehr/app/cds_client.py`

Read Parts 1–6 before beginning. Each step below produces something you can verify before moving to the next step.

**Reference documents:**
- `docs/spec/provider-ehr-spec.md` Section 9 — function signatures and responsibilities
- `docs/spec/cds-hooks-api-contract.md` Section 4 — the CDS Hooks endpoint and JSON contract

---

### Phase 1: File Setup

#### Step 1 — Create the file and add imports

`cds_client.py` already exists as an empty file at `provider-ehr/app/cds_client.py`. Open it and add the following content. These are all the imports and module-level declarations the complete module requires.

```python
import httpx

from app.config import settings
from app.models import CdsHooksRequest, CdsHooksResponse

_last_request: dict | None = None
_last_response: dict | None = None
```

**What each import does:**

| Import | Purpose |
|--------|---------|
| `httpx` | Async HTTP client for sending the CDS Hooks request to the payer |
| `settings` (from `app.config`) | Provides `settings.payer_crd_url` — the base URL of the PHP payer |
| `CdsHooksRequest` (from `app.models`) | The Pydantic model accepted by `send_crd_request` |
| `CdsHooksResponse` (from `app.models`) | The Pydantic model returned by `send_crd_request` |

**What the module-level variables do:**

| Variable | Initial value | Purpose |
|----------|--------------|---------|
| `_last_request` | `None` | Holds the last outgoing request payload as a serialized dict |
| `_last_response` | `None` | Holds the last incoming response payload as a parsed dict |

Both start as `None` at server startup. They remain `None` until the first CRD request is made in the current server session.

**Verify:** Open a Python shell from `provider-ehr/` (virtual environment activated) and confirm the imports resolve:

```python
import httpx
from app.config import settings
from app.models import CdsHooksRequest, CdsHooksResponse
print("imports OK")
print(settings.payer_crd_url)   # Should print http://localhost:8080
```

If `settings.payer_crd_url` raises a validation error, check that your `.env` file contains `PAYER_CRD_URL=http://localhost:8080`.

---

### Phase 2: Getter Functions

#### Step 2 — Implement `get_last_request` and `get_last_response`

These two functions are the read-only public interface to the module-level state. They return the stored dict (or `None` if no request has been made yet). They are synchronous — no I/O, no `async`.

Add them below the module-level variable declarations:

```python
def get_last_request() -> dict | None:
    return _last_request


def get_last_response() -> dict | None:
    return _last_response
```

**Design note:** The getters exist so that the debug routes import `get_last_request` and `get_last_response`, not `_last_request` and `_last_response`. Exposing the variables directly would allow callers to accidentally mutate them. Getter functions expose the values as read-only.

**Verify:** From a Python shell in `provider-ehr/`:

```python
from app.cds_client import get_last_request, get_last_response

print(get_last_request())    # None — no request made yet
print(get_last_response())   # None — no response received yet
```

---

### Phase 3: The CDS Request Function

#### Step 3 — Implement `send_crd_request`

This is the primary public function of the module. Add it below the getter functions:

```python
async def send_crd_request(request: CdsHooksRequest) -> CdsHooksResponse:
    global _last_request, _last_response

    url = settings.payer_crd_url + "/cds-services/crd-order-sign"
    payload = request.model_dump(by_alias=True)

    async with httpx.AsyncClient() as client:
        response = await client.post(url, json=payload, timeout=10.0)
        response.raise_for_status()

    _last_request = payload
    _last_response = response.json()

    return CdsHooksResponse.model_validate(_last_response)
```

**Walk-through of each step in the function:**

| Line(s) | What it does |
|---------|-------------|
| `global _last_request, _last_response` | Declares that assignments to these names within this function modify the module-level variables, not local ones |
| `url = settings.payer_crd_url + "/cds-services/crd-order-sign"` | Constructs the full payer endpoint URL from the configured base URL; no trailing slash on `payer_crd_url` means simple string concatenation works correctly |
| `payload = request.model_dump(by_alias=True)` | Serializes the Pydantic model to a plain dict with camelCase keys, as required by the CDS Hooks specification and the payer |
| `async with httpx.AsyncClient() as client:` | Opens a connection pool that is cleanly closed after the block |
| `await client.post(url, json=payload, timeout=10.0)` | Sends the POST request with the JSON body; suspends until the payer responds or 10 seconds elapse |
| `response.raise_for_status()` | Raises `httpx.HTTPStatusError` if the payer returned a 4xx or 5xx status; does nothing on 2xx |
| `_last_request = payload` | Stores the outgoing payload for the debug route; assigned after the request completes so it always reflects what was actually sent |
| `_last_response = response.json()` | Parses the response body to a dict and stores it for the debug route |
| `CdsHooksResponse.model_validate(_last_response)` | Parses the response dict into the typed `CdsHooksResponse` model, including all nested `CdsCard`, `CdsSource`, and `CdsLink` objects |

**Note on `global` placement:** The `global` declaration must appear before any assignment to the variable within the function. The convention is to place it at the very top of the function body. Reading a module-level variable (without assigning to it) does not require `global` — Python looks up the scope chain automatically. The `global` keyword is only required for assignments.

**Note on error propagation:** `send_crd_request` does not catch `httpx.RequestError` or `httpx.HTTPStatusError`. Both propagate to the route handler. This is intentional — the route handler is the right place to decide how to present errors to the clinician. Catching and re-raising errors inside `cds_client.py` would add complexity without benefit.

**Note on `_last_request` assignment placement:** `_last_request` is assigned **after** `raise_for_status()`. This means if the payer returns an error, `_last_request` is **not** updated — it retains the value from the previous successful request. An alternative would be to store the payload before the request. Both approaches are reasonable; this guide follows the spec, which does not prescribe ordering.

---

### Phase 4: Verification

#### Step 4 — Verify the module imports cleanly

From `provider-ehr/` with the virtual environment activated:

```bash
python -c "from app.cds_client import send_crd_request, get_last_request, get_last_response; print('cds_client.py OK')"
```

Expected output: `cds_client.py OK`

Any `ImportError` or `SyntaxError` indicates a problem in the file. Fix it before continuing.

---

#### Step 5 — Verify module-level state at startup

Confirm both variables are `None` immediately after import:

```python
from app.cds_client import get_last_request, get_last_response

assert get_last_request() is None, "Expected None before first request"
assert get_last_response() is None, "Expected None before first response"
print("Startup state: OK")
```

---

#### Step 6 — Verify the URL construction

The target URL is assembled from `settings.payer_crd_url` and the path suffix. Verify the result without making a network call:

```python
from app.config import settings

expected_url = settings.payer_crd_url + "/cds-services/crd-order-sign"
print(expected_url)   # Should print: http://localhost:8080/cds-services/crd-order-sign

assert expected_url == "http://localhost:8080/cds-services/crd-order-sign"
print("URL construction: OK")
```

---

#### Step 7 — Verify `send_crd_request` with the live payer (manual)

This step requires the PHP payer to be running. Start it first:

```bash
brew services start php
brew services start httpd
```

Then trigger a real request from a Python shell in `provider-ehr/`:

```python
import asyncio
from app.fhir_factory import build_crd_request
from app.cds_client import send_crd_request, get_last_request, get_last_response
from app.models import CdsHooksResponse

async def run():
    request = build_crd_request()
    response = await send_crd_request(request)

    # Verify return type
    assert isinstance(response, CdsHooksResponse), "Expected CdsHooksResponse"

    # Verify at least one card was returned
    assert len(response.cards) > 0, "Expected at least one CDS Card"
    print(f"Cards received: {len(response.cards)}")
    print(f"First card indicator: {response.cards[0].indicator}")
    print(f"First card summary: {response.cards[0].summary}")

    # Verify module-level state was updated
    assert get_last_request() is not None, "_last_request was not updated"
    assert get_last_response() is not None, "_last_response was not updated"

    # Confirm _last_request has camelCase keys (as sent on the wire)
    assert "hookInstance" in get_last_request()
    assert "fhirServer" in get_last_request()
    assert "hook_instance" not in get_last_request()

    print("send_crd_request: all assertions passed")

asyncio.run(run())
```

Expected output: cards printed and all assertions passed. If the payer is not running, you will see `httpx.ConnectError` — that is the expected error behavior.

---

#### Step 8 — Verify error propagation when payer is unreachable (manual)

Stop the PHP payer and confirm the correct error is raised:

```bash
brew services stop httpd
brew services stop php
```

Then from the Python shell:

```python
import asyncio
import httpx
from app.fhir_factory import build_crd_request
from app.cds_client import send_crd_request

async def run():
    request = build_crd_request()
    try:
        await send_crd_request(request)
        print("ERROR: Expected an exception but none was raised")
    except httpx.RequestError as exc:
        print(f"Correctly raised httpx.RequestError: {type(exc).__name__}")
    except Exception as exc:
        print(f"Unexpected exception type: {type(exc).__name__}: {exc}")

asyncio.run(run())
```

Expected output: `Correctly raised httpx.RequestError: ConnectError` (or similar `RequestError` subclass). Restart the payer when done.

---

## Appendix A: Complete `cds_client.py`

The full module after all steps are complete:

```python
import httpx

from app.config import settings
from app.models import CdsHooksRequest, CdsHooksResponse

_last_request: dict | None = None
_last_response: dict | None = None


def get_last_request() -> dict | None:
    return _last_request


def get_last_response() -> dict | None:
    return _last_response


async def send_crd_request(request: CdsHooksRequest) -> CdsHooksResponse:
    global _last_request, _last_response

    url = settings.payer_crd_url + "/cds-services/crd-order-sign"
    payload = request.model_dump(by_alias=True)

    async with httpx.AsyncClient() as client:
        response = await client.post(url, json=payload, timeout=10.0)
        response.raise_for_status()

    _last_request = payload
    _last_response = response.json()

    return CdsHooksResponse.model_validate(_last_response)
```

---

## Appendix B: Common Errors and What They Mean

| Error | Likely cause |
|-------|-------------|
| `httpx.ConnectError` | The payer is not running. Start Apache and PHP-FPM with `brew services start httpd` and `brew services start php` |
| `httpx.TimeoutException` | The payer is running but did not respond within 10 seconds. Check the PHP error log |
| `httpx.HTTPStatusError` with status 404 | The URL path is wrong. Confirm the payer is configured with the correct virtual host and that `public/index.php` handles `POST /cds-services/crd-order-sign` |
| `httpx.HTTPStatusError` with status 500 | The payer returned an internal error. Check the PHP payer logs |
| `pydantic.ValidationError` on `model_validate` | The payer returned a response that does not match the `CdsHooksResponse` schema. Print `response.json()` to inspect the raw response |
| `ValidationError` on `settings.payer_crd_url` | `.env` is missing or does not contain `PAYER_CRD_URL`. Check the file exists in `provider-ehr/` |
| `TypeError: Object of type CdsHooksRequest is not JSON serializable` | `model_dump(by_alias=True)` was not called before passing to `json=`. Pass the result of `request.model_dump(by_alias=True)`, not the model instance |
| `AssertionError` on camelCase key check | `model_dump` was called without `by_alias=True`. The snake_case keys were sent to the payer instead of camelCase |

---

## Appendix C: Module Structure Quick Reference

```
cds_client.py
│
├── _last_request              dict | None — last outgoing payload (None at startup)
├── _last_response             dict | None — last incoming payload (None at startup)
│
├── get_last_request()         Returns _last_request; used by the debug route
├── get_last_response()        Returns _last_response; used by the debug route
│
└── send_crd_request(request)  ← primary public API (async)
                               Serializes CdsHooksRequest → camelCase dict
                               POSTs to {payer_crd_url}/cds-services/crd-order-sign
                               Calls raise_for_status() — propagates errors to caller
                               Stores payload in _last_request
                               Stores parsed response in _last_response
                               Returns CdsHooksResponse model instance
```

Only `send_crd_request`, `get_last_request`, and `get_last_response` are part of the public API. The module-level variables are implementation details. External callers import and use only the three functions.
