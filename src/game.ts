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
  MAX_CONNECTIONS,
  RATE_LIMIT_MAX_TOKENS,
  RATE_LIMIT_REFILL_RATE,
  IDLE_SOCKET_TIMEOUT_MS,
  ROOM_TTL_MS,
  ALARM_INTERVAL_MS,
  AI_MOVE_DELAY_MS,
} from './types';
import { validateAndApply, computeAiMove, GAME_RULES_MODULE } from './sandbox';

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
  }

  // Smart state caching — loads from storage only once per DO wake cycle.
  async ensureState(): Promise<void> {
    if (this.stateLoaded) return;
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
  }

  async saveState(): Promise<void> {
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
    }
  }

  async assignSymbol(clientId: string, name: string): Promise<string> {
    await this.ensureState();

    // Reconnecting player — restore their original symbol.
    if (this.playerX === clientId) return 'X';
    if (this.playerO === clientId) return 'O';

    // New player — claim the first available slot.
    if (this.playerX === null) {
      this.playerX = clientId;
      this.nameX = name;
      await this.saveState();
      return 'X';
    }
    if (this.playerO === null && this.playerO !== '__AI__') {
      this.playerO = clientId;
      this.nameO = name;
      // Transition to playing phase when both players are present.
      if (this.phase === 'waiting') {
        this.phase = 'playing';
      }
      await this.saveState();
      return 'O';
    }

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
    const clientId = url.searchParams.get('clientId') ?? crypto.randomUUID();
    const name = (url.searchParams.get('name') ?? '').trim().slice(0, 20) || 'Player';
    const mode = (url.searchParams.get('mode') ?? 'multiplayer') as GameMode;
    const difficulty = (url.searchParams.get('difficulty') ?? 'hard') as AiDifficulty;

    const { 0: client, 1: server } = new WebSocketPair();

    const symbol = await this.assignSymbol(clientId, name);

    // Set up single-player mode when the first player connects.
    if (mode === 'singleplayer' && symbol === 'X' && this.gameMode !== 'singleplayer') {
      this.gameMode = 'singleplayer';
      this.aiDifficulty = difficulty;
      this.playerO = '__AI__';
      this.nameO = 'AI (' + difficulty.charAt(0).toUpperCase() + difficulty.slice(1) + ')';
      this.phase = 'playing';
      await this.saveState();
    }

    this.state.acceptWebSocket(server);
    server.serializeAttachment({ symbol, clientId, name } as SocketAttachment);

    await this.ensureState();
    this.lastRoomActivity = Date.now();
    await this.saveState();
    await this.ensureAlarm();

    server.send(JSON.stringify({ type: 'init', symbol }));
    this.broadcastState();

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string): Promise<void> {
    // Rate limiting check.
    if (!checkRateLimit(ws)) {
      try { ws.send(JSON.stringify({ type: 'rate_limited' })); } catch { /* ignore */ }
      return;
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

    if (data.type === 'move' && this.phase === 'playing' && !this.winner) {
      const index = data.index;
      if (index === undefined) return;

      // In single-player mode, only the human (X) can send moves.
      if (this.gameMode === 'singleplayer' && playerSymbol !== 'X') return;

      // Use sandbox for move validation if available, otherwise local fallback.
      let result: MoveResult;
      try {
        result = await this.executeInSandbox(this.board, playerSymbol, index, this.turn);
      } catch {
        // Sandbox unavailable — use local fallback.
        result = validateAndApply(this.board, playerSymbol, index, this.turn);
      }

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
        } else {
          // Switch turns.
          this.turn = this.turn === 'X' ? 'O' : 'X';
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
        await this.saveState();
        this.broadcastState();
      }
      // If same player sends reset again, ignore.
    }
  }

  // Execute AI move with a brief delay for natural feel.
  private async executeAiMove(): Promise<void> {
    await new Promise<void>(resolve => setTimeout(resolve, AI_MOVE_DELAY_MS));

    const aiIndex = computeAiMove(this.board, 'O', this.aiDifficulty ?? 'hard');
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
      } else {
        this.turn = 'X';
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
    });
    for (const ws of activeSockets) {
      try {
        ws.send(stateMessage);
      } catch {
        // Socket broken — close it so it's removed on next getWebSockets().
        try { ws.close(1011, 'send_failed'); } catch { /* ignore */ }
      }
    }
  }

  // Execute move validation in a Dynamic Worker sandbox.
  // Falls back to local validation if LOADER is unavailable.
  private async executeInSandbox(
    board: CellValue[],
    playerSymbol: string,
    moveIndex: number,
    turn: string,
  ): Promise<MoveResult> {
    // Check if LOADER binding exists (Dynamic Workers API).
    if (!this.env.LOADER) {
      return validateAndApply(board, playerSymbol, moveIndex, turn);
    }

    const worker = await this.env.LOADER.load({
      mainModule: 'rules.js',
      modules: {
        'rules.js': GAME_RULES_MODULE,
      },
      globalOutbound: null, // No network access.
    });

    const entrypoint = worker.getEntrypoint();
    return entrypoint.validateAndApply(board, playerSymbol, moveIndex, turn);
  }
}
