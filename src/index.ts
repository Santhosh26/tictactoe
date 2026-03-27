// ==========================================
// WORKER ROUTER
// ==========================================

import { Env } from './types';
import { HTML_TEMPLATE } from './frontend';

// Re-export Durable Object for wrangler to discover.
export { TicTacToe } from './game';

// Security headers applied to all HTML responses.
const SECURITY_HEADERS: Record<string, string> = {
  'Content-Type': 'text/html;charset=UTF-8',
  'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self' wss: ws:;",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Serve the frontend for the root path.
    if (url.pathname === '/') {
      return new Response(HTML_TEMPLATE, { headers: SECURITY_HEADERS });
    }

    // WebSocket upgrade — expects ?room=CODE&clientId=UUID&name=NAME
    if (url.pathname === '/ws') {
      // Origin validation (CSRF protection).
      const origin = request.headers.get('Origin');
      if (origin) {
        const originUrl = new URL(origin);
        const requestHost = url.host;
        // Allow same-origin and localhost for development.
        if (originUrl.host !== requestHost && !originUrl.host.startsWith('localhost') && !originUrl.host.startsWith('127.0.0.1')) {
          return new Response('Forbidden: origin mismatch', { status: 403 });
        }
      }

      const room = url.searchParams.get('room');
      if (!room || !/^[A-Z0-9]{6}$/.test(room)) {
        return new Response('Bad Request: invalid room code', { status: 400 });
      }

      const mode = url.searchParams.get('mode') ?? 'multiplayer';
      if (mode !== 'multiplayer' && mode !== 'singleplayer') {
        return new Response('Bad Request: invalid mode', { status: 400 });
      }

      const difficulty = url.searchParams.get('difficulty') ?? 'hard';
      if (!['easy', 'medium', 'hard'].includes(difficulty)) {
        return new Response('Bad Request: invalid difficulty', { status: 400 });
      }

      const roomId = env.GAME_ROOM.idFromName(room);
      const roomObject = env.GAME_ROOM.get(roomId);

      // Forward edge colo to the Durable Object via a header.
      const colo = (request.cf as Record<string, unknown> | undefined)?.colo as string | undefined;
      if (colo) {
        const headers = new Headers(request.headers);
        headers.set('X-CF-Colo', colo);
        const forwarded = new Request(request.url, {
          method: request.method,
          headers,
          body: request.body,
        });
        return roomObject.fetch(forwarded);
      }
      return roomObject.fetch(request);
    }

    return new Response('Not Found', { status: 404 });
  },
};
