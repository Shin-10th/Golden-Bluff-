// Golden Bluff - client. Plain JS, no build step, no frameworks.
const CHARACTERS = {
  ROYAL:     { name: 'Royal',     needsTarget: false, desc: 'Take your turn to claim it and gain 2 Golden Tickets.' },
  THIEF:     { name: 'Thief',     needsTarget: true,  desc: 'Steal up to 2 Golden Tickets from another player.' },
  GUARD:     { name: 'Guard',     needsTarget: false, desc: "Never claimed on your turn — if you hold it, reveal it the instant you're targeted to block that ability." },
  SEER:      { name: 'Seer',      needsTarget: true,  desc: "Look at one of another player's cards — they choose which one to show you." },
  TRICKSTER: { name: 'Trickster', needsTarget: false, desc: 'Swap one of your cards for a new secret one.' },
  ASSASSIN:  { name: 'Assassin',  needsTarget: true,  desc: 'Pay 2 Tickets to force another player to discard a card.' },
};
const CLAIMABLE_KEYS = Object.keys(CHARACTERS).filter((k) => k !== 'GUARD');
const CONFETTI_COLORS = ['#c9a227', '#e8c14a', '#8a5fd1', '#4fa3c7', '#e05fa0', '#d4544a', '#6fd67f'];

const socket = io();
const el = (id) => document.getElementById(id);
const charClass = (key) => `char-${key}`;
const initials = (name) => (name || '?').trim().charAt(0).toUpperCase();

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

// Builds one trading-card-style Character card: art + name + full description.
// opts: { onClick, selected, disabled, hand (bigger, non-interactive display variant), descOverride }
function buildCharCard(key, opts = {}) {
  const meta = CHARACTERS[key];
  const card = document.createElement('div');
  let cls = `char-card ${charClass(key)}`;
  if (opts.selected) cls += ' selected';
  if (opts.onClick && !opts.disabled) cls += ' clickable';
  if (opts.hand) cls += ' char-card--hand fan-card';
  if (opts.disabled) cls += ' disabled';
  card.className = cls;
  card.innerHTML = `
    <div class="c-icon">${charIconHTML(key)}</div>
    <div class="c-name">${meta.name}</div>
    <div class="c-desc">${opts.descOverride || meta.desc}</div>
  `;
  if (opts.onClick && !opts.disabled) card.onclick = opts.onClick;
  return card;
}

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

// Slide-out drawer (activity log + table talk) keeps the table view uncluttered.
el('drawer-toggle-btn').addEventListener('click', () => el('log-drawer').classList.remove('hidden'));
el('drawer-close-btn').addEventListener('click', () => el('log-drawer').classList.add('hidden'));

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
function nameOf(pub, id) {
  const p = pub.players.find((pl) => pl.id === id);
  return p ? p.name : 'someone';
}

function renderGame() {
  const pub = S.pub;
  if (!pub) return;
  el('game-code').textContent = pub.code;

  renderSeats(pub);
  renderTableCenter(pub);
  renderChipBar(pub);
  renderMyHand();
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

// Places every OTHER player around the top arc of the table ring; "you" live in the hand-fan below.
function renderSeats(pub) {
  const layer = el('seats-layer');
  layer.innerHTML = '';
  const others = pub.players.filter((p) => p.id !== S.myId);
  const n = others.length;

  others.forEach((p, i) => {
    const angleDeg = n === 1 ? 0 : -75 + (150 * i) / (n - 1);
    const rad = (angleDeg * Math.PI) / 180;
    const radiusPct = 46;
    const leftPct = 50 + radiusPct * Math.sin(rad);
    const topPct = 50 - radiusPct * Math.cos(rad);

    const prev = prevPlayerById(p.id);
    const delta = prev ? p.tickets - prev.tickets : 0;
    const justEliminated = prev && prev.alive && !p.alive;
    const pulseClass = delta > 0 ? 'pulse-gain' : delta < 0 ? 'pulse-loss' : '';
    const deltaHtml = delta !== 0 ? `<span class="ticket-delta ${delta > 0 ? 'gain' : 'loss'}">${delta > 0 ? '+' : ''}${delta}</span>` : '';
    const isReacting = pub.pendingGuardReaction && pub.pendingGuardReaction.targetId === p.id;

    const seat = document.createElement('div');
    seat.className = 'seat';
    if (p.id === pub.activePlayerId) seat.classList.add('is-turn');
    if (!p.alive) seat.classList.add('is-dead');
    if (justEliminated) seat.classList.add('just-eliminated');
    seat.style.left = leftPct + '%';
    seat.style.top = topPct + '%';
    seat.innerHTML = `
      <div class="seat-avatar">${p.alive ? initials(p.name) : '💀'}${isReacting ? '<span class="seat-shield">🛡️</span>' : ''}</div>
      <div class="seat-name">${p.name}${!p.connected ? ' 💤' : ''}</div>
      <div class="seat-tickets ${pulseClass}">🎟️ ${p.tickets}${deltaHtml}</div>
      <div class="seat-hearts">${p.alive ? '❤️'.repeat(p.cardCount) : ''}</div>
    `;
    layer.appendChild(seat);
  });
}

function emblemEl() {
  const div = document.createElement('div');
  div.className = 'tc-emblem';
  div.innerHTML = EMBLEM_SVG;
  return div;
}

// The circular table centerpiece: whose turn/claim/reaction is live, and (when few enough) the react buttons.
function renderTableCenter(pub) {
  const center = el('table-center');
  center.innerHTML = '';
  const isMyTurn = pub.activePlayerId === S.myId;
  const status = (text, cls) => {
    const d = document.createElement('div');
    d.className = `tc-status${cls ? ' ' + cls : ''}`;
    d.innerHTML = text;
    center.appendChild(d);
    return d;
  };

  if (pub.phase === 'claim') {
    status(isMyTurn ? 'Your turn — choose a claim below' : `${nameOf(pub, pub.activePlayerId)}'s turn...`);
    if (!isMyTurn) center.appendChild(emblemEl());
    return;
  }

  if (pub.phase === 'challengeWindow') {
    const c = pub.pendingClaim;
    const meta = CHARACTERS[c.character];
    const targetTxt = c.targetId ? ` → ${nameOf(pub, c.targetId)}` : '';
    status(`<b>${nameOf(pub, c.claimantId)}</b> claims<br><span class="c-icon-inline">${charIconHTML(c.character)}</span><b style="color:var(--char-a)">${meta.name}</b>${targetTxt}`, charClass(c.character));

    if (c.claimantId === S.myId) {
      status('Waiting to see if anyone challenges...');
    } else if (!c.eligible.includes(S.myId)) {
      status("You're out of this round.");
    } else if (c.passed.includes(S.myId)) {
      status('You passed. Waiting for others...');
    } else {
      const row = document.createElement('div');
      row.className = 'tc-actions';
      const challengeBtn = document.createElement('button');
      challengeBtn.className = 'danger';
      challengeBtn.textContent = 'CHALLENGE!';
      challengeBtn.onclick = () => socket.emit('challenge', {}, (res) => { if (!res.ok) alert(res.error); });
      const passBtn = document.createElement('button');
      passBtn.textContent = 'Pass';
      passBtn.onclick = () => socket.emit('pass', {}, (res) => { if (!res.ok) alert(res.error); });
      row.appendChild(challengeBtn);
      row.appendChild(passBtn);
      center.appendChild(row);
    }
    return;
  }

  if (pub.phase === 'awaitingGuardReaction') {
    const g = pub.pendingGuardReaction;
    const meta = CHARACTERS[g.character];
    const targetTxt = g.targetId ? ` on ${nameOf(pub, g.targetId)}` : '';
    status(`<span class="c-icon-inline">${charIconHTML(g.character)}</span><b style="color:var(--char-a)">${meta.name}</b>${targetTxt} is about to happen...`, charClass(g.character));
    if (g.targetId === S.myId) {
      status('Reveal Guard to block it, or let it happen — see below');
    } else {
      status(`Waiting for ${nameOf(pub, g.targetId)} to react...`);
    }
    return;
  }

  if (pub.phase === 'awaitingSeerChoice') {
    const s = pub.pendingSeerChoice;
    status(`<span class="c-icon-inline">${charIconHTML('SEER')}</span>${nameOf(pub, s.seerId)} is waiting to see one of ${nameOf(pub, s.targetId)}'s cards`, charClass('SEER'));
    if (s.targetId === S.myId) status('Choose which card to show below');
    return;
  }

  if (pub.phase === 'awaitingDiscard') {
    const d = pub.pendingDiscard;
    status(d.playerId === S.myId ? 'Choose a card to discard below' : `${nameOf(pub, d.playerId)} is choosing a card to discard...`);
    return;
  }

  if (pub.phase === 'awaitingTrickster') {
    const t = pub.pendingTrickster;
    status(t.claimantId === S.myId ? 'Choose a card to swap below' : `${nameOf(pub, t.claimantId)} is swapping a card...`);
    return;
  }

  center.appendChild(emblemEl());
}

// The floating card bar under the hand: claim picker, target picker, or a discard/swap/guard/seer choice.
function renderChipBar(pub) {
  const bar = el('chip-bar');
  bar.innerHTML = '';
  const isMyTurn = pub.activePlayerId === S.myId;

  if (pub.phase === 'claim' && isMyTurn) {
    bar.appendChild(buildClaimChipUI(pub));
    return;
  }
  if (pub.phase === 'awaitingGuardReaction' && pub.pendingGuardReaction.targetId === S.myId) {
    bar.appendChild(buildGuardReactionUI());
    return;
  }
  if (pub.phase === 'awaitingSeerChoice' && pub.pendingSeerChoice.targetId === S.myId) {
    bar.appendChild(buildHandCardPicker('seerChoice', { cardIndex: 'cardIndex' }));
    return;
  }
  if (pub.phase === 'awaitingDiscard' && pub.pendingDiscard.playerId === S.myId) {
    bar.appendChild(buildHandCardPicker('resolveDiscard'));
    return;
  }
  if (pub.phase === 'awaitingTrickster' && pub.pendingTrickster.claimantId === S.myId) {
    bar.appendChild(buildHandCardPicker('resolveTrickster'));
    return;
  }
  // otherwise left empty; .chip-bar:empty is hidden via CSS
}

function buildHandCardPicker(eventName) {
  const wrap = document.createElement('div');
  wrap.className = 'chip-char-grid';
  S.hand.forEach((c, idx) => {
    wrap.appendChild(buildCharCard(c, {
      onClick: () => socket.emit(eventName, { cardIndex: idx }, (res) => { if (!res.ok) alert(res.error); }),
    }));
  });
  return wrap;
}

function buildGuardReactionUI() {
  const wrap = document.createElement('div');
  wrap.className = 'chip-char-grid';
  const guardIndex = S.hand.indexOf('GUARD');

  if (guardIndex !== -1) {
    wrap.appendChild(buildCharCard('GUARD', {
      descOverride: 'Reveal this to block it! It goes back into the deck and you draw a fresh secret card.',
      onClick: () => socket.emit('guardReact', { reveal: true, cardIndex: guardIndex }, (res) => { if (!res.ok) alert(res.error); }),
    }));
  }

  const declineBtn = document.createElement('button');
  declineBtn.className = 'chip';
  declineBtn.textContent = guardIndex !== -1 ? "Don't reveal — let it happen" : "You don't have Guard — continue";
  declineBtn.onclick = () => socket.emit('guardReact', { reveal: false }, (res) => { if (!res.ok) alert(res.error); });
  wrap.appendChild(declineBtn);
  return wrap;
}

function buildClaimChipUI(pub) {
  const wrap = document.createElement('div');
  const grid = document.createElement('div');
  grid.className = 'chip-char-grid';
  CLAIMABLE_KEYS.forEach((key) => {
    grid.appendChild(buildCharCard(key, {
      selected: S.selectedCharacter === key,
      onClick: () => { S.selectedCharacter = key; S.selectedTarget = null; render(); },
    }));
  });
  wrap.appendChild(grid);

  const me = playerById(S.myId);
  if (S.selectedCharacter) {
    const meta = CHARACTERS[S.selectedCharacter];
    if (meta.needsTarget) {
      const targetsDiv = document.createElement('div');
      targetsDiv.className = 'chip-char-grid';
      pub.players.filter((p) => p.alive && p.id !== S.myId).forEach((p) => {
        const disabled = S.selectedCharacter === 'THIEF' && p.tickets <= 0;
        const chip = document.createElement('button');
        chip.className = 'chip';
        chip.textContent = `${p.name} (🎟️${p.tickets})`;
        chip.disabled = disabled;
        if (S.selectedTarget === p.id) chip.classList.add('selected');
        chip.onclick = () => { S.selectedTarget = p.id; render(); };
        targetsDiv.appendChild(chip);
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

// Your hand, fanned out like held cards. Purely a display of what you hold — actions live in the chip bar.
function renderMyHand() {
  const handDiv = el('my-hand');
  handDiv.innerHTML = '';
  const isInitialDeal = S.prevHand.length === 0 && S.hand.length > 0;
  const n = S.hand.length;

  S.hand.forEach((c, idx) => {
    const card = buildCharCard(c, { hand: true });

    let tilt = 0, xOffset = 0;
    if (n === 2) { tilt = idx === 0 ? -9 : 9; xOffset = idx === 0 ? -58 : 58; }
    card.style.setProperty('--fan-transform', `translateX(${xOffset}px) rotate(${tilt}deg)`);
    card.style.zIndex = String(idx);

    if (isInitialDeal) {
      card.classList.add('deal-in');
      card.style.animationDelay = (idx * 0.15) + 's';
    } else if (S.prevHand[idx] && S.prevHand[idx] !== c) {
      card.classList.add('flip-swap');
    }
    handDiv.appendChild(card);
  });

  S.prevHand = S.hand.slice();
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
  el('seer-toast-body').innerHTML = `${S.seerToast.targetName} chose to show you: <span class="c-icon-inline">${charIconHTML(S.seerToast.character)}</span><b style="color:var(--char-a)">${S.seerToast.characterName}</b>`;
  el('seer-toast-body').className = charClass(S.seerToast.character);
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

render();
