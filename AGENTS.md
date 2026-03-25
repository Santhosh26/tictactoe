# AGENTS.md — Coding Agent Guide

This file documents the conventions, commands, and guidelines for working in
this repository. It is intended for AI coding agents and human contributors.

---

## Project Overview

A real-time **multiplayer & single-player Tic-Tac-Toe game** deployed as a **Cloudflare Worker**,
showcasing Durable Objects, WebSockets, Dynamic Workers sandboxing, and an AI engine with
a real-time Developer Insights panel for observing Cloudflare internals.

| Attribute        | Value                                                          |
|------------------|----------------------------------------------------------------|
| Language         | TypeScript 6                                                   |
| Runtime          | Cloudflare Workers (edge, not Node.js)                         |
| Key primitives   | Durable Objects + WebSockets + Dynamic Workers (optional)      |
| Entry point      | `src/index.ts` (router); `src/game.ts` (DO)                   |
| Build tool       | Wrangler 4 (uses esbuild internally)                           |
| Module format    | `"type": "commonjs"` in package.json                           |
| Type definitions | `@cloudflare/workers-types`                                    |
| Test framework   | Vitest 4 + `@cloudflare/vitest-pool-workers`                   |

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

A `tsconfig.json` exists at the project root. To run a standalone type check:

```bash
npx tsc --noEmit
```

### Lint / Format

No ESLint or Prettier configuration exists. There are no lint or format scripts.
Do not add linting/formatting tooling unless explicitly requested.

### Tests

Tests use **Vitest** with **`@cloudflare/vitest-pool-workers`** so they run
inside the Workers runtime. Config is in `vitest.config.mts` (`.mts` required
since the package is ESM-only while the project uses CommonJS).

```bash
# Run all tests
npm test                  # runs `vitest run`

# Watch mode
npm run test:watch        # runs `vitest`

# Run a single test file
npx vitest run src/__tests__/sandbox.test.ts

# Run a single test by name
npx vitest run --reporter=verbose -t "test name here"
```

**Test files** (in `src/__tests__/`):

| File               | Coverage                                                  | Tests |
|--------------------|-----------------------------------------------------------|-------|
| `sandbox.test.ts`  | Game rules (`validateAndApply`), AI engine (`computeAiMove`) | 26  |
| `game.test.ts`     | Durable Object integration (WS, state machine, AI, reset)   | 15  |
| `index.test.ts`    | Worker router (routes, validation, security headers)         | 22  |

---

## Repository Structure

```
tictactoe/
├── src/
│   ├── index.ts              # Worker router (~50 lines): CSP headers, Origin check, re-exports
│   ├── game.ts               # TicTacToe Durable Object: state machine, WS, rate limiting, sandbox, debug events
│   ├── sandbox.ts            # Game rules + AI engine (minimax with alpha-beta pruning)
│   ├── types.ts              # Shared interfaces, types, constants, DebugEvent
│   ├── frontend.ts           # HTML_TEMPLATE: game UI, lobby, AI mode, Developer Insights panel
│   └── __tests__/
│       ├── sandbox.test.ts   # Unit tests for game rules + AI engine
│       ├── game.test.ts      # Integration tests for Durable Object
│       └── index.test.ts     # Router & validation tests
├── vitest.config.mts         # Vitest config (cloudflareTest plugin + cloudflarePool)
├── tsconfig.json             # TypeScript config (includes test types)
├── wrangler.toml             # Cloudflare Workers deployment config
├── package.json
└── package-lock.json
```

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
| Interfaces              | `PascalCase`            | `Env`, `DebugEvent`        |
| Methods & functions     | `camelCase`             | `broadcastState()`         |
| Variables & properties  | `camelCase`             | `playerSymbol`, `debugLog` |
| Constants (module-level)| `SCREAMING_SNAKE_CASE`  | `HTML_TEMPLATE`            |
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
- `src/game.ts` — Durable Object (state machine, WebSocket handlers, alarms, sandbox, debug instrumentation)
- `src/sandbox.ts` — Game rules + AI engine (minimax with alpha-beta, 3 difficulty levels)
- `src/types.ts` — Shared interfaces, types, constants, and DebugEvent
- `src/frontend.ts` — HTML template (XSS-safe, auto-reconnect, mutual reset, AI mode, Developer Insights panel)

Use inline `// Comment` style for short explanatory notes; avoid block comments
(`/* */`) unless documenting a public API.

### Async / Await

- Use `async/await` throughout. Do not use raw `.then()` / `.catch()` chains.
- Cloudflare Workers lifecycle methods (`fetch`, `webSocketMessage`,
  `webSocketClose`) must be `async`.

### Error Handling

- HTTP-level errors are returned as `new Response('message', { status: NNN })`.
  - 400 — invalid room code, mode, or difficulty
  - 403 — origin mismatch
  - 404 — route not found
  - 426 — non-WebSocket request to WebSocket endpoint
  - 503 — room full
- Only add `try/catch` where failure is genuinely expected and recoverable
  (JSON parse, ws.send).
- Do not throw exceptions across Worker boundaries; always return a `Response`.
- Frontend uses `ws.onerror` for connection-level errors. Avoid `alert()`;
  prefer updating a status element in the DOM.

### WebSocket & Durable Object Patterns

- Use `this.state.acceptWebSocket(server)` to hibernate the WebSocket into the
  Durable Object (enables hibernation billing model).
- Track session data via `server.serializeAttachment()` / `ws.deserializeAttachment()`
  storing a `SocketAttachment` object with `{ symbol, clientId, name }`.
- After every state mutation, call `broadcastState()` to sync all connected
  clients (includes debug events which are flushed after each broadcast).
- Game state is persisted via `this.state.storage.put()` with smart caching
  (`ensureState()` loads from storage only once per DO wake cycle).

### Frontend (Inline HTML)

The frontend is a template literal constant `HTML_TEMPLATE` in `src/frontend.ts`.

- Keep all CSS inline in the `<style>` block; no external stylesheets.
- Keep all JS inline in the `<script>` block; no external scripts.
- Use `var`-free JS (`let`/`const`). The existing code uses `let ws` because
  it is reassigned; use `const` everywhere else.
- Prefer `element.textContent` over `element.innerText` for non-HTML text
  updates. **Never use `innerHTML` for user-supplied data** (XSS prevention).
- The frontend includes a lobby (mode selection), game board, and a Developer
  Insights side panel that renders debug events from the Durable Object.

---

## Single-Player AI Mode

Players can choose **Play vs Friend** (multiplayer) or **Play vs AI** (single-player)
from the lobby. AI difficulty levels:

| Difficulty | Algorithm | Behavior |
|------------|-----------|----------|
| Easy       | Random    | Picks a random empty cell |
| Medium     | 50/50     | 50% chance minimax, 50% chance random |
| Hard       | Minimax + alpha-beta pruning | Unbeatable — perfect play |

Key implementation details:

- `GameMode` type: `'multiplayer' | 'singleplayer'`
- `AiDifficulty` type: `'easy' | 'medium' | 'hard'`
- AI is the O player, represented by sentinel `playerO = '__AI__'`
- `computeAiMove()` in `src/sandbox.ts` — the AI engine
- `executeAiMove()` in `src/game.ts` — DO method with 250ms delay for natural feel
- Single-player uses immediate reset (no mutual protocol)
- Mode and difficulty are passed as query params on the `/ws` route

---

## Developer Insights Panel

A real-time side panel that shows Cloudflare internals as the game is played,
designed to educate audiences about Durable Objects, Workers, and Dynamic Workers.

### Architecture

- **Data delivery**: The `broadcastState()` message includes a `debug` array
  of `DebugEvent` objects. Events accumulate on a transient `debugLog` array
  on the DO class, get flushed into each broadcast, then cleared. Never persisted.
- **Frontend**: `updateDebugPanel(data)` is called from the `ws.onmessage`
  handler. It updates both the live state section and the scrolling event log.
- **Client-side events**: The frontend generates its own `worker`-category
  events for actions it observes (e.g., "WebSocket connected", "Security headers applied").

### DebugEvent Type

```typescript
type DebugEventCategory = 'worker' | 'durable-object' | 'websocket' | 'sandbox' | 'ai' | 'state-machine';

interface DebugEvent {
  ts: number;           // Date.now() timestamp
  category: DebugEventCategory;
  label: string;        // e.g., "State loaded from storage"
  detail?: string;      // e.g., "Smart cache: first load this wake cycle"
}
```

### Adding New Events

To instrument a new event in the Durable Object:

```typescript
this.pushDebug('category', 'Short label', 'Optional detail');
```

The event will automatically be included in the next `broadcastState()` call
and rendered in the frontend panel.

### Color Coding

| Category         | Color   |
|------------------|---------|
| `worker`         | Purple  |
| `durable-object` | Blue    |
| `websocket`      | Green   |
| `sandbox`        | Yellow  |
| `ai`             | Orange  |
| `state-machine`  | Pink    |

### Responsive Layout

- **Desktop (≥1024px)**: Side-by-side — game on left, panel on right (340px wide, sticky)
- **Mobile (<1024px)**: Panel below game, full width, max-height 260px

---

## Dynamic Workers (LOADER)

Dynamic Workers allow running game rules in an isolated V8 sandbox with no
network access, preventing cheating via code injection.

### wrangler.toml Configuration

```toml
# Uncomment to enable (requires paid plan):
# [[worker_loaders]]
# binding = "LOADER"
```

### How It Works

1. `executeInSandbox()` in `src/game.ts` checks if `env.LOADER` exists
2. If available: calls `env.LOADER.load()` with the game rules as a string module,
   `globalOutbound: null` (blocks all network access)
3. If unavailable: falls back to local `validateAndApply()` function
4. The `GAME_RULES_MODULE` string in `src/sandbox.ts` contains a self-contained
   copy of the validation logic (must maintain its own `WINNING_LINES` since
   it runs in an isolated context)

### Typing

The `DynamicWorkerLoader` interface in `src/types.ts` types the LOADER binding:

```typescript
interface DynamicWorkerLoader {
  load(config: {
    mainModule: string;
    modules: Record<string, string>;
    globalOutbound: null;
  }): Promise<{ getEntrypoint(): { validateAndApply(...): MoveResult } }>;
}
```

---

## wrangler.toml Conventions

- Worker name: `tic-tac-toe-do`
- Durable Object binding name: `GAME_ROOM` → class `TicTacToe`
- New Durable Object classes must be added to `[[durable_objects.bindings]]`
  and a corresponding `[[migrations]]` entry with a new unique `tag`.
- Dynamic Workers binding uses `[[worker_loaders]]` with `binding = "LOADER"`.

---

## What Not to Do

- Do not add ESLint/Prettier unless explicitly requested.
- Do not add new source files without clear justification.
- Do not commit `.wrangler/` — it contains local dev state.
- Do not hardcode secrets in source. The password (`secret1!`) is a demo
  placeholder; production secrets should use Wrangler secrets
  (`wrangler secret put SECRET_NAME`).
- Do not use `innerHTML` for user-supplied data — always use `textContent` or
  DOM methods (XSS prevention).
- Do not persist debug events to storage — they are transient and flushed after
  each broadcast.
