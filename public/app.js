// Golden Bluff - client. Plain JS, no build step, no frameworks.
const CHARACTERS = {
  ROYAL:     { name: 'Royal',     needsTarget: false, desc: 'Gain 2 Golden Tickets — only 1 if a rival is secretly holding a Royal too.' },
  THIEF:     { name: 'Thief',     needsTarget: true,  desc: 'Steal up to 2 Golden Tickets from another player.' },
  GUARD:     { name: 'Guard',     needsTarget: false, desc: "Never claimed on your turn — if you hold it, reveal it the instant you're targeted to block that ability." },
  SEER:      { name: 'Seer',      needsTarget: true,  desc: "Look at one of another player's cards — they choose which one to show you." },
  TRICKSTER: { name: 'Trickster', needsTarget: false, desc: 'Swap one of your cards for a new secret one.' },
  ASSASSIN:  { name: 'Assassin',  needsTarget: true,  desc: 'Pay 2 Tickets to force another player to discard a card.' },
};
const CLAIMABLE_KEYS = Object.keys(CHARACTERS).filter((k) => k !== 'GUARD');
const CONFETTI_COLORS = ['#c9a227', '#e8c14a', '#8a5fd1', '#4fa3c7', '#e05fa0', '#d4544a', '#6fd67f'];
const CHARACTER_ORDER = Object.keys(CHARACTERS);

// Card-number footer, e.g. "03/06" — purely flavour, mirrors a TCG's print number.
function cardNumber(key) {
  const idx = CHARACTER_ORDER.indexOf(key) + 1;
  return `${String(idx).padStart(2, '0')}/${String(CHARACTER_ORDER.length).padStart(2, '0')}`;
}
// Guard-interaction note for the card footer — genuinely useful, not just flavour.
function guardNote(key) {
  if (key === 'GUARD') return 'Blocks Thief · Seer · Assassin';
  if (CHARACTERS[key].needsTarget) return 'Countered by Guard';
  return 'Unblockable by Guard';
}

const socket = io();
const el = (id) => document.getElementById(id);
const charClass = (key) => `char-${key}`;
const initials = (name) => (name || '?').trim().charAt(0).toUpperCase();

const DEFAULT_AVATAR = { bodyColor: '#e8b04a', hat: 'none', face: 'happy', tagColor: '#c9a227' };
function loadSavedAvatar() {
  try {
    const raw = localStorage.getItem('goldenbluff_avatar');
    if (!raw) return { ...DEFAULT_AVATAR };
    return { ...DEFAULT_AVATAR, ...JSON.parse(raw) };
  } catch (e) { return { ...DEFAULT_AVATAR }; }
}

const S = {
  screen: 'title',      // title | auth | avatar | howtoplay | lobby | game
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
  lastOutcomeSig: null,
  lastScreen: null,
  avatar: loadSavedAvatar(),   // my own 3D avatar customization
  pendingAuth: null,           // { mode: 'create'|'join', name, code } -- staged while on the avatar screen
  avatarReturnTo: null,        // 'title' | 'lobby' -- where to return after an anytime avatar edit (outside the join flow)
  avatarPreview: null,         // the live rotating preview renderer (built lazily)
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

  const desc = opts.descOverride || meta.desc;
  const bodyHtml = opts.hand
    ? `<div class="cc-ability"><div class="cc-ability-label">Ability</div><div class="cc-desc">${desc}</div></div>
       <div class="cc-footer"><span class="cc-guard-note">🛡️ ${guardNote(key)}</span><span class="cc-number">${cardNumber(key)}</span></div>`
    : `<div class="cc-desc">${desc}</div>`;

  card.innerHTML = `
    <div class="cc-header">
      <span class="cc-icon-badge">${charIconHTML(key)}</span>
    </div>
    <div class="cc-art">${buildCardArtHTML(key, opts)}</div>
    <div class="c-name">${meta.name}</div>
    ${bodyHtml}
  `;
  if (opts.onClick && !opts.disabled) {
    card.onclick = () => { AudioFX.sfx('click'); opts.onClick(); };
  }
  return card;
}

// A card's art is your own 3D avatar wearing that character's look, when we have an
// avatar config to render it with (your own hand cards); otherwise the plain flat icon.
function buildCardArtHTML(key, opts) {
  if (opts.avatarConfig) {
    const snapshot = getAvatarSnapshot(opts.avatarConfig, key);
    if (snapshot) return `<img class="avatar-snapshot" src="${snapshot}" alt="">`;
  }
  return `<div class="cc-art-icon">${charIconHTML(key)}</div>`;
}

function showError(msg) {
  el('auth-error').textContent = msg || '';
  if (msg) setTimeout(() => { if (el('auth-error').textContent === msg) el('auth-error').textContent = ''; }, 4000);
}

// ---------- Socket wiring ----------
socket.on('connect', () => { S.myId = socket.id; });

socket.on('state', (pub) => {
  const prevPub = S.pub;
  const outcome = detectChallengeOutcome(prevPub, pub);
  const applyBookkeeping = () => {
    S.prevPub = prevPub;
    S.pub = pub;
    if (S.screen === 'avatar' && pub.phase === 'lobby') {
      // Editing your avatar mid-lobby shouldn't get bumped by routine broadcasts --
      // but DO still pull you into the game screen the instant it actually starts.
    } else if (pub.phase === 'lobby') {
      S.screen = 'lobby';
    } else {
      S.screen = 'game';
    }
    if (pub.phase !== 'gameover') S.confettiSpawned = false;
  };

  if (outcome) {
    // The claim's fate (truthful/lie) is already decided server-side and folded into this
    // one broadcast — so instead of letting everything land at once, spend a moment on it:
    // CHALLENGE flash now, then (after a beat) a card-reveal flip, then a win/lose banner,
    // and only THEN the ticket-fly/sound/log effects that used to fire instantly.
    S.lastOutcomeSig = outcome.sig;
    S.lastFlashSig = outcome.sig; // keep maybeFlashChallenge's own dedup in sync
    spawnChallengeFlash(pub, outcome.c);
    AudioFX.sfx('challenge');
    applyBookkeeping();
    render();
    sequenceChallengeOutcome(prevPub, pub, outcome);
    return;
  }

  maybeFlashChallenge(prevPub, pub);
  reactToNewLogEntries(prevPub, pub);
  reactToTicketDeltas(prevPub, pub);
  reactToAbilitySpotlights(prevPub, pub);
  applyBookkeeping();
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

// ---------- Title screen ----------
el('title-play-btn').addEventListener('click', () => {
  AudioFX.sfx('click');
  S.screen = 'auth';
  render();
});
el('title-avatar-btn').addEventListener('click', () => {
  AudioFX.sfx('click');
  S.pendingAuth = null;
  S.avatarReturnTo = 'title';
  S.screen = 'avatar';
  render();
});
el('title-howtoplay-btn').addEventListener('click', () => {
  AudioFX.sfx('click');
  S.screen = 'howtoplay';
  render();
});
el('howtoplay-back-btn').addEventListener('click', () => {
  S.screen = 'title';
  render();
});

// ---------- Auth screen ----------
// Both forms stage their intent and hand off to the avatar creator screen first --
// the actual createRoom/joinRoom call happens once the player confirms their look.
el('create-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = el('create-name').value.trim();
  if (!name) return showError('Enter your name.');
  S.pendingAuth = { mode: 'create', name };
  S.screen = 'avatar';
  render();
});

el('join-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = el('join-name').value.trim();
  const code = el('join-code').value.trim();
  if (!name || !code) return showError('Enter your name and the room code.');
  S.pendingAuth = { mode: 'join', name, code };
  S.screen = 'avatar';
  render();
});

el('auth-back-btn').addEventListener('click', () => {
  S.screen = 'title';
  render();
});

el('avatar-back-btn').addEventListener('click', () => {
  if (S.pendingAuth) {
    S.pendingAuth = null;
    S.screen = 'auth';
  } else {
    S.screen = S.avatarReturnTo || 'title';
    S.avatarReturnTo = null;
  }
  render();
});

el('avatar-confirm-btn').addEventListener('click', () => {
  const pending = S.pendingAuth;
  try { localStorage.setItem('goldenbluff_avatar', JSON.stringify(S.avatar)); } catch (e) { /* best-effort */ }

  if (pending) {
    const done = (res) => {
      if (!res.ok) { S.screen = 'auth'; render(); return showError(res.error); }
      S.myName = pending.name; S.code = res.code; S.myId = res.playerId;
      S.pendingAuth = null;
      S.screen = 'lobby';
      render();
    };
    if (pending.mode === 'create') {
      socket.emit('createRoom', { name: pending.name, avatar: S.avatar }, done);
    } else {
      socket.emit('joinRoom', { name: pending.name, code: pending.code, avatar: S.avatar }, done);
    }
    return;
  }

  // Anytime edit (title menu, or mid-lobby) -- not part of the create/join flow.
  if (S.avatarReturnTo === 'lobby' && S.code) {
    socket.emit('updateAvatar', { avatar: S.avatar });
  }
  S.screen = S.avatarReturnTo || 'title';
  S.avatarReturnTo = null;
  render();
});

el('start-game-btn').addEventListener('click', () => {
  AudioFX.sfx('click');
  socket.emit('startGame', {}, (res) => { if (!res.ok) alert(res.error); });
});

el('lobby-edit-avatar-btn').addEventListener('click', () => {
  AudioFX.sfx('click');
  S.pendingAuth = null;
  S.avatarReturnTo = 'lobby';
  S.screen = 'avatar';
  render();
});

// ---------- Avatar creator screen ----------
const HAT_LABELS = { none: 'None', cap: 'Cap', cone: 'Wizard', crown: 'Crown', band: 'Band' };
const FACE_LABELS = { happy: 'Happy', smirk: 'Smirk', surprised: 'Surprised', glasses: 'Shades', mask: 'Masked' };
let avatarUIBuilt = false;
let avatarPreviewSig = null;

function buildAvatarCreatorUI() {
  if (avatarUIBuilt) return;
  avatarUIBuilt = true;
  const { AVATAR_OPTIONS } = window.Avatar3D;

  AVATAR_OPTIONS.bodyColors.forEach((color) => {
    const sw = document.createElement('div');
    sw.className = 'swatch';
    sw.style.background = color;
    sw.dataset.color = color;
    sw.title = color;
    sw.onclick = () => { S.avatar.bodyColor = color; render(); };
    el('avatar-body-swatches').appendChild(sw);

    const tagSw = sw.cloneNode(true);
    tagSw.onclick = () => { S.avatar.tagColor = color; render(); };
    el('avatar-tag-swatches').appendChild(tagSw);
  });

  AVATAR_OPTIONS.hats.forEach((hat) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'option-btn';
    btn.textContent = HAT_LABELS[hat] || hat;
    btn.dataset.value = hat;
    btn.onclick = () => { S.avatar.hat = hat; render(); };
    el('avatar-hat-options').appendChild(btn);
  });

  AVATAR_OPTIONS.faces.forEach((face) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'option-btn';
    btn.textContent = FACE_LABELS[face] || face;
    btn.dataset.value = face;
    btn.onclick = () => { S.avatar.face = face; render(); };
    el('avatar-face-options').appendChild(btn);
  });
}

function renderAvatarScreen() {
  if (!window.Avatar3D) return; // module still loading -- render() will retry on the next tick
  buildAvatarCreatorUI();

  if (!S.avatarPreview) {
    S.avatarPreview = window.Avatar3D.createPreviewRenderer(el('avatar-preview-canvas'));
  }
  const sig = JSON.stringify(S.avatar);
  if (sig !== avatarPreviewSig) {
    avatarPreviewSig = sig;
    S.avatarPreview.update(S.avatar, null);
  }

  el('avatar-body-swatches').querySelectorAll('.swatch').forEach((sw) => {
    sw.classList.toggle('selected', sw.dataset.color === S.avatar.bodyColor);
  });
  el('avatar-tag-swatches').querySelectorAll('.swatch').forEach((sw) => {
    sw.classList.toggle('selected', sw.dataset.color === S.avatar.tagColor);
  });
  el('avatar-hat-options').querySelectorAll('.option-btn').forEach((btn) => {
    btn.classList.toggle('selected', btn.dataset.value === S.avatar.hat);
  });
  el('avatar-face-options').querySelectorAll('.option-btn').forEach((btn) => {
    btn.classList.toggle('selected', btn.dataset.value === S.avatar.face);
  });
}

// A small cache of baked avatar images (data URLs), keyed by config + which character's
// accessory look is applied -- rendered once each via a single shared off-screen WebGL
// context (see avatar3d.js), then reused as plain <img> everywhere (seats, cards).
const avatarSnapshotCache = new Map();
function getAvatarSnapshot(avatarConfig, charKey) {
  if (!window.Avatar3D || !avatarConfig) return null;
  const key = JSON.stringify(avatarConfig) + '|' + (charKey || '');
  let url = avatarSnapshotCache.get(key);
  if (!url) {
    const charOverride = charKey ? window.Avatar3D.CHARACTER_ACCESSORY[charKey] : null;
    url = window.Avatar3D.renderSnapshot(avatarConfig, { charOverride, size: 160 });
    avatarSnapshotCache.set(key, url);
  }
  return url;
}
window.addEventListener('avatar3d-ready', () => { if (S.screen === 'avatar') render(); });

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

// Static character-reference grids (How to Play screen + in-game cheat sheet) -- built
// once from the same CHARACTERS data everything else uses, so they can never drift.
function buildCharacterReferenceGrid(containerId) {
  const grid = el(containerId);
  if (!grid) return;
  CHARACTER_ORDER.forEach((key) => {
    const row = document.createElement('div');
    row.className = `char-btn ${charClass(key)}`;
    row.innerHTML = `
      <div class="c-title"><span class="c-icon-inline">${charIconHTML(key)}</span>${CHARACTERS[key].name}</div>
      <div class="c-desc">${CHARACTERS[key].desc}</div>
    `;
    grid.appendChild(row);
  });
}
buildCharacterReferenceGrid('howtoplay-char-grid');
buildCharacterReferenceGrid('cheat-sheet-grid');

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

// Detects the single broadcast where a challenge's fate (truthful claim vs. caught bluff) has
// just been decided server-side — the engine resolves this synchronously, so the log already
// carries the outcome line by the time we see it. Returns null on any other broadcast (no new
// challenge, or the outcome came through in a broadcast we've already handled).
function detectChallengeOutcome(prevPub, pub) {
  const c = pub && pub.pendingClaim;
  if (!c || c.status !== 'challenged') return null;
  const sig = JSON.stringify({ a: c.claimantId, b: c.character, t: c.targetId, ch: c.challengerId });
  if (sig === S.lastOutcomeSig) return null;
  const prevLast = prevPub && prevPub.log && prevPub.log.length ? prevPub.log[prevPub.log.length - 1].ts : 0;
  const newEntries = (pub.log || []).filter((e) => e.ts > prevLast);
  const lied = newEntries.some((e) => /was bluffing/.test(e.text));
  const truthful = newEntries.some((e) => /— the claim was true!/.test(e.text));
  if (!lied && !truthful) return null; // outcome not in this broadcast yet
  return { sig, c, newEntries, truthful };
}

// Stages the dramatic beats for a just-resolved challenge: the CHALLENGE flash has already
// fired by the time this is called, so this picks up from there — reveal flip, then a
// win/lose banner, then (finally) the sound/card-fly/ticket-fly effects the outcome triggers,
// timed so they land with the banner instead of all at once with the initial flash.
function sequenceChallengeOutcome(prevPub, pub, outcome) {
  const deferredEntries = outcome.newEntries.filter((e) => !/shouts CHALLENGE/.test(e.text));
  const applyDeferredEffects = () => {
    reactToNewLogEntries(prevPub, pub, deferredEntries);
    reactToTicketDeltas(prevPub, pub);
  };

  if (PREFERS_REDUCED_MOTION) {
    applyDeferredEffects();
    return;
  }

  const FLASH_MS = 1500;
  const FLIP_MS = 1000;
  setTimeout(() => {
    showRevealFlip(outcome.c, outcome.truthful);
    setTimeout(() => {
      showOutcomeBanner(pub, outcome);
      applyDeferredEffects();
    }, FLIP_MS);
  }, FLASH_MS);
}

// The big centered card-flip: flips from a face-down back to either the real claimed
// character (truthful claim survives) or a symbolic "BLUFF" face (lie caught) — the
// bluffer's actual hand is NEVER shown, even here.
function showRevealFlip(c, truthful) {
  const meta = CHARACTERS[c.character];
  const wrap = document.createElement('div');
  wrap.className = 'reveal-flip-wrap';
  const frontCls = truthful ? `reveal-face reveal-face-front ${charClass(c.character)}` : 'reveal-face reveal-face-front reveal-bluff';
  const frontHtml = truthful
    ? `<span class="rf-icon">${charIconHTML(c.character)}</span><span class="rf-name">${meta.name}</span>`
    : `<span class="rf-icon">✕</span><span class="rf-name">BLUFF</span>`;
  wrap.innerHTML = `
    <div class="reveal-flip-inner">
      <div class="reveal-face reveal-face-back"><span class="fc-back">🎴</span></div>
      <div class="${frontCls}">${frontHtml}</div>
    </div>
  `;
  fxLayer().appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add('flipped'));
  setTimeout(() => wrap.remove(), 1500);
}

// The win/lose beat right after the flip settles: names the winner (tickets) and the loser
// (a character) of this specific challenge, colored green/red so the outcome reads instantly.
function showOutcomeBanner(pub, outcome) {
  const claimant = pub.players.find((p) => p.id === outcome.c.claimantId);
  const challenger = pub.players.find((p) => p.id === outcome.c.challengerId);
  const winner = outcome.truthful ? claimant : challenger;
  const loser = outcome.truthful ? challenger : claimant;
  const div = document.createElement('div');
  div.className = `outcome-banner ${outcome.truthful ? 'outcome-win' : 'outcome-loss'}`;
  div.innerHTML = `
    <div class="ob-title">${outcome.truthful ? '🏆 CLAIM HOLDS!' : '💥 CAUGHT BLUFFING!'}</div>
    <div class="ob-sub">${winner ? winner.name : 'Someone'} wins the challenge · ${loser ? loser.name : 'Someone'} loses a character</div>
  `;
  fxLayer().appendChild(div);
  setTimeout(() => div.remove(), 1600);
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

// Generic hook: skim newly-added activity-log lines for keywords and play the
// matching sound (and, for a Guard block, a visual flash) — works for every
// player's client without any extra server events, since pub.log is already broadcast.
function reactToNewLogEntries(prevPub, pub, explicitEntries) {
  if (!pub || !pub.log) return;
  let newEntries = explicitEntries;
  if (!newEntries) {
    const prevLast = prevPub && prevPub.log && prevPub.log.length ? prevPub.log[prevPub.log.length - 1].ts : 0;
    newEntries = pub.log.filter((e) => e.ts > prevLast);
  }
  const deck = el('pile-deck');
  newEntries.forEach((e) => {
    const t = e.text;
    if (/reveals GUARD and blocks/.test(t)) { AudioFX.sfx('shield'); spawnGuardFlash(t); }
    else if (/was bluffing/.test(t)) AudioFX.sfx('bust');
    else if (/shouts CHALLENGE/.test(t)) AudioFX.sfx('challenge');
    else if (/wins with/.test(t)) AudioFX.sfx('win');
    else if (/is eliminated/.test(t)) AudioFX.sfx('defeat');
    else if (/claims/.test(t)) AudioFX.sfx('claim');
    else if (/steals|from Royal|Royal pays out|for the correct challenge|for winning the challenge|Stable Income/.test(t)) AudioFX.sfx('coin');
    else if (/discards|pays 2 🎟️/.test(t)) AudioFX.sfx('loss');

    // --- Card-pile animations: only for events the rules already make public. ---
    // Guard block: the blocker's GUARD flies face-up to the deck (it's genuinely revealed).
    const guardMatch = t.match(/^🛡️ (.+?) reveals GUARD and blocks/);
    if (guardMatch) {
      const id = idByName(pub, guardMatch[1]);
      if (id) flyCard(playerAnchor(id), deck, 'GUARD');
    }
    // Truthful claim survives a challenge: the claimed character flies face-up to the deck.
    // pub.pendingClaim still holds this exact claim (status 'challenged') at this broadcast.
    if (/— the claim was true!/.test(t) && pub.pendingClaim && pub.pendingClaim.character) {
      flyCard(playerAnchor(pub.pendingClaim.claimantId), deck, pub.pendingClaim.character);
    }
    // Any discard is always face-up per the rules (bluffed, lost a challenge, or assassinated).
    const discardMatch = t.match(/^(.+?) discards .+? (\w+)\.$/);
    if (discardMatch) {
      const id = idByName(pub, discardMatch[1]);
      const key = NAME_TO_KEY[discardMatch[2]];
      if (id) flyCard(playerAnchor(id), deck, key || null);
    }
    // Generic "revealed card shuffled back, draw a replacement" — shared by Guard's redraw,
    // a truthful claimant's redraw, AND Trickster's own hidden swap. The new card is always
    // secret, so this is always a face-down flight from the deck — never names a character.
    const redrawMatch = t.match(/^(.+?)'s revealed card is shuffled back into the deck/);
    if (redrawMatch) {
      const id = idByName(pub, redrawMatch[1]);
      if (id) flyCard(deck, playerAnchor(id), null);
    }
  });
}

// Center-stage flavor pop-up for the moment an ability actually resolves — a themed
// callout (icon + flourish + flavor text) rather than just a log line. Triggered off the
// specific outcome log lines each ability writes, plus (for Trickster, whose resolution
// reuses a generic "shuffled back" line shared with Guard/reveal redraws) the
// pendingTrickster state transition instead.
const SPOTLIGHT_FLAVOR = {
  ROYAL:     { title: '👑 ROYAL DECREE' },
  THIEF:     { title: '🦹 THE THIEF STRIKES' },
  SEER:      { title: '🔮 THE SEER PEEKS' },
  TRICKSTER: { title: '🎭 THE SWITCH' },
  ASSASSIN:  { title: '☠️ THE ASSASSIN STRIKES' },
};

function reactToAbilitySpotlights(prevPub, pub, explicitEntries) {
  if (!pub) return;
  let newEntries = explicitEntries;
  if (!newEntries) {
    const prevLast = prevPub && prevPub.log && prevPub.log.length ? prevPub.log[prevPub.log.length - 1].ts : 0;
    newEntries = (pub.log || []).filter((e) => e.ts > prevLast);
  }
  newEntries.forEach((e) => {
    const t = e.text;
    let m;
    if ((m = t.match(/^(.+?) gains 2 🎟️ from Royal\.$/))) spawnAbilitySpotlight('ROYAL', m[1], 'Gains 2 🎟️!');
    else if ((m = t.match(/^(.+?)'s Royal pays out the full 2/))) spawnAbilitySpotlight('ROYAL', m[1], 'Gains the full 2 🎟️!');
    else if ((m = t.match(/^(.+?)'s Royal only pays out 1/))) spawnAbilitySpotlight('ROYAL', m[1], 'Capped at 1 🎟️.');
    else if ((m = t.match(/^(.+?) steals (\d+) 🎟️ from (.+?)\.$/))) spawnAbilitySpotlight('THIEF', m[1], `Steals ${m[2]} 🎟️ from ${m[3]}!`);
    else if ((m = t.match(/^(.+?) pays 2 🎟️ for the Assassin\.$/))) spawnAbilitySpotlight('ASSASSIN', m[1], 'Strikes!');
    else if ((m = t.match(/^(.+?) shows one of their cards to (.+?)\.$/))) spawnAbilitySpotlight('SEER', m[2], `Peeks at ${m[1]}'s hand!`);
    else if ((m = t.match(/^(.+?) has only one card left and shows it to (.+?)\.$/))) spawnAbilitySpotlight('SEER', m[2], `Peeks at ${m[1]}'s hand!`);
  });
  if (prevPub && prevPub.pendingTrickster && (!pub.pendingTrickster)) {
    const p = pub.players.find((pl) => pl.id === prevPub.pendingTrickster.claimantId);
    spawnAbilitySpotlight('TRICKSTER', p ? p.name : 'Someone', 'Swaps a card!');
  }
}

function spawnAbilitySpotlight(key, playerName, flavorText) {
  const meta = SPOTLIGHT_FLAVOR[key];
  if (!meta) return;
  const div = document.createElement('div');
  div.className = `ability-spotlight ${charClass(key)}`;
  div.innerHTML = `
    <div class="asl-icon">${charIconHTML(key)}</div>
    <div class="asl-title">${meta.title}</div>
    <div class="asl-sub">${playerName} — ${flavorText}</div>
  `;
  fxLayer().appendChild(div);
  setTimeout(() => div.remove(), 2000);
}

function idByName(pub, name) {
  const p = pub.players.find((pl) => pl.name === name);
  return p ? p.id : null;
}

function spawnGuardFlash(logText) {
  const div = document.createElement('div');
  div.className = 'guard-flash char-GUARD';
  div.innerHTML = `<div class="gf-title">🛡️ BLOCKED!</div><div class="gf-sub">${logText}</div>`;
  fxLayer().appendChild(div);
  setTimeout(() => div.remove(), 1500);
}

// A slow, continuous drift of embers rising from the bottom of the screen —
// purely decorative ambiance for the fx-layer, paused when the tab isn't visible.
function spawnEmber() {
  const layer = fxLayer();
  const ember = document.createElement('div');
  ember.className = 'ember';
  const size = 3 + Math.random() * 3;
  const duration = 7 + Math.random() * 5;
  ember.style.left = Math.random() * 100 + 'vw';
  ember.style.width = size + 'px';
  ember.style.height = size + 'px';
  ember.style.setProperty('--drift', (Math.random() * 80 - 40) + 'px');
  ember.style.animationDuration = duration + 's';
  layer.appendChild(ember);
  setTimeout(() => ember.remove(), duration * 1000 + 200);
}
function startAmbientParticles() {
  setInterval(() => { if (document.visibilityState === 'visible') spawnEmber(); }, 900);
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

// ---------- Flying pile animations (bank <-> player tickets, deck <-> player cards) ----------
// Positions are computed live from real DOM rects (getBoundingClientRect), not hard-coded,
// since seats/piles move around with viewport size. Skips entirely under reduced-motion,
// since the ticket-delta popup and activity log already convey the same information.
const PREFERS_REDUCED_MOTION = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
const NAME_TO_KEY = Object.fromEntries(Object.entries(CHARACTERS).map(([k, m]) => [m.name, k]));

function centerOf(node) {
  const r = node.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

// The on-screen anchor for a player: their seat in the ring, or your own hand/stats.
function playerAnchor(playerId) {
  if (!playerId) return null;
  if (playerId === S.myId) return el('my-hand') || el('my-stats');
  const layer = el('seats-layer');
  return layer && layer.querySelector(`[data-player-id="${CSS.escape(playerId)}"]`);
}

// One "coin" flying from one anchor to another.
function flyToken(fromNode, toNode, delayMs) {
  if (PREFERS_REDUCED_MOTION || !fromNode || !toNode) return;
  const from = centerOf(fromNode);
  const to = centerOf(toNode);
  const dx = to.x - from.x, dy = to.y - from.y;
  const token = document.createElement('div');
  token.className = 'flying-token';
  token.textContent = '🎟️';
  token.style.left = from.x + 'px';
  token.style.top = from.y + 'px';
  fxLayer().appendChild(token);
  const anim = token.animate(
    [
      { transform: 'translate(-50%,-50%) scale(0.6)', opacity: 0 },
      { transform: `translate(calc(-50% + ${dx * 0.5}px), calc(-50% + ${dy * 0.5 - 40}px)) scale(1.2)`, opacity: 1, offset: 0.55 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.75)`, opacity: 0 },
    ],
    { duration: 650, delay: delayMs || 0, easing: 'ease-in-out' }
  );
  anim.onfinish = () => token.remove();
}

// A little burst of 1-3 tokens so a +2 reads differently from a +1, without spamming the screen.
function flyTicketBurst(fromNode, toNode, count) {
  const n = Math.max(1, Math.min(3, Math.abs(count)));
  for (let i = 0; i < n; i++) flyToken(fromNode, toNode, i * 110);
}

// One character card flying between the deck pile and a player. `key` shows the character
// face-up; omit it (null/undefined) for a face-down "mystery" card — always used for anything
// that isn't already public per the rules (a fresh draw, Seer's peek, Trickster's own swap).
function flyCard(fromNode, toNode, key) {
  if (PREFERS_REDUCED_MOTION || !fromNode || !toNode) return;
  const from = centerOf(fromNode);
  const to = centerOf(toNode);
  const dx = to.x - from.x, dy = to.y - from.y;
  const card = document.createElement('div');
  card.className = 'flying-card' + (key ? ` ${charClass(key)} face-up` : ' face-down');
  card.innerHTML = key ? `<span class="fc-icon">${charIconHTML(key)}</span>` : '<span class="fc-back">🎴</span>';
  card.style.left = from.x + 'px';
  card.style.top = from.y + 'px';
  fxLayer().appendChild(card);
  const anim = card.animate(
    [
      { transform: 'translate(-50%,-50%) rotate(0deg) scale(0.55)', opacity: 0 },
      { transform: `translate(calc(-50% + ${dx * 0.5}px), calc(-50% + ${dy * 0.5 - 30}px)) rotate(10deg) scale(1.08)`, opacity: 1, offset: 0.5 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(0deg) scale(0.7)`, opacity: 0 },
    ],
    { duration: 700, easing: 'ease-in-out' }
  );
  anim.onfinish = () => card.remove();
}

// Any change in a player's ticket count flies coins to/from the bank pile — Stable Income,
// Royal, challenge rewards, an Assassin's 2-ticket cost, an elimination's tickets-to-supply,
// and a Thief's steal (shown as two bank flights rather than a direct player-to-player one,
// which keeps this one generic rule covering every ticket-moving ability).
function reactToTicketDeltas(prevPub, pub) {
  if (!prevPub || !pub) return;
  const bank = el('pile-bank');
  pub.players.forEach((p) => {
    const prev = prevPub.players.find((pp) => pp.id === p.id);
    if (!prev) return;
    const delta = p.tickets - prev.tickets;
    if (delta === 0) return;
    const anchor = playerAnchor(p.id);
    if (!anchor) return;
    if (delta > 0) flyTicketBurst(bank, anchor, delta);
    else flyTicketBurst(anchor, bank, delta);
  });
}

// ---------- Render ----------
function render() {
  el('screen-title').classList.toggle('hidden', S.screen !== 'title');
  el('screen-auth').classList.toggle('hidden', S.screen !== 'auth');
  el('screen-avatar').classList.toggle('hidden', S.screen !== 'avatar');
  el('screen-howtoplay').classList.toggle('hidden', S.screen !== 'howtoplay');
  el('screen-lobby').classList.toggle('hidden', S.screen !== 'lobby');
  el('screen-game').classList.toggle('hidden', S.screen !== 'game');

  if (S.screen !== S.lastScreen) {
    const activeEl = el(`screen-${S.screen}`);
    activeEl.classList.remove('screen-enter');
    void activeEl.offsetWidth; // reflow so the animation restarts
    activeEl.classList.add('screen-enter');
    S.lastScreen = S.screen;
  }

  if (S.screen === 'avatar') renderAvatarScreen();
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
  el('start-game-btn').disabled = count < 2 || count > 6;
  el('lobby-hint').textContent = isHost
    ? (count < 2 ? `Need at least 2 players (currently ${count}).` : `Ready to start with ${count} players.`)
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

  el('table-ring').classList.toggle('my-turn', pub.activePlayerId === S.myId && pub.phase !== 'gameover');

  renderSeats(pub);
  renderMyStats(pub);
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
    seat.dataset.playerId = p.id;
    if (p.id === pub.activePlayerId) seat.classList.add('is-turn');
    if (!p.alive) seat.classList.add('is-dead');
    if (justEliminated) seat.classList.add('just-eliminated');
    seat.style.left = leftPct + '%';
    seat.style.top = topPct + '%';
    const snapshot = p.alive ? getAvatarSnapshot(p.avatar, null) : null;
    const avatarInner = snapshot ? `<img class="avatar-snapshot" src="${snapshot}" alt="">` : (p.alive ? initials(p.name) : '💀');
    seat.innerHTML = `
      <div class="seat-avatar">${avatarInner}${isReacting ? '<span class="seat-shield">🛡️</span>' : ''}</div>
      <div class="seat-name">${p.name}${!p.connected ? ' 💤' : ''}</div>
      <div class="seat-tickets ${pulseClass}">🎟️ ${p.tickets}${deltaHtml}</div>
      <div class="seat-hearts">${p.alive ? '❤️'.repeat(p.cardCount) : ''}</div>
    `;
    layer.appendChild(seat);
  });
}

// Your own ticket count — you're excluded from the seats layer, so this is
// the only place your own tickets are shown. Same delta pulse as everyone else.
function renderMyStats(pub) {
  const wrap = el('my-stats');
  const me = playerById(S.myId);
  if (!me) { wrap.innerHTML = ''; return; }
  const prev = prevPlayerById(S.myId);
  const delta = prev ? me.tickets - prev.tickets : 0;
  const pulseClass = delta > 0 ? 'pulse-gain' : delta < 0 ? 'pulse-loss' : '';
  const deltaHtml = delta !== 0 ? `<span class="ticket-delta ${delta > 0 ? 'gain' : 'loss'}">${delta > 0 ? '+' : ''}${delta}</span>` : '';
  wrap.innerHTML = `<span class="my-tickets ${pulseClass}">🎟️ ${me.tickets}${deltaHtml}</span>`;
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
    const counterTxt = c.royalCounterFor ? `<br><span class="tc-counter-note">countering ${nameOf(pub, c.royalCounterFor)}'s claim</span>` : '';
    status(`<b>${nameOf(pub, c.claimantId)}</b> claims<br><span class="c-icon-inline">${charIconHTML(c.character)}</span><b style="color:var(--char-a)">${meta.name}</b>${targetTxt}${counterTxt}`, charClass(c.character));

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
      challengeBtn.onclick = () => { AudioFX.sfx('click'); socket.emit('challenge', {}, (res) => { if (!res.ok) alert(res.error); }); };
      row.appendChild(challengeBtn);
      // Only on a fresh Royal claim (never on someone else's counter-claim) can a rival
      // speak up with their own "I'm also a Royal" instead of just passing or challenging.
      if (c.character === 'ROYAL' && !c.royalCounterFor) {
        const royalTooBtn = document.createElement('button');
        royalTooBtn.className = 'secondary';
        royalTooBtn.textContent = '👑 I\'m also a Royal';
        royalTooBtn.onclick = () => { AudioFX.sfx('click'); socket.emit('claimRoyalToo', {}, (res) => { if (!res.ok) alert(res.error); }); };
        row.appendChild(royalTooBtn);
      }
      const passBtn = document.createElement('button');
      passBtn.className = 'secondary';
      passBtn.textContent = 'Pass';
      passBtn.onclick = () => { AudioFX.sfx('click'); socket.emit('pass', {}, (res) => { if (!res.ok) alert(res.error); }); };
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
      avatarConfig: S.avatar,
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
      avatarConfig: S.avatar,
      onClick: () => socket.emit('guardReact', { reveal: true, cardIndex: guardIndex }, (res) => { if (!res.ok) alert(res.error); }),
    }));
  }

  const declineBtn = document.createElement('button');
  declineBtn.className = 'chip secondary';
  declineBtn.textContent = guardIndex !== -1 ? "Don't reveal — let it happen" : "You don't have Guard — continue";
  declineBtn.onclick = () => { AudioFX.sfx('click'); socket.emit('guardReact', { reveal: false }, (res) => { if (!res.ok) alert(res.error); }); };
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
      avatarConfig: S.avatar,
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
        chip.onclick = () => { AudioFX.sfx('click'); S.selectedTarget = p.id; render(); };
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
      AudioFX.sfx('click');
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
    const card = buildCharCard(c, { hand: true, avatarConfig: S.avatar });

    // Cards sit in normal flex flow (not absolutely positioned) so the row
    // centers reliably at any hand size; a small rotation from the bottom
    // pivot plus a negative margin for overlap gives the "fanned in hand" look.
    let tilt = 0;
    if (n === 2) {
      tilt = idx === 0 ? -6 : 6;
      if (idx === 1) card.style.marginLeft = '-56px';
    }
    card.style.setProperty('--fan-transform', `rotate(${tilt}deg)`);
    card.style.zIndex = String(idx);

    if (isInitialDeal) {
      card.classList.add('deal-in');
      card.style.animationDelay = (idx * 0.15) + 's';
      setTimeout(() => AudioFX.sfx('deal'), idx * 150);
    } else if (S.prevHand[idx] && S.prevHand[idx] !== c) {
      card.classList.add('flip-swap');
      AudioFX.sfx('flip');
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

// ---------- Audio: unlock on first gesture (browser autoplay policy), mute toggle ----------
function updateAudioBtn() { el('audio-toggle-btn').textContent = AudioFX.isMuted() ? '🔇' : '🔊'; }
function unlockAudioOnce() {
  AudioFX.ensureCtx();
  if (!AudioFX.isMuted()) AudioFX.startAmbient();
  updateAudioBtn();
}
document.addEventListener('pointerdown', unlockAudioOnce, { once: true });
document.addEventListener('keydown', unlockAudioOnce, { once: true });
el('audio-toggle-btn').addEventListener('click', () => {
  AudioFX.ensureCtx();
  const muted = AudioFX.toggleMuted();
  if (!muted) { AudioFX.startAmbient(); AudioFX.sfx('click'); }
  updateAudioBtn();
});
updateAudioBtn();

startAmbientParticles();
render();
