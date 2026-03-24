# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Summary

**Real-time multiplayer Tic-Tac-Toe game** deployed as a Cloudflare Worker using Durable Objects and WebSockets. Multi-file TypeScript application with sandboxed game logic, rate limiting, and a game state machine. See **AGENTS.md** for comprehensive conventions, code style, and detailed guidelines.

## Essential Commands

```bash
# Development (local dev server with hot reload)
npx wrangler dev

# Deploy to Cloudflare Workers
npx wrangler deploy

# Type check without deploying
npx tsc --noEmit --types @cloudflare/workers-types src/index.ts

# Tests (not yet configured; placeholder command exits with error)
npm test
```

## Architecture Overview

The application is split across five source files:

1. **`src/index.ts`** — Worker router (~50 lines): CSP/security headers, Origin validation, re-exports DO
2. **`src/game.ts`** — TicTacToe Durable Object: state machine, WebSocket handlers, rate limiting, idle/TTL alarms, sandbox integration
3. **`src/sandbox.ts`** — Game rules: local `validateAndApply()` function + string module for Dynamic Worker isolates
4. **`src/types.ts`** — Shared interfaces (`Env`, `GameState`, `MoveResult`), types, and constants
5. **`src/frontend.ts`** — `HTML_TEMPLATE` export with XSS-safe DOM methods, auto-reconnection, mutual reset protocol

**Key mechanisms:**
- **Durable Objects** store game state with smart caching (`ensureState()` loads once per wake cycle)
- **WebSockets** (hibernable) enable real-time client updates via `broadcastState()`
- **State machine** (`waiting` → `playing` → `finished`) gates moves and resets
- **Rate limiting** (token bucket per socket: 10 tokens, refills 2/sec)
- **Dynamic Workers sandbox** (optional) — game rules run in isolated V8 with no network access
- **Alarms** — idle socket cleanup (30 min) and room TTL cleanup (24h)
- **Mutual reset** — both players must agree to play again

## Code Style & Conventions

- **2-space indentation**, semicolons required, single quotes for literals
- **TypeScript strict mode** — explicit types on all class properties, function parameters, and return types
- **Naming:** Classes `PascalCase`, functions/variables `camelCase`, constants `SCREAMING_SNAKE_CASE`
- **Section dividers:** Use `// ===...===` banner comments at top of each file
- **WebSocket pattern:** Use `getWebSockets()` + `serializeAttachment()`; call `broadcastState()` after every state mutation
- **Error handling:** Return `Response` objects with appropriate HTTP status codes; `try/catch` only where failure is expected (JSON parse, ws.send)
- **Frontend JS:** Use `let`/`const` (no `var`), `textContent` (never `innerHTML` for user data)

See **AGENTS.md § Code Style** for detailed conventions on types, async/await, frontend patterns, and more.

## Development Notes

- **No external dependencies** beyond build tooling (`typescript`, `wrangler`, `@cloudflare/workers-types`)
- **No ESLint/Prettier** — style is documented in AGENTS.md; do not add tooling unless explicitly requested
- **No tests configured** yet — when tests are added, use Vitest with `@cloudflare/vitest-pool-workers` and place tests in `src/__tests__/`
- **TypeScript:** Wrangler uses an implicit `tsconfig`; a `tsconfig.json` exists but is not strictly required
- **Secrets:** Demo password is hardcoded; production secrets should use `wrangler secret put`
- **Storage:** Game state persisted via `this.state.storage`; smart caching avoids redundant reads

## Files to Know

- `src/index.ts` — Worker router with security headers and Origin validation
- `src/game.ts` — TicTacToe Durable Object (core game logic)
- `src/sandbox.ts` — Game rules module (local + Dynamic Worker isolate)
- `src/types.ts` — All shared types and constants
- `src/frontend.ts` — HTML/CSS/JS frontend template
- `wrangler.toml` — Cloudflare Workers config; defines `GAME_ROOM` binding to `TicTacToe` class
- `AGENTS.md` — Comprehensive coding guidelines, naming conventions, and project standards
- `.gitignore` — Properly configured; `.wrangler/`, `node_modules/`, `.dev.vars` are ignored

## When in Doubt

Refer to **AGENTS.md** for:
- Detailed code style rules and TypeScript patterns
- WebSocket and Durable Object conventions
- wrangler.toml structure and Durable Object binding setup
- Frontend HTML/CSS/JS patterns
- What not to do (adding tooling, unnecessary files, etc.)
