export interface Env {
  GAME_ROOM: DurableObjectNamespace;
}

// ==========================================
// 1. WORKER ROUTER
// ==========================================
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Serve the frontend for all non-API paths
    if (url.pathname === '/') {
      return new Response(HTML_TEMPLATE, {
        headers: { 'Content-Type': 'text/html;charset=UTF-8' },
      });
    }

    // WebSocket upgrade — expects ?room=CODE&clientId=UUID&name=NAME
    if (url.pathname === '/ws') {
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
  winLine: number[] | null;
  // Persist player slot assignments so reconnecting clients reclaim their symbol.
  playerX: string | null;
  playerO: string | null;
  nameX: string | null;
  nameO: string | null;
}

interface SocketAttachment {
  symbol: string;
  clientId: string;
  name: string;
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
  winLine: number[] | null;
  playerX: string | null;
  playerO: string | null;
  nameX: string | null;
  nameO: string | null;

  constructor(state: DurableObjectState, _env: Env) {
    this.state = state;
    this.board = Array(9).fill(null) as null[];
    this.turn = 'X';
    this.winner = null;
    this.winLine = null;
    this.playerX = null;
    this.playerO = null;
    this.nameX = null;
    this.nameO = null;
  }

  // Load persisted game state from storage; falls back to in-memory defaults.
  async loadState(): Promise<void> {
    const stored = await this.state.storage.get<GameState>('gameState');
    if (stored) {
      this.board = stored.board;
      this.turn = stored.turn;
      this.winner = stored.winner;
      this.winLine = stored.winLine ?? null;
      this.playerX = stored.playerX;
      this.playerO = stored.playerO;
      this.nameX = stored.nameX ?? null;
      this.nameO = stored.nameO ?? null;
    }
  }

  // Persist game state so it survives DO hibernation and page refreshes.
  async saveState(): Promise<void> {
    await this.state.storage.put<GameState>('gameState', {
      board: this.board,
      turn: this.turn,
      winner: this.winner,
      winLine: this.winLine,
      playerX: this.playerX,
      playerO: this.playerO,
      nameX: this.nameX,
      nameO: this.nameO,
    });
  }

  // Assign a symbol to a clientId, restoring it if the client reconnects.
  async assignSymbol(clientId: string, name: string): Promise<string> {
    await this.loadState();

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
    if (this.playerO === null) {
      this.playerO = clientId;
      this.nameO = name;
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
    const name = (url.searchParams.get('name') ?? '').trim().slice(0, 20) || 'Player';

    const { 0: client, 1: server } = new WebSocketPair();

    // assignSymbol loads state internally — call before acceptWebSocket.
    const symbol = await this.assignSymbol(clientId, name);

    // Accept into the hibernation model, then attach identity to the socket so
    // it survives any future hibernation wake-up.
    this.state.acceptWebSocket(server);
    server.serializeAttachment({ symbol, clientId, name } as SocketAttachment);

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
      this.winLine = null;
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
      this.winLine = null;
      this.turn = 'X';
      this.playerX = null;
      this.playerO = null;
      this.nameX = null;
      this.nameO = null;
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
      this.winLine = null;
      this.turn = 'X';
      this.playerX = null;
      this.playerO = null;
      this.nameX = null;
      this.nameO = null;
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
        this.winLine = [a, b, c];
        return;
      }
    }
    if (!this.board.includes(null)) {
      this.winner = 'Draw';
      this.winLine = null;
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
      winLine: this.winLine,
      playersCount: activeSockets.length,
      nameX: this.nameX,
      nameO: this.nameO,
    });
    for (const ws of activeSockets) {
      ws.send(stateMessage);
    }
  }
}

// ==========================================
// 3. FRONTEND UI (HTML/CSS/JS)
// ==========================================

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
      gap: 20px;
      padding: 24px;
    }

    h1 { font-size: 2rem; letter-spacing: 0.04em; }

    /* ---- Lobby ---- */
    #lobby {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 14px;
      width: 100%;
      max-width: 320px;
    }
    .lobby-label {
      font-size: 0.75rem;
      font-weight: 600;
      color: #666;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      align-self: flex-start;
    }
    #lobby .divider {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      color: #444;
      font-size: 0.8rem;
    }
    #lobby .divider::before,
    #lobby .divider::after {
      content: '';
      flex: 1;
      height: 1px;
      background: #222;
    }
    #join-row { display: flex; gap: 8px; width: 100%; }
    #join-row input {
      flex: 1;
      min-width: 0;
      text-transform: uppercase;
      letter-spacing: 0.15em;
    }

    /* ---- Game ---- */
    #game { display: none; flex-direction: column; align-items: center; gap: 14px; }

    #room-banner {
      display: flex;
      align-items: center;
      gap: 10px;
      background: #161616;
      border: 1px solid #222;
      border-radius: 8px;
      padding: 7px 14px;
      font-size: 0.82rem;
      color: #555;
    }
    #room-code { font-weight: 700; color: #ddd; letter-spacing: 0.18em; font-size: 0.9rem; }
    #copy-btn {
      background: none;
      border: 1px solid #2a2a2a;
      color: #777;
      padding: 3px 10px;
      font-size: 0.75rem;
      cursor: pointer;
      border-radius: 5px;
      width: auto;
    }
    #copy-btn:hover { background: #1e1e1e; color: #ccc; }

    /* ---- Player cards ---- */
    #players-row {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      max-width: 360px;
    }

    .player-card {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      padding: 14px 8px 10px;
      border-radius: 12px;
      border: 2px solid #1e1e1e;
      background: #111;
      transition: border-color 0.3s, box-shadow 0.3s, opacity 0.3s;
      opacity: 0.4;
      min-width: 0;
    }
    .player-card.active   { opacity: 1; }
    .player-card.x.active { border-color: #4f9cf9; box-shadow: 0 0 18px rgba(79,156,249,0.2); }
    .player-card.o.active { border-color: #f97b4f; box-shadow: 0 0 18px rgba(249,123,79,0.2); }
    .player-card.winner   { opacity: 1; border-color: #6ee86e; box-shadow: 0 0 22px rgba(110,232,110,0.3); }
    .player-card.loser    { opacity: 0.18; }

    .card-symbol {
      font-size: 1.8rem;
      font-weight: 800;
      line-height: 1;
    }
    .player-card.x .card-symbol { color: #4f9cf9; }
    .player-card.o .card-symbol { color: #f97b4f; }

    .card-name {
      font-size: 0.88rem;
      font-weight: 600;
      color: #ddd;
      max-width: 110px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      text-align: center;
    }

    .card-you {
      font-size: 0.6rem;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      height: 0.85rem;
      color: transparent;
    }
    .player-card.x .card-you { color: #2e68b0; }
    .player-card.o .card-you { color: #a05030; }

    /* Pulsing turn dot */
    .card-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      margin-top: 2px;
      opacity: 0;
    }
    .player-card.x .card-dot { background: #4f9cf9; }
    .player-card.o .card-dot { background: #f97b4f; }
    .player-card.active:not(.winner):not(.loser) .card-dot {
      opacity: 1;
      animation: blink 1.1s ease-in-out infinite;
    }

    @keyframes blink {
      0%, 100% { opacity: 1; }
      50%       { opacity: 0.15; }
    }

    .vs-label {
      font-size: 0.72rem;
      font-weight: 700;
      color: #333;
      letter-spacing: 0.08em;
      flex-shrink: 0;
    }

    /* ---- Status ---- */
    #status {
      font-size: 1rem;
      text-align: center;
      min-height: 1.4em;
      line-height: 1.4;
    }

    /* ---- Board ---- */
    #board {
      display: grid;
      grid-template-columns: repeat(3, 100px);
      gap: 6px;
    }
    .cell {
      width: 100px;
      height: 100px;
      background: #161616;
      border: 1px solid #232323;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 2.8rem;
      font-weight: 800;
      cursor: default;
      border-radius: 10px;
      transition: background 0.1s, border-color 0.25s, box-shadow 0.25s;
      user-select: none;
    }
    .cell.x { color: #4f9cf9; }
    .cell.o { color: #f97b4f; }

    /* Only show hover on empty cells when it is the player's turn */
    .cell.clickable { cursor: pointer; }
    .cell.clickable:hover { background: #202020; }

    /* Winning line highlight */
    .cell.winning {
      background: #172217;
      border-color: #4db84d;
      box-shadow: inset 0 0 14px rgba(110,232,110,0.12);
    }
    .cell.winning.x { color: #74c8ff; }
    .cell.winning.o { color: #ffaa7a; }

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
    .btn-primary       { background: #4f9cf9; color: #000; }
    .btn-primary:hover { background: #3a87f0; }
    .btn-secondary       { background: #181818; color: #ccc; border: 1px solid #2a2a2a; }
    .btn-secondary:hover { background: #202020; }

    input {
      padding: 11px 14px;
      font-size: 1rem;
      border-radius: 7px;
      border: 1px solid #222;
      background: #111;
      color: #f0f0f0;
      outline: none;
      width: 100%;
    }
    input:focus { border-color: #4f9cf9; }

    #reset-btn { display: none; max-width: 200px; }
    #back-btn  { max-width: 200px; }

    .waiting   { color: #555; font-style: italic; }
    .your-turn { color: #4f9cf9; font-weight: 700; }
    .win       { color: #6ee86e; font-weight: 700; }
    .lose      { color: #666; }
    .draw      { color: #f9d44f; font-weight: 700; }
  </style>
</head>
<body>
  <h1>Tic-Tac-Toe</h1>

  <!-- Lobby -->
  <div id="lobby">
    <span class="lobby-label">Your name</span>
    <input id="name-input" maxlength="20" placeholder="Enter your name" autocomplete="off" />
    <button class="btn-primary" onclick="createGame()">Create Game</button>
    <div class="divider">or join with a code</div>
    <div id="join-row">
      <input id="join-input" maxlength="6" placeholder="ROOM CODE" autocomplete="off" />
      <button class="btn-secondary" style="width:auto;padding:11px 18px;" onclick="joinGame()">Join</button>
    </div>
  </div>

  <!-- Game room -->
  <div id="game">
    <div id="room-banner">
      Room:&nbsp;<span id="room-code"></span>
      <button id="copy-btn" onclick="copyLink()">Copy link</button>
    </div>

    <!-- Player cards -->
    <div id="players-row">
      <div id="player-x" class="player-card x">
        <div class="card-symbol">X</div>
        <div id="name-x" class="card-name">—</div>
        <div id="badge-x" class="card-you"></div>
        <div class="card-dot"></div>
      </div>
      <div class="vs-label">VS</div>
      <div id="player-o" class="player-card o">
        <div class="card-symbol">O</div>
        <div id="name-o" class="card-name">—</div>
        <div id="badge-o" class="card-you"></div>
        <div class="card-dot"></div>
      </div>
    </div>

    <div id="status"></div>
    <div id="board"></div>
    <button id="reset-btn" class="btn-secondary" onclick="resetGame()">Play Again</button>
    <button id="back-btn"  class="btn-secondary" onclick="goLobby()">Back to Lobby</button>
  </div>

  <script>
    let ws          = null;
    let mySymbol    = '';
    let currentRoom = '';

    // ---- Name persistence ----

    function loadSavedName() {
      const saved = localStorage.getItem('ttt_name');
      if (saved) document.getElementById('name-input').value = saved;
    }

    function getMyName() {
      const val = document.getElementById('name-input').value.trim();
      const name = val || localStorage.getItem('ttt_name') || 'Player';
      if (val) localStorage.setItem('ttt_name', val);
      return name;
    }

    // ---- Routing ----

    function init() {
      loadSavedName();
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
    }

    function showGame() {
      document.getElementById('lobby').style.display = 'none';
      document.getElementById('game').style.display  = 'flex';
      document.getElementById('reset-btn').style.display = 'none';
      resetPlayerCards();
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
      const name     = getMyName();
      const proto    = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url      = proto + '//' + location.host
        + '/ws?room='   + encodeURIComponent(room)
        + '&clientId='  + encodeURIComponent(clientId)
        + '&name='      + encodeURIComponent(name);

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
          const isMyTurn = data.turn === mySymbol && !data.winner;
          renderBoard(data.board, data.winLine, isMyTurn);
          updatePlayerCards(data);
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

    // ---- Player cards ----

    function resetPlayerCards() {
      document.getElementById('name-x').textContent  = '—';
      document.getElementById('name-o').textContent  = '—';
      document.getElementById('badge-x').textContent = '';
      document.getElementById('badge-o').textContent = '';
      document.getElementById('player-x').className  = 'player-card x';
      document.getElementById('player-o').className  = 'player-card o';
    }

    function updatePlayerCards(state) {
      const cardX = document.getElementById('player-x');
      const cardO = document.getElementById('player-o');

      document.getElementById('name-x').textContent  = state.nameX || '—';
      document.getElementById('name-o').textContent  = state.nameO || '—';
      document.getElementById('badge-x').textContent = mySymbol === 'X' ? 'YOU' : '';
      document.getElementById('badge-o').textContent = mySymbol === 'O' ? 'YOU' : '';

      cardX.className = 'player-card x';
      cardO.className = 'player-card o';

      if (state.playersCount < 2) {
        // Only one player connected — highlight their slot.
        if (mySymbol === 'X') cardX.className += ' active';
        else if (mySymbol === 'O') cardO.className += ' active';
        return;
      }

      if (state.winner === 'Draw') {
        cardX.className += ' active';
        cardO.className += ' active';
      } else if (state.winner === 'X') {
        cardX.className += ' winner';
        cardO.className += ' loser';
      } else if (state.winner === 'O') {
        cardO.className += ' winner';
        cardX.className += ' loser';
      } else {
        // Game in progress — highlight whose turn it is.
        if (state.turn === 'X') cardX.className += ' active';
        else                    cardO.className += ' active';
      }
    }

    // ---- Board ----

    function renderBoard(board, winLine, isMyTurn) {
      const boardDiv = document.getElementById('board');
      boardDiv.innerHTML = '';
      board.forEach((cell, index) => {
        const div   = document.createElement('div');
        const isWin = winLine && winLine.includes(index);
        let cls = 'cell';
        if (cell)              cls += ' ' + cell.toLowerCase();
        if (isWin)             cls += ' winning';
        if (!cell && isMyTurn) cls += ' clickable';
        div.className   = cls;
        div.textContent = cell || '';
        if (!cell) div.onclick = () => makeMove(index);
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

    // ---- Status ----

    function updateStatus(state) {
      const resetBtn    = document.getElementById('reset-btn');
      const nameX       = state.nameX || 'X';
      const nameO       = state.nameO || 'O';
      const myName      = mySymbol === 'X' ? nameX : mySymbol === 'O' ? nameO : 'You';
      const opponentName = mySymbol === 'X' ? nameO : nameX;

      if (state.playersCount < 2) {
        setStatus('<span class="waiting">Waiting for opponent...</span>');
        resetBtn.style.display = 'none';
        return;
      }

      let text = '';

      if (state.winner) {
        resetBtn.style.display = 'block';
        if (state.winner === 'Draw') {
          text = '<span class="draw">It\\'s a draw!</span>';
        } else if (state.winner === mySymbol) {
          text = '<span class="win">You win, ' + myName + '!</span>';
        } else {
          text = '<span class="lose">' + opponentName + ' wins!</span>';
        }
      } else {
        resetBtn.style.display = 'none';
        if (mySymbol === 'Spectator') {
          const turnName = state.turn === 'X' ? nameX : nameO;
          text = '<span class="waiting">' + turnName + '\\'s turn...</span>';
        } else if (state.turn === mySymbol) {
          text = '<span class="your-turn">Your turn!</span>';
        } else {
          text = '<span class="waiting">' + opponentName + '\\'s turn...</span>';
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

    // Allow Enter in the join input to submit.
    document.getElementById('join-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') joinGame();
    });

    // Allow Enter in the name input to move focus to room code field.
    document.getElementById('name-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('join-input').focus();
    });

    // Handle browser back/forward navigation.
    window.addEventListener('popstate', init);

    init();
  </script>
</body>
</html>
`;
