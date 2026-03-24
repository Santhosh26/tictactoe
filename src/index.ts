export interface Env {
  GAME_ROOM: DurableObjectNamespace;
  GAME_PASSWORD: string;
}

// ==========================================
// 1. WORKER ROUTER
// ==========================================
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Serve the frontend for all non-API paths
    if (url.pathname === '/') {
      // Inject the server-side password so it never lives in source code.
      const html = HTML_TEMPLATE.replace('__GAME_PASSWORD__', env.GAME_PASSWORD);
      return new Response(html, {
        headers: { 'Content-Type': 'text/html;charset=UTF-8' },
      });
    }

    // WebSocket upgrade — expects ?room=CODE&clientId=UUID
    if (url.pathname === '/ws') {
      const password = url.searchParams.get('password');
      if (password !== env.GAME_PASSWORD) {
        return new Response('Unauthorized', { status: 401 });
      }

      const room = url.searchParams.get('room');
      if (!room || !/^[A-Z0-9]{6}$/.test(room)) {
        return new Response('Bad Request: invalid room code', { status: 400 });
      }

      // Each room code maps to its own Durable Object instance.
      const roomId = env.GAME_ROOM.idFromName(room);
      const roomObject = env.GAME_ROOM.get(roomId);
      return roomObject.fetch(request);
    }

    return new Response('Not Found', { status: 404 });
  },
};

// ==========================================
// 2. DURABLE OBJECT (Game State & Logic)
// ==========================================

interface GameState {
  board: (string | null)[];
  turn: string;
  winner: string | null;
  // Persist player slot assignments so reconnecting clients reclaim their symbol.
  playerX: string | null;
  playerO: string | null;
}

interface SocketAttachment {
  symbol: string;
  clientId: string;
}

// Winning line indices typed as a fixed-length tuple to satisfy noUncheckedIndexedAccess.
type WinLine = [number, number, number];

const WINNING_LINES: WinLine[] = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // Rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // Cols
  [0, 4, 8], [2, 4, 6],             // Diagonals
];

export class TicTacToe {
  state: DurableObjectState;
  board: (string | null)[];
  turn: string;
  winner: string | null;
  playerX: string | null;
  playerO: string | null;

  constructor(state: DurableObjectState, _env: Env) {
    this.state = state;
    this.board = Array(9).fill(null) as null[];
    this.turn = 'X';
    this.winner = null;
    this.playerX = null;
    this.playerO = null;
  }

  // Load persisted game state from storage; falls back to in-memory defaults.
  async loadState(): Promise<void> {
    const stored = await this.state.storage.get<GameState>('gameState');
    if (stored) {
      this.board = stored.board;
      this.turn = stored.turn;
      this.winner = stored.winner;
      this.playerX = stored.playerX;
      this.playerO = stored.playerO;
    }
  }

  // Persist game state so it survives DO hibernation and page refreshes.
  async saveState(): Promise<void> {
    await this.state.storage.put<GameState>('gameState', {
      board: this.board,
      turn: this.turn,
      winner: this.winner,
      playerX: this.playerX,
      playerO: this.playerO,
    });
  }

  // Assign a symbol to a clientId, restoring it if the client reconnects.
  async assignSymbol(clientId: string): Promise<string> {
    await this.loadState();

    // Reconnecting player — restore their original symbol.
    if (this.playerX === clientId) return 'X';
    if (this.playerO === clientId) return 'O';

    // New player — claim the first available slot.
    if (this.playerX === null) {
      this.playerX = clientId;
      await this.saveState();
      return 'X';
    }
    if (this.playerO === null) {
      this.playerO = clientId;
      await this.saveState();
      return 'O';
    }

    return 'Spectator';
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const url = new URL(request.url);
    const clientId = url.searchParams.get('clientId') ?? crypto.randomUUID();

    const { 0: client, 1: server } = new WebSocketPair();

    // assignSymbol loads state internally — call before acceptWebSocket.
    const symbol = await this.assignSymbol(clientId);

    // Accept into the hibernation model, then attach identity to the socket so
    // it survives any future hibernation wake-up.
    this.state.acceptWebSocket(server);
    server.serializeAttachment({ symbol, clientId } as SocketAttachment);

    // Reload so broadcastState has current board (assignSymbol may have mutated it).
    await this.loadState();

    server.send(JSON.stringify({ type: 'init', symbol }));
    this.broadcastState();

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string): Promise<void> {
    // Always load from storage first — in-memory state is lost after hibernation.
    await this.loadState();

    const data = JSON.parse(message) as { type: string; index?: number };
    const { symbol: playerSymbol } = ws.deserializeAttachment() as SocketAttachment;

    if (data.type === 'move' && !this.winner && playerSymbol === this.turn) {
      const index = data.index;
      if (index !== undefined && this.board[index] === null) {
        this.board[index] = playerSymbol;
        this.checkWinner();

        // Switch turns only if the game is still ongoing.
        if (!this.winner) {
          this.turn = this.turn === 'X' ? 'O' : 'X';
        }

        await this.saveState();
        this.broadcastState();
      }
    } else if (data.type === 'reset') {
      this.board = Array(9).fill(null) as null[];
      this.winner = null;
      this.turn = 'X';
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
    // By the time this fires, the closing socket is already removed from
    // getWebSockets(), so remaining is the true count of active players.
    const remaining = this.state.getWebSockets();

    if (remaining.length === 0) {
      // Last player left — reset everything for the next session.
      this.board = Array(9).fill(null) as null[];
      this.winner = null;
      this.turn = 'X';
      this.playerX = null;
      this.playerO = null;
      await this.saveState();
    } else {
      await this.loadState();
      this.broadcastState();
    }
  }

  async webSocketError(_ws: WebSocket, _error: unknown): Promise<void> {
    // Treat an error like a close — reuse the same cleanup path.
    const remaining = this.state.getWebSockets();

    if (remaining.length === 0) {
      this.board = Array(9).fill(null) as null[];
      this.winner = null;
      this.turn = 'X';
      this.playerX = null;
      this.playerO = null;
      await this.saveState();
    } else {
      await this.loadState();
      this.broadcastState();
    }
  }

  checkWinner(): void {
    for (const [a, b, c] of WINNING_LINES) {
      const cellA = this.board[a];
      if (cellA && cellA === this.board[b] && cellA === this.board[c]) {
        this.winner = cellA;
        return;
      }
    }
    if (!this.board.includes(null)) {
      this.winner = 'Draw';
    }
  }

  broadcastState(): void {
    // Use getWebSockets() — not a local Map — so broadcasts work after hibernation.
    const activeSockets = this.state.getWebSockets();
    const stateMessage = JSON.stringify({
      type: 'state',
      board: this.board,
      turn: this.turn,
      winner: this.winner,
      playersCount: activeSockets.length,
    });
    for (const ws of activeSockets) {
      ws.send(stateMessage);
    }
  }
}

// ==========================================
// 3. FRONTEND UI (HTML/CSS/JS)
// ==========================================

// __GAME_PASSWORD__ is replaced at serve-time by the Worker router so the
// actual secret never appears in source code.
const HTML_TEMPLATE = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Multiplayer Tic-Tac-Toe</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: system-ui, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      background: #0f0f0f;
      color: #f0f0f0;
      gap: 24px;
      padding: 24px;
    }

    h1 { font-size: 2rem; letter-spacing: 0.04em; }

    /* ---- Lobby ---- */
    #lobby {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 20px;
      width: 100%;
      max-width: 320px;
    }
    #lobby .divider {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      color: #666;
      font-size: 0.85rem;
    }
    #lobby .divider::before,
    #lobby .divider::after {
      content: '';
      flex: 1;
      height: 1px;
      background: #333;
    }
    #join-row { display: flex; gap: 8px; width: 100%; }
    #join-row input {
      flex: 1;
      min-width: 0;
      text-transform: uppercase;
      letter-spacing: 0.1em;
    }

    /* ---- Game ---- */
    #game { display: none; flex-direction: column; align-items: center; gap: 16px; }

    #room-banner {
      display: flex;
      align-items: center;
      gap: 10px;
      background: #1a1a1a;
      border: 1px solid #333;
      border-radius: 8px;
      padding: 8px 16px;
      font-size: 0.9rem;
      color: #aaa;
    }
    #room-code { font-weight: 700; color: #fff; letter-spacing: 0.15em; font-size: 1rem; }
    #copy-btn {
      background: none;
      border: 1px solid #444;
      color: #aaa;
      padding: 3px 10px;
      font-size: 0.8rem;
      cursor: pointer;
      border-radius: 5px;
    }
    #copy-btn:hover { background: #222; color: #fff; }

    #status {
      font-size: 1.05rem;
      text-align: center;
      min-height: 2.4em;
      line-height: 1.5;
    }

    #board {
      display: grid;
      grid-template-columns: repeat(3, 100px);
      gap: 6px;
    }
    .cell {
      width: 100px;
      height: 100px;
      background: #1e1e1e;
      border: 1px solid #2e2e2e;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 2.8rem;
      font-weight: 700;
      cursor: pointer;
      border-radius: 8px;
      transition: background 0.1s;
      user-select: none;
    }
    .cell:hover { background: #2a2a2a; }
    .cell.x { color: #4f9cf9; }
    .cell.o { color: #f97b4f; }

    /* ---- Shared controls ---- */
    button {
      padding: 11px 24px;
      font-size: 1rem;
      border-radius: 7px;
      border: none;
      cursor: pointer;
      font-weight: 600;
      transition: background 0.15s;
      width: 100%;
    }
    .btn-primary { background: #4f9cf9; color: #000; }
    .btn-primary:hover { background: #3a87f0; }
    .btn-secondary { background: #2a2a2a; color: #ddd; border: 1px solid #444; }
    .btn-secondary:hover { background: #333; }

    input {
      padding: 11px 14px;
      font-size: 1rem;
      border-radius: 7px;
      border: 1px solid #333;
      background: #1a1a1a;
      color: #f0f0f0;
      outline: none;
      width: 100%;
    }
    input:focus { border-color: #4f9cf9; }

    #reset-btn { display: none; max-width: 200px; margin-top: 4px; }
    #back-btn  { display: none; max-width: 200px; }

    .waiting { color: #888; font-style: italic; }
    .your-turn { color: #4f9cf9; font-weight: 700; }
    .win  { color: #6ee86e; font-weight: 700; }
    .draw { color: #f9d44f; font-weight: 700; }
  </style>
</head>
<body>
  <h1>Tic-Tac-Toe</h1>

  <!-- Lobby -->
  <div id="lobby">
    <button class="btn-primary" onclick="createGame()">Create Game</button>
    <div class="divider">or join with a code</div>
    <div id="join-row">
      <input id="join-input" maxlength="6" placeholder="ROOM CODE" />
      <button class="btn-secondary" style="width:auto;padding:11px 18px;" onclick="joinGame()">Join</button>
    </div>
  </div>

  <!-- Game room -->
  <div id="game">
    <div id="room-banner">
      Room: <span id="room-code"></span>
      <button id="copy-btn" onclick="copyLink()">Copy link</button>
    </div>
    <div id="status"></div>
    <div id="board"></div>
    <button id="reset-btn" class="btn-secondary" onclick="resetGame()">Play Again</button>
    <button id="back-btn"  class="btn-secondary" onclick="goLobby()">Back to Lobby</button>
  </div>

  <script>
    const GAME_PASSWORD = '__GAME_PASSWORD__';

    let ws = null;
    let mySymbol = '';
    let currentRoom = '';

    // ---- Routing ----

    function init() {
      const params = new URLSearchParams(window.location.search);
      const room = params.get('room');
      if (room && /^[A-Z0-9]{6}$/i.test(room)) {
        enterRoom(room.toUpperCase());
      } else {
        showLobby();
      }
    }

    function createGame() {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      let code = '';
      const arr = new Uint8Array(6);
      crypto.getRandomValues(arr);
      arr.forEach(n => { code += chars[n % chars.length]; });
      enterRoom(code);
    }

    function joinGame() {
      const raw = document.getElementById('join-input').value.trim().toUpperCase();
      if (!/^[A-Z0-9]{6}$/.test(raw)) {
        document.getElementById('join-input').focus();
        return;
      }
      enterRoom(raw);
    }

    function enterRoom(code) {
      currentRoom = code;
      window.history.pushState({}, '', '?room=' + code);
      document.getElementById('room-code').textContent = code;
      showGame();
      connectWS(code);
    }

    function goLobby() {
      if (ws) { ws.close(1000); ws = null; }
      window.history.pushState({}, '', '/');
      showLobby();
    }

    // ---- Visibility helpers ----

    function showLobby() {
      document.getElementById('lobby').style.display = 'flex';
      document.getElementById('game').style.display  = 'none';
      document.getElementById('back-btn').style.display = 'none';
    }

    function showGame() {
      document.getElementById('lobby').style.display = 'none';
      document.getElementById('game').style.display  = 'flex';
      document.getElementById('back-btn').style.display = 'block';
      setStatus('<span class="waiting">Connecting...</span>');
    }

    // ---- WebSocket ----

    function getClientId() {
      let id = localStorage.getItem('ttt_clientId');
      if (!id) {
        id = crypto.randomUUID();
        localStorage.setItem('ttt_clientId', id);
      }
      return id;
    }

    function connectWS(room) {
      const clientId = getClientId();
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = proto + '//' + location.host
        + '/ws?room=' + encodeURIComponent(room)
        + '&password=' + encodeURIComponent(GAME_PASSWORD)
        + '&clientId=' + encodeURIComponent(clientId);

      ws = new WebSocket(url);

      ws.onopen = () => {
        setStatus('<span class="waiting">Waiting for opponent...</span>');
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.type === 'init') {
          mySymbol = data.symbol;
        }

        if (data.type === 'state') {
          renderBoard(data.board);
          updateStatus(data);
        }
      };

      ws.onerror = () => {
        setStatus('Connection error. Please refresh.');
      };

      ws.onclose = (e) => {
        if (e.code !== 1000) {
          setStatus('Disconnected. <a href="#" onclick="connectWS(currentRoom);return false;">Reconnect</a>');
        }
      };
    }

    // ---- Game UI ----

    function renderBoard(board) {
      const boardDiv = document.getElementById('board');
      boardDiv.innerHTML = '';
      board.forEach((cell, index) => {
        const div = document.createElement('div');
        div.className = 'cell' + (cell ? ' ' + cell.toLowerCase() : '');
        div.textContent = cell || '';
        div.onclick = () => makeMove(index);
        boardDiv.appendChild(div);
      });
    }

    function makeMove(index) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'move', index }));
      }
    }

    function resetGame() {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'reset' }));
      }
    }

    function updateStatus(state) {
      const resetBtn = document.getElementById('reset-btn');

      if (state.playersCount < 2) {
        setStatus('<span class="waiting">Waiting for opponent...</span>');
        resetBtn.style.display = 'none';
        return;
      }

      let text = 'You are: <strong>' + mySymbol + '</strong> &nbsp;|&nbsp; ';

      if (state.winner) {
        if (state.winner === 'Draw') {
          text += '<span class="draw">It\'s a draw!</span>';
        } else if (state.winner === mySymbol) {
          text += '<span class="win">You win!</span>';
        } else {
          text += '<span class="draw">You lose.</span>';
        }
        resetBtn.style.display = 'block';
      } else {
        resetBtn.style.display = 'none';
        if (state.turn === mySymbol) {
          text += '<span class="your-turn">Your turn</span>';
        } else {
          text += '<span class="waiting">Opponent\'s turn...</span>';
        }
      }

      setStatus(text);
    }

    function setStatus(html) {
      document.getElementById('status').innerHTML = html;
    }

    function copyLink() {
      const link = location.origin + '?room=' + currentRoom;
      navigator.clipboard.writeText(link).then(() => {
        const btn = document.getElementById('copy-btn');
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy link'; }, 2000);
      });
    }

    // Allow pressing Enter in the join input
    document.getElementById('join-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') joinGame();
    });

    // Handle browser back/forward navigation
    window.addEventListener('popstate', init);

    init();
  </script>
</body>
</html>
`;
