// ==========================================
// INTEGRATION TESTS: Durable Object Game Flow
// ==========================================

import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import type { TicTacToe } from '../game';

// ---- Helpers ----

function makeUpgradeRequest(
  room: string,
  clientId: string,
  name: string,
  mode: string = 'multiplayer',
  difficulty: string = 'hard',
): Request {
  return new Request(
    `https://test.example.com/ws?room=${room}&clientId=${clientId}&name=${name}&mode=${mode}&difficulty=${difficulty}`,
    { headers: { Upgrade: 'websocket' } },
  );
}

function getStub(room: string = 'TEST01'): DurableObjectStub<TicTacToe> {
  const id = env.GAME_ROOM.idFromName(room);
  return env.GAME_ROOM.get(id) as DurableObjectStub<TicTacToe>;
}

interface WSPair {
  ws: WebSocket;
  messages: string[];
  close: () => void;
}

async function connectPlayer(
  stub: DurableObjectStub<TicTacToe>,
  clientId: string,
  name: string,
  mode: string = 'multiplayer',
  difficulty: string = 'hard',
): Promise<WSPair> {
  const req = makeUpgradeRequest('TEST01', clientId, name, mode, difficulty);
  const resp = await stub.fetch(req);

  expect(resp.status).toBe(101);
  const ws = resp.webSocket!;
  ws.accept();

  const messages: string[] = [];
  ws.addEventListener('message', (event) => {
    messages.push(event.data as string);
  });

  // Wait a tick for init message
  await new Promise(resolve => setTimeout(resolve, 50));

  return {
    ws,
    messages,
    close: () => { try { ws.close(1000); } catch { /* */ } },
  };
}

function getLatestState(messages: string[]): Record<string, unknown> | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const parsed = JSON.parse(messages[i]!) as Record<string, unknown>;
    if (parsed.type === 'state') return parsed;
  }
  return null;
}

function getInitMessage(messages: string[]): Record<string, unknown> | null {
  for (const msg of messages) {
    const parsed = JSON.parse(msg) as Record<string, unknown>;
    if (parsed.type === 'init') return parsed;
  }
  return null;
}

// ==========================================
// Tests
// ==========================================

describe('TicTacToe Durable Object', () => {
  describe('connection and symbol assignment', () => {
    it('should assign X to the first player', async () => {
      const stub = getStub('CONN01');
      const req = makeUpgradeRequest('CONN01', 'player1', 'Alice');
      const resp = await stub.fetch(req);
      expect(resp.status).toBe(101);
      const ws = resp.webSocket!;
      ws.accept();

      const messages: string[] = [];
      ws.addEventListener('message', (e) => messages.push(e.data as string));
      await new Promise(resolve => setTimeout(resolve, 50));

      const init = getInitMessage(messages);
      expect(init).not.toBeNull();
      expect(init!.symbol).toBe('X');
      ws.close(1000);
    });

    it('should assign O to the second player and transition to playing', async () => {
      const stub = getStub('CONN02');

      // Player 1
      const req1 = makeUpgradeRequest('CONN02', 'player1', 'Alice');
      const resp1 = await stub.fetch(req1);
      const ws1 = resp1.webSocket!;
      ws1.accept();
      const msgs1: string[] = [];
      ws1.addEventListener('message', (e) => msgs1.push(e.data as string));

      // Player 2
      const req2 = makeUpgradeRequest('CONN02', 'player2', 'Bob');
      const resp2 = await stub.fetch(req2);
      const ws2 = resp2.webSocket!;
      ws2.accept();
      const msgs2: string[] = [];
      ws2.addEventListener('message', (e) => msgs2.push(e.data as string));

      await new Promise(resolve => setTimeout(resolve, 50));

      const init2 = getInitMessage(msgs2);
      expect(init2).not.toBeNull();
      expect(init2!.symbol).toBe('O');

      // State should show phase=playing
      const state = getLatestState(msgs1);
      expect(state).not.toBeNull();
      expect(state!.phase).toBe('playing');
      expect(state!.nameX).toBe('Alice');
      expect(state!.nameO).toBe('Bob');

      ws1.close(1000);
      ws2.close(1000);
    });

    it('should assign Spectator to the third player', async () => {
      const stub = getStub('CONN03');

      const resp1 = await stub.fetch(makeUpgradeRequest('CONN03', 'p1', 'A'));
      resp1.webSocket!.accept();
      const resp2 = await stub.fetch(makeUpgradeRequest('CONN03', 'p2', 'B'));
      resp2.webSocket!.accept();

      const resp3 = await stub.fetch(makeUpgradeRequest('CONN03', 'p3', 'C'));
      const ws3 = resp3.webSocket!;
      ws3.accept();
      const msgs: string[] = [];
      ws3.addEventListener('message', (e) => msgs.push(e.data as string));
      await new Promise(resolve => setTimeout(resolve, 50));

      const init = getInitMessage(msgs);
      expect(init!.symbol).toBe('Spectator');

      resp1.webSocket!.close(1000);
      resp2.webSocket!.close(1000);
      ws3.close(1000);
    });

    it('should reject non-websocket requests', async () => {
      const stub = getStub('CONN04');
      const req = new Request('https://test.example.com/ws?room=CONN04');
      const resp = await stub.fetch(req);
      expect(resp.status).toBe(426);
    });
  });

  describe('multiplayer game flow', () => {
    it('should process valid moves and switch turns', async () => {
      const stub = getStub('MOVE01');

      const resp1 = await stub.fetch(makeUpgradeRequest('MOVE01', 'px', 'Alice'));
      const ws1 = resp1.webSocket!;
      ws1.accept();
      const msgs1: string[] = [];
      ws1.addEventListener('message', (e) => msgs1.push(e.data as string));

      const resp2 = await stub.fetch(makeUpgradeRequest('MOVE01', 'po', 'Bob'));
      const ws2 = resp2.webSocket!;
      ws2.accept();
      const msgs2: string[] = [];
      ws2.addEventListener('message', (e) => msgs2.push(e.data as string));
      await new Promise(resolve => setTimeout(resolve, 50));

      // X plays center
      ws1.send(JSON.stringify({ type: 'move', index: 4 }));
      await new Promise(resolve => setTimeout(resolve, 50));

      let state = getLatestState(msgs1);
      expect(state!.board).toEqual([null, null, null, null, 'X', null, null, null, null]);
      expect(state!.turn).toBe('O');

      // O plays corner
      ws2.send(JSON.stringify({ type: 'move', index: 0 }));
      await new Promise(resolve => setTimeout(resolve, 50));

      state = getLatestState(msgs2);
      expect(state!.board).toEqual(['O', null, null, null, 'X', null, null, null, null]);
      expect(state!.turn).toBe('X');

      ws1.close(1000);
      ws2.close(1000);
    });

    it('should reject move when not player turn', async () => {
      const stub = getStub('MOVE02');

      const resp1 = await stub.fetch(makeUpgradeRequest('MOVE02', 'px', 'A'));
      const ws1 = resp1.webSocket!;
      ws1.accept();
      const msgs1: string[] = [];
      ws1.addEventListener('message', (e) => msgs1.push(e.data as string));

      const resp2 = await stub.fetch(makeUpgradeRequest('MOVE02', 'po', 'B'));
      const ws2 = resp2.webSocket!;
      ws2.accept();
      await new Promise(resolve => setTimeout(resolve, 50));

      // O tries to move but it's X's turn
      ws2.send(JSON.stringify({ type: 'move', index: 0 }));
      await new Promise(resolve => setTimeout(resolve, 50));

      // Board should remain empty — the state should show all nulls
      const state = getLatestState(msgs1);
      const boardArr = state!.board as (string | null)[];
      expect(boardArr.every(c => c === null)).toBe(true);

      ws1.close(1000);
      ws2.close(1000);
    });

    it('should detect a win and update scoreboard', async () => {
      const stub = getStub('WIN001');

      const resp1 = await stub.fetch(makeUpgradeRequest('WIN001', 'px', 'A'));
      const ws1 = resp1.webSocket!;
      ws1.accept();
      const msgs1: string[] = [];
      ws1.addEventListener('message', (e) => msgs1.push(e.data as string));

      const resp2 = await stub.fetch(makeUpgradeRequest('WIN001', 'po', 'B'));
      const ws2 = resp2.webSocket!;
      ws2.accept();
      await new Promise(resolve => setTimeout(resolve, 50));

      // Play a game where X wins: X takes 0,1,2 and O takes 3,4
      const moves = [
        { ws: ws1, index: 0 }, // X
        { ws: ws2, index: 3 }, // O
        { ws: ws1, index: 1 }, // X
        { ws: ws2, index: 4 }, // O
        { ws: ws1, index: 2 }, // X wins top row
      ];

      for (const m of moves) {
        m.ws.send(JSON.stringify({ type: 'move', index: m.index }));
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      const state = getLatestState(msgs1);
      expect(state!.winner).toBe('X');
      expect(state!.phase).toBe('finished');
      expect(state!.winLine).toEqual([0, 1, 2]);
      expect(state!.winsX).toBe(1);
      expect(state!.winsO).toBe(0);

      ws1.close(1000);
      ws2.close(1000);
    });

    it('should handle mutual reset protocol', async () => {
      const stub = getStub('RESET1');

      const resp1 = await stub.fetch(makeUpgradeRequest('RESET1', 'px', 'A'));
      const ws1 = resp1.webSocket!;
      ws1.accept();
      const msgs1: string[] = [];
      ws1.addEventListener('message', (e) => msgs1.push(e.data as string));

      const resp2 = await stub.fetch(makeUpgradeRequest('RESET1', 'po', 'B'));
      const ws2 = resp2.webSocket!;
      ws2.accept();
      const msgs2: string[] = [];
      ws2.addEventListener('message', (e) => msgs2.push(e.data as string));
      await new Promise(resolve => setTimeout(resolve, 50));

      // X wins quickly
      const moves = [
        { ws: ws1, index: 0 }, { ws: ws2, index: 3 },
        { ws: ws1, index: 1 }, { ws: ws2, index: 4 },
        { ws: ws1, index: 2 },
      ];
      for (const m of moves) {
        m.ws.send(JSON.stringify({ type: 'move', index: m.index }));
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      // Player X requests reset
      ws1.send(JSON.stringify({ type: 'reset' }));
      await new Promise(resolve => setTimeout(resolve, 50));

      let state = getLatestState(msgs1);
      expect(state!.resetRequestedBy).toBe('px');
      expect(state!.phase).toBe('finished'); // Still finished — waiting for O

      // Player O accepts
      ws2.send(JSON.stringify({ type: 'reset' }));
      await new Promise(resolve => setTimeout(resolve, 50));

      state = getLatestState(msgs1);
      expect(state!.phase).toBe('playing');
      expect(state!.resetRequestedBy).toBeNull();
      // Winner (X) starts next game
      expect(state!.turn).toBe('X');
      const boardArr = state!.board as (string | null)[];
      expect(boardArr.every(c => c === null)).toBe(true);

      ws1.close(1000);
      ws2.close(1000);
    });
  });

  describe('single-player mode', () => {
    it('should set up AI opponent and transition to playing immediately', async () => {
      const stub = getStub('AI0001');

      const resp = await stub.fetch(
        makeUpgradeRequest('AI0001', 'human', 'Alice', 'singleplayer', 'hard'),
      );
      const ws = resp.webSocket!;
      ws.accept();
      const msgs: string[] = [];
      ws.addEventListener('message', (e) => msgs.push(e.data as string));
      await new Promise(resolve => setTimeout(resolve, 50));

      const init = getInitMessage(msgs);
      expect(init!.symbol).toBe('X');

      const state = getLatestState(msgs);
      expect(state!.phase).toBe('playing');
      expect(state!.gameMode).toBe('singleplayer');
      expect(state!.aiDifficulty).toBe('hard');
      expect(state!.nameO).toBe('AI (Hard)');

      ws.close(1000);
    });

    it('should process human move then AI responds automatically', async () => {
      const stub = getStub('AI0002');

      const resp = await stub.fetch(
        makeUpgradeRequest('AI0002', 'human', 'Alice', 'singleplayer', 'easy'),
      );
      const ws = resp.webSocket!;
      ws.accept();
      const msgs: string[] = [];
      ws.addEventListener('message', (e) => msgs.push(e.data as string));
      await new Promise(resolve => setTimeout(resolve, 100));

      // Human (X) plays center
      ws.send(JSON.stringify({ type: 'move', index: 4 }));
      // Wait for AI delay (250ms) + processing
      await new Promise(resolve => setTimeout(resolve, 500));

      const state = getLatestState(msgs);
      const boardArr = state!.board as (string | null)[];

      // Human's move should be there
      expect(boardArr[4]).toBe('X');

      // AI should have made a move too (one O on the board)
      const oCount = boardArr.filter(c => c === 'O').length;
      expect(oCount).toBe(1);

      // Turn should be back to X
      expect(state!.turn).toBe('X');

      ws.close(1000);
    });

    it('should allow immediate reset without mutual agreement', async () => {
      const stub = getStub('AI0003');

      const resp = await stub.fetch(
        makeUpgradeRequest('AI0003', 'human', 'Alice', 'singleplayer', 'easy'),
      );
      const ws = resp.webSocket!;
      ws.accept();
      const msgs: string[] = [];
      ws.addEventListener('message', (e) => msgs.push(e.data as string));
      await new Promise(resolve => setTimeout(resolve, 100));

      // Play until game is finished by making AI-beatable moves
      // We'll manipulate via the DO directly
      await runInDurableObject(stub, async (instance: TicTacToe) => {
        instance.phase = 'finished';
        instance.winner = 'X';
        await instance.saveState();
        instance.broadcastState();
      });
      await new Promise(resolve => setTimeout(resolve, 50));

      // Send reset — should work immediately without needing second player
      ws.send(JSON.stringify({ type: 'reset' }));
      await new Promise(resolve => setTimeout(resolve, 100));

      const state = getLatestState(msgs);
      expect(state!.phase).toBe('playing');
      const boardArr = state!.board as (string | null)[];
      // Board might not be all null if AI moved first after reset
      // But phase should be playing
      expect(state!.winner).toBeNull();

      ws.close(1000);
    });

    it('should set correct AI name for each difficulty', async () => {
      for (const diff of ['easy', 'medium', 'hard'] as const) {
        const room = 'AIDF' + diff.toUpperCase().slice(0, 2);
        const stub = getStub(room);
        const resp = await stub.fetch(
          makeUpgradeRequest(room, 'h', 'P', 'singleplayer', diff),
        );
        const ws = resp.webSocket!;
        ws.accept();
        const msgs: string[] = [];
        ws.addEventListener('message', (e) => msgs.push(e.data as string));
        await new Promise(resolve => setTimeout(resolve, 50));

        const state = getLatestState(msgs);
        const expected = 'AI (' + diff.charAt(0).toUpperCase() + diff.slice(1) + ')';
        expect(state!.nameO).toBe(expected);

        ws.close(1000);
      }
    });

    it('should prevent second player from claiming O slot in singleplayer', async () => {
      const stub = getStub('AI0005');

      // First player connects as singleplayer
      const resp1 = await stub.fetch(
        makeUpgradeRequest('AI0005', 'human', 'Alice', 'singleplayer', 'hard'),
      );
      const ws1 = resp1.webSocket!;
      ws1.accept();
      await new Promise(resolve => setTimeout(resolve, 50));

      // Second player tries to connect
      const resp2 = await stub.fetch(
        makeUpgradeRequest('AI0005', 'intruder', 'Bob', 'singleplayer', 'hard'),
      );
      const ws2 = resp2.webSocket!;
      ws2.accept();
      const msgs2: string[] = [];
      ws2.addEventListener('message', (e) => msgs2.push(e.data as string));
      await new Promise(resolve => setTimeout(resolve, 50));

      const init = getInitMessage(msgs2);
      expect(init!.symbol).toBe('Spectator');

      ws1.close(1000);
      ws2.close(1000);
    });
  });

  describe('state persistence', () => {
    it('should persist game mode across DO reads', async () => {
      const stub = getStub('PERS01');

      const resp = await stub.fetch(
        makeUpgradeRequest('PERS01', 'h', 'A', 'singleplayer', 'medium'),
      );
      const ws = resp.webSocket!;
      ws.accept();
      const msgs: string[] = [];
      ws.addEventListener('message', (e) => msgs.push(e.data as string));
      await new Promise(resolve => setTimeout(resolve, 50));

      // Verify the state is correct
      await runInDurableObject(stub, async (instance: TicTacToe) => {
        await instance.ensureState();
        expect(instance.gameMode).toBe('singleplayer');
        expect(instance.aiDifficulty).toBe('medium');
      });

      ws.close(1000);
    });
  });

  describe('broadcast state includes new fields', () => {
    it('should include gameMode and aiDifficulty in state broadcast', async () => {
      const stub = getStub('BCAST1');

      const resp = await stub.fetch(
        makeUpgradeRequest('BCAST1', 'h', 'A', 'singleplayer', 'easy'),
      );
      const ws = resp.webSocket!;
      ws.accept();
      const msgs: string[] = [];
      ws.addEventListener('message', (e) => msgs.push(e.data as string));
      await new Promise(resolve => setTimeout(resolve, 50));

      const state = getLatestState(msgs);
      expect(state).toHaveProperty('gameMode', 'singleplayer');
      expect(state).toHaveProperty('aiDifficulty', 'easy');

      ws.close(1000);
    });

    it('should include gameMode=multiplayer for default connections', async () => {
      const stub = getStub('BCAST2');

      const resp = await stub.fetch(makeUpgradeRequest('BCAST2', 'h', 'A'));
      const ws = resp.webSocket!;
      ws.accept();
      const msgs: string[] = [];
      ws.addEventListener('message', (e) => msgs.push(e.data as string));
      await new Promise(resolve => setTimeout(resolve, 50));

      const state = getLatestState(msgs);
      expect(state).toHaveProperty('gameMode', 'multiplayer');

      ws.close(1000);
    });
  });
});
