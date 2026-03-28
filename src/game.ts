// ==========================================
// DURABLE OBJECT (Game State & Logic)
// ==========================================

import {
  Env,
  GameState,
  GamePhase,
  GameMode,
  AiDifficulty,
  CellValue,
  PlayerSymbol,
  Scoreboard,
  SocketAttachment,
  IncomingMessage,
  MoveResult,
  DebugEvent,
  DebugEventCategory,
  MAX_CONNECTIONS,
  RATE_LIMIT_MAX_TOKENS,
  RATE_LIMIT_REFILL_RATE,
  IDLE_SOCKET_TIMEOUT_MS,
  ROOM_TTL_MS,
  ALARM_INTERVAL_MS,
  AI_MOVE_DELAY_MS,
} from './types';
import { validateAndApply, computeAiMove } from './sandbox';

// ---- Rate limiter per socket ----

interface RateLimitBucket {
  tokens: number;
  lastRefill: number;
}

const rateLimitBuckets = new WeakMap<WebSocket, RateLimitBucket>();
const socketActivity = new WeakMap<WebSocket, number>();

function checkRateLimit(ws: WebSocket): boolean {
  const now = Date.now();
  let bucket = rateLimitBuckets.get(ws);
  if (!bucket) {
    bucket = { tokens: RATE_LIMIT_MAX_TOKENS, lastRefill: now };
    rateLimitBuckets.set(ws, bucket);
  }

  // Refill tokens based on elapsed time.
  const elapsed = (now - bucket.lastRefill) / 1000;
  bucket.tokens = Math.min(RATE_LIMIT_MAX_TOKENS, bucket.tokens + elapsed * RATE_LIMIT_REFILL_RATE);
  bucket.lastRefill = now;

  if (bucket.tokens < 1) {
    return false; // Rate limited.
  }

  bucket.tokens -= 1;
  return true;
}

// ---- TicTacToe Durable Object ----

export class TicTacToe {
  state: DurableObjectState;
  env: Env;
  board: CellValue[];
  turn: PlayerSymbol;
  winner: string | null;
  winLine: number[] | null;
  phase: GamePhase;
  playerX: string | null;
  playerO: string | null;
  nameX: string | null;
  nameO: string | null;
  resetRequestedBy: string | null;
  lastStarter: PlayerSymbol;
  lastRoomActivity: number;
  winsX: number;
  winsO: number;
  draws: number;
  stateLoaded: boolean;
  gameMode: GameMode;
  aiDifficulty: AiDifficulty | null;
  debugLog: DebugEvent[];

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.board = Array(9).fill(null) as CellValue[];
    this.turn = 'X';
    this.winner = null;
    this.winLine = null;
    this.phase = 'waiting';
    this.playerX = null;
    this.playerO = null;
    this.nameX = null;
    this.nameO = null;
    this.resetRequestedBy = null;
    this.lastStarter = 'X';
    this.lastRoomActivity = Date.now();
    this.winsX = 0;
    this.winsO = 0;
    this.draws = 0;
    this.stateLoaded = false;
    this.gameMode = 'multiplayer';
    this.aiDifficulty = null;
    this.debugLog = [];
  }

  // Append a transient debug event (flushed in broadcastState, never persisted).
  private pushDebug(category: DebugEventCategory, label: string, detail?: string): void {
    this.debugLog.push({ ts: Date.now(), category, label, detail });
  }

  // Smart state caching — loads from storage only once per DO wake cycle.
  async ensureState(): Promise<void> {
    if (this.stateLoaded) {
      this.pushDebug('durable-object', 'State cached in memory', 'Durable Object is still awake — skipped storage read');
      return;
    }
    const stored = await this.state.storage.get<GameState>('gameState');
    if (stored) {
      this.board = stored.board;
      this.turn = stored.turn;
      this.winner = stored.winner;
      this.winLine = stored.winLine ?? null;
      this.phase = stored.phase ?? 'waiting';
      this.playerX = stored.playerX;
      this.playerO = stored.playerO;
      this.nameX = stored.nameX ?? null;
      this.nameO = stored.nameO ?? null;
      this.resetRequestedBy = stored.resetRequestedBy ?? null;
      this.lastStarter = stored.lastStarter ?? 'X';
      this.lastRoomActivity = stored.lastRoomActivity ?? Date.now();
      this.gameMode = stored.gameMode ?? 'multiplayer';
      this.aiDifficulty = stored.aiDifficulty ?? null;
    }
    const scoreboard = await this.state.storage.get<Scoreboard>('scoreboard');
    if (scoreboard) {
      this.winsX = scoreboard.winsX;
      this.winsO = scoreboard.winsO;
      this.draws = scoreboard.draws;
    }
    this.stateLoaded = true;
    this.pushDebug('durable-object', 'Durable Object woke up — state loaded from storage', 'First request this wake cycle: hydrating from persistent storage');
  }

  async saveState(): Promise<void> {
    this.pushDebug('durable-object', 'State persisted to storage', 'storage.put(): gameState (14 fields)');
    await this.state.storage.put<GameState>('gameState', {
      board: this.board,
      turn: this.turn,
      winner: this.winner,
      winLine: this.winLine,
      phase: this.phase,
      playerX: this.playerX,
      playerO: this.playerO,
      nameX: this.nameX,
      nameO: this.nameO,
      resetRequestedBy: this.resetRequestedBy,
      lastStarter: this.lastStarter,
      lastRoomActivity: this.lastRoomActivity,
      gameMode: this.gameMode,
      aiDifficulty: this.aiDifficulty,
    });
  }

  async saveScoreboard(): Promise<void> {
    await this.state.storage.put<Scoreboard>('scoreboard', {
      winsX: this.winsX,
      winsO: this.winsO,
      draws: this.draws,
    });
  }

  // Schedule the cleanup alarm if not already set.
  async ensureAlarm(): Promise<void> {
    const existing = await this.state.storage.getAlarm();
    if (!existing) {
      await this.state.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
      this.pushDebug('durable-object', 'Alarm set: cleanup in 5 min', 'Alarms API will wake this Durable Object for idle cleanup');
    }
  }

  async assignSymbol(clientId: string, name: string): Promise<string> {
    await this.ensureState();

    // Reconnecting player — restore their original symbol.
    if (this.playerX === clientId) {
      this.pushDebug('websocket', 'Player X reconnected', 'Durable Object matched stored clientId — session restored');
      return 'X';
    }
    if (this.playerO === clientId) {
      this.pushDebug('websocket', 'Player O reconnected', 'Durable Object matched stored clientId — session restored');
      return 'O';
    }

    // New player — claim the first available slot.
    if (this.playerX === null) {
      this.playerX = clientId;
      this.nameX = name;
      await this.saveState();
      this.pushDebug('websocket', 'Player 1 joined as X', 'DO reserved slot 1/2 - waiting for second player');
      return 'X';
    }
    if (this.playerO === null && this.playerO !== '__AI__') {
      this.playerO = clientId;
      this.nameO = name;
      // Transition to playing phase when both players are present.
      if (this.phase === 'waiting') {
        this.phase = 'playing';
        this.pushDebug('state-machine', 'Phase: waiting → playing', 'Both players connected — game started');
      }
      await this.saveState();
      this.pushDebug('websocket', 'Player 2 joined as O', 'Both slots filled - game can start');
      return 'O';
    }

    this.pushDebug('websocket', 'Spectator connected (room full)', 'Max 2 players per room - this connection is observer mode');
    return 'Spectator';
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    // Connection limit per room.
    const currentSockets = this.state.getWebSockets();
    if (currentSockets.length >= MAX_CONNECTIONS) {
      return new Response('Room is full', { status: 503 });
    }

    const url = new URL(request.url);
    const roomCode = (url.searchParams.get('room') ?? 'UNKNOWN').toUpperCase();
    const clientId = url.searchParams.get('clientId') ?? crypto.randomUUID();
    const name = (url.searchParams.get('name') ?? '').trim().slice(0, 20) || 'Player';
    const mode = (url.searchParams.get('mode') ?? 'multiplayer') as GameMode;
    const difficulty = (url.searchParams.get('difficulty') ?? 'hard') as AiDifficulty;

    if (currentSockets.length === 0) {
      this.pushDebug('durable-object', 'Room ' + roomCode + ' created', 'Worker routed request → Durable Object instantiated');
    }

    const { 0: client, 1: server } = new WebSocketPair();

    const symbol = await this.assignSymbol(clientId, name);

    // Set up single-player mode when the first player connects.
    if (mode === 'singleplayer' && symbol === 'X' && this.gameMode !== 'singleplayer') {
      this.gameMode = 'singleplayer';
      this.aiDifficulty = difficulty;
      this.playerO = '__AI__';
      this.nameO = 'AI (' + difficulty.charAt(0).toUpperCase() + difficulty.slice(1) + ')';
      this.phase = 'playing';
      this.pushDebug('state-machine', 'Phase: waiting → playing', 'AI opponent (' + difficulty + ') assigned to O slot');
      await this.saveState();
    }

    this.state.acceptWebSocket(server);
    server.serializeAttachment({ symbol, clientId, name } as SocketAttachment);
    this.pushDebug('websocket', 'WebSocket accepted + hibernated', 'Symbol: ' + symbol + ' — zero cost while idle (hibernation API)');

    await this.ensureState();
    this.lastRoomActivity = Date.now();
    await this.saveState();
    await this.ensureAlarm();

    const colo = request.headers.get('X-CF-Colo') ?? undefined;
    server.send(JSON.stringify({ type: 'init', symbol, colo }));
    this.broadcastState();

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string): Promise<void> {
    // Rate limiting check.
    const allowed = checkRateLimit(ws);
    const bucket = rateLimitBuckets.get(ws);
    if (!allowed) {
      this.pushDebug('websocket', 'Rate limit: move blocked', 'Token bucket depleted: ' + (bucket ? bucket.tokens.toFixed(1) : '0') + '/' + RATE_LIMIT_MAX_TOKENS + ' tokens');
      try { ws.send(JSON.stringify({ type: 'rate_limited' })); } catch { /* ignore */ }
      return;
    }
    if (bucket && bucket.tokens < 5) {
      this.pushDebug('websocket', 'Rate limit: tokens running low', 'Bucket: ' + bucket.tokens.toFixed(1) + '/' + RATE_LIMIT_MAX_TOKENS + ' (refills at ' + RATE_LIMIT_REFILL_RATE + '/sec)');
    }

    // Track activity for idle timeout.
    socketActivity.set(ws, Date.now());
    this.lastRoomActivity = Date.now();

    await this.ensureState();

    // JSON parse error handling — silently drop malformed messages.
    let data: IncomingMessage;
    try {
      data = JSON.parse(message) as IncomingMessage;
    } catch {
      return;
    }

    const attachment = ws.deserializeAttachment() as SocketAttachment;
    const { symbol: playerSymbol, clientId } = attachment;
    this.pushDebug('websocket', 'Player message received', 'type: ' + data.type + (data.index !== undefined ? ', cell: ' + data.index : ''));

    if (data.type === 'move' && this.phase === 'playing' && !this.winner) {
      const index = data.index;
      if (index === undefined) return;

      // In single-player mode, only the human (X) can send moves.
      if (this.gameMode === 'singleplayer' && playerSymbol !== 'X') return;

      const result = validateAndApply(this.board, playerSymbol, index, this.turn);

      if (result.valid) {
        this.pushDebug('durable-object', 'Move accepted: cell ' + index, playerSymbol + ' placed at index ' + index + ' — board updated');
        this.board = result.board;
        this.winner = result.winner;
        this.winLine = result.winLine;

        if (this.winner) {
          this.phase = 'finished';
          if (this.winner === 'X') this.winsX++;
          else if (this.winner === 'O') this.winsO++;
          else if (this.winner === 'Draw') this.draws++;
          await this.saveScoreboard();
          if (this.winner === 'Draw') {
            this.pushDebug('state-machine', 'Game over — draw', 'Board full, no winner; scoreboard persisted');
          } else {
            this.pushDebug('state-machine', 'Game over — ' + this.winner + ' wins!', 'Winning line: [' + (this.winLine || []).join(', ') + ']; scoreboard persisted');
          }
        } else {
          // Switch turns.
          const prev = this.turn;
          this.turn = this.turn === 'X' ? 'O' : 'X';
          this.pushDebug('state-machine', 'Turn: ' + prev + ' → ' + this.turn, 'Broadcasting updated state to all connected clients');
        }

        await this.saveState();
        this.broadcastState();

        // AI's turn in single-player mode.
        if (
          this.gameMode === 'singleplayer' &&
          this.turn === 'O' &&
          !this.winner &&
          this.phase === 'playing'
        ) {
          await this.executeAiMove();
        }
      }
    } else if (data.type === 'reset' && this.phase === 'finished') {
      // Auth check: only actual players can reset.
      if (clientId !== this.playerX && clientId !== this.playerO) return;

      // Single-player: immediate reset, no mutual protocol needed.
      if (this.gameMode === 'singleplayer') {
        if (this.winner === 'X' || this.winner === 'O') {
          this.turn = this.winner as PlayerSymbol;
        } else {
          this.turn = this.lastStarter === 'X' ? 'O' : 'X';
        }
        this.lastStarter = this.turn;
        this.board = Array(9).fill(null) as CellValue[];
        this.winner = null;
        this.winLine = null;
        this.phase = 'playing';
        this.resetRequestedBy = null;
        this.pushDebug('state-machine', 'Board reset — new game', 'Single-player: instant reset, no confirmation needed; first move: ' + this.turn);
        await this.saveState();
        this.broadcastState();

        // If AI starts, make its move.
        if (this.turn === 'O') {
          await this.executeAiMove();
        }
        return;
      }

      // Multiplayer: mutual reset protocol.
      if (this.resetRequestedBy === null) {
        // First player requests reset.
        this.resetRequestedBy = clientId;
        this.pushDebug('state-machine', 'Rematch requested by ' + playerSymbol, 'Multiplayer: waiting for opponent confirmation');
        await this.saveState();
        this.broadcastState();
      } else if (this.resetRequestedBy !== clientId) {
        // Second player agrees — execute reset.
        // Winner starts next; on draw, alternate starter.
        if (this.winner === 'X' || this.winner === 'O') {
          this.turn = this.winner as PlayerSymbol;
        } else {
          this.turn = this.lastStarter === 'X' ? 'O' : 'X';
        }
        this.lastStarter = this.turn;
        this.board = Array(9).fill(null) as CellValue[];
        this.winner = null;
        this.winLine = null;
        this.phase = 'playing';
        this.resetRequestedBy = null;
        this.pushDebug('state-machine', 'Rematch confirmed — new game', 'Both players agreed; first move: ' + this.turn);
        await this.saveState();
        this.broadcastState();
      }
      // If same player sends reset again, ignore.
    }
  }

  // Execute AI move with a brief delay for natural feel.
  private async executeAiMove(): Promise<void> {
    const diff = this.aiDifficulty ?? 'hard';
    this.pushDebug('ai', 'AI computing move', 'Difficulty: ' + diff + (diff === 'hard' ? ' — minimax with alpha-beta pruning' : diff === 'medium' ? ' — 50% optimal / 50% random' : ' — random selection'));
    const t0 = Date.now();
    await new Promise<void>(resolve => setTimeout(resolve, AI_MOVE_DELAY_MS));

    const aiIndex = computeAiMove(this.board, 'O', diff);
    const elapsed = Date.now() - t0;
    this.pushDebug('ai', 'AI placed O at cell ' + aiIndex, 'Computed in ' + elapsed + 'ms (includes ' + AI_MOVE_DELAY_MS + 'ms UX delay)');
    const result = validateAndApply(this.board, 'O', aiIndex, this.turn);

    if (result.valid) {
      this.board = result.board;
      this.winner = result.winner;
      this.winLine = result.winLine;

      if (this.winner) {
        this.phase = 'finished';
        if (this.winner === 'X') this.winsX++;
        else if (this.winner === 'O') this.winsO++;
        else if (this.winner === 'Draw') this.draws++;
        await this.saveScoreboard();
        if (this.winner === 'Draw') {
          this.pushDebug('state-machine', 'Game over — draw', 'Board full, no winner; scoreboard persisted');
        } else {
          this.pushDebug('state-machine', 'Game over — ' + this.winner + ' wins!', 'Winning line: [' + (this.winLine || []).join(', ') + ']; scoreboard persisted');
        }
      } else {
        this.turn = 'X';
        this.pushDebug('state-machine', 'Turn: O → X', 'Broadcasting updated state to all connected clients');
      }

      await this.saveState();
      this.broadcastState();
    }
  }

  async webSocketClose(
    _ws: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    await this.ensureState();
    const remaining = this.state.getWebSockets();

    if (remaining.length === 0) {
      this.board = Array(9).fill(null) as CellValue[];
      this.winner = null;
      this.winLine = null;
      this.turn = 'X';
      this.phase = 'waiting';
      this.playerX = null;
      this.playerO = null;
      this.nameX = null;
      this.nameO = null;
      this.resetRequestedBy = null;
      this.lastStarter = 'X';
      this.lastRoomActivity = Date.now();
      this.winsX = 0;
      this.winsO = 0;
      this.draws = 0;
      this.gameMode = 'multiplayer';
      this.aiDifficulty = null;
      await this.saveState();
      await this.state.storage.delete('scoreboard');
    } else {
      this.broadcastState();
    }
  }

  async webSocketError(_ws: WebSocket, _error: unknown): Promise<void> {
    await this.ensureState();
    const remaining = this.state.getWebSockets();

    if (remaining.length === 0) {
      this.board = Array(9).fill(null) as CellValue[];
      this.winner = null;
      this.winLine = null;
      this.turn = 'X';
      this.phase = 'waiting';
      this.playerX = null;
      this.playerO = null;
      this.nameX = null;
      this.nameO = null;
      this.resetRequestedBy = null;
      this.lastStarter = 'X';
      this.winsX = 0;
      this.winsO = 0;
      this.draws = 0;
      this.gameMode = 'multiplayer';
      this.aiDifficulty = null;
      await this.saveState();
      await this.state.storage.delete('scoreboard');
    } else {
      this.broadcastState();
    }
  }

  // Alarm handler: idle socket cleanup + room TTL cleanup.
  async alarm(): Promise<void> {
    await this.ensureState();
    const now = Date.now();
    const sockets = this.state.getWebSockets();

    // Close sockets idle > 30 min.
    for (const ws of sockets) {
      const lastActive = socketActivity.get(ws) ?? 0;
      if (now - lastActive > IDLE_SOCKET_TIMEOUT_MS) {
        try {
          ws.close(1000, 'idle_timeout');
        } catch {
          // Socket already closed.
        }
      }
    }

    // Room TTL cleanup: if 0 sockets and idle > 24h, delete all storage.
    const remainingSockets = this.state.getWebSockets();
    if (remainingSockets.length === 0 && now - this.lastRoomActivity > ROOM_TTL_MS) {
      await this.state.storage.deleteAll();
      return; // No need to reschedule alarm.
    }

    // Reschedule alarm.
    await this.state.storage.setAlarm(now + ALARM_INTERVAL_MS);
  }

  broadcastState(): void {
    const activeSockets = this.state.getWebSockets();
    const stateMessage = JSON.stringify({
      type: 'state',
      board: this.board,
      turn: this.turn,
      winner: this.winner,
      winLine: this.winLine,
      phase: this.phase,
      playersCount: activeSockets.length,
      nameX: this.nameX,
      nameO: this.nameO,
      resetRequestedBy: this.resetRequestedBy,
      winsX: this.winsX,
      winsO: this.winsO,
      draws: this.draws,
      gameMode: this.gameMode,
      aiDifficulty: this.aiDifficulty,
      debug: this.debugLog,
    });
    // Flush debug events after serialization.
    this.debugLog = [];
    for (const ws of activeSockets) {
      try {
        ws.send(stateMessage);
      } catch {
        // Socket broken — close it so it's removed on next getWebSockets().
        try { ws.close(1011, 'send_failed'); } catch { /* ignore */ }
      }
    }
  }

}
