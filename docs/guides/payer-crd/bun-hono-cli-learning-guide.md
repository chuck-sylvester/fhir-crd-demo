# Bun + Hono Learning Guide for macOS

A practical guide for learning Bun and Hono, with an initial focus on terminal-based / command-line applications and a later path into web applications.

> Audience: a developer who already understands programming concepts and wants a hands-on path into modern JavaScript / TypeScript tooling using Bun, then Hono.

---

## Section 1 — Learning Material

### 1. What Bun Is

Bun is an all-in-one JavaScript and TypeScript toolkit. It can act as:

- A JavaScript / TypeScript runtime
- A package manager
- A script runner
- A test runner
- A bundler
- A development server for some app types

For your early learning, think of Bun as a more integrated alternative to using `node`, `npm`, `npx`, `ts-node`, `jest/vitest`, and a bundler as separate tools.

Common Bun commands:

```bash
bun --version
bun --revision
bun init
bun run index.ts
bun run dev
bun add hono
bun install
bun test
```

### 2. What Hono Is

Hono is a small, fast web framework built around Web Standards APIs. It works across multiple JavaScript runtimes, including Bun, Node.js, Deno, Cloudflare Workers, AWS Lambda, Vercel, and others.

For now, Hono is optional. You can learn Bun first by writing CLI tools. Later, Hono becomes useful when you want to expose your logic through HTTP endpoints.

A minimal Hono app looks like this:

```ts
import { Hono } from 'hono'

const app = new Hono()

app.get('/', (c) => {
  return c.text('Hello Hono')
})

export default app
```

### 3. Why This Stack Is Worth Exploring

Bun + Hono is attractive when you want:

- Fast startup time for small command-line tools
- TypeScript support without a complex setup
- Simple dependency management
- A lightweight web framework for APIs
- A path from local scripts to local web services
- A modern JavaScript environment without starting with React or Next.js

For your preferred development style, the natural progression is:

```text
small TypeScript scripts
  -> reusable CLI utilities
  -> CLI tools that read/write files
  -> CLI tools that call APIs
  -> Hono APIs that expose the same logic over HTTP
  -> optional web front ends later
```

### 4. Install Bun on macOS

#### Option A: Official install script

```bash
curl -fsSL https://bun.com/install | bash
```

Then restart your terminal, or source your shell profile if the installer modified it.

For `zsh`, which is the default shell on modern macOS:

```bash
source ~/.zshrc
```

Verify the installation:

```bash
bun --version
bun --revision
```

#### Option B: Homebrew

```bash
brew tap oven-sh/bun
brew install bun
```

Verify:

```bash
bun --version
```

### 5. Create a Workspace Folder

A clean folder structure helps you keep experiments organized.

```bash
mkdir -p ~/dev/bun-hono-lab
cd ~/dev/bun-hono-lab
```

Suggested structure:

```text
bun-hono-lab/
  01-hello-cli/
  02-args-cli/
  03-file-json-cli/
  04-api-client-cli/
  05-task-tracker-cli/
  06-hono-preview-api/
```

### 6. Create Your First Bun Project

```bash
mkdir 01-hello-cli
cd 01-hello-cli
bun init
```

Bun will create starter files such as:

```text
package.json
index.ts
README.md
tsconfig.json
```

Run the starter program:

```bash
bun run index.ts
```

You can also add a script to `package.json`:

```json
{
  "scripts": {
    "start": "bun run index.ts"
  }
}
```

Then run:

```bash
bun run start
```

### 7. TypeScript Basics You Need First

You do not need to master TypeScript before writing useful programs. Start with these concepts.

#### Variables

```ts
const name = 'Chuck'
let count = 1
```

Use `const` by default. Use `let` only when a value changes.

#### Function parameters and return types

```ts
function greet(name: string): string {
  return `Hello, ${name}`
}
```

#### Objects

```ts
type Patient = {
  id: string
  name: string
  birthDate?: string
}

const patient: Patient = {
  id: '123',
  name: 'Jane Doe'
}
```

The `?` means the field is optional.

#### Arrays

```ts
const names: string[] = ['Alice', 'Bob', 'Charlie']
```

#### Async functions

```ts
async function main(): Promise<void> {
  const response = await fetch('https://example.com')
  console.log(response.status)
}

main()
```

### 8. How Bun Handles CLI Arguments

Bun exposes command-line arguments through `Bun.argv`.

Example:

```ts
console.log(Bun.argv)
```

If you run:

```bash
bun run index.ts hello Chuck
```

You will see an array containing the Bun executable path, the script path, and your arguments.

A practical pattern is:

```ts
const args = Bun.argv.slice(2)
```

### 9. Reading and Writing Files

Bun supports Web-standard file APIs and also supports many Node-compatible APIs.

Simple file read:

```ts
const file = Bun.file('data/input.txt')
const text = await file.text()
console.log(text)
```

Simple file write:

```ts
await Bun.write('data/output.txt', 'Hello from Bun\n')
```

JSON file read:

```ts
const file = Bun.file('data/patient.json')
const patient = await file.json()
console.log(patient)
```

JSON file write:

```ts
const patient = {
  resourceType: 'Patient',
  id: 'example',
  name: [{ family: 'Smith', given: ['Jane'] }]
}

await Bun.write('data/patient.json', JSON.stringify(patient, null, 2))
```

### 10. Calling HTTP APIs

Bun supports `fetch`, which is also used in browser JavaScript and modern Node.js.

```ts
const response = await fetch('https://jsonplaceholder.typicode.com/todos/1')

if (!response.ok) {
  throw new Error(`HTTP error: ${response.status}`)
}

const data = await response.json()
console.log(data)
```

### 11. Environment Variables

Use environment variables for configuration values such as API URLs, tokens, and runtime settings.

Create `.env`:

```bash
API_BASE_URL=https://jsonplaceholder.typicode.com
```

Read it in Bun:

```ts
const apiBaseUrl = Bun.env.API_BASE_URL

if (!apiBaseUrl) {
  throw new Error('Missing API_BASE_URL')
}
```

Do not commit real secrets to GitHub.

Add this to `.gitignore`:

```text
.env
node_modules
bun.lock
```

You may choose to commit `bun.lock` for real projects to make dependency versions reproducible. For casual throwaway experiments, it is not critical.

### 12. Installing Dependencies

Install a package:

```bash
bun add hono
```

Install a development dependency:

```bash
bun add -d typescript
```

Install dependencies already listed in `package.json`:

```bash
bun install
```

### 13. Testing with Bun

Create `math.ts`:

```ts
export function add(a: number, b: number): number {
  return a + b
}
```

Create `math.test.ts`:

```ts
import { expect, test } from 'bun:test'
import { add } from './math'

test('add returns the sum of two numbers', () => {
  expect(add(2, 3)).toBe(5)
})
```

Run:

```bash
bun test
```

### 14. Recommended Learning Workflow

For each sample program:

1. Create a new folder.
2. Run `bun init`.
3. Write a small working version first.
4. Run it from the terminal.
5. Add one feature at a time.
6. Refactor repeated code into functions.
7. Add one or two tests after the code works.
8. Commit the working version to Git.

A good Git pattern:

```bash
git init
git add .
git commit -m "Initial Bun CLI project"
```

### 15. When to Introduce Hono

Start using Hono after you are comfortable with:

- Running TypeScript files with Bun
- Passing command-line arguments
- Reading and writing JSON files
- Calling APIs with `fetch`
- Structuring code into functions and modules

Then create a small Hono API that reuses logic from one of your CLI tools.

Create a Hono project:

```bash
bun create hono@latest 06-hono-preview-api --template bun
cd 06-hono-preview-api
bun install
bun run dev
```

Then open:

```text
http://localhost:3000
```

---

## Section 2 — Sample Programs and Applications

This section contains a sequence of small programs. Each one is designed to teach a specific capability.

---

### Program 1 — Hello CLI

#### Goal

Create a simple command-line program that prints a greeting.

#### Skills practiced

- Creating a Bun project
- Running a TypeScript file
- Using `console.log`
- Using `Bun.argv`

#### Folder

```bash
cd ~/dev/bun-hono-lab
mkdir 01-hello-cli
cd 01-hello-cli
bun init
```

#### Replace `index.ts`

```ts
const args = Bun.argv.slice(2)
const name = args[0] ?? 'World'

console.log(`Hello, ${name}!`)
```

#### Run

```bash
bun run index.ts
bun run index.ts Chuck
```

#### Expected output

```text
Hello, World!
Hello, Chuck!
```

#### Suggested enhancements

- Add a `--shout` option that prints uppercase output.
- Add a `--help` option that explains usage.
- Add a default greeting based on the current time of day.

#### Enhanced version with `--help` and `--shout`

```ts
const args = Bun.argv.slice(2)

function printHelp(): void {
  console.log(`Usage:
  bun run index.ts [name] [--shout]

Examples:
  bun run index.ts
  bun run index.ts Chuck
  bun run index.ts Chuck --shout`)
}

if (args.includes('--help')) {
  printHelp()
  process.exit(0)
}

const shout = args.includes('--shout')
const name = args.find((arg) => !arg.startsWith('--')) ?? 'World'
let message = `Hello, ${name}!`

if (shout) {
  message = message.toUpperCase()
}

console.log(message)
```

---

### Program 2 — Unit Converter CLI

#### Goal

Create a command-line utility that converts miles to kilometers and kilometers to miles.

#### Skills practiced

- Parsing arguments
- Numeric conversion
- Error handling
- Functions

#### Folder

```bash
cd ~/dev/bun-hono-lab
mkdir 02-unit-converter-cli
cd 02-unit-converter-cli
bun init
```

#### `index.ts`

```ts
type Unit = 'miles' | 'km'

function milesToKm(miles: number): number {
  return miles * 1.609344
}

function kmToMiles(km: number): number {
  return km / 1.609344
}

function printHelp(): void {
  console.log(`Usage:
  bun run index.ts <value> <unit>

Units:
  miles
  km

Examples:
  bun run index.ts 10 miles
  bun run index.ts 5 km`)
}

const args = Bun.argv.slice(2)

if (args.includes('--help') || args.length < 2) {
  printHelp()
  process.exit(0)
}

const value = Number(args[0])
const unit = args[1] as Unit

if (Number.isNaN(value)) {
  console.error('Error: value must be a number')
  process.exit(1)
}

if (unit !== 'miles' && unit !== 'km') {
  console.error('Error: unit must be "miles" or "km"')
  process.exit(1)
}

if (unit === 'miles') {
  const result = milesToKm(value)
  console.log(`${value} miles = ${result.toFixed(2)} km`)
} else {
  const result = kmToMiles(value)
  console.log(`${value} km = ${result.toFixed(2)} miles`)
}
```

#### Run

```bash
bun run index.ts 10 miles
bun run index.ts 5 km
bun run index.ts --help
```

#### Suggested enhancements

- Add feet to meters.
- Add pounds to kilograms.
- Add Celsius to Fahrenheit.
- Let users pass `mi`, `mile`, `miles`, `km`, `kilometer`, or `kilometers`.

---

### Program 3 — JSON Patient File Reader

#### Goal

Create a CLI program that reads a small FHIR-like Patient JSON file and prints a friendly summary.

#### Skills practiced

- Reading JSON files
- TypeScript object types
- Defensive coding for optional fields
- Formatting terminal output

#### Folder

```bash
cd ~/dev/bun-hono-lab
mkdir -p 03-file-json-cli/data
cd 03-file-json-cli
bun init
```

#### Create `data/patient.json`

```json
{
  "resourceType": "Patient",
  "id": "example-patient-001",
  "name": [
    {
      "family": "Sylvester",
      "given": ["Chuck"]
    }
  ],
  "gender": "male",
  "birthDate": "1964-03-30"
}
```

#### Replace `index.ts`

```ts
type HumanName = {
  family?: string
  given?: string[]
}

type Patient = {
  resourceType: 'Patient'
  id?: string
  name?: HumanName[]
  gender?: string
  birthDate?: string
}

function formatName(patient: Patient): string {
  const firstName = patient.name?.[0]?.given?.join(' ')
  const familyName = patient.name?.[0]?.family

  return [firstName, familyName].filter(Boolean).join(' ') || 'Unknown name'
}

async function main(): Promise<void> {
  const path = Bun.argv[2] ?? 'data/patient.json'
  const file = Bun.file(path)

  if (!(await file.exists())) {
    console.error(`File not found: ${path}`)
    process.exit(1)
  }

  const patient = (await file.json()) as Patient

  if (patient.resourceType !== 'Patient') {
    console.error('The JSON file is not a Patient resource')
    process.exit(1)
  }

  console.log('Patient Summary')
  console.log('---------------')
  console.log(`ID:        ${patient.id ?? 'Unknown'}`)
  console.log(`Name:      ${formatName(patient)}`)
  console.log(`Gender:    ${patient.gender ?? 'Unknown'}`)
  console.log(`BirthDate: ${patient.birthDate ?? 'Unknown'}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
```

#### Run

```bash
bun run index.ts
bun run index.ts data/patient.json
```

#### Suggested enhancements

- Read a FHIR Bundle and summarize all Patient resources.
- Add support for `telecom` phone/email fields.
- Print output as JSON when the user passes `--json`.
- Save a summary to `data/patient-summary.txt`.

---

### Program 4 — Todo API Client CLI

#### Goal

Create a terminal program that calls a public JSON API and prints selected fields.

#### Skills practiced

- `fetch`
- Async/await
- HTTP status handling
- JSON parsing
- Environment variables

#### Folder

```bash
cd ~/dev/bun-hono-lab
mkdir 04-api-client-cli
cd 04-api-client-cli
bun init
```

#### Create `.env`

```bash
API_BASE_URL=https://jsonplaceholder.typicode.com
```

#### Replace `index.ts`

```ts
type Todo = {
  userId: number
  id: number
  title: string
  completed: boolean
}

function printHelp(): void {
  console.log(`Usage:
  bun run index.ts <todo-id>

Examples:
  bun run index.ts 1
  bun run index.ts 42`)
}

async function fetchTodo(id: string): Promise<Todo> {
  const apiBaseUrl = Bun.env.API_BASE_URL

  if (!apiBaseUrl) {
    throw new Error('Missing API_BASE_URL in environment')
  }

  const response = await fetch(`${apiBaseUrl}/todos/${id}`)

  if (!response.ok) {
    throw new Error(`HTTP error: ${response.status}`)
  }

  return (await response.json()) as Todo
}

async function main(): Promise<void> {
  const args = Bun.argv.slice(2)

  if (args.includes('--help') || args.length < 1) {
    printHelp()
    process.exit(0)
  }

  const id = args[0]
  const todo = await fetchTodo(id)

  console.log('Todo')
  console.log('----')
  console.log(`ID:        ${todo.id}`)
  console.log(`User ID:   ${todo.userId}`)
  console.log(`Title:     ${todo.title}`)
  console.log(`Completed: ${todo.completed ? 'yes' : 'no'}`)
}

main().catch((error) => {
  console.error(`Error: ${error.message}`)
  process.exit(1)
})
```

#### Run

```bash
bun run index.ts 1
bun run index.ts 42
```

#### Suggested enhancements

- Add a `--json` option.
- Add a `--save` option that writes the response to a local file.
- Add a `list` command that retrieves several todos.
- Replace JSONPlaceholder with a local Hono API later.

---

### Program 5 — Local Task Tracker CLI

#### Goal

Build a small local command-line app that stores tasks in a JSON file.

#### Skills practiced

- CLI subcommands
- JSON persistence
- File existence checks
- Basic data modeling
- Incremental app design

#### Commands

```bash
bun run index.ts add "Learn Bun"
bun run index.ts list
bun run index.ts done 1
bun run index.ts delete 1
```

#### Folder

```bash
cd ~/dev/bun-hono-lab
mkdir -p 05-task-tracker-cli/data
cd 05-task-tracker-cli
bun init
```

#### Replace `index.ts`

```ts
type Task = {
  id: number
  title: string
  completed: boolean
  createdAt: string
  completedAt?: string
}

const DATA_PATH = 'data/tasks.json'

async function loadTasks(): Promise<Task[]> {
  const file = Bun.file(DATA_PATH)

  if (!(await file.exists())) {
    return []
  }

  return (await file.json()) as Task[]
}

async function saveTasks(tasks: Task[]): Promise<void> {
  await Bun.write(DATA_PATH, JSON.stringify(tasks, null, 2))
}

function printHelp(): void {
  console.log(`Usage:
  bun run index.ts <command> [arguments]

Commands:
  add <title>      Add a new task
  list             List all tasks
  done <id>        Mark a task complete
  delete <id>      Delete a task

Examples:
  bun run index.ts add "Learn Bun"
  bun run index.ts list
  bun run index.ts done 1
  bun run index.ts delete 1`)
}

function getNextId(tasks: Task[]): number {
  const maxId = tasks.reduce((max, task) => Math.max(max, task.id), 0)
  return maxId + 1
}

async function addTask(title: string): Promise<void> {
  const tasks = await loadTasks()

  const task: Task = {
    id: getNextId(tasks),
    title,
    completed: false,
    createdAt: new Date().toISOString()
  }

  tasks.push(task)
  await saveTasks(tasks)
  console.log(`Added task ${task.id}: ${task.title}`)
}

async function listTasks(): Promise<void> {
  const tasks = await loadTasks()

  if (tasks.length === 0) {
    console.log('No tasks found')
    return
  }

  for (const task of tasks) {
    const status = task.completed ? 'x' : ' '
    console.log(`${task.id}. [${status}] ${task.title}`)
  }
}

async function completeTask(idText: string): Promise<void> {
  const id = Number(idText)

  if (Number.isNaN(id)) {
    throw new Error('Task ID must be a number')
  }

  const tasks = await loadTasks()
  const task = tasks.find((item) => item.id === id)

  if (!task) {
    throw new Error(`Task not found: ${id}`)
  }

  task.completed = true
  task.completedAt = new Date().toISOString()
  await saveTasks(tasks)
  console.log(`Completed task ${id}`)
}

async function deleteTask(idText: string): Promise<void> {
  const id = Number(idText)

  if (Number.isNaN(id)) {
    throw new Error('Task ID must be a number')
  }

  const tasks = await loadTasks()
  const filtered = tasks.filter((task) => task.id !== id)

  if (filtered.length === tasks.length) {
    throw new Error(`Task not found: ${id}`)
  }

  await saveTasks(filtered)
  console.log(`Deleted task ${id}`)
}

async function main(): Promise<void> {
  const [command, ...args] = Bun.argv.slice(2)

  switch (command) {
    case 'add': {
      const title = args.join(' ').trim()
      if (!title) {
        throw new Error('Task title is required')
      }
      await addTask(title)
      break
    }

    case 'list':
      await listTasks()
      break

    case 'done':
      if (!args[0]) {
        throw new Error('Task ID is required')
      }
      await completeTask(args[0])
      break

    case 'delete':
      if (!args[0]) {
        throw new Error('Task ID is required')
      }
      await deleteTask(args[0])
      break

    case '--help':
    case undefined:
      printHelp()
      break

    default:
      throw new Error(`Unknown command: ${command}`)
  }
}

main().catch((error) => {
  console.error(`Error: ${error.message}`)
  process.exit(1)
})
```

#### Run

```bash
bun run index.ts add "Learn Bun basics"
bun run index.ts add "Write a JSON file reader"
bun run index.ts list
bun run index.ts done 1
bun run index.ts list
bun run index.ts delete 2
bun run index.ts list
```

#### Suggested enhancements

- Add task priority: `low`, `medium`, `high`.
- Add due dates.
- Add a `search` command.
- Add a `clear-completed` command.
- Add tests for `getNextId` and task filtering logic.
- Move functions into separate files.

#### Suggested refactored structure

```text
05-task-tracker-cli/
  index.ts
  src/
    task.ts
    storage.ts
    commands.ts
  data/
    tasks.json
```

---

### Program 6 — Markdown Notes CLI

#### Goal

Create a small utility that creates timestamped Markdown notes.

#### Skills practiced

- Working with dates
- Creating filenames
- Writing Markdown files
- Basic CLI ergonomics

#### Folder

```bash
cd ~/dev/bun-hono-lab
mkdir -p 06-markdown-notes-cli/notes
cd 06-markdown-notes-cli
bun init
```

#### Replace `index.ts`

```ts
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function getDateStamp(): string {
  return new Date().toISOString().slice(0, 10)
}

async function main(): Promise<void> {
  const title = Bun.argv.slice(2).join(' ').trim()

  if (!title) {
    console.error('Usage: bun run index.ts <note title>')
    process.exit(1)
  }

  const dateStamp = getDateStamp()
  const slug = slugify(title)
  const path = `notes/${dateStamp}-${slug}.md`

  const content = `# ${title}

Date: ${dateStamp}

## Notes

- 

## Follow-up

- 
`

  await Bun.write(path, content)
  console.log(`Created ${path}`)
}

main().catch((error) => {
  console.error(`Error: ${error.message}`)
  process.exit(1)
})
```

#### Run

```bash
bun run index.ts Learning Bun and Hono
```

#### Suggested enhancements

- Add a `list` command.
- Add a `search` command.
- Add a template option: `--template meeting`, `--template learning`, `--template project`.
- Open the file in VS Code after creating it:

```ts
Bun.spawn(['code', path])
```

---

### Program 7 — Hono Preview API for Your Task Tracker

#### Goal

Create a small Hono API that exposes task-tracker data over HTTP.

This program is intentionally small. It gives you a bridge from CLI development to web/API development.

#### Skills practiced

- Creating a Hono app with Bun
- Defining routes
- Returning JSON
- Reading route parameters
- Reusing CLI logic in a web app

#### Folder

```bash
cd ~/dev/bun-hono-lab
bun create hono@latest 07-hono-task-api --template bun
cd 07-hono-task-api
bun install
```

#### Replace `src/index.ts`

```ts
import { Hono } from 'hono'

type Task = {
  id: number
  title: string
  completed: boolean
  createdAt: string
  completedAt?: string
}

const DATA_PATH = 'data/tasks.json'

async function loadTasks(): Promise<Task[]> {
  const file = Bun.file(DATA_PATH)

  if (!(await file.exists())) {
    return []
  }

  return (await file.json()) as Task[]
}

async function saveTasks(tasks: Task[]): Promise<void> {
  await Bun.write(DATA_PATH, JSON.stringify(tasks, null, 2))
}

function getNextId(tasks: Task[]): number {
  const maxId = tasks.reduce((max, task) => Math.max(max, task.id), 0)
  return maxId + 1
}

const app = new Hono()

app.get('/', (c) => {
  return c.json({
    name: 'Hono Task API',
    routes: [
      'GET /tasks',
      'GET /tasks/:id',
      'POST /tasks'
    ]
  })
})

app.get('/tasks', async (c) => {
  const tasks = await loadTasks()
  return c.json(tasks)
})

app.get('/tasks/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const tasks = await loadTasks()
  const task = tasks.find((item) => item.id === id)

  if (!task) {
    return c.json({ error: 'Task not found' }, 404)
  }

  return c.json(task)
})

app.post('/tasks', async (c) => {
  const body = await c.req.json<{ title?: string }>()
  const title = body.title?.trim()

  if (!title) {
    return c.json({ error: 'Task title is required' }, 400)
  }

  const tasks = await loadTasks()
  const task: Task = {
    id: getNextId(tasks),
    title,
    completed: false,
    createdAt: new Date().toISOString()
  }

  tasks.push(task)
  await saveTasks(tasks)

  return c.json(task, 201)
})

export default app
```

#### Create data folder

```bash
mkdir -p data
```

#### Run

```bash
bun run dev
```

#### Test with curl

```bash
curl http://localhost:3000/

curl http://localhost:3000/tasks

curl -X POST http://localhost:3000/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"Learn Hono routes"}'

curl http://localhost:3000/tasks/1
```

#### Suggested enhancements

- Add `PATCH /tasks/:id/done`.
- Add `DELETE /tasks/:id`.
- Add validation for request bodies.
- Move task storage into a separate module.
- Share task logic between the CLI app and the Hono API.

---

## Recommended Next Steps

After completing these programs, you will have enough foundation to build more useful local tools.

Good next projects:

1. A FHIR JSON Bundle inspector CLI.
2. A local API testing helper that saves responses to files.
3. A project scaffolding CLI for your FastAPI or Bun experiments.
4. A lightweight Hono API that wraps a local JSON file or SQLite database.
5. A small Hono + HTMX web app if you later want browser-based UI.

A strong portfolio progression would be:

```text
CLI task tracker
  -> Hono task API
  -> persistent database version
  -> simple web UI
  -> authentication later
```

---

## Reference Commands Cheat Sheet

```bash
# Install / verify
bun --version
bun --revision

# Project setup
bun init
bun install
bun add hono
bun add -d typescript

# Run scripts
bun run index.ts
bun run dev
bun run start

# Test
bun test

# Hono project
bun create hono@latest my-app --template bun
cd my-app
bun install
bun run dev
```

---

## Notes on Using This Guide

You can use this guide in two ways:

1. Type the code manually to learn the syntax and structure.
2. Copy/paste the examples, run them, then modify one feature at a time.

Typing manually is slower but better for learning. Copy/paste is fine when your goal is to quickly get a working baseline and then experiment.

