// ==========================================
// UNIT TESTS: Game Rules & AI Engine
// ==========================================

import { describe, it, expect } from 'vitest';
import { validateAndApply, computeAiMove } from '../sandbox';
import type { CellValue, PlayerSymbol } from '../types';

// ---- Helper ----

function board(template: string): CellValue[] {
  // Parse a 9-char string like 'XO_X__O__' into CellValue[]
  return template.split('').map(c => (c === 'X' ? 'X' : c === 'O' ? 'O' : null));
}

function emptyBoard(): CellValue[] {
  return Array(9).fill(null) as CellValue[];
}

function countEmpty(b: CellValue[]): number {
  return b.filter(c => c === null).length;
}

// ==========================================
// validateAndApply
// ==========================================

describe('validateAndApply', () => {
  describe('valid moves', () => {
    it('should accept a valid move on an empty cell', () => {
      const result = validateAndApply(emptyBoard(), 'X', 0, 'X');
      expect(result.valid).toBe(true);
      expect(result.board[0]).toBe('X');
      expect(result.winner).toBeNull();
    });

    it('should not mutate the original board', () => {
      const original = emptyBoard();
      const result = validateAndApply(original, 'X', 4, 'X');
      expect(original[4]).toBeNull();
      expect(result.board[4]).toBe('X');
    });

    it('should alternate turns correctly', () => {
      const b = board('X________');
      const result = validateAndApply(b, 'O', 1, 'O');
      expect(result.valid).toBe(true);
      expect(result.board[1]).toBe('O');
    });
  });

  describe('invalid moves', () => {
    it('should reject a move on an occupied cell', () => {
      const b = board('X________');
      const result = validateAndApply(b, 'O', 0, 'O');
      expect(result.valid).toBe(false);
    });

    it('should reject a move when it is not the player turn', () => {
      const result = validateAndApply(emptyBoard(), 'O', 0, 'X');
      expect(result.valid).toBe(false);
    });

    it('should reject a move with index out of bounds (negative)', () => {
      const result = validateAndApply(emptyBoard(), 'X', -1, 'X');
      expect(result.valid).toBe(false);
    });

    it('should reject a move with index out of bounds (>8)', () => {
      const result = validateAndApply(emptyBoard(), 'X', 9, 'X');
      expect(result.valid).toBe(false);
    });

    it('should reject a non-integer index', () => {
      const result = validateAndApply(emptyBoard(), 'X', 1.5, 'X');
      expect(result.valid).toBe(false);
    });
  });

  describe('win detection', () => {
    it('should detect a row win (top row)', () => {
      const b = board('XX_OO____');
      const result = validateAndApply(b, 'X', 2, 'X');
      expect(result.valid).toBe(true);
      expect(result.winner).toBe('X');
      expect(result.winLine).toEqual([0, 1, 2]);
    });

    it('should detect a row win (middle row)', () => {
      const b = board('__XOO_X__');
      const result = validateAndApply(b, 'O', 5, 'O');
      expect(result.valid).toBe(true);
      expect(result.winner).toBe('O');
      expect(result.winLine).toEqual([3, 4, 5]);
    });

    it('should detect a column win', () => {
      const b = board('X_OX_O___');
      const result = validateAndApply(b, 'X', 6, 'X');
      expect(result.valid).toBe(true);
      expect(result.winner).toBe('X');
      expect(result.winLine).toEqual([0, 3, 6]);
    });

    it('should detect a diagonal win (top-left to bottom-right)', () => {
      const b = board('X_OOX____');
      const result = validateAndApply(b, 'X', 8, 'X');
      expect(result.valid).toBe(true);
      expect(result.winner).toBe('X');
      expect(result.winLine).toEqual([0, 4, 8]);
    });

    it('should detect a diagonal win (top-right to bottom-left)', () => {
      const b = board('_XO_OX___');
      const result = validateAndApply(b, 'O', 6, 'O');
      expect(result.valid).toBe(true);
      expect(result.winner).toBe('O');
      expect(result.winLine).toEqual([2, 4, 6]);
    });
  });

  describe('draw detection', () => {
    it('should detect a draw when the board is full with no winner', () => {
      // X O X
      // X O O
      // O X _
      const b = board('XOXXOOOХ_'.replace('Х', 'X'));
      // Cleaner: build directly
      const b2: CellValue[] = ['X', 'O', 'X', 'X', 'O', 'O', 'O', 'X', null];
      const result = validateAndApply(b2, 'X', 8, 'X');
      expect(result.valid).toBe(true);
      expect(result.winner).toBe('Draw');
      expect(result.winLine).toBeNull();
    });
  });

  describe('no winner yet', () => {
    it('should return null winner when game is still in progress', () => {
      const result = validateAndApply(emptyBoard(), 'X', 4, 'X');
      expect(result.winner).toBeNull();
      expect(result.winLine).toBeNull();
    });
  });
});

// ==========================================
// AI Engine (computeAiMove)
// ==========================================

describe('computeAiMove', () => {
  describe('hard difficulty (minimax — unbeatable)', () => {
    it('should return a valid empty cell index', () => {
      const b = emptyBoard();
      const move = computeAiMove(b, 'O', 'hard');
      expect(move).toBeGreaterThanOrEqual(0);
      expect(move).toBeLessThanOrEqual(8);
      expect(b[move]).toBeNull();
    });

    it('should take the winning move when one exists', () => {
      // O O _ | X X _ | _ _ _
      const b = board('OO_XX____');
      const move = computeAiMove(b, 'O', 'hard');
      expect(move).toBe(2); // Complete top row
    });

    it('should block the opponent winning move', () => {
      // X X _ | O _ _ | _ _ _
      const b = board('XX_O_____');
      const move = computeAiMove(b, 'O', 'hard');
      expect(move).toBe(2); // Must block X from completing top row
    });

    it('should never lose as O when playing optimally from start', () => {
      // Simulate a full game where AI plays as O and X plays randomly but validly
      // Run multiple games to test robustness
      for (let trial = 0; trial < 50; trial++) {
        const b = emptyBoard();
        let turn: PlayerSymbol = 'X';
        let winner: string | null = null;

        while (!winner && countEmpty(b) > 0) {
          let move: number;
          if (turn === 'O') {
            move = computeAiMove(b, 'O', 'hard');
          } else {
            // X plays randomly
            const empties: number[] = [];
            for (let i = 0; i < 9; i++) {
              if (b[i] === null) empties.push(i);
            }
            move = empties[Math.floor(Math.random() * empties.length)]!;
          }

          const result = validateAndApply(b, turn, move, turn);
          expect(result.valid).toBe(true);
          for (let i = 0; i < 9; i++) b[i] = result.board[i]!;
          winner = result.winner;
          turn = turn === 'X' ? 'O' : 'X';
        }

        // AI (O) should never lose — only win or draw
        expect(winner).not.toBe('X');
      }
    });

    it('should never lose as X when playing optimally from start', () => {
      for (let trial = 0; trial < 50; trial++) {
        const b = emptyBoard();
        let turn: PlayerSymbol = 'X';
        let winner: string | null = null;

        while (!winner && countEmpty(b) > 0) {
          let move: number;
          if (turn === 'X') {
            move = computeAiMove(b, 'X', 'hard');
          } else {
            const empties: number[] = [];
            for (let i = 0; i < 9; i++) {
              if (b[i] === null) empties.push(i);
            }
            move = empties[Math.floor(Math.random() * empties.length)]!;
          }

          const result = validateAndApply(b, turn, move, turn);
          expect(result.valid).toBe(true);
          for (let i = 0; i < 9; i++) b[i] = result.board[i]!;
          winner = result.winner;
          turn = turn === 'X' ? 'O' : 'X';
        }

        expect(winner).not.toBe('O');
      }
    });

    it('two hard AIs playing each other should always draw', () => {
      for (let trial = 0; trial < 10; trial++) {
        const b = emptyBoard();
        let turn: PlayerSymbol = 'X';
        let winner: string | null = null;

        while (!winner && countEmpty(b) > 0) {
          const move = computeAiMove(b, turn, 'hard');
          const result = validateAndApply(b, turn, move, turn);
          expect(result.valid).toBe(true);
          for (let i = 0; i < 9; i++) b[i] = result.board[i]!;
          winner = result.winner;
          turn = turn === 'X' ? 'O' : 'X';
        }

        expect(winner).toBe('Draw');
      }
    });
  });

  describe('easy difficulty (random)', () => {
    it('should return a valid empty cell index', () => {
      const b = board('XOXOX____');
      const move = computeAiMove(b, 'O', 'easy');
      expect(move).toBeGreaterThanOrEqual(0);
      expect(move).toBeLessThanOrEqual(8);
      expect(b[move]).toBeNull();
    });

    it('should work when only one cell is left', () => {
      const b = board('XOXOXXO_O');
      const move = computeAiMove(b, 'X', 'easy');
      expect(move).toBe(7);
    });
  });

  describe('medium difficulty (mixed)', () => {
    it('should return a valid empty cell index', () => {
      const b = emptyBoard();
      const move = computeAiMove(b, 'O', 'medium');
      expect(move).toBeGreaterThanOrEqual(0);
      expect(move).toBeLessThanOrEqual(8);
      expect(b[move]).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('should handle nearly full board', () => {
      // Only one cell left
      const b = board('XOXXOO_XO');
      const move = computeAiMove(b, 'X', 'hard');
      expect(move).toBe(6);
    });

    it('should prefer winning over blocking', () => {
      // O can win at 8, but X also threatens at 2
      // O _ _ | _ O _ | X X _
      const b = board('O___O_XX_');
      const move = computeAiMove(b, 'O', 'hard');
      expect(move).toBe(8); // O wins via diagonal
    });
  });
});
