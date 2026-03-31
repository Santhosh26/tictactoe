# Tic-Tac-Toe on Cloudflare

A real-time multiplayer and single-player Tic-Tac-Toe game built on Cloudflare Workers and Durable Objects.

**Live Demo:** [tictactoe.ksanthoshkumar.com](https://tictactoe.ksanthoshkumar.com)

## Features

- 🎮 Play against a friend or AI
- 🤖 AI with 3 difficulty levels (Easy, Medium, Hard)
- 🌍 Runs globally on Cloudflare edge (330+ locations)
- 📊 Real-time Developer Insights panel
- 🔒 Secure by default (CSP, CSRF protection)

## Quick Start

### Local Development

```bash
npm install
npx wrangler dev
```

Visit `http://localhost:8787`

### Deploy to Cloudflare

1. **Authenticate**
   ```bash
   npx wrangler login
   ```

2. **Update `wrangler.toml`**
   - Replace `tic-tac-toe-do` with a unique worker name
   - Replace `tictactoe.ksanthoshkumar.com` with your domain

3. **Deploy**
   ```bash
   npx wrangler deploy
   ```

## How to Play

**Multiplayer:** Enter a room code to create/join a game with a friend

**Single-Player:** Choose AI difficulty and play

## Project Structure

```
src/
├── index.ts       # Worker router
├── game.ts        # Durable Object (game state & WebSocket)
├── sandbox.ts     # Game rules & AI engine
├── types.ts       # Shared types
└── frontend.ts    # HTML & UI
```

## Testing

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
```

## More Info

- **Docs:** https://developers.cloudflare.com/workers
- **Issues:** https://github.com/anomalyco/opencode
