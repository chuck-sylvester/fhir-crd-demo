# ESLint Guide for TypeScript Projects

## ESLint's Role in Your Project

Before installing anything, it helps to understand what kind of tool ESLint is.

**ESLint is developer tooling, not application code.** Your application never imports ESLint, and ESLint has no runtime presence — it is not included in your production bundle and does not affect how your code runs. ESLint reads your source files; your code has no knowledge that ESLint exists.

The right mental model is to put `eslint.config.mjs` in the same category as `tsconfig.json` and `package.json`. All three sit at the project root and configure tools that operate on your codebase:

| File | Tool it configures | When it matters |
|---|---|---|
| `package.json` | Package manager (`bun install`) | Install time |
| `tsconfig.json` | TypeScript compiler (`tsc`) | Type-check and build time |
| `eslint.config.mjs` | ESLint linter | Development and CI time |

None of these are imported by your application. ESLint is invoked in exactly two contexts:

1. **Continuously in the editor** — the VS Code ESLint extension runs ESLint in the background as you type and shows violations as squiggles. You never invoke this manually.
2. **Explicitly via CLI** — `bunx eslint 'src/**/*.ts'`, run by hand, as a `bun run lint` script, or in a CI pipeline.

Because ESLint is only needed during development, it belongs in `devDependencies` in `package.json` rather than `dependencies`. This distinction tells the package manager not to include it in a production install.

### The JavaScript/TypeScript Tooling Landscape

One reason the JavaScript ecosystem can feel disjointed is that it is built from many small, specialized tools rather than one integrated system. Python ships `unittest`, a linter (`pylint`/`flake8`), and a formatter (`black`) as separate installs, but the standard library and toolchain are relatively cohesive. JavaScript historically shipped none of these — each problem was solved independently by different teams at different times. That history is why there are so many tools with overlapping names, competing alternatives, and config files at the project root.

Here is a map of the categories and where the tools in this project fall:

| Category | What it does | Tool in this project |
|---|---|---|
| Runtime | Executes your code | Bun |
| Package manager | Installs and manages dependencies | Bun (`bun install`) |
| Type checker | Verifies type correctness at build time | TypeScript (`tsc`) |
| Linter | Catches bugs and style violations statically | ESLint |
| Test runner | Runs unit and integration tests | Bun (`bun test`) |
| HTTP framework | Handles routing and middleware | Hono |
| Formatter | Enforces consistent whitespace and style | *(none yet — Prettier if added)* |
| Bundler | Packages code for deployment | Bun (`bun build`) |

Each tool has one job. The apparent complexity comes from needing to understand which tool does what and how they connect — not from any single tool being complicated. Once the categories are clear, the config files at your project root become legible: each one belongs to exactly one row of that table.

---

## Part 1: Understanding ESLint

### 1.1 What ESLint Does

ESLint is a **static analysis tool** — it reads your source code without running it and flags patterns that violate configured rules. Static analysis catches a different class of problems than runtime errors:

- **Style violations:** missing semicolons, inconsistent spacing, unreachable code
- **Likely bugs:** unused variables, calling a function with the wrong number of arguments, using `==` instead of `===`
- **TypeScript-specific issues:** unsafe `any` usage, unhandled promise results, incorrect type assertions

"Static" means ESLint works on the text of your code, not its runtime behavior. This makes it fast and usable as an editor integration — VS Code shows violations as you type, without running your program.

### 1.2 ESLint vs the TypeScript Compiler

ESLint and the TypeScript compiler (`tsc`) are complementary tools, not substitutes for each other.

| Tool | What it checks |
|---|---|
| TypeScript compiler | Type correctness — can this value be used in this position? |
| ESLint | Code quality and style — is this pattern a likely bug or a style violation? |

Example: TypeScript will catch `const x: number = "hello"` as a type error. It will not flag `const x = 1; const y = 2;` where `y` is never used. ESLint catches the unused variable. Neither tool alone is sufficient — use both.

### 1.3 ESLint vs Prettier

ESLint and Prettier are also complementary, but their domains overlap in the formatting area.

| Tool | Domain |
|---|---|
| ESLint | Code quality rules (bugs, anti-patterns) + some style rules |
| Prettier | Opinionated code formatting (indentation, line length, quote style) |

**The overlap:** ESLint has formatting rules like `semi` that overlap with what Prettier handles. When both are used together, conflicts can arise — Prettier formats one way and ESLint flags it as a violation. The standard resolution is to add `eslint-config-prettier`, which disables all ESLint rules that would conflict with Prettier and lets Prettier own formatting decisions. For this project (no Prettier), using the `semi` rule in ESLint is appropriate.

### 1.4 How ESLint Works: Parsers, Plugins, and Configs

Understanding these three concepts makes ESLint config files legible.

**Parser:** ESLint's default parser (Espree) reads JavaScript. It does not understand TypeScript syntax — TypeScript-specific constructs like generics, type annotations, and `as` casts will cause parse errors. `typescript-eslint` provides a replacement parser (`@typescript-eslint/parser`) that reads TypeScript. When you use the `typescript-eslint` unified package, this parser is configured automatically.

**Plugin:** A plugin adds new rules to ESLint beyond the built-in set. `@typescript-eslint/eslint-plugin` adds TypeScript-aware rules such as `@typescript-eslint/no-explicit-any` and `@typescript-eslint/no-floating-promises`. The `typescript-eslint` unified package bundles the plugin and wires it up for you.

**Config:** A config is a collection of rule settings, and optionally parser, plugin, and file pattern settings. `tseslint.configs.recommended` is a pre-made config that enables a curated set of TypeScript rules. You extend it by passing additional rule objects alongside it.

The relationship: configure a **parser** so ESLint understands your language, add **plugins** for the rules you want available, and apply **configs** to set which rules are active and at what severity.

### 1.5 Rule Severity Levels

Every ESLint rule operates at one of three severity levels:

| Value | Effect |
|---|---|
| `'off'` or `0` | Rule is disabled |
| `'warn'` or `1` | Violation shown as a warning (yellow underline in VS Code); does not cause the `eslint` CLI to exit with a non-zero code |
| `'error'` or `2` | Violation shown as an error (red underline in VS Code); causes `eslint` CLI to exit with a non-zero code |

In CI pipelines, the `eslint` exit code determines whether the build passes. Use `'error'` for rules you want strictly enforced. Use `'warn'` during a migration phase — violations are visible but do not block the pipeline while you work through them.

### 1.6 The Flat Config Format (v9+)

ESLint v9 introduced the **flat config** format, replacing the older `.eslintrc.*` family of files. The flat config file is always named `eslint.config.js` or `eslint.config.mjs` and uses standard ES module `import`/`export` syntax.

Key differences from the legacy format:

| Old (`.eslintrc`) | New (flat config) |
|---|---|
| JSON, YAML, or JS — limited logic | JavaScript — variables, conditionals, full imports |
| Implicit plugin name prefixes | Explicit plugin registration |
| `extends` array for shared configs | Arrays of config objects passed to `tseslint.config()` |
| Multiple possible filenames | Always `eslint.config.js` or `eslint.config.mjs` |

If you encounter ESLint documentation that shows `.eslintrc.json` or `extends: ['plugin:@typescript-eslint/recommended']`, it describes the old format. The flat config equivalent is `tseslint.configs.recommended` passed to `tseslint.config()`.

---

## Part 2: Installation

### Step 1 — Install ESLint in Your Project

ESLint should always be installed locally, in the project's `node_modules`. A local install means each project controls its own ESLint version and rule configuration — two projects on the same machine can have different setups without interfering with each other, and CI runs the same version as your editor.

From `payer-crd/`:

```bash
bun add --dev eslint @eslint/js typescript-eslint typescript
```

- `eslint` — the core linter
- `@eslint/js` — ESLint's built-in recommended JavaScript rules; a separate first-party package that must be installed explicitly
- `typescript-eslint` — the unified package that provides the TypeScript parser and plugin; replaces the older separate `@typescript-eslint/parser` and `@typescript-eslint/eslint-plugin` packages
- `typescript` — the TypeScript compiler API; required by `typescript-eslint` as a peer dependency. Bun provides its own TypeScript transpilation at runtime, but `typescript-eslint` needs the compiler API separately for type-aware analysis.

---

### Step 2 — Create Your ESLint Config

Create `eslint.config.mjs` at your project root. Using the `.mjs` extension explicitly marks this file as an ES module, making the `import`/`export` syntax valid regardless of the `"type"` field in your `package.json`.

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/', 'dist/'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      'semi': ['error', 'always'],
    },
  }
);
```

What each part does:

| Part | Purpose |
|---|---|
| `{ ignores: [...] }` | Excludes directories from linting; placed first so it applies globally |
| `js.configs.recommended` | Enables ESLint's built-in recommended rules: `no-unused-vars`, `no-undef`, `no-debugger`, and ~25 others |
| `tseslint.configs.recommended` | Enables the TypeScript-aware recommended rules: `no-explicit-any`, `no-unused-expressions`, and similar |
| `'semi': ['error', 'always']` | Enforces semicolons; shown as errors and auto-fixed on save |

`tseslint.config()` is a helper that accepts config objects and arrays and flattens them into the format ESLint v9 expects. You can pass a plain array instead, but `tseslint.config()` provides better TypeScript types on the config objects.

`@eslint/js` is a separate package that must be installed explicitly, as shown in Step 1.

---

## Part 3: VS Code Integration

### Step 3 — Install the VS Code Extension

Open VS Code and press `Cmd+Shift+X` to open the Extensions panel. Search for **ESLint** and install the one published by **Microsoft** (identifier: `dbaeumer.vscode-eslint`).

The extension is the editor integration layer — it runs ESLint in the background and translates its output into squiggly underlines, hover messages, and code actions (quick fixes). Without the extension, ESLint only works from the command line; with it, violations appear as you type.

---

### Step 4 — Configure VS Code Settings

ESLint editor behavior is personal preference. The right place for these settings is your VS Code **User Settings** — a global file that applies to all projects and is never committed to any repo.

#### Option A: VS Code User Settings (recommended)

Open the file:

1. `Cmd+Shift+P` → **"Preferences: Open User Settings (JSON)"**

Add:

```json
{
  "eslint.workingDirectories": ["./payer-crd"],
  "eslint.validate": [
    "javascript",
    "javascriptreact",
    "typescript",
    "typescriptreact"
  ],
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": "explicit"
  }
}
```

This is the right place for ESLint editor settings because they are personal — your teammates may use a different editor, prefer no auto-fix, or have different save behavior. Keeping this configuration out of the repo avoids encoding your editor preferences as a project requirement.

#### Option B: `.vscode/settings.json` added to `.gitignore`

If you want project-scoped settings that are not committed, create `.vscode/settings.json` with the same content above and add `.vscode/` to `.gitignore`. The file stays on your machine but is never tracked by Git.

This is appropriate when your ESLint settings differ meaningfully from project to project — for example, if one project uses TypeScript and another does not, and you want different `eslint.validate` values per project without touching your global defaults.

---

**What each setting does:**

- `eslint.workingDirectories` — tells the extension which subdirectories have their own ESLint installation. This is required when VS Code is opened at a repo root that contains multiple sub-projects, each with their own `node_modules` and `eslint.config.mjs`. Without this setting, the extension looks for ESLint relative to the workspace root and fails silently when it cannot find the binary or config there. The path `"./payer-crd"` is relative to the open workspace folder. If you later add ESLint to `provider-ehr/` as well, add `"./provider-ehr"` to the same array. Note that unlike the other two settings below, this one contains a project-specific path — it is the one setting where Option B (`.vscode/settings.json` + `.gitignore`) is arguably a better fit, since the path only makes sense in the context of this repo.
- `eslint.validate` — tells the extension which language identifiers to run ESLint on. Recent extension versions default to these four values, so this is explicit documentation more than a behavioral change. Worth having for clarity.
- `source.fixAll.eslint: "explicit"` — runs auto-fixable ESLint rules when you explicitly save with `Cmd+S`. The `"explicit"` value means it does not trigger on VS Code's auto-save, only on deliberate saves.

---

## Part 4: Verification and Usage

### Step 5 — Verify It's Working

1. Open any `.ts` file in your project.
2. Type a statement and deliberately omit the semicolon.
3. You should see a red squiggly underline immediately (or after a brief pause while ESLint initializes on first open).
4. Save with `Cmd+S` — the semicolon should be inserted automatically.

If linting does not appear after setup:

- Open the Command Palette (`Cmd+Shift+P`) and run **"ESLint: Restart ESLint Server"**. This restarts the ESLint background process and re-reads your config file.
- Check the **ESLint** output panel (`View → Output`, then select "ESLint" from the dropdown). Parse errors and missing package errors appear here.
- Confirm `eslint.config.mjs` is present at your project root and that `node_modules` contains `eslint` and `typescript-eslint`.

---

### Step 6 — Run ESLint from the Command Line

The VS Code extension shows violations in the editor. The CLI is useful for CI pipelines, pre-commit hooks, and bulk fixes across the whole project.

```bash
# Lint all TypeScript source files
bunx eslint 'src/**/*.ts'

# Lint with auto-fix applied
bunx eslint --fix 'src/**/*.ts'

# Lint a single file
bunx eslint src/index.ts
```

`bunx` runs a locally installed binary from `node_modules/.bin/` without requiring a global install. It is the Bun equivalent of `npx eslint`.

Add scripts to `package.json` for convenience:

```json
"scripts": {
  "lint":     "eslint 'src/**/*.ts'",
  "lint:fix": "eslint --fix 'src/**/*.ts'"
}
```

Then run with `bun run lint` or `bun run lint:fix`.

---

## Part 5: Ignoring Files

Exclude files or directories from linting with an `ignores` object in `eslint.config.mjs`. There is no separate `.eslintignore` file in the flat config format — ignores live in the config file.

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/', 'dist/', 'coverage/', '**/*.d.ts'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      'semi': ['error', 'always'],
    },
  }
);
```

An `ignores`-only object placed first in the array applies globally. Glob patterns follow `.gitignore` syntax.

---

## Appendix: Troubleshooting

| Symptom | Likely cause |
|---|---|
| No squiggles in `.ts` files, no errors in ESLint output panel | `eslint.workingDirectories` not set; the extension cannot find the ESLint binary at the workspace root and fails silently — add `"eslint.workingDirectories": ["./payer-crd"]` to User Settings |
| No squiggles, ESLint output panel shows a config or module error | `eslint.config.mjs` is missing or a required package is not installed; run `bun install` and confirm the config file is at the project root |
| `Cannot find module 'typescript-eslint'` or `Cannot find package '@eslint/js'` | Run `bun install` to restore `node_modules`; if the error persists, run `bun add --dev eslint @eslint/js typescript-eslint typescript` to install missing packages |
| `Parsing error: Cannot read file 'tsconfig.json'` | You enabled type-checked rules (`tseslint.configs.recommendedTypeChecked`) without pointing ESLint at your `tsconfig.json`; add `languageOptions: { parserOptions: { project: true } }` to your config, or switch back to `tseslint.configs.recommended` |
| `'semi'` auto-fix not running on save | Confirm `source.fixAll.eslint` is set to `"explicit"` (not `false`) in your User Settings and that the file is saved |
| Old `.eslintrc` docs not matching your config | Those docs describe the legacy format; your `eslint.config.mjs` uses the ESLint v9 flat config — the two are not interchangeable |
| ESLint flags code that Prettier already handles | Add `eslint-config-prettier` (`bun add --dev eslint-config-prettier`) and include `eslintConfigPrettier` as the last item in your `tseslint.config()` call to disable conflicting rules |

---

## Quick Reference

| What | Where |
|---|---|
| Extension (editor UI) | VS Code Extensions panel → search "ESLint" by Microsoft |
| Extension settings | VS Code User Settings (`Cmd+Shift+P` → "Preferences: Open User Settings (JSON)") |
| Working directory setting | `"eslint.workingDirectories": ["./payer-crd"]` in User Settings |
| Lint rules | `eslint.config.mjs` at project root |
| Install | `bun add --dev eslint @eslint/js typescript-eslint typescript` |
| CLI lint | `bunx eslint 'src/**/*.ts'` |
| CLI fix | `bunx eslint --fix 'src/**/*.ts'` |
| Restart ESLint in VS Code | `Cmd+Shift+P` → "ESLint: Restart ESLint Server" |
