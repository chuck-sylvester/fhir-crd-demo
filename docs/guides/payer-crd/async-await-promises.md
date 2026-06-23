# Async/Await and Promises in TypeScript

This guide explains how asynchronous code works in TypeScript, from the underlying problem it solves through Promises, `async` functions, and the `await` keyword. Python comparisons are included throughout because the concepts map closely — the syntax and mental model transfer well.

---

## 1. The Problem: Slow I/O in a Fast Program

Modern CPUs execute billions of instructions per second. Network and disk I/O operate on a timescale millions of times slower. When your program asks for a file or makes an HTTP request, the CPU spends almost all of its time doing nothing — just waiting.

```
Timeline (not to scale)

CPU instruction:    ~0.3 ns  ──────|
L1 cache read:      ~1 ns    ──────────|
RAM read:           ~100 ns  ─────────────────────────────|
SSD read:           ~100 µs  (100,000× slower than RAM)
Network round-trip: ~50 ms   (50,000× slower than SSD)
```

There are two strategies for dealing with this wait:

### Blocking (synchronous)

Stop everything. Wait for the result. Resume.

```
Thread:  [build request]──[WAITING]──────────────────────[parse response]──[done]
                                     ↑
                              CPU is idle here
```

Simple to write, but wastes the CPU and can only handle one request at a time without threads.

### Non-blocking (asynchronous)

Start the I/O operation, register a callback for when it completes, and go do other work in the meantime.

```
Event loop:

  Task A:  [start I/O]·····················[resume]──[done]
                      ↑                   ↑
  Task B:             [runs here]──[done] |
  Task C:                                 [starts here]──...
```

The dots represent Task A waiting for I/O. The event loop fills that time with other work. No CPU cycles are wasted idling.

Both Python's `asyncio` and JavaScript's event loop use this non-blocking strategy. The keyword `await` is the marker in both languages that says: *"start this I/O and suspend me until it's ready."*

---

## 2. The Event Loop

Both Python and JavaScript/TypeScript are single-threaded at the application level. They handle concurrency through an **event loop**: a continuous cycle that picks up completed I/O events and resumes the functions that were waiting for them.

```
                    ┌────────────────────────────┐
                    │          Event Loop        │
                    │                            │
   Incoming I/O ──► │  ┌──────────────────────┐  │
   completions      │  │   Task / Microtask   │  │
                    │  │       Queue          │  │
                    │  └──────────┬───────────┘  │
                    │             │              │
                    │             ▼              │
                    │  ┌──────────────────────┐  │
                    │  │  Resume suspended    │  │
                    │  │  async function      │  │
                    │  └──────────────────────┘  │
                    └────────────────────────────┘
```

When a `Promise` resolves (e.g., a file read completes), the runtime places the continuation of the suspended `async` function onto the task queue. The event loop picks it up on the next iteration and resumes execution from the line after the `await`.

---

## 3. Promises: Representing a Future Value

A `Promise<T>` is TypeScript's way of saying: *"I don't have a `T` right now, but I will — either a value or an error."*

It is the TypeScript equivalent of Python's `asyncio.Future` or the return value of any `async def` function (a coroutine object).

### Promise States

A Promise is always in exactly one of three states, and once it leaves `pending` it never changes:

```
                ┌─────────────┐
                │   pending   │  (initial state — I/O in progress)
                └──────┬──────┘
                       │
           ┌───────────┴───────────┐
           ▼                       ▼
  ┌─────────────────┐     ┌─────────────────┐
  │   fulfilled     │     │    rejected     │
  │  (has a value)  │     │  (has an error) │
  └─────────────────┘     └─────────────────┘
```

### Python comparison

| Concept | Python | TypeScript |
|---|---|---|
| Future value type | `Coroutine` / `asyncio.Future` | `Promise<T>` |
| Fulfilled | `future.set_result(value)` | `resolve(value)` |
| Rejected | `future.set_exception(err)` | `reject(err)` |
| Unwrap the value | `await future` | `await promise` |

### Constructing a Promise manually

You rarely construct Promises by hand — library functions return them for you. But seeing the constructor once makes the model concrete:

```ts
// TypeScript
const p = new Promise<number>((resolve, reject) => {
    // Simulate async work
    setTimeout(() => resolve(42), 1000);
});
```

```python
# Python — closest equivalent
loop = asyncio.get_event_loop()
future = loop.create_future()
loop.call_later(1.0, future.set_result, 42)
```

In both cases, `p` / `future` is a pending value that will be fulfilled with `42` after one second.

---

## 4. `async function` — What It Actually Does

Marking a function `async` does exactly two things:

1. Allows `await` to be used inside the function body.
2. Wraps the return value in a `Promise` automatically.

```ts
// TypeScript — these two are equivalent
async function double(n: number): Promise<number> {
    return n * 2;
}

function double(n: number): Promise<number> {
    return Promise.resolve(n * 2);
}
```

```python
# Python — same idea
async def double(n: int) -> int:
    return n * 2
# Calling double(5) gives you a coroutine, not 10.
# You must await it to get 10.
```

The declared return type in TypeScript is `Promise<number>` because the *caller* receives a Promise — the actual number lives inside it and must be unwrapped with `await`.

### Return type anatomy

```
Promise<Response>
│       │
│       └── The type of value inside the Promise once fulfilled
└────────── Wrapper that says "this value is not ready yet"
```

```
List[str]         ← Python generic equivalent
│    │
│    └── The type of items in the list
└─────── The container
```

TypeScript's `<T>` type parameter syntax maps directly to Python's `[T]` in generics like `List[T]`, `Dict[K, V]`, and `Optional[T]`.

---

## 5. `await` — Unwrapping a Promise

`await` suspends the current `async` function, registers a callback for when the Promise resolves, and yields control back to the event loop. When the Promise fulfills, execution resumes at the next line and `await` evaluates to the unwrapped value.

```ts
// TypeScript
async function loadFixture() {
    // Bun.file().json() returns Promise<unknown>
    const data = await Bun.file('fixtures/data.json').json();
    //    ^^^^                                              ^
    //    unwrapped value (the parsed JSON object)         returns a Promise
    return data;
}
```

```python
# Python
async def load_fixture():
    async with aiofiles.open('fixtures/data.json') as f:
        data = json.loads(await f.read())
    return data
```

### Execution timeline

```
loadFixture() called
        │
        ▼
  Bun.file().json() → returns Promise (I/O starts)
        │
      await ──────────────── suspends here
                              event loop runs other work
                              ...disk read completes...
      await ──────────────── resumes here
        │
        ▼
  data = parsed JSON object
        │
        ▼
  return data (wrapped in Promise<unknown> automatically)
```

### The one rule

`await` can only appear inside an `async` function. Writing it at the top level or inside a regular function is a TypeScript compile error.

```ts
// ERROR — not inside an async function
const data = await Bun.file('data.json').json();

// OK — inside async function
async function load() {
    const data = await Bun.file('data.json').json();
}
```

Bun and modern Node support top-level `await` in ES modules, but inside application code (route handlers, etc.) you will always be inside an `async function`.

---

## 6. Error Handling

A rejected Promise is equivalent to an exception raised inside an `async def` in Python. You catch it with `try/catch`, which maps directly to Python's `try/except`:

```ts
// TypeScript
async function loadFixture(path: string) {
    try {
        const data = await Bun.file(path).json();
        return data;
    } catch (err) {
        console.error('Failed to load fixture:', err);
        throw err;  // re-raise, same as Python's bare "raise"
    }
}
```

```python
# Python
async def load_fixture(path: str):
    try:
        async with aiofiles.open(path) as f:
            return json.loads(await f.read())
    except Exception as err:
        print('Failed to load fixture:', err)
        raise
```

If you `await` a rejected Promise without a `try/catch`, the error propagates up the async call stack — exactly like an unhandled exception in Python. In Hono, unhandled errors in route handlers are caught by the framework and converted to 500 responses.

---

## 7. Running Multiple Awaits

### Sequential (default)

Each `await` waits for the previous one to finish before starting the next. Use this when the second operation depends on the first.

```ts
async function sequential() {
    const user    = await fetchUser(id);       // waits for user
    const profile = await fetchProfile(user);  // then fetches profile
    return profile;
}
```

```
Timeline:

fetchUser    ──────────────────────┤
fetchProfile                       ──────────────────────┤
Total time:  |────────────────────────────────────────────|
```

### Parallel with `Promise.all`

When operations are independent, run them simultaneously with `Promise.all`. It takes an array of Promises and returns a single Promise
that resolves when all of them fulfill.

```ts
async function parallel() {
    const [users, products] = await Promise.all([
        fetchUsers(),
        fetchProducts(),
    ]);
    return { users, products };
}
```

```
Timeline:

fetchUsers    ──────────────────────┤
fetchProducts ─────────────┤
Total time:   |────────────────────|   (limited by the slowest)
```

```python
# Python equivalent
users, products = await asyncio.gather(fetchUsers(), fetchProducts())
```

`Promise.all` rejects immediately if any of the Promises reject. Use `Promise.allSettled` if you want all results even when some fail.

---

## 8. The `.then()` / `.catch()` Style (Promise Chaining)

Before `async/await` was standardized, Promises were consumed by chaining `.then()` and `.catch()` callbacks. You will see this style in older code and documentation.

```ts
// Promise chain style (older)
Bun.file('data.json').json()
    .then((data) => {
        console.log(data);
    })
    .catch((err) => {
        console.error(err);
    });
```

```ts
// async/await style (modern equivalent)
try {
    const data = await Bun.file('data.json').json();
    console.log(data);
} catch (err) {
    console.error(err);
}
```

Both styles work. `async/await` is syntactic sugar built on top of `.then()`/`.catch()` — at runtime they compile down to the same Promise machinery. Modern TypeScript almost always prefers `async/await` because it reads like synchronous code and is easier to reason about.

---

## 9. Common Mistakes

### Forgetting `await`

```ts
// Bug: data is a Promise<unknown>, not the parsed JSON
const data = Bun.file('data.json').json();
console.log(data);  // logs: Promise { <pending> }

// Fix
const data = await Bun.file('data.json').json();
console.log(data);  // logs: { ... actual JSON ... }
```

Python raises a `RuntimeWarning: coroutine was never awaited`. TypeScript silently gives you the Promise object — no warning — which makes this mistake harder to spot.

### Using `forEach` with async callbacks

`Array.forEach` does not await async callbacks. Use `for...of` instead:

```ts
// Bug: forEach fires all async calls and doesn't wait for any
items.forEach(async (item) => {
    await processItem(item);  // not actually awaited by forEach
});

// Fix: for...of respects await
for (const item of items) {
    await processItem(item);
}

// Or: run all in parallel if order doesn't matter
await Promise.all(items.map((item) => processItem(item)));
```

### Async functions always return a Promise

Even if you return a plain value, the caller gets a Promise. You cannot call an `async` function and use its return value synchronously.

```ts
async function getValue(): Promise<number> {
    return 42;
}

// Bug: result is Promise<number>, not 42
const result = getValue();

// Fix
const result = await getValue();
```

---

## 10. Applied: `discovery.ts` Annotated

```ts
import type { Context } from 'hono';
// "import type" — only used for compile-time type checking, no runtime cost.
// Context is the Hono object that carries the request and response helpers.

export async function discoveryHandler(c: Context): Promise<Response> {
// async    — allows await inside; wraps return value in a Promise.
// c        — Hono's Context: access request data via c.req,
//            build responses via c.json(), c.text(), c.html(), etc.
// : Promise<Response> — the fulfilled value will be an HTTP Response object.

    const data = await Bun.file('fixtures/cds-discovery.json').json();
    // Bun.file().json() — reads file from disk and parses JSON.
    // Returns Promise<unknown>; await suspends until the read completes,
    // then data holds the parsed JavaScript object.

    return c.json(data, 200);
    // c.json(body, status) — serializes data to JSON, sets Content-Type,
    // returns a Response. Hono (the caller) awaits this Promise<Response>
    // and sends the resolved Response to the HTTP client.
}
```

### Full call chain

```
GET /cds-services arrives
        │
        ▼
Hono router calls await discoveryHandler(c)
        │
        ▼
Bun.file().json() → Promise<unknown>  (disk I/O starts)
        │
      await ──── event loop free for other requests ────
        │                                               │
        │         disk read completes                   │
      await ◄─────────────────────────────────────────┘
        │
        ▼
data = parsed cds-discovery.json object
        │
        ▼
c.json(data, 200) → Response
        │
        ▼
Hono sends HTTP 200 JSON response to the EHR client
```

---

## 11. Summary

| Concept | What it means | Python equivalent |
|---|---|---|
| `Promise<T>` | A value that will exist in the future | `asyncio.Future[T]` / coroutine return type |
| `async function` | Function that can use `await`; returns `Promise` | `async def` |
| `await expr` | Suspend until `expr`'s Promise resolves; evaluate to its value | `await expr` |
| `Promise.all([...])` | Run multiple Promises in parallel; wait for all | `asyncio.gather(...)` |
| `.then()` / `.catch()` | Older callback-based Promise API | `.add_done_callback()` |
| Rejected Promise | Promise that holds an error | Raised exception in a coroutine |

The mental model in one sentence: **`async`/`await` lets you write code that reads like sequential Python while the runtime handles non-blocking I/O underneath — `await` is the word you write wherever you want to pause and wait, and `Promise<T>` is TypeScript's label for "a `T` that isn't ready yet."**
