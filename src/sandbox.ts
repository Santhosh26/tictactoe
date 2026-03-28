// ==========================================
// GAME RULES MODULE + AI ENGINE
// ==========================================

import { CellValue, PlayerSymbol, MoveResult, AiDifficulty, WINNING_LINES } from './types';

// Validate and apply a move, returning the result.
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

// ---- AI Engine (Minimax with Alpha-Beta Pruning) ----

function checkWinner(board: CellValue[]): CellValue | 'Draw' | null {
  for (const [a, b, c] of WINNING_LINES) {
    const cellA = board[a];
    if (cellA && cellA === board[b] && cellA === board[c]) {
      return cellA;
    }
  }
  if (!board.includes(null)) return 'Draw';
  return null;
}

function minimax(
  board: CellValue[],
  aiSymbol: PlayerSymbol,
  depth: number,
  alpha: number,
  beta: number,
  isMaximizing: boolean,
): number {
  const humanSymbol: PlayerSymbol = aiSymbol === 'X' ? 'O' : 'X';
  const winner = checkWinner(board);

  if (winner === aiSymbol) return 10 - depth;
  if (winner === humanSymbol) return depth - 10;
  if (winner === 'Draw') return 0;

  if (isMaximizing) {
    let best = -Infinity;
    for (let i = 0; i < 9; i++) {
      if (board[i] !== null) continue;
      board[i] = aiSymbol;
      best = Math.max(best, minimax(board, aiSymbol, depth + 1, alpha, beta, false));
      board[i] = null;
      alpha = Math.max(alpha, best);
      if (beta <= alpha) break;
    }
    return best;
  } else {
    let best = Infinity;
    for (let i = 0; i < 9; i++) {
      if (board[i] !== null) continue;
      board[i] = humanSymbol;
      best = Math.min(best, minimax(board, aiSymbol, depth + 1, alpha, beta, true));
      board[i] = null;
      beta = Math.min(beta, best);
      if (beta <= alpha) break;
    }
    return best;
  }
}

function getRandomMove(board: CellValue[]): number {
  const empty: number[] = [];
  for (let i = 0; i < 9; i++) {
    if (board[i] === null) empty.push(i);
  }
  return empty[Math.floor(Math.random() * empty.length)]!;
}

function getBestMove(board: CellValue[], aiSymbol: PlayerSymbol): number {
  const copy = [...board] as CellValue[];
  let bestScore = -Infinity;
  let bestIndex = -1;

  for (let i = 0; i < 9; i++) {
    if (copy[i] !== null) continue;
    copy[i] = aiSymbol;
    const score = minimax(copy, aiSymbol, 0, -Infinity, Infinity, false);
    copy[i] = null;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  return bestIndex;
}

// Main entry point for AI move computation.
export function computeAiMove(
  board: CellValue[],
  aiSymbol: PlayerSymbol,
  difficulty: AiDifficulty,
): number {
  switch (difficulty) {
    case 'easy':
      return getRandomMove(board);
    case 'medium':
      return Math.random() < 0.5 ? getBestMove(board, aiSymbol) : getRandomMove(board);
    case 'hard':
      return getBestMove(board, aiSymbol);
  }
}

