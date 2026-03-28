# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Summary

**Real-time multiplayer & single-player Tic-Tac-Toe game** with AI opponents, deployed as a Cloudflare Worker using Durable Objects and WebSockets. Features a real-time Developer Insights panel showing Cloudflare internals. Multi-file TypeScript application with game logic, rate limiting, and a game state machine. See **AGENTS.md** for comprehensive conventions, code style, and detailed guidelines.

## Essential Commands

```bash
# Development (local dev server with hot reload)
npx wrangler dev

# Deploy to Cloudflare Workers
npx wrangler deploy

# Type check
npx tsc --noEmit

# Run all tests (Vitest + @cloudflare/vitest-pool-workers)
npm test

# Watch mode
npm run test:watch
```

## Architecture Overview

The application is split across five source files:

1. **`src/index.ts`** — Worker router (~50 lines): CSP/security headers, Origin validation, mode/difficulty validation, re-exports DO
2. **`src/game.ts`** — TicTacToe Durable Object: state machine, WebSocket handlers, rate limiting, idle/TTL alarms, AI move execution, debug event instrumentation
3. **`src/sandbox.ts`** — Game rules + AI engine: `validateAndApply()`, `computeAiMove()` (minimax with alpha-beta pruning, 3 difficulty levels)
4. **`src/types.ts`** — Shared interfaces (`Env`, `GameState`, `MoveResult`, `DebugEvent`), types, and constants
5. **`src/frontend.ts`** — `HTML_TEMPLATE` export with lobby, mode selection, XSS-safe DOM methods, auto-reconnection, mutual reset protocol, Developer Insights panel

**Key mechanisms:**
- **Durable Objects** store game state with smart caching (`ensureState()` loads once per wake cycle)
- **WebSockets** (hibernable) enable real-time client updates via `broadcastState()`
- **State machine** (`waiting` → `playing` → `finished`) gates moves and resets
- **AI engine** (minimax with alpha-beta pruning, 3 difficulty levels: easy/medium/hard)
- **Rate limiting** (token bucket per socket: 10 tokens, refills 2/sec)
- **Alarms** — idle socket cleanup (30 min) and room TTL cleanup (24h)
- **Mutual reset** — both players must agree to play again (multiplayer); immediate reset (single-player)
- **Developer Insights panel** — real-time side panel showing Cloudflare internals (DO state, events)

## Code Style & Conventions

- **2-space indentation**, semicolons required, single quotes for literals
- **TypeScript strict mode** — explicit types on all class properties, function parameters, and return types
- **Naming:** Classes `PascalCase`, functions/variables `camelCase`, constants `SCREAMING_SNAKE_CASE`
- **Section dividers:** Use `// ===...===` banner comments at top of each file
- **WebSocket pattern:** Use `getWebSockets()` + `serializeAttachment()`; call `broadcastState()` after every state mutation
- **Error handling:** Return `Response` objects with appropriate HTTP status codes; `try/catch` only where failure is expected (JSON parse, ws.send)
- **Frontend JS:** Use `let`/`const` (no `var`), `textContent` (never `innerHTML` for user data)

See **AGENTS.md** for detailed conventions on types, async/await, frontend patterns, and the debug panel.

## Development Notes

- **No external dependencies** beyond build tooling (`typescript`, `wrangler`, `@cloudflare/workers-types`, `vitest`, `@cloudflare/vitest-pool-workers`)
- **No ESLint/Prettier** — style is documented in AGENTS.md; do not add tooling unless explicitly requested
- **Tests:** Vitest with `@cloudflare/vitest-pool-workers` — config in `vitest.config.mts` (`.mts` required for ESM-only package with CommonJS project). 63 tests across 3 files.
- **TypeScript:** `tsconfig.json` exists with `@cloudflare/workers-types` and `@cloudflare/vitest-pool-workers/types`
- **Secrets:** Demo password is hardcoded; production secrets should use `wrangler secret put`
- **Storage:** Game state persisted via `this.state.storage`; smart caching avoids redundant reads
- **Debug events:** Transient `debugLog` array on DO class, flushed in `broadcastState()`, never persisted

## Files to Know

- `src/index.ts` — Worker router with security headers and Origin validation
- `src/game.ts` — TicTacToe Durable Object (core game logic, AI, debug instrumentation)
- `src/sandbox.ts` — Game rules + AI engine (minimax with alpha-beta pruning)
- `src/types.ts` — All shared types, constants, and `DebugEvent`
- `src/frontend.ts` — HTML/CSS/JS frontend template with Developer Insights panel
- `src/__tests__/sandbox.test.ts` — Unit tests for game rules + AI engine (26 tests)
- `src/__tests__/game.test.ts` — Integration tests for Durable Object (16 tests)
- `src/__tests__/index.test.ts` — Router & validation tests (21 tests)
- `vitest.config.mts` — Vitest config (cloudflareTest plugin + cloudflarePool)
- `wrangler.toml` — Cloudflare Workers config; defines `GAME_ROOM` binding
- `AGENTS.md` — Comprehensive coding guidelines, naming conventions, and project standards
- `.gitignore` — Properly configured; `.wrangler/`, `node_modules/`, `.dev.vars` are ignored

## When in Doubt

Refer to **AGENTS.md** for:
- Detailed code style rules and TypeScript patterns
- WebSocket and Durable Object conventions
- wrangler.toml structure and Durable Object binding setup
- Single-player AI mode architecture
- Developer Insights panel and debug event system
- Frontend HTML/CSS/JS patterns
- What not to do (adding tooling, unnecessary files, etc.)
