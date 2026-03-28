import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';

const HOST = 'tictactoe.ksanthoshkumar.com';
const PROTOCOL = 'wss'; // Set to wss for production
const NUM_PAIRS = 500;
const MOVE_DELAY_MS = 600; // 600ms to avoid rate limiting (refill is 2/sec)

// Metrics
const metrics = {
  connectionsAttempted: 0,
  connectionsEstablished: 0,
  connectionsFailed: 0,
  connectionsClosed: 0,
  gamesFinished: 0,
  movesSent: 0,
  rateLimitsHit: 0,
  errors: 0,
  moveLatencies: [] as number[],
  connectionLatencies: [] as number[],
};

// Start the load test
async function runLoadTest() {
  console.log(`Starting load test: ${NUM_PAIRS} pairs (Total ${NUM_PAIRS * 2} connections)`);
  console.log(`Target: ${PROTOCOL}://${HOST}/ws`);
  console.log(`Move delay: ${MOVE_DELAY_MS}ms`);
  console.log('---');

  const startTime = Date.now();
  const rooms: RoomSimulation[] = [];

  // Generate rooms and start them with a slight stagger
  for (let i = 0; i < NUM_PAIRS; i++) {
    const roomCode = generateRoomCode(i);
    const room = new RoomSimulation(roomCode);
    rooms.push(room);
    
    // Stagger connections slightly to avoid massive thundering herd
    await new Promise(resolve => setTimeout(resolve, 50));
    room.start();
  }

  // Periodic status update
  const intervalId = setInterval(() => {
    printMetrics();
  }, 5000);

  // Run for a specified duration or until all games finish
  // Let's run until all games finish once, or max 30 seconds to avoid hanging forever
  let allFinished = false;
  let loops = 0;
  while (!allFinished && loops < 30) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    allFinished = rooms.every(r => r.finished);
    loops++;
  }

  if (!allFinished) {
    console.log("\nTimeout reached! The following rooms did not finish:");
    const unfinished = rooms.filter(r => !r.finished);
    console.log(unfinished.map(r => r.roomCode).join(', '));
  }

  clearInterval(intervalId);
  console.log('\n=======================================');
  console.log('LOAD TEST COMPLETE');
  console.log(`Total execution time: ${(Date.now() - startTime) / 1000}s`);
  printMetrics();
  
  // Cleanup
  for (const room of rooms) {
    room.cleanup();
  }
}

function generateRoomCode(_index: number): string {
  // Use random room codes to avoid collisions with stale rooms from previous runs
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function printMetrics() {
  const avgMoveLatency = metrics.moveLatencies.length > 0 
    ? metrics.moveLatencies.reduce((a, b) => a + b, 0) / metrics.moveLatencies.length 
    : 0;
    
  const avgConnLatency = metrics.connectionLatencies.length > 0
    ? metrics.connectionLatencies.reduce((a, b) => a + b, 0) / metrics.connectionLatencies.length
    : 0;

  console.log('\n--- Metrics ---');
  console.log(`Connections: ${metrics.connectionsEstablished} / ${metrics.connectionsAttempted} (Failed: ${metrics.connectionsFailed}, Closed: ${metrics.connectionsClosed})`);
  console.log(`Games Finished: ${metrics.gamesFinished} / ${NUM_PAIRS}`);
  console.log(`Moves Sent: ${metrics.movesSent}`);
  console.log(`Rate Limits Hit: ${metrics.rateLimitsHit}`);
  console.log(`Errors: ${metrics.errors}`);
  console.log(`Avg Connection Latency: ${avgConnLatency.toFixed(2)}ms`);
  console.log(`Avg Move Latency: ${avgMoveLatency.toFixed(2)}ms`);
}

class RoomSimulation {
  roomCode: string;
  playerX: BotPlayer;
  playerO: BotPlayer;
  finished: boolean = false;

  constructor(roomCode: string) {
    this.roomCode = roomCode;
    this.playerX = new BotPlayer(this.roomCode, 'X');
    this.playerO = new BotPlayer(this.roomCode, 'O');
    
    // Wire up events
    this.playerX.onGameFinished = () => this.checkFinished();
    this.playerO.onGameFinished = () => this.checkFinished();
  }

  start() {
    // Player X connects first, then Player O
    this.playerX.connect();
    setTimeout(() => {
      this.playerO.connect();
    }, 200);
  }

  checkFinished() {
    if (this.playerX.gameFinished && this.playerO.gameFinished) {
      this.finished = true;
      metrics.gamesFinished++;
    }
  }

  cleanup() {
    this.playerX.disconnect();
    this.playerO.disconnect();
  }
}

class BotPlayer {
  roomCode: string;
  symbol: 'X' | 'O';
  assignedSymbol: 'X' | 'O' | 'Spectator' | null = null;
  clientId: string;
  ws: WebSocket | null = null;
  gameFinished: boolean = false;
  onGameFinished: (() => void) | null = null;
  lastMoveSentTime: number = 0;
  pendingMoveIndex: number | null = null;

  constructor(roomCode: string, symbol: 'X' | 'O') {
    this.roomCode = roomCode;
    this.symbol = symbol;
    this.clientId = uuidv4();
  }

  connect() {
    metrics.connectionsAttempted++;
    const startTime = Date.now();
    
    const url = `${PROTOCOL}://${HOST}/ws?room=${this.roomCode}&clientId=${this.clientId}&name=Bot_${this.symbol}`;
    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      const latency = Date.now() - startTime;
      metrics.connectionLatencies.push(latency);
      metrics.connectionsEstablished++;
    });

    this.ws.on('message', (data) => {
      this.handleMessage(data.toString());
    });

    this.ws.on('error', (err) => {
      metrics.errors++;
      metrics.connectionsFailed++;
      console.error(`[${this.roomCode}-${this.symbol}] WS Error:`, err.message);
    });

    this.ws.on('close', () => {
      metrics.connectionsClosed++;
    });
  }

  handleMessage(message: string) {
    try {
      const data = JSON.parse(message);

      if (data.type === 'init') {
        this.assignedSymbol = data.symbol;
      }

      if (data.type === 'state') {
        // Record latency if we had a pending move
        if (this.pendingMoveIndex !== null) {
          // Check if board reflects our move
          if (data.board[this.pendingMoveIndex] === this.symbol) {
            const latency = Date.now() - this.lastMoveSentTime;
            // Only push latency if it's a positive number (sane value)
            if (latency > 0 && latency < 5000) {
              metrics.moveLatencies.push(latency);
            }
            this.pendingMoveIndex = null;
          } else if (data.turn === this.symbol) {
            // Turn came back to us but our move isn't there, likely dropped or race condition
            this.pendingMoveIndex = null;
          }
        }

        // Handle case where we aren't actually the player we think we are due to ghost connections
        if (this.assignedSymbol && this.assignedSymbol !== this.symbol) {
          // We were assigned a different role (like Spectator or the opposite symbol)
          // due to state left over from previous test runs.
          // Just mark this bot as "finished" so the test can proceed.
          if (!this.gameFinished) {
            this.gameFinished = true;
            if (this.onGameFinished) this.onGameFinished();
          }
          return;
        }

        if (data.phase === 'playing') {
          // Only play if we haven't already finished a game for this room
          if (!this.gameFinished) {
            // Check if it's our turn AND we don't already have a move pending
            if (data.turn === this.symbol && this.pendingMoveIndex === null) {
              this.makeMove(data.board);
            }
          }
        } else if (data.phase === 'finished' && !this.gameFinished) {
          this.gameFinished = true;
          this.pendingMoveIndex = null;
          if (this.onGameFinished) this.onGameFinished();
        } else if (data.phase === 'waiting') {
          // Waiting for the second player — do nothing, just wait
          this.pendingMoveIndex = null;
        }
      } else if (data.type === 'rate_limited') {
        metrics.rateLimitsHit++;
        this.pendingMoveIndex = null; // Reset to try again later
      }
    } catch (e) {
      // ignore parse errors
    }
  }

  sendReset() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'reset' }));
    }
  }

  makeMove(board: (string | null)[]) {
    // Only make a move if we don't already have one pending
    if (this.pendingMoveIndex !== null || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    // Find all empty cells
    const emptyIndices: number[] = [];
    for (let i = 0; i < 9; i++) {
      if (board[i] === null) {
        emptyIndices.push(i);
      }
    }

    if (emptyIndices.length > 0) {
      // Pick a random empty cell
      const randomEmptyIndex = emptyIndices[Math.floor(Math.random() * emptyIndices.length)];
      
      this.pendingMoveIndex = randomEmptyIndex ?? null;
      
      // Artificial delay to prevent aggressive bot behavior triggering rate limits
      setTimeout(() => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.lastMoveSentTime = Date.now(); // Record time right before sending
          this.ws.send(JSON.stringify({ type: 'move', index: randomEmptyIndex }));
          metrics.movesSent++;
          
          // Add a safety timeout: if the server never responds to our move, clear pending state
          // so we aren't permanently stuck
          setTimeout(() => {
             if (this.pendingMoveIndex === randomEmptyIndex) {
               // Move likely dropped, unstick
               this.pendingMoveIndex = null;
             }
          }, 3000);
        } else {
           // Reset if we couldn't send
           this.pendingMoveIndex = null;
        }
      }, MOVE_DELAY_MS);
    }
  }

  disconnect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close();
    }
  }
}

// Handle unhandled rejections to prevent silent script deaths
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  metrics.errors++;
});

runLoadTest().catch(console.error);
