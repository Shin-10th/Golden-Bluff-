// Golden Bluff - client. Plain JS, no build step, no frameworks.
const CHARACTERS = {
  ROYAL:     { name: 'Royal',     emoji: '👑', needsTarget: false, desc: 'Gain 2 Golden Tickets.' },
  THIEF:     { name: 'Thief',     emoji: '🦹', needsTarget: true,  desc: 'Steal up to 2 Tickets from another player.' },
  GUARD:     { name: 'Guard',     emoji: '🛡️', needsTarget: false, desc: 'Block the next ability targeting you, until your next turn.' },
  SEER:      { name: 'Seer',      emoji: '🔮', needsTarget: true,  desc: "Secretly see one of another player's cards." },
  TRICKSTER: { name: 'Trickster', emoji: '🎭', needsTarget: false, desc: 'Swap one of your cards for a new secret one.' },
  ASSASSIN:  { name: 'Assassin',  emoji: '☠️', needsTarget: true,  desc: 'Pay 2 Tickets to force a discard.' },
};
const CONFETTI_COLORS = ['#c9a227', '#e8c14a', '#8a5fd1', '#4fa3c7', '#e05fa0', '#d4544a', '#6fd67f'];

const socket = io();
const el = (id) => document.getElementById(id);
const charClass = (key) => `char-${key}`;

const S = {
  screen: 'auth',       // auth | lobby | game
  myId: null,
  myName: '',
  code: null,
  pub: null,            // last public state from server
  prevPub: null,        // previous public state, for diffing (tickets, eliminations, challenges)
  hand: [],
  prevHand: [],
  chat: [],
  selectedCharacter: null,
  selectedTarget: null,
  seerToast: null,
  confettiSpawned: false,
  lastFlashSig: null,
};

function showError(msg) {
  el('auth-error').textContent = msg || '';
  if (msg) setTimeout(() => { if (el('auth-error').textContent === msg) el('auth-error').textContent = ''; }, 4000);
}

// ---------- Socket wiring ----------
socket.on('connect', () => { S.myId = socket.id; });

socket.on('state', (pub) => {
  maybeFlashChallenge(S.pub, pub);
  S.prevPub = S.pub;
  S.pub = pub;
  if (pub.phase === 'lobby') S.screen = 'lobby'; else S.screen = 'game';
  if (pub.phase !== 'gameover') S.confettiSpawned = false;
  render();
});

socket.on('hand', (data) => { S.hand = data.hand || []; render(); });

socket.on('seerReveal', (data) => {
  S.seerToast = data;
  render();
});

socket.on('chatMessage', (msg) => {
  S.chat.push(msg);
  if (S.chat.length > 100) S.chat.shift();
  renderChat();
});

// ---------- Auth screen ----------
el('create-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = el('create-name').value.trim();
  if (!name) return showError('Enter your name.');
  socket.emit('createRoom', { name }, (res) => {
    if (!res.ok) return showError(res.error);
    S.myName = name; S.code = res.code; S.myId = res.playerId;
    S.screen = 'lobby';
    render();
  });
});

el('join-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = el('join-name').value.trim();
  const code = el('join-code').value.trim();
  if (!name || !code) return showError('Enter your name and the room code.');
  socket.emit('joinRoom', { name, code }, (res) => {
    if (!res.ok) return showError(res.error);
    S.myName = name; S.code = res.code; S.myId = res.playerId;
    S.screen = 'lobby';
    render();
  });
});

el('start-game-btn').addEventListener('click', () => {
  socket.emit('startGame', {}, (res) => { if (!res.ok) alert(res.error); });
});

el('chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = el('chat-input');
  const message = input.value.trim();
  if (!message) return;
  socket.emit('announce', { message });
  input.value = '';
});

el('seer-toast-close').addEventListener('click', () => { S.seerToast = null; render(); });

// ---------- Effects layer (survives normal re-renders) ----------
function fxLayer() { return el('fx-layer'); }

function maybeFlashChallenge(prevPub, pub) {
  const c = pub && pub.pendingClaim;
  if (!c || c.status !== 'challenged') return;
  const sig = JSON.stringify({ a: c.claimantId, b: c.character, t: c.targetId, ch: c.challengerId });
  if (sig === S.lastFlashSig) return;
  S.lastFlashSig = sig;
  spawnChallengeFlash(pub, c);
}

function spawnChallengeFlash(pub, c) {
  const claimant = pub.players.find((p) => p.id === c.claimantId);
  const challenger = pub.players.find((p) => p.id === c.challengerId);
  const meta = CHARACTERS[c.character];
  const div = document.createElement('div');
  div.className = `challenge-flash ${charClass(c.character)}`;
  div.innerHTML = `
    <div class="cf-title">⚔️ CHALLENGE!</div>
    <div class="cf-sub">${challenger ? challenger.name : 'Someone'} challenges ${claimant ? claimant.name : 'someone'}'s <span class="c-icon-inline">${charIconHTML(c.character)}</span>${meta.name} claim!</div>
  `;
  fxLayer().appendChild(div);
  setTimeout(() => div.remove(), 1600);
}

function spawnConfetti() {
  const layer = fxLayer();
  const count = 70;
  for (let i = 0; i < count; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    const left = Math.random() * 100;
    const delay = Math.random() * 0.6;
    const duration = 2.2 + Math.random() * 1.4;
    const color = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
    piece.style.left = left + 'vw';
    piece.style.background = color;
    piece.style.animationDelay = delay + 's';
    piece.style.animationDuration = duration + 's';
    piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
    layer.appendChild(piece);
    setTimeout(() => piece.remove(), (delay + duration) * 1000 + 200);
  }
}

// ---------- Render ----------
function render() {
  el('screen-auth').classList.toggle('hidden', S.screen !== 'auth');
  el('screen-lobby').classList.toggle('hidden', S.screen !== 'lobby');
  el('screen-game').classList.toggle('hidden', S.screen !== 'game');

  if (S.screen === 'lobby') renderLobby();
  if (S.screen === 'game') renderGame();
  renderSeerToast();
}

function renderLobby() {
  const pub = S.pub;
  el('lobby-code').textContent = S.code || (pub && pub.code) || '';
  const list = el('lobby-players');
  list.innerHTML = '';
  if (pub) {
    pub.players.forEach((p, i) => {
      const li = document.createElement('li');
      li.style.animationDelay = (i * 0.06) + 's';
      li.textContent = p.name + (p.id === pub.hostId ? '  👑 host' : '') + (p.id === S.myId ? '  (you)' : '');
      list.appendChild(li);
    });
  }
  const isHost = pub && pub.hostId === S.myId;
  const count = pub ? pub.players.length : 0;
  el('start-game-btn').classList.toggle('hidden', !isHost);
  el('start-game-btn').disabled = count < 3 || count > 6;
  el('lobby-hint').textContent = isHost
    ? (count < 3 ? `Need at least 3 players (currently ${count}).` : `Ready to start with ${count} players.`)
    : 'Waiting for the host to start the game...';
}

function playerById(id) { return S.pub ? S.pub.players.find((p) => p.id === id) : null; }
function prevPlayerById(id) { return S.prevPub ? S.prevPub.players.find((p) => p.id === id) : null; }

function renderGame() {
  const pub = S.pub;
  if (!pub) return;
  el('game-code').textContent = pub.code;

  // Players grid
  const grid = el('players-grid');
  grid.innerHTML = '';
  pub.players.forEach((p) => {
    const prev = prevPlayerById(p.id);
    const delta = prev ? p.tickets - prev.tickets : 0;
    const justEliminated = prev && prev.alive && !p.alive;

    const card = document.createElement('div');
    card.className = 'player-card';
    if (p.id === pub.activePlayerId) card.classList.add('is-turn');
    if (p.id === S.myId) card.classList.add('is-me');
    if (!p.alive) card.classList.add('is-dead');
    if (justEliminated) card.classList.add('just-eliminated');

    const pulseClass = delta > 0 ? 'pulse-gain' : (delta < 0 ? 'pulse-loss' : '');
    const deltaHtml = delta !== 0
      ? `<span class="ticket-delta ${delta > 0 ? 'gain' : 'loss'}">${delta > 0 ? '+' : ''}${delta}</span>`
      : '';

    card.innerHTML = `
      <div class="p-name">${p.name}${p.id === S.myId ? ' <span class="badge">you</span>' : ''}${p.id === pub.activePlayerId ? ' <span class="badge">turn</span>' : ''}${p.protected ? ' 🛡️' : ''}${!p.connected ? ' <span class="badge">offline</span>' : ''}</div>
      <div class="p-tickets ${pulseClass}">🎟️ ${p.tickets}${deltaHtml}</div>
      <div class="p-cards">${p.alive ? '❤️'.repeat(p.cardCount) : '💀 eliminated'}</div>
    `;
    grid.appendChild(card);
  });

  renderMyHand();
  renderActionArea(pub);
  renderLog(pub);
  renderChat();

  if (pub.phase === 'gameover') {
    const winner = playerById(pub.winnerId);
    el('winner-banner').classList.remove('hidden');
    el('winner-banner').innerHTML = `
      <span class="trophy">🏆</span>
      <h2>${winner ? winner.name : 'Someone'} WINS!</h2>
      <p>${winner ? winner.tickets : '10+'} Golden Tickets. Refresh the page to start a new room.</p>
    `;
    if (!S.confettiSpawned) { spawnConfetti(); S.confettiSpawned = true; }
  } else {
    el('winner-banner').classList.add('hidden');
  }
}

function renderMyHand() {
  const handDiv = el('my-hand');
  handDiv.innerHTML = '';
  const isInitialDeal = S.prevHand.length === 0 && S.hand.length > 0;

  S.hand.forEach((c, idx) => {
    const meta = CHARACTERS[c];
    const div = document.createElement('div');
    div.className = `hand-card ${charClass(c)}`;
    if (isInitialDeal) {
      div.classList.add('deal-in');
      div.style.animationDelay = (idx * 0.15) + 's';
    } else if (S.prevHand[idx] && S.prevHand[idx] !== c) {
      div.classList.add('flip-swap');
    }
    div.innerHTML = `<div class="c-icon">${charIconHTML(c)}</div><div class="c-name">${meta.name}</div>`;
    handDiv.appendChild(div);
  });

  S.prevHand = S.hand.slice();
}

function renderActionArea(pub) {
  const area = el('action-area');
  area.innerHTML = '';
  area.classList.remove('action-fade');
  // Force reflow so the fade-in animation replays every time content changes.
  void area.offsetWidth;
  area.classList.add('action-fade');

  const isMyTurn = pub.activePlayerId === S.myId;

  if (pub.phase === 'claim') {
    if (isMyTurn) {
      area.appendChild(buildClaimUI(pub));
    } else {
      area.innerHTML = `<div class="action-banner">Waiting for ${nameOf(pub, pub.activePlayerId)} to make a claim...</div>`;
    }
    return;
  }

  if (pub.phase === 'challengeWindow') {
    const c = pub.pendingClaim;
    const meta = CHARACTERS[c.character];
    const targetTxt = c.targetId ? ` targeting ${nameOf(pub, c.targetId)}` : '';
    const banner = document.createElement('div');
    banner.className = `action-banner ${charClass(c.character)}`;
    banner.innerHTML = `${nameOf(pub, c.claimantId)} claims <b style="color:var(--char-a)"><span class="c-icon-inline">${charIconHTML(c.character)}</span>${meta.name}</b>${targetTxt}.`;
    area.appendChild(banner);

    if (c.claimantId === S.myId) {
      const p = document.createElement('div');
      p.textContent = 'Waiting to see if anyone challenges...';
      area.appendChild(p);
    } else if (!c.eligible.includes(S.myId)) {
      area.appendChild(document.createTextNode('You are out of this round.'));
    } else if (c.passed.includes(S.myId)) {
      area.appendChild(document.createTextNode("You passed. Waiting for others..."));
    } else {
      const row = document.createElement('div');
      row.className = 'pending-actions';
      const challengeBtn = document.createElement('button');
      challengeBtn.className = 'danger';
      challengeBtn.textContent = 'CHALLENGE!';
      challengeBtn.onclick = () => socket.emit('challenge', {}, (res) => { if (!res.ok) alert(res.error); });
      const passBtn = document.createElement('button');
      passBtn.textContent = 'Pass';
      passBtn.onclick = () => socket.emit('pass', {}, (res) => { if (!res.ok) alert(res.error); });
      row.appendChild(challengeBtn);
      row.appendChild(passBtn);
      area.appendChild(row);
    }
    return;
  }

  if (pub.phase === 'awaitingDiscard') {
    const d = pub.pendingDiscard;
    const reasonText = {
      lied: 'You were caught bluffing! Choose a Character to discard.',
      lostChallenge: 'Your challenge was wrong! Choose a Character to discard.',
      assassinated: 'You were targeted by the Assassin! Choose a Character to discard.',
    }[d.reason] || 'Choose a Character to discard.';

    if (d.playerId === S.myId) {
      const banner = document.createElement('div');
      banner.className = 'action-banner';
      banner.textContent = reasonText;
      area.appendChild(banner);
      const row = document.createElement('div');
      row.className = 'hand-cards';
      S.hand.forEach((c, idx) => {
        const meta = CHARACTERS[c];
        const div = document.createElement('div');
        div.className = `hand-card clickable ${charClass(c)}`;
        div.innerHTML = `<div class="c-icon">${charIconHTML(c)}</div><div class="c-name">${meta.name}</div>`;
        div.onclick = () => socket.emit('resolveDiscard', { cardIndex: idx }, (res) => { if (!res.ok) alert(res.error); });
        row.appendChild(div);
      });
      area.appendChild(row);
    } else {
      area.innerHTML = `<div class="action-banner">Waiting for ${nameOf(pub, d.playerId)} to choose a card to discard...</div>`;
    }
    return;
  }

  if (pub.phase === 'awaitingTrickster') {
    const t = pub.pendingTrickster;
    if (t.claimantId === S.myId) {
      const banner = document.createElement('div');
      banner.className = 'action-banner';
      banner.textContent = 'Choose which card to swap for a new secret one.';
      area.appendChild(banner);
      const row = document.createElement('div');
      row.className = 'hand-cards';
      S.hand.forEach((c, idx) => {
        const meta = CHARACTERS[c];
        const div = document.createElement('div');
        div.className = `hand-card clickable ${charClass(c)}`;
        div.innerHTML = `<div class="c-icon">${charIconHTML(c)}</div><div class="c-name">${meta.name}</div>`;
        div.onclick = () => socket.emit('resolveTrickster', { cardIndex: idx }, (res) => { if (!res.ok) alert(res.error); });
        row.appendChild(div);
      });
      area.appendChild(row);
    } else {
      area.innerHTML = `<div class="action-banner">Waiting for ${nameOf(pub, t.claimantId)} to choose a card to swap...</div>`;
    }
    return;
  }

  if (pub.phase === 'gameover') {
    area.innerHTML = '';
  }
}

function buildClaimUI(pub) {
  const wrap = document.createElement('div');
  const banner = document.createElement('div');
  banner.className = 'action-banner';
  banner.textContent = 'Your turn — choose a Character to claim (you may bluff):';
  wrap.appendChild(banner);

  const grid = document.createElement('div');
  grid.className = 'char-grid';
  Object.entries(CHARACTERS).forEach(([key, meta]) => {
    const btn = document.createElement('button');
    btn.className = `char-btn ${charClass(key)}` + (S.selectedCharacter === key ? ' selected' : '');
    btn.innerHTML = `<span class="c-title"><span class="c-icon-inline">${charIconHTML(key)}</span>${meta.name}</span><span class="c-desc">${meta.desc}</span>`;
    btn.onclick = () => { S.selectedCharacter = key; S.selectedTarget = null; render(); };
    grid.appendChild(btn);
  });
  wrap.appendChild(grid);

  const me = playerById(S.myId);
  if (S.selectedCharacter) {
    const meta = CHARACTERS[S.selectedCharacter];
    if (meta.needsTarget) {
      const targetsDiv = document.createElement('div');
      targetsDiv.className = 'target-list';
      pub.players.filter((p) => p.alive && p.id !== S.myId).forEach((p) => {
        const disabled = S.selectedCharacter === 'THIEF' && p.tickets <= 0;
        const btn = document.createElement('button');
        btn.textContent = `${p.name} (🎟️${p.tickets})` + (disabled ? ' — no tickets' : '');
        btn.disabled = disabled;
        if (S.selectedTarget === p.id) btn.classList.add('primary');
        btn.onclick = () => { S.selectedTarget = p.id; render(); };
        targetsDiv.appendChild(btn);
      });
      wrap.appendChild(targetsDiv);
    }

    const needsTicketWarning = S.selectedCharacter === 'ASSASSIN' && me && me.tickets < 2;
    if (needsTicketWarning) {
      const warn = document.createElement('div');
      warn.className = 'error-msg';
      warn.textContent = 'You need at least 2 Golden Tickets to attempt this claim.';
      wrap.appendChild(warn);
    }

    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'primary';
    confirmBtn.textContent = `Claim ${meta.name}`;
    confirmBtn.disabled = (meta.needsTarget && !S.selectedTarget) || needsTicketWarning;
    confirmBtn.onclick = () => {
      socket.emit('makeClaim', { character: S.selectedCharacter, targetId: S.selectedTarget }, (res) => {
        if (!res.ok) { alert(res.error); return; }
        S.selectedCharacter = null; S.selectedTarget = null;
      });
    };
    wrap.appendChild(confirmBtn);
  }

  return wrap;
}

function renderLog(pub) {
  const logDiv = el('game-log');
  logDiv.innerHTML = '';
  pub.log.slice().reverse().forEach((entry) => {
    const line = document.createElement('div');
    line.textContent = entry.text;
    logDiv.appendChild(line);
  });
}

function renderChat() {
  const chatDiv = el('chat-log');
  chatDiv.innerHTML = '';
  S.chat.slice().reverse().forEach((msg) => {
    const line = document.createElement('div');
    line.className = 'chat-line';
    line.innerHTML = `<b>${msg.name}:</b> ${escapeHtml(msg.message)}`;
    chatDiv.appendChild(line);
  });
}

function renderSeerToast() {
  const toast = el('seer-toast');
  if (!S.seerToast) { toast.classList.add('hidden'); return; }
  toast.classList.remove('hidden');
  el('seer-toast-body').innerHTML = `${S.seerToast.targetName} is secretly holding: <span class="c-icon-inline">${charIconHTML(S.seerToast.character)}</span><b style="color:var(--char-a)">${S.seerToast.characterName}</b>`;
  el('seer-toast-body').className = charClass(S.seerToast.character);
}

function nameOf(pub, id) {
  const p = pub.players.find((pl) => pl.id === id);
  return p ? p.name : 'someone';
}
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

render();
