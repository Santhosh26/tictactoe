// ==========================================
// FRONTEND UI (HTML/CSS/JS)
// ==========================================
// All XSS vulnerabilities fixed: innerHTML replaced with textContent + DOM methods.
// Auto-reconnection with exponential backoff. beforeunload handler. Mutual reset.
// Single-player mode with AI difficulty selection.

export const HTML_TEMPLATE = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Tic-Tac-Toe</title>
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

    /* ---- Mode selection ---- */
    #mode-select {
      display: flex;
      flex-direction: column;
      gap: 8px;
      width: 100%;
    }
    #mp-options, #ai-options {
      display: none;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      width: 100%;
    }
    .btn-ai       { background: #f97b4f; color: #000; }
    .btn-ai:hover { background: #e06a3f; }
    #difficulty-row {
      display: flex;
      gap: 6px;
      width: 100%;
    }
    .btn-diff {
      flex: 1;
      padding: 10px 8px;
      font-size: 0.85rem;
      background: #181818;
      color: #888;
      border: 1px solid #2a2a2a;
      border-radius: 7px;
      cursor: pointer;
      transition: all 0.15s;
      font-weight: 600;
    }
    .btn-diff:hover { background: #222; color: #ccc; }
    .btn-diff.selected { background: #f97b4f; color: #000; border-color: #f97b4f; }
    .btn-back {
      background: none;
      border: none;
      color: #555;
      font-size: 0.82rem;
      cursor: pointer;
      padding: 4px 8px;
      width: auto;
    }
    .btn-back:hover { color: #aaa; }

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

    /* ---- Mode badge ---- */
    #mode-badge {
      font-size: 0.7rem;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      padding: 3px 10px;
      border-radius: 5px;
      background: #1a1a1a;
      border: 1px solid #2a2a2a;
      color: #666;
    }
    #mode-badge.ai { background: #2a1a14; border-color: #f97b4f44; color: #f97b4f; }

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

    /* ---- Scoreboard ---- */
    #scoreboard {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 6px 18px;
      border-radius: 8px;
      background: #131313;
      border: 1px solid #1e1e1e;
    }
    .score-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1px;
    }
    .score-value {
      font-size: 1.3rem;
      font-weight: 800;
      line-height: 1.2;
    }
    .score-label {
      font-size: 0.6rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #555;
    }
    .score-item.x .score-value { color: #4f9cf9; }
    .score-item.o .score-value { color: #f97b4f; }
    .score-item.draw .score-value { color: #f9d44f; }

    /* ---- Win animation ---- */
    .cell.winning {
      animation: winPulse 1.2s ease-in-out infinite;
    }
    @keyframes winPulse {
      0%, 100% { transform: scale(1); box-shadow: inset 0 0 14px rgba(110,232,110,0.12); }
      50%      { transform: scale(1.08); box-shadow: inset 0 0 22px rgba(110,232,110,0.3), 0 0 12px rgba(110,232,110,0.15); }
    }

    .win-celebration {
      animation: celebrateText 0.6s ease-out;
    }
    @keyframes celebrateText {
      0%   { transform: scale(0.5); opacity: 0; }
      70%  { transform: scale(1.15); }
      100% { transform: scale(1); opacity: 1; }
    }

    .draw-animation {
      animation: drawShake 0.5s ease-in-out;
    }
    @keyframes drawShake {
      0%, 100% { transform: translateX(0); }
      20%      { transform: translateX(-4px); }
      40%      { transform: translateX(4px); }
      60%      { transform: translateX(-3px); }
      80%      { transform: translateX(3px); }
    }

    #confetti-canvas {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 9999;
    }

    /* ---- Developer Insights Panel ---- */
    #debug-panel {
      display: none;
      flex-direction: column;
      width: 340px;
      max-height: 90vh;
      background: #0a0a0a;
      border: 1px solid #1e1e1e;
      border-radius: 12px;
      overflow: hidden;
      font-size: 0.78rem;
      flex-shrink: 0;
    }
    #debug-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      background: #111;
      border-bottom: 1px solid #1e1e1e;
    }
    .debug-title {
      font-weight: 700;
      font-size: 0.82rem;
      letter-spacing: 0.04em;
      color: #ccc;
    }
    #debug-toggle {
      background: none;
      border: 1px solid #2a2a2a;
      color: #777;
      padding: 3px 10px;
      font-size: 0.7rem;
      cursor: pointer;
      border-radius: 5px;
      width: auto;
      font-weight: 600;
    }
    #debug-toggle:hover { background: #1a1a1a; color: #ccc; }
    #debug-body {
      display: flex;
      flex-direction: column;
      overflow-y: auto;
      flex: 1;
    }
    .debug-section-title {
      font-size: 0.68rem;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: #555;
      padding: 8px 14px 4px;
    }
    /* Live state grid */
    #debug-do-info {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4px 10px;
      padding: 4px 14px 10px;
    }
    .debug-kv {
      display: flex;
      flex-direction: column;
    }
    .debug-kv-key {
      font-size: 0.62rem;
      color: #555;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .debug-kv-val {
      font-size: 0.78rem;
      color: #ddd;
      font-weight: 600;
    }
    /* Event log */
    #debug-log {
      padding: 6px 14px 10px;
      display: flex;
      flex-direction: column;
      gap: 3px;
      overflow-y: auto;
      max-height: 400px;
    }
    .debug-event {
      padding: 3px 0;
      line-height: 1.35;
      animation: debugFadeIn 0.3s ease-out;
    }
    @keyframes debugFadeIn {
      from { opacity: 0; transform: translateY(-4px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .debug-event-header {
      display: flex;
      gap: 6px;
      align-items: baseline;
    }
    .debug-ts {
      color: #444;
      font-size: 0.66rem;
      font-family: monospace;
      flex-shrink: 0;
    }
    .debug-cat {
      font-size: 0.6rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      padding: 1px 5px;
      border-radius: 3px;
      flex-shrink: 0;
    }
    .debug-cat.worker         { background: #2a1f3a; color: #a78bfa; }
    .debug-cat.durable-object { background: #152540; color: #4f9cf9; }
    .debug-cat.websocket      { background: #152a15; color: #6ee86e; }
    .debug-cat.sandbox        { background: #2a2815; color: #f9d44f; }
    .debug-cat.ai             { background: #2a1a14; color: #f97b4f; }
    .debug-cat.state-machine  { background: #2a152a; color: #e86edb; }
    .debug-label {
      color: #ccc;
      font-weight: 600;
    }
    .debug-detail {
      color: #666;
      padding-left: 50px;
      font-size: 0.7rem;
    }

    /* Layout: side-by-side on desktop */
    @media (min-width: 1024px) {
      body {
        flex-direction: row;
        align-items: flex-start;
        justify-content: center;
        gap: 30px;
        padding: 30px;
      }
      #main-content {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 20px;
        flex-shrink: 0;
      }
      #debug-panel {
        position: sticky;
        top: 20px;
      }
    }

    /* Mobile: panel below game */
    @media (max-width: 1023px) {
      #debug-panel {
        width: 100%;
        max-width: 400px;
        max-height: 260px;
      }
      #debug-log {
        max-height: 150px;
      }
    }
  </style>
</head>
<body>
  <div id="main-content">
  <h1>Tic-Tac-Toe</h1>

  <!-- Lobby -->
  <div id="lobby">
    <span class="lobby-label">Your name</span>
    <input id="name-input" maxlength="20" placeholder="Enter your name" autocomplete="off" />

    <!-- Mode selection -->
    <div id="mode-select">
      <button class="btn-primary" onclick="showMultiplayerOptions()">Play vs Friend</button>
      <button class="btn-ai" onclick="showAiOptions()">Play vs AI</button>
    </div>

    <!-- Multiplayer options -->
    <div id="mp-options">
      <button class="btn-primary" onclick="createGame()">Create Game</button>
      <div class="divider">or join with a code</div>
      <div id="join-row">
        <input id="join-input" maxlength="6" placeholder="ROOM CODE" autocomplete="off" />
        <button class="btn-secondary" style="width:auto;padding:11px 18px;" onclick="joinGame()">Join</button>
      </div>
      <button class="btn-back" onclick="showModeSelect()">Back</button>
    </div>

    <!-- AI options -->
    <div id="ai-options">
      <span class="lobby-label">Difficulty</span>
      <div id="difficulty-row">
        <button class="btn-diff" data-diff="easy" onclick="selectDifficulty('easy')">Easy</button>
        <button class="btn-diff" data-diff="medium" onclick="selectDifficulty('medium')">Medium</button>
        <button class="btn-diff selected" data-diff="hard" onclick="selectDifficulty('hard')">Hard</button>
      </div>
      <button class="btn-ai" onclick="startAiGame()">Start Game</button>
      <button class="btn-back" onclick="showModeSelect()">Back</button>
    </div>
  </div>

  <!-- Game room -->
  <div id="game">
    <div id="room-banner">
      Room:&nbsp;<span id="room-code"></span>
      <button id="copy-btn" onclick="copyLink()">Copy link</button>
    </div>
    <div id="mode-badge"></div>

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

    <div id="scoreboard">
      <div class="score-item x"><span id="score-x" class="score-value">0</span><span class="score-label">Wins</span></div>
      <div class="score-item draw"><span id="score-draws" class="score-value">0</span><span class="score-label">Draws</span></div>
      <div class="score-item o"><span id="score-o" class="score-value">0</span><span class="score-label">Wins</span></div>
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

  </div><!-- /main-content -->

  <!-- Developer Insights Panel -->
  <div id="debug-panel">
    <div id="debug-header">
      <span class="debug-title">Cloudflare Internals</span>
      <button id="debug-toggle" onclick="toggleDebugPanel()">Hide</button>
    </div>
    <div id="debug-body">
      <div class="debug-section-title">Durable Object State</div>
      <div id="debug-do-info"></div>
      <div class="debug-section-title">Event Log</div>
      <div id="debug-log"></div>
    </div>
  </div>

  <canvas id="confetti-canvas"></canvas>

  <script>
    let ws            = null;
    let mySymbol      = '';
    let currentRoom   = '';
    let currentMode   = 'multiplayer';
    let currentDifficulty = 'hard';
    let selectedDifficulty = 'hard';
    let pendingRoom   = null;
    let lastPhase     = '';
    let confettiAnimId = null;
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

    // ---- Mode selection ----

    function showModeSelect() {
      document.getElementById('mode-select').style.display = 'flex';
      document.getElementById('mp-options').style.display = 'none';
      document.getElementById('ai-options').style.display = 'none';
    }

    function showMultiplayerOptions() {
      document.getElementById('mode-select').style.display = 'none';
      document.getElementById('mp-options').style.display = 'flex';
      document.getElementById('ai-options').style.display = 'none';
    }

    function showAiOptions() {
      document.getElementById('mode-select').style.display = 'none';
      document.getElementById('mp-options').style.display = 'none';
      document.getElementById('ai-options').style.display = 'flex';
    }

    function selectDifficulty(diff) {
      selectedDifficulty = diff;
      document.querySelectorAll('.btn-diff').forEach(function(btn) {
        btn.classList.toggle('selected', btn.dataset.diff === diff);
      });
    }

    function startAiGame() {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      let code = '';
      const arr = new Uint8Array(6);
      crypto.getRandomValues(arr);
      arr.forEach(function(n) { code += chars[n % chars.length]; });
      enterRoom(code, 'singleplayer', selectedDifficulty);
    }

    // ---- Routing ----

    function init() {
      loadSavedName();
      const params = new URLSearchParams(window.location.search);
      const room = params.get('room');
      if (room && /^[A-Z0-9]{6}$/i.test(room)) {
        const savedName = localStorage.getItem('ttt_name');
        if (savedName) {
          // Returning player — join immediately.
          enterRoom(room.toUpperCase());
        } else {
          // New player via shared link — show lobby with room pre-filled.
          pendingRoom = room.toUpperCase();
          showLobby();
          showMultiplayerOptions();
          document.getElementById('join-input').value = pendingRoom;
          document.getElementById('name-input').focus();
        }
      } else {
        showLobby();
      }
    }

    function createGame() {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      let code = '';
      const arr = new Uint8Array(6);
      crypto.getRandomValues(arr);
      arr.forEach(function(n) { code += chars[n % chars.length]; });
      enterRoom(code, 'multiplayer');
    }

    function joinGame() {
      const raw = document.getElementById('join-input').value.trim().toUpperCase();
      if (!/^[A-Z0-9]{6}$/.test(raw)) {
        document.getElementById('join-input').focus();
        return;
      }
      enterRoom(raw, 'multiplayer');
    }

    function enterRoom(code, mode, difficulty) {
      pendingRoom = null;
      currentRoom = code;
      currentMode = mode || 'multiplayer';
      currentDifficulty = difficulty || 'hard';
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
      currentMode = 'multiplayer';
      currentDifficulty = 'hard';
      // Reset debug panel counters.
      debugStorageReads = 0;
      debugStorageWrites = 0;
      debugSandboxMode = 'Unknown';
      document.getElementById('debug-log').innerHTML = '';
      window.history.pushState({}, '', '/');
      showLobby();
    }

    // ---- Visibility helpers ----

    function showLobby() {
      document.getElementById('lobby').style.display = 'flex';
      document.getElementById('game').style.display  = 'none';
      hideDebugPanel();
      showModeSelect();
    }

    function showGame() {
      document.getElementById('lobby').style.display = 'none';
      document.getElementById('game').style.display  = 'flex';
      document.getElementById('reset-btn').style.display = 'none';
      document.getElementById('reset-prompt').style.display = 'none';
      showDebugPanel();

      // Show/hide room banner based on mode.
      const banner = document.getElementById('room-banner');
      const badge = document.getElementById('mode-badge');
      if (currentMode === 'singleplayer') {
        banner.style.display = 'none';
        badge.textContent = 'vs AI';
        badge.className = 'ai';
        badge.id = 'mode-badge';
      } else {
        banner.style.display = 'flex';
        badge.textContent = 'Multiplayer';
        badge.className = '';
        badge.id = 'mode-badge';
      }

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
        + '/ws?room='       + encodeURIComponent(room)
        + '&clientId='      + encodeURIComponent(clientId)
        + '&name='          + encodeURIComponent(name)
        + '&mode='          + encodeURIComponent(currentMode)
        + '&difficulty='    + encodeURIComponent(currentDifficulty);

      ws = new WebSocket(url);

      ws.onopen = function() {
        reconnectAttempts = 0;
        addClientDebugEvent('worker', 'WebSocket connected', 'Route: /ws, Room: ' + room);
        addClientDebugEvent('worker', 'Security headers applied', 'CSP, X-Frame-Options, X-Content-Type-Options');
        if (currentMode === 'singleplayer') {
          setStatus('Starting game...', 'waiting');
        } else {
          setStatus('Waiting for opponent...', 'waiting');
        }
      };

      ws.onmessage = function(event) {
        const data = JSON.parse(event.data);

        if (data.type === 'init') {
          mySymbol = data.symbol;
        }

        if (data.type === 'state') {
          // Update mode from server state.
          if (data.gameMode) currentMode = data.gameMode;

          const isMyTurn = data.turn === mySymbol && !data.winner;
          renderBoard(data.board, data.winLine, isMyTurn);
          updatePlayerCards(data);
          updateStatus(data);
          updateSpectatorCount(data);
          updateScoreboard(data);
          updateResetPrompt(data);
          updateModeBadge(data);
          handlePhaseTransition(data);
          updateDebugPanel(data);
        }

        if (data.type === 'room_full') {
          setStatus('Room is full', 'lose');
        }

        if (data.type === 'rate_limited') {
          // Silently ignore — just don't process
        }
      };

      ws.onerror = function() {
        setStatus('Connection error.', 'lose');
      };

      ws.onclose = function(e) {
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
        btn.onclick = function() {
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
      reconnectTimer = setTimeout(function() {
        if (currentRoom) connectWS(currentRoom);
      }, delay);
    }

    // ---- beforeunload: clean close on tab close ----

    window.addEventListener('beforeunload', function() {
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
      document.getElementById('badge-o').textContent = mySymbol === 'O' ? 'YOU' : (state.gameMode === 'singleplayer' ? 'AI' : '');

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

    // ---- Mode badge ----

    function updateModeBadge(state) {
      const badge = document.getElementById('mode-badge');
      const banner = document.getElementById('room-banner');
      if (state.gameMode === 'singleplayer') {
        banner.style.display = 'none';
        const diffLabel = state.aiDifficulty ? state.aiDifficulty.charAt(0).toUpperCase() + state.aiDifficulty.slice(1) : 'Hard';
        badge.textContent = 'vs AI (' + diffLabel + ')';
        badge.className = 'ai';
        badge.id = 'mode-badge';
      } else {
        banner.style.display = 'flex';
        badge.textContent = '';
        badge.className = '';
        badge.id = 'mode-badge';
      }
    }

    // ---- Spectator count ----

    function updateSpectatorCount(state) {
      const el = document.getElementById('spectator-count');
      const playerSlots = state.gameMode === 'singleplayer' ? 1 : 2;
      const spectators = Math.max(0, (state.playersCount || 0) - playerSlots);
      el.textContent = spectators > 0 ? 'Spectators: ' + spectators : '';
    }

    // ---- Board ----

    function renderBoard(board, winLine, isMyTurn) {
      const boardDiv = document.getElementById('board');
      boardDiv.innerHTML = '';
      board.forEach(function(cell, index) {
        const div   = document.createElement('div');
        const isWin = winLine && winLine.includes(index);
        let cls = 'cell';
        if (cell)              cls += ' ' + cell.toLowerCase();
        if (isWin)             cls += ' winning';
        if (!cell && isMyTurn) cls += ' clickable';
        div.className   = cls;
        div.textContent = cell || '';
        if (!cell) div.onclick = function() { makeMove(index); };
        boardDiv.appendChild(div);
      });
    }

    function makeMove(index) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'move', index: index }));
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

      // Single-player: show Play Again directly, no mutual protocol.
      if (state.gameMode === 'singleplayer') {
        prompt.style.display = 'none';
        if (mySymbol === 'X') {
          resetBtn.style.display = 'block';
        }
        return;
      }

      // Multiplayer: mutual reset protocol.
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
      const isSingleplayer = state.gameMode === 'singleplayer';

      if (state.phase === 'waiting') {
        if (isSingleplayer) {
          setStatus('Starting game...', 'waiting');
        } else {
          setStatus('Waiting for opponent...', 'waiting');
        }
        resetBtn.style.display = 'none';
        return;
      }

      if (state.winner) {
        if (mySymbol === 'X' || mySymbol === 'O') {
          // Only show reset button for actual players, not spectators
          if (!state.resetRequestedBy && !isSingleplayer) {
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
          if (isSingleplayer && mySymbol === 'X') {
            setStatus('AI wins!', 'lose');
          } else {
            setStatus(opponentName + ' wins!', 'lose');
          }
        }
      } else {
        resetBtn.style.display = 'none';
        if (mySymbol === 'Spectator') {
          const turnName = state.turn === 'X' ? nameX : nameO;
          setStatus(turnName + "'s turn...", 'waiting');
        } else if (state.turn === mySymbol) {
          setStatus('Your turn!', 'your-turn');
        } else {
          if (isSingleplayer) {
            setStatus('AI is thinking...', 'waiting');
          } else {
            setStatus(opponentName + "'s turn...", 'waiting');
          }
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

    // ---- Scoreboard ----

    function updateScoreboard(state) {
      document.getElementById('score-x').textContent = String(state.winsX || 0);
      document.getElementById('score-o').textContent = String(state.winsO || 0);
      document.getElementById('score-draws').textContent = String(state.draws || 0);
    }

    // ---- Phase transition & animations ----

    function handlePhaseTransition(state) {
      if (state.phase === 'finished' && lastPhase !== 'finished') {
        const statusSpan = document.querySelector('#status span');
        if (state.winner && state.winner !== 'Draw') {
          launchConfetti();
          if (statusSpan) statusSpan.classList.add('win-celebration');
        } else if (state.winner === 'Draw') {
          if (statusSpan) statusSpan.classList.add('draw-animation');
        }
      }
      if (state.phase !== 'finished' && lastPhase === 'finished') {
        cancelConfetti();
      }
      lastPhase = state.phase;
    }

    // ---- Confetti ----

    function launchConfetti() {
      cancelConfetti();
      const canvas = document.getElementById('confetti-canvas');
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      const ctx = canvas.getContext('2d');
      const colors = ['#4f9cf9', '#f97b4f', '#6ee86e', '#f9d44f', '#e86edb', '#fff'];
      const particles = [];
      for (let i = 0; i < 120; i++) {
        particles.push({
          x: canvas.width / 2 + (Math.random() - 0.5) * 100,
          y: canvas.height / 2,
          vx: (Math.random() - 0.5) * 16,
          vy: (Math.random() - 1) * 14 - 4,
          w: Math.random() * 8 + 4,
          h: Math.random() * 6 + 2,
          color: colors[Math.floor(Math.random() * colors.length)],
          rotation: Math.random() * Math.PI * 2,
          rotSpeed: (Math.random() - 0.5) * 0.3,
          alpha: 1,
          decay: 0.008 + Math.random() * 0.008,
        });
      }
      function frame() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        let alive = false;
        for (const p of particles) {
          if (p.alpha <= 0) continue;
          alive = true;
          p.x += p.vx;
          p.vy += 0.35;
          p.y += p.vy;
          p.rotation += p.rotSpeed;
          p.alpha -= p.decay;
          if (p.alpha < 0) p.alpha = 0;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rotation);
          ctx.globalAlpha = p.alpha;
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
          ctx.restore();
        }
        if (alive) {
          confettiAnimId = requestAnimationFrame(frame);
        } else {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          confettiAnimId = null;
        }
      }
      confettiAnimId = requestAnimationFrame(frame);
    }

    function cancelConfetti() {
      if (confettiAnimId) {
        cancelAnimationFrame(confettiAnimId);
        confettiAnimId = null;
      }
      const canvas = document.getElementById('confetti-canvas');
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    function copyLink() {
      const link = location.origin + '?room=' + currentRoom;
      navigator.clipboard.writeText(link).then(function() {
        const btn = document.getElementById('copy-btn');
        btn.textContent = 'Copied!';
        setTimeout(function() { btn.textContent = 'Copy link'; }, 2000);
      });
    }

    // Allow Enter in the join input to submit.
    document.getElementById('join-input').addEventListener('keydown', function(e) {
      if (e.key === 'Enter') joinGame();
    });

    // Allow Enter in the name input to join pending room or move focus.
    document.getElementById('name-input').addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        if (pendingRoom) {
          enterRoom(pendingRoom);
        } else {
          document.getElementById('join-input').focus();
        }
      }
    });

    // Handle browser back/forward navigation.
    window.addEventListener('popstate', init);

    // ---- Developer Insights Panel ----

    let debugPanelVisible = true;
    let debugStorageReads = 0;
    let debugStorageWrites = 0;
    let debugSandboxMode = 'Unknown';
    const DEBUG_MAX_EVENTS = 100;

    function toggleDebugPanel() {
      debugPanelVisible = !debugPanelVisible;
      const body = document.getElementById('debug-body');
      const btn = document.getElementById('debug-toggle');
      body.style.display = debugPanelVisible ? 'flex' : 'none';
      btn.textContent = debugPanelVisible ? 'Hide' : 'Show';
    }

    function showDebugPanel() {
      document.getElementById('debug-panel').style.display = 'flex';
    }

    function hideDebugPanel() {
      document.getElementById('debug-panel').style.display = 'none';
    }

    function updateDebugPanel(data) {
      // Update live state section.
      updateDebugState(data);
      // Append new debug events.
      if (data.debug && data.debug.length > 0) {
        for (let i = 0; i < data.debug.length; i++) {
          var evt = data.debug[i];
          appendDebugEvent(evt);
          // Track storage stats from events.
          if (evt.category === 'durable-object') {
            if (evt.label.indexOf('loaded') !== -1) debugStorageReads++;
            if (evt.label.indexOf('persisted') !== -1) debugStorageWrites++;
          }
          if (evt.category === 'sandbox') {
            if (evt.label.indexOf('Dynamic Worker') !== -1) debugSandboxMode = 'Dynamic Worker isolate';
            else if (evt.label.indexOf('local') !== -1) debugSandboxMode = 'Local fallback';
          }
        }
      }
    }

    function updateDebugState(data) {
      var el = document.getElementById('debug-do-info');
      el.innerHTML = '';
      var items = [
        ['Game Mode', data.gameMode === 'singleplayer' ? 'Single (' + (data.aiDifficulty || 'hard') + ')' : 'Multiplayer'],
        ['Phase', data.phase],
        ['Connections', String(data.playersCount || 0) + (data.gameMode === 'singleplayer' ? ' + AI' : '')],
        ['Storage R/W', debugStorageReads + ' / ' + debugStorageWrites],
        ['Sandbox', debugSandboxMode],
        ['Turn', data.turn || '-'],
      ];
      for (var i = 0; i < items.length; i++) {
        var kv = document.createElement('div');
        kv.className = 'debug-kv';
        var k = document.createElement('span');
        k.className = 'debug-kv-key';
        k.textContent = items[i][0];
        var v = document.createElement('span');
        v.className = 'debug-kv-val';
        v.textContent = items[i][1];
        // Color-code phase.
        if (items[i][0] === 'Phase') {
          if (data.phase === 'playing') v.style.color = '#6ee86e';
          else if (data.phase === 'finished') v.style.color = '#f97b4f';
          else v.style.color = '#f9d44f';
        }
        kv.appendChild(k);
        kv.appendChild(v);
        el.appendChild(kv);
      }
    }

    function appendDebugEvent(evt) {
      var log = document.getElementById('debug-log');
      var div = document.createElement('div');
      div.className = 'debug-event';

      var header = document.createElement('div');
      header.className = 'debug-event-header';

      var ts = document.createElement('span');
      ts.className = 'debug-ts';
      var d = new Date(evt.ts);
      ts.textContent = '[' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) + ']';

      var cat = document.createElement('span');
      cat.className = 'debug-cat ' + evt.category;
      cat.textContent = evt.category;

      var label = document.createElement('span');
      label.className = 'debug-label';
      label.textContent = evt.label;

      header.appendChild(ts);
      header.appendChild(cat);
      header.appendChild(label);
      div.appendChild(header);

      if (evt.detail) {
        var detail = document.createElement('div');
        detail.className = 'debug-detail';
        detail.textContent = evt.detail;
        div.appendChild(detail);
      }

      log.appendChild(div);

      // Trim old events.
      while (log.children.length > DEBUG_MAX_EVENTS) {
        log.removeChild(log.firstChild);
      }

      // Auto-scroll to bottom.
      log.scrollTop = log.scrollHeight;
    }

    function pad2(n) { return n < 10 ? '0' + n : String(n); }

    // Client-side debug events for worker-layer actions.
    function addClientDebugEvent(category, label, detail) {
      appendDebugEvent({ ts: Date.now(), category: category, label: label, detail: detail });
    }

    init();
  </script>
</body>
</html>
`;
