// ==========================================
// TESTS: Worker Router (index.ts)
// ==========================================

import { describe, it, expect } from 'vitest';
import { exports } from 'cloudflare:workers';

const worker = (exports as Cloudflare.Exports & { default: Fetcher }).default;

// ---- Helpers ----

function makeRequest(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://test.example.com${path}`, { headers });
}

// ==========================================
// Route: / (Frontend)
// ==========================================

describe('GET /', () => {
  it('should return 200 with HTML content', async () => {
    const resp = await worker.fetch(makeRequest('/'));
    expect(resp.status).toBe(200);
    const body = await resp.text();
    expect(body).toContain('<!DOCTYPE html>');
    expect(body).toContain('Tic-Tac-Toe');
  });

  it('should return correct security headers', async () => {
    const resp = await worker.fetch(makeRequest('/'));
    expect(resp.headers.get('Content-Type')).toBe('text/html;charset=UTF-8');
    expect(resp.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(resp.headers.get('X-Frame-Options')).toBe('DENY');
    expect(resp.headers.get('Content-Security-Policy')).toContain("default-src 'self'");
  });

  it('should include mode selection UI in the HTML', async () => {
    const resp = await worker.fetch(makeRequest('/'));
    const body = await resp.text();
    expect(body).toContain('Play vs Friend');
    expect(body).toContain('Play vs AI');
    expect(body).toContain('difficulty-row');
  });
});

// ==========================================
// Route: /ws (WebSocket upgrade)
// ==========================================

describe('GET /ws', () => {
  describe('room code validation', () => {
    it('should reject missing room code', async () => {
      const resp = await worker.fetch(
        makeRequest('/ws', { Upgrade: 'websocket' }),
      );
      expect(resp.status).toBe(400);
      const body = await resp.text();
      expect(body).toContain('invalid room code');
    });

    it('should reject invalid room code format', async () => {
      const resp = await worker.fetch(
        makeRequest('/ws?room=abc', { Upgrade: 'websocket' }),
      );
      expect(resp.status).toBe(400);
    });

    it('should reject room code with special characters', async () => {
      const resp = await worker.fetch(
        makeRequest('/ws?room=AB!@CD', { Upgrade: 'websocket' }),
      );
      expect(resp.status).toBe(400);
    });

    it('should reject room code that is too short', async () => {
      const resp = await worker.fetch(
        makeRequest('/ws?room=ABC', { Upgrade: 'websocket' }),
      );
      expect(resp.status).toBe(400);
    });

    it('should reject room code that is too long', async () => {
      const resp = await worker.fetch(
        makeRequest('/ws?room=ABCDEFGH', { Upgrade: 'websocket' }),
      );
      expect(resp.status).toBe(400);
    });
  });

  describe('mode validation', () => {
    it('should reject invalid mode', async () => {
      const resp = await worker.fetch(
        makeRequest('/ws?room=ABCDEF&mode=invalid', { Upgrade: 'websocket' }),
      );
      expect(resp.status).toBe(400);
      const body = await resp.text();
      expect(body).toContain('invalid mode');
    });

    it('should accept multiplayer mode', async () => {
      const resp = await worker.fetch(
        makeRequest('/ws?room=ABCDEF&mode=multiplayer', { Upgrade: 'websocket' }),
      );
      // Should not be 400 (will be 101 if WS upgrade succeeds)
      expect(resp.status).not.toBe(400);
    });

    it('should accept singleplayer mode', async () => {
      const resp = await worker.fetch(
        makeRequest('/ws?room=ABCDEG&mode=singleplayer', { Upgrade: 'websocket' }),
      );
      expect(resp.status).not.toBe(400);
    });

    it('should default to multiplayer when mode is omitted', async () => {
      const resp = await worker.fetch(
        makeRequest('/ws?room=ABCDEH', { Upgrade: 'websocket' }),
      );
      // Should not be 400
      expect(resp.status).not.toBe(400);
    });
  });

  describe('difficulty validation', () => {
    it('should reject invalid difficulty', async () => {
      const resp = await worker.fetch(
        makeRequest('/ws?room=ABCDEF&difficulty=impossible', {
          Upgrade: 'websocket',
        }),
      );
      expect(resp.status).toBe(400);
      const body = await resp.text();
      expect(body).toContain('invalid difficulty');
    });

    it('should accept easy difficulty', async () => {
      const resp = await worker.fetch(
        makeRequest('/ws?room=DIFF01&difficulty=easy', { Upgrade: 'websocket' }),
      );
      expect(resp.status).not.toBe(400);
    });

    it('should accept medium difficulty', async () => {
      const resp = await worker.fetch(
        makeRequest('/ws?room=DIFF02&difficulty=medium', { Upgrade: 'websocket' }),
      );
      expect(resp.status).not.toBe(400);
    });

    it('should accept hard difficulty', async () => {
      const resp = await worker.fetch(
        makeRequest('/ws?room=DIFF03&difficulty=hard', { Upgrade: 'websocket' }),
      );
      expect(resp.status).not.toBe(400);
    });
  });

  describe('origin validation', () => {
    it('should reject cross-origin requests', async () => {
      const resp = await worker.fetch(
        makeRequest('/ws?room=ABCDEF', {
          Upgrade: 'websocket',
          Origin: 'https://evil.com',
        }),
      );
      expect(resp.status).toBe(403);
      const body = await resp.text();
      expect(body).toContain('origin mismatch');
    });

    it('should allow same-origin requests', async () => {
      const resp = await worker.fetch(
        makeRequest('/ws?room=ORIG01', {
          Upgrade: 'websocket',
          Origin: 'https://test.example.com',
        }),
      );
      expect(resp.status).not.toBe(403);
    });

    it('should allow localhost for development', async () => {
      const resp = await worker.fetch(
        makeRequest('/ws?room=ORIG02', {
          Upgrade: 'websocket',
          Origin: 'http://localhost:8787',
        }),
      );
      expect(resp.status).not.toBe(403);
    });
  });
});

// ==========================================
// Route: 404
// ==========================================

describe('unknown routes', () => {
  it('should return 404 for unknown paths', async () => {
    const resp = await worker.fetch(makeRequest('/unknown'));
    expect(resp.status).toBe(404);
  });

  it('should return 404 for /api', async () => {
    const resp = await worker.fetch(makeRequest('/api'));
    expect(resp.status).toBe(404);
  });
});
