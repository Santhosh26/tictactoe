# AGENTS.md — Coding Agent Guide

This file documents the conventions, commands, and guidelines for working in
this repository. It is intended for AI coding agents and human contributors.

---

## Project Overview

A real-time multiplayer Tic-Tac-Toe game deployed as a **Cloudflare Worker**.
The entire application lives in a single TypeScript file (`src/index.ts`).

| Attribute        | Value                                         |
|------------------|-----------------------------------------------|
| Language         | TypeScript 6                                  |
| Runtime          | Cloudflare Workers (edge, not Node.js)        |
| Key primitive    | Durable Objects + WebSockets                  |
| Entry point      | `src/index.ts` (router); `src/game.ts` (DO)   |
| Build tool       | Wrangler 4 (uses esbuild internally)          |
| Module format    | `"type": "commonjs"` in package.json          |
| Type definitions | `@cloudflare/workers-types`                   |

---

## Commands

### Development

```bash
npx wrangler dev          # Start local dev server with hot reload
```

### Deploy

```bash
npx wrangler deploy       # Deploy to Cloudflare Workers
```

### Type Checking

There is no `tsconfig.json` at the project root. Wrangler uses its own bundled
tsconfig that extends `@cloudflare/workers-tsconfig`. Type checking happens
implicitly during `wrangler dev` / `wrangler deploy`.

To run a standalone type check without deploying:

```bash
npx tsc --noEmit --types @cloudflare/workers-types src/index.ts
```

### Lint / Format

No ESLint or Prettier configuration exists. There are no lint or format scripts.
Do not add linting/formatting tooling unless explicitly requested.

### Tests

**No tests are currently configured.** The `npm test` script is a placeholder
that exits with an error.

When tests are added, the idiomatic approach for Cloudflare Workers is:

```bash
# Install test dependencies (not yet present)
npm install --save-dev vitest @cloudflare/vitest-pool-workers

# Run all tests
npx vitest run

# Run a single test file
npx vitest run src/__tests__/index.test.ts

# Run a single test by name
npx vitest run --reporter=verbose -t "test name here"

# Watch mode
npx vitest
```

Place test files in `src/__tests__/` following the pattern `*.test.ts`.

---

## Repository Structure

```
tictactoe/
├── src/
│   ├── index.ts          # Worker router (~50 lines): CSP headers, Origin check, re-exports
│   ├── game.ts           # TicTacToe Durable Object: state machine, WS, rate limiting, sandbox
│   ├── sandbox.ts        # Game rules module (local + Dynamic Worker isolate string)
│   ├── types.ts          # Shared interfaces, types, and constants
│   └── frontend.ts       # HTML_TEMPLATE export with XSS-safe DOM methods and reconnection
├── wrangler.toml         # Cloudflare Workers deployment config
├── package.json
└── package-lock.json
```

The application was split into multiple files to accommodate sandboxing, rate
limiting, alarms, a state machine, and a mutual reset protocol.

---

## Code Style

### Indentation & Formatting

- **2-space indentation** — no tabs.
- **Semicolons** — always required at end of statements.
- **Single quotes** for string literals; template literals (backticks) for
  interpolation and multi-line strings.
- **Trailing commas** in multi-line object/array literals.
- Lines should stay readable; no hard line-length limit is enforced but aim for
  ≤ 100 characters.

### Imports

Use standard ES `import` syntax for cross-file imports. Cloudflare Workers
ambient globals (`Request`, `Response`, `WebSocket`, `WebSocketPair`,
`DurableObjectState`, `DurableObjectNamespace`) are provided by
`@cloudflare/workers-types` — no imports needed for those.

Do not use `require()`.

### Naming Conventions

| Construct               | Convention              | Example                    |
|-------------------------|-------------------------|----------------------------|
| Classes                 | `PascalCase`            | `TicTacToe`                |
| Interfaces              | `PascalCase`            | `Env`                      |
| Methods & functions     | `camelCase`             | `broadcastState()`         |
| Variables & properties  | `camelCase`             | `playerSymbol`, `sessions` |
| Constants (module-level)| `SCREAMING_SNAKE_CASE`  | `HTML_CONTENT`             |
| Durable Object bindings | `SCREAMING_SNAKE_CASE`  | `GAME_ROOM`                |
| Boolean variables       | `is`/`has` prefix preferred | `isConnected`          |

### TypeScript Types

- Always annotate class properties with explicit types.
- Always annotate function parameters and return types.
- Prefer `string | null` over optional (`?`) when a value can be explicitly
  absent vs simply not yet set.
- Use `Map<K, V>` for keyed collections; use typed arrays (`(string | null)[]`)
  rather than `any[]`.
- Do not use `any`. Prefer `unknown` if the type is truly unknown, then narrow.

### File & Code Organization

Each source file has a banner comment at the top using `// ===` style:

```typescript
// ==========================================
// WORKER ROUTER
// ==========================================
```

- `src/index.ts` — Worker router + security headers + re-exports
- `src/game.ts` — Durable Object (state machine, WebSocket handlers, alarms, sandbox)
- `src/sandbox.ts` — Game rules (local function + string module for Dynamic Workers)
- `src/types.ts` — Shared interfaces, types, and constants
- `src/frontend.ts` — HTML template (XSS-safe, auto-reconnect, mutual reset)

Use inline `// Comment` style for short explanatory notes; avoid block comments
(`/* */`) unless documenting a public API.

### Async / Await

- Use `async/await` throughout. Do not use raw `.then()` / `.catch()` chains.
- Cloudflare Workers lifecycle methods (`fetch`, `webSocketMessage`,
  `webSocketClose`) must be `async`.

### Error Handling

- HTTP-level errors are returned as `new Response('message', { status: NNN })`.
  - 401 — unauthorized (e.g., wrong password)
  - 404 — route not found
  - 426 — non-WebSocket request to WebSocket endpoint
- There are no `try/catch` blocks in the server code. For new code, only add
  `try/catch` where failure is genuinely expected and recoverable.
- Do not throw exceptions across Worker boundaries; always return a `Response`.
- Frontend (inline JS) uses `ws.onerror` for connection-level errors. Avoid
  `alert()` in new code; prefer updating a status element in the DOM.

### WebSocket & Durable Object Patterns

- Use `this.state.acceptWebSocket(server)` to hibernate the WebSocket into the
  Durable Object (enables hibernation billing model).
- Track sessions with `Map<WebSocket, PlayerSymbol>` where the symbol is a
  descriptive string (`'X'`, `'O'`, `'Spectator'`).
- After every state mutation, call `broadcastState()` to sync all connected
  clients.
- Game state is in-memory on the Durable Object instance. If persistence across
  restarts is needed, use `this.state.storage` (SQLite is already enabled via
  the `new_sqlite_classes` migration).

### Frontend (Inline HTML)

The frontend is a template literal constant `HTML_CONTENT` in `src/index.ts`.

- Keep all CSS inline in the `<style>` block; no external stylesheets.
- Keep all JS inline in the `<script>` block; no external scripts.
- Use `var`-free JS (`let`/`const`). The existing code uses `let ws` because
  it is reassigned; use `const` everywhere else.
- Prefer `element.textContent` over `element.innerText` for non-HTML text
  updates. Use `element.innerHTML` only when rendering HTML markup.

---

## wrangler.toml Conventions

- Worker name: `tic-tac-toe-do`
- Durable Object binding name: `GAME_ROOM` → class `TicTacToe`
- New Durable Object classes must be added to `[[durable_objects.bindings]]`
  and a corresponding `[[migrations]]` entry with a new unique `tag`.

---

## What Not to Do

- Do not add a `tsconfig.json` unless Wrangler's implicit config is insufficient.
- Do not add ESLint/Prettier unless explicitly requested.
- Do not add new source files without clear justification (e.g., new game mode).
- Do not commit `.wrangler/` — it contains local dev state.
- Do not hardcode secrets in source. The password (`secret1!`) is a demo
  placeholder; production secrets should use Wrangler secrets
  (`wrangler secret put SECRET_NAME`).
