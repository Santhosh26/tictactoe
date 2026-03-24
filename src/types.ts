// ==========================================
// SHARED TYPES & CONSTANTS
// ==========================================

export type PlayerSymbol = 'X' | 'O';
export type CellValue = PlayerSymbol | null;
export type GamePhase = 'waiting' | 'playing' | 'finished';

export interface Env {
  GAME_ROOM: DurableObjectNamespace;
}

export interface GameState {
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
  lastRoomActivity: number;
}

export interface SocketAttachment {
  symbol: string;
  clientId: string;
  name: string;
}

export interface MoveResult {
  valid: boolean;
  board: CellValue[];
  winner: string | null;
  winLine: number[] | null;
}

export interface IncomingMessage {
  type: string;
  index?: number;
}

// Winning line indices typed as a fixed-length tuple.
export type WinLine = [number, number, number];

export const WINNING_LINES: WinLine[] = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // Rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // Cols
  [0, 4, 8], [2, 4, 6],             // Diagonals
];

export const MAX_CONNECTIONS = 52; // 2 players + 50 spectators
export const RATE_LIMIT_MAX_TOKENS = 10;
export const RATE_LIMIT_REFILL_RATE = 2; // tokens per second
export const IDLE_SOCKET_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
export const ROOM_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
export const ALARM_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
