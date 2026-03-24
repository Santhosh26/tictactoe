// ==========================================
// FRONTEND UI (HTML/CSS/JS)
// ==========================================
// All XSS vulnerabilities fixed: innerHTML replaced with textContent + DOM methods.
// Auto-reconnection with exponential backoff. beforeunload handler. Mutual reset.

export const HTML_TEMPLATE = `
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

    /* ---- Spectator count ---- */
    #spectator-count {
      font-size: 0.75rem;
      color: #555;
      min-height: 1em;
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

    /* ---- Reset prompt ---- */
    #reset-prompt {
      display: none;
      flex-direction: column;
      align-items: center;
      gap: 8px;
    }
    #reset-prompt .prompt-text {
      font-size: 0.85rem;
      color: #999;
      font-style: italic;
    }
    #reset-prompt .prompt-buttons {
      display: flex;
      gap: 8px;
    }

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
        <div id="name-x" class="card-name">&mdash;</div>
        <div id="badge-x" class="card-you"></div>
        <div class="card-dot"></div>
      </div>
      <div class="vs-label">VS</div>
      <div id="player-o" class="player-card o">
        <div class="card-symbol">O</div>
        <div id="name-o" class="card-name">&mdash;</div>
        <div id="badge-o" class="card-you"></div>
        <div class="card-dot"></div>
      </div>
    </div>

    <div id="spectator-count"></div>
    <div id="status"></div>
    <div id="board"></div>
    <button id="reset-btn" class="btn-secondary" onclick="requestReset()">Play Again</button>
    <div id="reset-prompt">
      <span class="prompt-text">Opponent wants to play again</span>
      <div class="prompt-buttons">
        <button class="btn-primary" style="width:auto;padding:8px 20px;" onclick="acceptReset()">Accept</button>
        <button class="btn-secondary" style="width:auto;padding:8px 20px;" onclick="declineReset()">Decline</button>
      </div>
    </div>
    <button id="back-btn" class="btn-secondary" onclick="goLobby()">Back to Lobby</button>
  </div>

  <script>
    let ws            = null;
    let mySymbol      = '';
    let currentRoom   = '';
    let reconnectAttempts = 0;
    let reconnectTimer   = null;
    const MAX_RECONNECT_ATTEMPTS = 5;

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
      reconnectAttempts = 0;
      clearTimeout(reconnectTimer);
      window.history.pushState({}, '', '?room=' + code);
      document.getElementById('room-code').textContent = code;
      showGame();
      connectWS(code);
    }

    function goLobby() {
      clearTimeout(reconnectTimer);
      reconnectAttempts = MAX_RECONNECT_ATTEMPTS; // prevent auto-reconnect
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
      document.getElementById('reset-prompt').style.display = 'none';
      resetPlayerCards();
      setStatus('Connecting...', 'waiting');
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
      if (ws) { ws.close(1000); ws = null; }
      const clientId = getClientId();
      const name     = getMyName();
      const proto    = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url      = proto + '//' + location.host
        + '/ws?room='   + encodeURIComponent(room)
        + '&clientId='  + encodeURIComponent(clientId)
        + '&name='      + encodeURIComponent(name);

      ws = new WebSocket(url);

      ws.onopen = () => {
        reconnectAttempts = 0;
        setStatus('Waiting for opponent...', 'waiting');
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
          updateSpectatorCount(data);
          updateResetPrompt(data);
        }

        if (data.type === 'room_full') {
          setStatus('Room is full', 'lose');
        }

        if (data.type === 'rate_limited') {
          // Silently ignore — just don't process
        }
      };

      ws.onerror = () => {
        setStatus('Connection error.', 'lose');
      };

      ws.onclose = (e) => {
        if (e.code !== 1000) {
          attemptReconnect();
        }
      };
    }

    // ---- Auto-reconnection with exponential backoff ----

    function attemptReconnect() {
      if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        setStatus('Disconnected. Could not reconnect.', 'lose');
        // Add a manual reconnect button via DOM
        const statusEl = document.getElementById('status');
        const btn = document.createElement('button');
        btn.textContent = 'Try Again';
        btn.className = 'btn-secondary';
        btn.style.cssText = 'width:auto;padding:6px 16px;margin-top:6px;font-size:0.85rem;';
        btn.onclick = () => {
          reconnectAttempts = 0;
          connectWS(currentRoom);
        };
        statusEl.appendChild(document.createElement('br'));
        statusEl.appendChild(btn);
        return;
      }
      const delay = Math.pow(2, reconnectAttempts) * 1000; // 1s, 2s, 4s, 8s, 16s
      reconnectAttempts++;
      setStatus('Reconnecting in ' + (delay / 1000) + 's... (attempt ' + reconnectAttempts + '/' + MAX_RECONNECT_ATTEMPTS + ')', 'waiting');
      reconnectTimer = setTimeout(() => {
        if (currentRoom) connectWS(currentRoom);
      }, delay);
    }

    // ---- beforeunload: clean close on tab close ----

    window.addEventListener('beforeunload', () => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close(1000, 'tab_closed');
      }
    });

    // ---- Player cards ----

    function resetPlayerCards() {
      document.getElementById('name-x').textContent  = '\\u2014';
      document.getElementById('name-o').textContent  = '\\u2014';
      document.getElementById('badge-x').textContent = '';
      document.getElementById('badge-o').textContent = '';
      document.getElementById('player-x').className  = 'player-card x';
      document.getElementById('player-o').className  = 'player-card o';
    }

    function updatePlayerCards(state) {
      const cardX = document.getElementById('player-x');
      const cardO = document.getElementById('player-o');

      document.getElementById('name-x').textContent  = state.nameX || '\\u2014';
      document.getElementById('name-o').textContent  = state.nameO || '\\u2014';
      document.getElementById('badge-x').textContent = mySymbol === 'X' ? 'YOU' : '';
      document.getElementById('badge-o').textContent = mySymbol === 'O' ? 'YOU' : '';

      cardX.className = 'player-card x';
      cardO.className = 'player-card o';

      if (state.phase === 'waiting') {
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

    // ---- Spectator count ----

    function updateSpectatorCount(state) {
      const el = document.getElementById('spectator-count');
      const spectators = Math.max(0, (state.playersCount || 0) - 2);
      el.textContent = spectators > 0 ? 'Spectators: ' + spectators : '';
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

    // ---- Mutual reset protocol ----

    function requestReset() {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'reset' }));
      }
    }

    function acceptReset() {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'reset' }));
      }
    }

    function declineReset() {
      document.getElementById('reset-prompt').style.display = 'none';
    }

    function updateResetPrompt(state) {
      const prompt = document.getElementById('reset-prompt');
      const resetBtn = document.getElementById('reset-btn');
      const clientId = getClientId();

      if (state.phase !== 'finished') {
        prompt.style.display = 'none';
        return;
      }

      if (state.resetRequestedBy) {
        if (state.resetRequestedBy === clientId) {
          // I requested — hide my button, show waiting text
          resetBtn.style.display = 'none';
          prompt.style.display = 'flex';
          prompt.querySelector('.prompt-text').textContent = 'Waiting for opponent...';
          prompt.querySelector('.prompt-buttons').style.display = 'none';
        } else if (mySymbol === 'X' || mySymbol === 'O') {
          // Opponent requested — show accept/decline
          resetBtn.style.display = 'none';
          prompt.style.display = 'flex';
          prompt.querySelector('.prompt-text').textContent = 'Opponent wants to play again';
          prompt.querySelector('.prompt-buttons').style.display = 'flex';
        }
      } else {
        prompt.style.display = 'none';
      }
    }

    // ---- Status ----
    // XSS-safe: uses textContent, never innerHTML for user-supplied data.

    function updateStatus(state) {
      const resetBtn    = document.getElementById('reset-btn');
      const nameX       = state.nameX || 'X';
      const nameO       = state.nameO || 'O';
      const myName      = mySymbol === 'X' ? nameX : mySymbol === 'O' ? nameO : 'You';
      const opponentName = mySymbol === 'X' ? nameO : nameX;

      if (state.phase === 'waiting') {
        setStatus('Waiting for opponent...', 'waiting');
        resetBtn.style.display = 'none';
        return;
      }

      if (state.winner) {
        if (mySymbol === 'X' || mySymbol === 'O') {
          // Only show reset button for actual players, not spectators
          if (!state.resetRequestedBy) {
            resetBtn.style.display = 'block';
          }
        } else {
          resetBtn.style.display = 'none';
        }

        if (state.winner === 'Draw') {
          setStatus("It's a draw!", 'draw');
        } else if (state.winner === mySymbol) {
          setStatus('You win, ' + myName + '!', 'win');
        } else {
          setStatus(opponentName + ' wins!', 'lose');
        }
      } else {
        resetBtn.style.display = 'none';
        if (mySymbol === 'Spectator') {
          const turnName = state.turn === 'X' ? nameX : nameO;
          setStatus(turnName + "'s turn...", 'waiting');
        } else if (state.turn === mySymbol) {
          setStatus('Your turn!', 'your-turn');
        } else {
          setStatus(opponentName + "'s turn...", 'waiting');
        }
      }
    }

    // XSS-safe status setter: uses textContent + className, never innerHTML.
    function setStatus(text, className) {
      const el = document.getElementById('status');
      el.textContent = '';
      const span = document.createElement('span');
      if (className) span.className = className;
      span.textContent = text;
      el.appendChild(span);
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
