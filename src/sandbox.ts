// ==========================================
// SANDBOXED GAME RULES MODULE
// ==========================================
// This string is loaded into a Dynamic Worker isolate via env.LOADER.
// The isolate runs with globalOutbound: null (no network access).

import { CellValue, MoveResult } from './types';

const WINNING_LINES: [number, number, number][] = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

// Validate and apply a move, returning the result.
// This function is also used as the local fallback when LOADER is unavailable.
export function validateAndApply(
  board: CellValue[],
  playerSymbol: string,
  moveIndex: number,
  turn: string,
): MoveResult {
  // Validate move index bounds.
  if (!Number.isInteger(moveIndex) || moveIndex < 0 || moveIndex > 8) {
    return { valid: false, board, winner: null, winLine: null };
  }

  // Cell must be empty.
  if (board[moveIndex] !== null) {
    return { valid: false, board, winner: null, winLine: null };
  }

  // Must be this player's turn.
  if (playerSymbol !== turn) {
    return { valid: false, board, winner: null, winLine: null };
  }

  // Apply move to a copy.
  const newBoard = [...board] as CellValue[];
  newBoard[moveIndex] = playerSymbol as CellValue;

  // Check for winner.
  for (const [a, b, c] of WINNING_LINES) {
    const cellA = newBoard[a];
    if (cellA && cellA === newBoard[b] && cellA === newBoard[c]) {
      return { valid: true, board: newBoard, winner: cellA, winLine: [a, b, c] };
    }
  }

  // Check for draw.
  if (!newBoard.includes(null)) {
    return { valid: true, board: newBoard, winner: 'Draw', winLine: null };
  }

  return { valid: true, board: newBoard, winner: null, winLine: null };
}

// The module source as a string, for loading into a Dynamic Worker isolate.
export const GAME_RULES_MODULE = `
const WINNING_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

export default {
  validateAndApply(board, playerSymbol, moveIndex, turn) {
    if (!Number.isInteger(moveIndex) || moveIndex < 0 || moveIndex > 8) {
      return { valid: false, board, winner: null, winLine: null };
    }
    if (board[moveIndex] !== null) {
      return { valid: false, board, winner: null, winLine: null };
    }
    if (playerSymbol !== turn) {
      return { valid: false, board, winner: null, winLine: null };
    }
    const newBoard = [...board];
    newBoard[moveIndex] = playerSymbol;
    for (const [a, b, c] of WINNING_LINES) {
      const cellA = newBoard[a];
      if (cellA && cellA === newBoard[b] && cellA === newBoard[c]) {
        return { valid: true, board: newBoard, winner: cellA, winLine: [a, b, c] };
      }
    }
    if (!newBoard.includes(null)) {
      return { valid: true, board: newBoard, winner: 'Draw', winLine: null };
    }
    return { valid: true, board: newBoard, winner: null, winLine: null };
  }
};
`;
