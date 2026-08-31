// Golden Bluff - core game engine.
// Pure state-machine logic, no networking, no timers (server.js owns timers).
// Every exported function mutates the passed-in `room` object and returns
// a small result descriptor; server.js is responsible for broadcasting.

const CHARACTERS = {
  ROYAL:     { name: 'Royal',     emoji: '👑', needsTarget: false, summary: 'Gain 2 Golden Tickets — only 1 if a rival is also secretly holding a Royal.' },
  THIEF:     { name: 'Thief',     emoji: '🦹', needsTarget: true,  summary: 'Steal up to 2 Golden Tickets from another player.' },
  GUARD:     { name: 'Guard',     emoji: '🛡️', needsTarget: false, summary: "Not claimed on your turn. If you actually hold this card, you may reveal it the instant someone targets you with Thief, Seer, or Assassin, blocking that ability outright." },
  SEER:      { name: 'Seer',      emoji: '🔮', needsTarget: true,  summary: "Look at one of another player's Character cards — they choose which one to show you." },
  TRICKSTER: { name: 'Trickster', emoji: '🎭', needsTarget: false, summary: 'Swap one of your Character cards for a new secret one.' },
  ASSASSIN:  { name: 'Assassin',  emoji: '☠️', needsTarget: true,  summary: 'Pay 2 Golden Tickets to force another player to discard a Character.' },
};
const CHARACTER_KEYS = Object.keys(CHARACTERS);
const CLAIMABLE_CHARACTER_KEYS = CHARACTER_KEYS.filter((k) => k !== 'GUARD');
const COPIES_PER_CHARACTER = 3;
const WINNING_TICKETS = 10;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6;

function shuffle(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function buildDeck(rng) {
  const deck = [];
  for (const key of CHARACTER_KEYS) {
    for (let i = 0; i < COPIES_PER_CHARACTER; i++) deck.push(key);
  }
  return shuffle(deck, rng);
}

function createRoom(code, rng = Math.random) {
  return {
    code,
    rng,
    // lobby | claim | challengeWindow | awaitingGuardReaction | awaitingSeerChoice
    // | awaitingDiscard | awaitingTrickster | gameover
    phase: 'lobby',
    players: [],    // seat order
    deck: [],
    discardPile: [],
    turnIndex: -1,
    activePlayerId: null,
    pendingClaim: null,         // { claimantId, character, targetId, passed:Set, challengerId, status, royalCounterFor? }
    pendingGuardReaction: null, // { claimantId, character, targetId }
    pendingSeerChoice: null,    // { seerId, targetId }
    pendingDiscard: null,       // { playerId, reason, continuation }
    pendingTrickster: null,     // { claimantId }
    hostId: null,
    winnerId: null,
    log: [],
  };
}

function log(room, text) {
  room.log.push({ ts: Date.now(), text });
  if (room.log.length > 200) room.log.shift();
}

function getPlayer(room, id) {
  return room.players.find((p) => p.id === id) || null;
}

function alivePlayers(room) {
  return room.players.filter((p) => p.alive);
}

// Defends against a malformed/malicious client rather than trusting whatever shape shows
// up on the wire -- values only ever flow into THREE.Color()/canvas drawing (never HTML),
// but a fixed allow-list keeps a bad client from wedging a giant string into every
// broadcast (serializePublicState sends this to every player on every state update).
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const VALID_HATS = new Set(['none', 'cap', 'cone', 'crown', 'band']);
const VALID_FACES = new Set(['happy', 'smirk', 'surprised', 'glasses', 'mask']);
function sanitizeAvatar(avatar) {
  const a = avatar && typeof avatar === 'object' ? avatar : {};
  return {
    bodyColor: HEX_COLOR_RE.test(a.bodyColor) ? a.bodyColor : '#e8b04a',
    hatColor: HEX_COLOR_RE.test(a.hatColor) ? a.hatColor : '#5c4a32',
    hat: VALID_HATS.has(a.hat) ? a.hat : 'none',
    face: VALID_FACES.has(a.face) ? a.face : 'happy',
    tagColor: HEX_COLOR_RE.test(a.tagColor) ? a.tagColor : '#c9a227',
  };
}

function addPlayer(room, id, name, avatar) {
  if (room.phase !== 'lobby') return { ok: false, error: 'Game already started.' };
  if (room.players.length >= MAX_PLAYERS) return { ok: false, error: 'Room is full (max 6).' };
  if (room.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
    return { ok: false, error: 'That name is taken in this room.' };
  }
  const player = { id, name, hand: [], tickets: 0, alive: true, connected: true, avatar: sanitizeAvatar(avatar) };
  room.players.push(player);
  if (!room.hostId) room.hostId = id;
  log(room, `${name} joined the room.`);
  return { ok: true };
}

function removePlayer(room, id) {
  const p = getPlayer(room, id);
  if (!p) return;
  if (room.phase === 'lobby') {
    room.players = room.players.filter((pl) => pl.id !== id);
    if (room.hostId === id) room.hostId = room.players[0]?.id || null;
    log(room, `${p.name} left the room.`);
  } else {
    p.connected = false;
    log(room, `${p.name} disconnected.`);
  }
}

function canStart(room) {
  return room.phase === 'lobby' && room.players.length >= MIN_PLAYERS && room.players.length <= MAX_PLAYERS;
}

function startGame(room) {
  if (!canStart(room)) return { ok: false, error: `Need ${MIN_PLAYERS}-${MAX_PLAYERS} players to start.` };
  room.deck = buildDeck(room.rng);
  room.discardPile = [];
  for (const p of room.players) {
    p.hand = [room.deck.pop(), room.deck.pop()];
    p.tickets = 0;
    p.alive = true;
  }
  room.turnIndex = Math.floor(room.rng() * room.players.length);
  room.winnerId = null;
  log(room, 'The game begins!');
  beginTurn(room, room.turnIndex);
  return { ok: true };
}

function nextAliveIndex(room, fromIndex) {
  const n = room.players.length;
  for (let step = 1; step <= n; step++) {
    const idx = (fromIndex + step) % n;
    if (room.players[idx].alive) return idx;
  }
  return -1;
}

function clearPending(room) {
  room.pendingClaim = null;
  room.pendingGuardReaction = null;
  room.pendingSeerChoice = null;
  room.pendingDiscard = null;
  room.pendingTrickster = null;
}

function beginTurn(room, seatIndex) {
  const player = room.players[seatIndex];
  room.turnIndex = seatIndex;
  room.activePlayerId = player.id;
  clearPending(room);

  player.tickets += 1;
  log(room, `${player.name} takes Stable Income (+1 🎟️).`);

  const winner = checkWinner(room);
  if (winner) {
    finishGame(room, winner);
    return;
  }
  room.phase = 'claim';
}

function checkWinner(room) {
  const byTickets = room.players.find((p) => p.alive && p.tickets >= WINNING_TICKETS);
  if (byTickets) return byTickets;
  const alive = alivePlayers(room);
  if (alive.length === 1 && room.players.length > 1) return alive[0];
  return null;
}

function finishGame(room, winner) {
  room.phase = 'gameover';
  room.winnerId = winner.id;
  clearPending(room);
  log(room, `🏆 ${winner.name} wins with ${winner.tickets} Golden Tickets!`);
}

function checkWinOrAdvance(room) {
  const winner = checkWinner(room);
  if (winner) {
    finishGame(room, winner);
    return;
  }
  const next = nextAliveIndex(room, room.turnIndex);
  if (next === -1) { room.phase = 'gameover'; return; }
  beginTurn(room, next);
}

function makeClaim(room, playerId, character, targetId = null) {
  if (room.phase !== 'claim') return { ok: false, error: 'Not the claim phase.' };
  if (room.activePlayerId !== playerId) return { ok: false, error: 'Not your turn.' };
  if (!CHARACTER_KEYS.includes(character)) return { ok: false, error: 'Unknown character.' };
  if (character === 'GUARD') {
    return { ok: false, error: 'Guard is never claimed on your turn — reveal it reactively if someone targets you.' };
  }

  const claimant = getPlayer(room, playerId);
  const meta = CHARACTERS[character];

  if (meta.needsTarget) {
    if (!targetId || targetId === playerId) return { ok: false, error: 'This ability needs another player as a target.' };
    const target = getPlayer(room, targetId);
    if (!target || !target.alive) return { ok: false, error: 'Invalid target.' };
    if (character === 'THIEF' && target.tickets <= 0) {
      return { ok: false, error: `${target.name} has no tickets to steal.` };
    }
  } else if (targetId) {
    return { ok: false, error: 'This ability does not take a target.' };
  }

  if (character === 'ASSASSIN' && claimant.tickets < 2) {
    return { ok: false, error: 'You need at least 2 Golden Tickets to attempt an Assassin claim.' };
  }

  room.pendingClaim = {
    claimantId: playerId, character, targetId,
    passed: new Set(), challengerId: null, status: 'open',
  };
  room.phase = 'challengeWindow';

  const targetName = targetId ? getPlayer(room, targetId).name : null;
  log(room, `${claimant.name} claims ${meta.emoji} ${meta.name}${targetName ? ` — targeting ${targetName}` : ''}.`);
  return { ok: true };
}

function eligibleChallengers(room) {
  const c = room.pendingClaim;
  if (!c) return [];
  return alivePlayers(room).filter((p) => p.id !== c.claimantId).map((p) => p.id);
}

function pass(room, playerId) {
  const c = room.pendingClaim;
  if (room.phase !== 'challengeWindow' || !c || c.status !== 'open') return { ok: false, error: 'No claim to pass on.' };
  if (playerId === c.claimantId) return { ok: false, error: 'You cannot pass on your own claim.' };
  if (!eligibleChallengers(room).includes(playerId)) return { ok: false, error: 'You cannot act on this claim.' };
  c.passed.add(playerId);
  const allPassed = eligibleChallengers(room).every((id) => c.passed.has(id));
  if (allPassed) resolveUnchallenged(room);
  return { ok: true };
}

// Instead of the amount being silently checked against hidden hands, a rival can
// speak up: "I'm also a Royal." That claim goes through the exact same pass/challenge
// flow as any other (it can be bluffed, and it can be called out) — it just resolves
// differently: nobody gains the normal Royal ability from it, it only decides whether
// the ORIGINAL claimant's payout is capped at 1 (counter stands) or stays at 2 (counter
// is disproven). Only one counter-claim is allowed per Royal claim (no chaining).
function claimRoyalToo(room, playerId) {
  const c = room.pendingClaim;
  if (room.phase !== 'challengeWindow' || !c || c.status !== 'open') {
    return { ok: false, error: 'No Royal claim to respond to.' };
  }
  if (c.character !== 'ROYAL') return { ok: false, error: 'Only a Royal claim can be countered this way.' };
  if (c.royalCounterFor) return { ok: false, error: 'This claim is already a counter-claim.' };
  if (playerId === c.claimantId) return { ok: false, error: 'You cannot counter your own claim.' };
  if (!eligibleChallengers(room).includes(playerId)) return { ok: false, error: 'You cannot act on this claim.' };

  const counter = getPlayer(room, playerId);
  log(room, `${counter.name} claims to also be a 👑 Royal!`);

  room.pendingClaim = {
    claimantId: playerId, character: 'ROYAL', targetId: null,
    passed: new Set(), challengerId: null, status: 'open',
    royalCounterFor: c.claimantId,
  };
  // Phase stays 'challengeWindow' — the counter-claim is challenged or passed on exactly
  // like any other claim; only the resolution (below) treats it specially.
  return { ok: true };
}

function challenge(room, challengerId) {
  const c = room.pendingClaim;
  if (room.phase !== 'challengeWindow' || !c || c.status !== 'open') return { ok: false, error: 'No claim to challenge.' };
  if (challengerId === c.claimantId) return { ok: false, error: 'You cannot challenge your own claim.' };
  if (!eligibleChallengers(room).includes(challengerId)) return { ok: false, error: 'You cannot act on this claim.' };

  c.status = 'challenged';
  c.challengerId = challengerId;
  const claimant = getPlayer(room, c.claimantId);
  const challenger = getPlayer(room, challengerId);
  const meta = CHARACTERS[c.character];
  const wasTruthful = claimant.hand.includes(c.character);

  log(room, `${challenger.name} shouts CHALLENGE! on ${claimant.name}'s ${meta.name} claim.`);

  if (!wasTruthful) {
    challenger.tickets += 1;
    log(room, `${claimant.name} was bluffing! ${meta.name} claim cancelled. ${challenger.name} gains 1 🎟️ for the correct challenge.`);
    room.phase = 'awaitingDiscard';
    room.pendingDiscard = { playerId: c.claimantId, reason: 'lied', royalCounterFor: c.royalCounterFor || null };
    return { ok: true, truthful: false };
  } else {
    claimant.tickets += 1;
    log(room, `${claimant.name} reveals ${meta.emoji} ${meta.name} — the claim was true! ${claimant.name} gains 1 🎟️ for winning the challenge.`);
    room.phase = 'awaitingDiscard';
    room.pendingDiscard = {
      playerId: challengerId,
      reason: 'lostChallenge',
      continuation: { claimantId: c.claimantId, character: c.character, targetId: c.targetId, royalCounterFor: c.royalCounterFor || null },
    };
    return { ok: true, truthful: true };
  }
}

// A Royal counter-claim ("I'm also a Royal") was disproven or upheld — apply the
// deferred effect on the ORIGINAL claimant's payout instead of the normal ability effect.
function settleRoyalCounter(room, originalClaimantId, counterSurvived) {
  const original = getPlayer(room, originalClaimantId);
  if (!original || !original.alive) { checkWinOrAdvance(room); return; }
  if (counterSurvived) {
    original.tickets += 1;
    log(room, `${original.name}'s Royal only pays out 1 🎟️ — a rival's Royal claim stood.`);
  } else {
    original.tickets += 2;
    log(room, `${original.name}'s Royal pays out the full 2 🎟️ — the rival's counter-claim didn't hold up.`);
  }
  checkWinOrAdvance(room);
}

function resolveUnchallenged(room) {
  if (room.phase !== 'challengeWindow') return;
  const c = room.pendingClaim;
  if (!c) return;
  const { claimantId, character, targetId, royalCounterFor } = c;
  room.pendingClaim = null;
  log(room, `Nobody challenged. The claim happens.`);
  if (royalCounterFor) {
    settleRoyalCounter(room, royalCounterFor, true);
    return;
  }
  const resolved = applyAbilityEffect(room, claimantId, character, targetId);
  if (resolved) checkWinOrAdvance(room);
}

// Removes one card of `character` type from the player's hand and returns it. Assumes present.
function removeOneCard(hand, character) {
  const idx = hand.indexOf(character);
  if (idx === -1) return null;
  return hand.splice(idx, 1)[0];
}

function revealReturnShuffleDraw(room, playerId, character) {
  const player = getPlayer(room, playerId);
  removeOneCard(player.hand, character);
  room.deck.push(character);
  shuffle(room.deck, room.rng);
  const drawn = room.deck.pop();
  player.hand.push(drawn);
  log(room, `${player.name}'s revealed card is shuffled back into the deck and they draw a replacement.`);
}

function eliminateIfNeeded(room, player) {
  if (player.hand.length === 0 && player.alive) {
    player.alive = false;
    player.tickets = 0;
    log(room, `💀 ${player.name} is eliminated! Their tickets return to the supply.`);
  }
}

// Returns true if the ability fully resolved synchronously (safe to advance turn),
// or false if it opened a new pending interaction (guard reaction / seer choice / assassin discard / trickster swap).
function applyAbilityEffect(room, claimantId, character, targetId) {
  const claimant = getPlayer(room, claimantId);

  switch (character) {
    case 'ROYAL': {
      // Full payout unless a rival publicly counters with their own "I'm also a Royal"
      // claim (see claimRoyalToo) — that reduction is applied separately, once the
      // counter-claim itself resolves, not silently checked against hidden hands here.
      claimant.tickets += 2;
      log(room, `${claimant.name} gains 2 🎟️ from Royal.`);
      return true;
    }
    case 'TRICKSTER': {
      if (claimant.hand.length <= 1) {
        if (claimant.hand.length === 1) revealReturnShuffleDraw(room, claimant.id, claimant.hand[0]);
        return true;
      }
      room.phase = 'awaitingTrickster';
      room.pendingTrickster = { claimantId: claimant.id };
      return false;
    }
    case 'THIEF':
    case 'SEER':
    case 'ASSASSIN': {
      // Assassin pays their 2 tickets up front, whether or not Guard ends up blocking it —
      // the cost is for attempting the attack, not for it landing.
      if (character === 'ASSASSIN') {
        if (claimant.tickets >= 2) claimant.tickets -= 2;
        log(room, `${claimant.name} pays 2 🎟️ for the Assassin.`);
      }
      room.phase = 'awaitingGuardReaction';
      room.pendingGuardReaction = { claimantId, character, targetId };
      return false;
    }
    default:
      return true;
  }
}

// The targeted player may reveal an actual Guard card to block, or decline (or time out).
function resolveGuardReaction(room, playerId, reveal, cardIndex) {
  const g = room.pendingGuardReaction;
  if (room.phase !== 'awaitingGuardReaction' || !g || g.targetId !== playerId) {
    return { ok: false, error: 'No reaction is waiting on you right now.' };
  }
  const { claimantId, character } = g;
  const target = getPlayer(room, playerId);
  const claimant = getPlayer(room, claimantId);
  const meta = CHARACTERS[character];

  if (reveal) {
    if (typeof cardIndex !== 'number' || cardIndex < 0 || cardIndex >= target.hand.length || target.hand[cardIndex] !== 'GUARD') {
      return { ok: false, error: 'You do not have a Guard card to reveal.' };
    }
    room.pendingGuardReaction = null;
    log(room, `🛡️ ${target.name} reveals GUARD and blocks ${claimant.name}'s ${meta.name}!`);
    revealReturnShuffleDraw(room, playerId, 'GUARD');
    checkWinOrAdvance(room);
    return { ok: true, blocked: true };
  }

  room.pendingGuardReaction = null;
  proceedWithTargetedEffect(room, claimantId, character, playerId);
  return { ok: true, blocked: false };
}

// Runs the actual Thief/Seer/Assassin effect once Guard did not block it.
// Always leaves the room in a state ready for checkWinOrAdvance, either directly
// or via a further pending interaction (Seer's reveal choice / Assassin's forced discard).
function proceedWithTargetedEffect(room, claimantId, character, targetId) {
  const claimant = getPlayer(room, claimantId);
  const target = getPlayer(room, targetId);

  if (character === 'THIEF') {
    const amount = Math.min(2, target.tickets);
    target.tickets -= amount;
    claimant.tickets += amount;
    log(room, `${claimant.name} steals ${amount} 🎟️ from ${target.name}.`);
    checkWinOrAdvance(room);
    return;
  }

  if (character === 'SEER') {
    if (target.hand.length <= 1) {
      const seen = target.hand[0];
      room.lastSeerReveal = { seerId: claimant.id, targetId: target.id, character: seen };
      log(room, `${target.name} has only one card left and shows it to ${claimant.name}.`);
      checkWinOrAdvance(room);
    } else {
      room.phase = 'awaitingSeerChoice';
      room.pendingSeerChoice = { seerId: claimant.id, targetId: target.id };
      log(room, `${target.name} is choosing which card to show ${claimant.name}...`);
    }
    return;
  }

  if (character === 'ASSASSIN') {
    room.phase = 'awaitingDiscard';
    room.pendingDiscard = { playerId: target.id, reason: 'assassinated' };
    return;
  }
}

// The Seer's target picks which of their own cards to reveal (only relevant with 2 cards).
function resolveSeerChoice(room, playerId, cardIndex) {
  const s = room.pendingSeerChoice;
  if (room.phase !== 'awaitingSeerChoice' || !s || s.targetId !== playerId) {
    return { ok: false, error: 'No Seer choice is waiting on you right now.' };
  }
  const target = getPlayer(room, playerId);
  if (cardIndex < 0 || cardIndex >= target.hand.length) return { ok: false, error: 'Invalid card.' };
  const seen = target.hand[cardIndex];
  room.lastSeerReveal = { seerId: s.seerId, targetId: playerId, character: seen };
  const seer = getPlayer(room, s.seerId);
  log(room, `${target.name} shows one of their cards to ${seer ? seer.name : 'the Seer'}.`);
  room.pendingSeerChoice = null;
  checkWinOrAdvance(room);
  return { ok: true };
}

function resolveDiscard(room, playerId, cardIndex) {
  if (room.phase !== 'awaitingDiscard' || !room.pendingDiscard || room.pendingDiscard.playerId !== playerId) {
    return { ok: false, error: 'You have no discard to make right now.' };
  }
  const player = getPlayer(room, playerId);
  if (cardIndex < 0 || cardIndex >= player.hand.length) return { ok: false, error: 'Invalid card.' };

  const { reason, continuation, royalCounterFor } = room.pendingDiscard;
  const discarded = player.hand.splice(cardIndex, 1)[0];
  room.discardPile.push(discarded);
  log(room, `${player.name} discards ${CHARACTERS[discarded].emoji} ${CHARACTERS[discarded].name}.`);
  eliminateIfNeeded(room, player);
  room.pendingDiscard = null;

  if (reason === 'lied') {
    // If this losing claim was itself a Royal counter-claim, its disproof means the
    // ORIGINAL Royal claim it was contesting pays out in full after all.
    if (royalCounterFor) { settleRoyalCounter(room, royalCounterFor, false); return { ok: true }; }
    checkWinOrAdvance(room);
    return { ok: true };
  }
  if (reason === 'assassinated') {
    checkWinOrAdvance(room);
    return { ok: true };
  }
  if (reason === 'lostChallenge') {
    const { claimantId, character, targetId, royalCounterFor: counterFor } = continuation;
    const claimant = getPlayer(room, claimantId);
    if (!claimant.alive) { checkWinOrAdvance(room); return { ok: true }; }
    revealReturnShuffleDraw(room, claimantId, character);
    // A truthful Royal counter-claim doesn't grant the counter-claimant their own Royal
    // bonus — it only confirms the original claimant's payout gets capped at 1.
    if (counterFor) { settleRoyalCounter(room, counterFor, true); return { ok: true }; }
    const resolved = applyAbilityEffect(room, claimantId, character, targetId);
    if (resolved) checkWinOrAdvance(room);
    return { ok: true };
  }
  return { ok: true };
}

function resolveTrickster(room, playerId, cardIndex) {
  if (room.phase !== 'awaitingTrickster' || !room.pendingTrickster || room.pendingTrickster.claimantId !== playerId) {
    return { ok: false, error: 'No Trickster swap pending.' };
  }
  const player = getPlayer(room, playerId);
  if (cardIndex < 0 || cardIndex >= player.hand.length) return { ok: false, error: 'Invalid card.' };
  const chosen = player.hand[cardIndex];
  revealReturnShuffleDraw(room, playerId, chosen);
  room.pendingTrickster = null;
  checkWinOrAdvance(room);
  return { ok: true };
}

function serializePublicState(room) {
  return {
    code: room.code,
    phase: room.phase,
    hostId: room.hostId,
    activePlayerId: room.activePlayerId,
    winnerId: room.winnerId,
    deckCount: room.deck.length,
    players: room.players.map((p) => ({
      id: p.id, name: p.name, tickets: p.tickets, cardCount: p.hand.length,
      alive: p.alive, connected: p.connected, avatar: p.avatar || sanitizeAvatar(null),
    })),
    pendingClaim: room.pendingClaim ? {
      claimantId: room.pendingClaim.claimantId,
      character: room.pendingClaim.character,
      targetId: room.pendingClaim.targetId,
      status: room.pendingClaim.status,
      passed: [...room.pendingClaim.passed],
      eligible: eligibleChallengers(room),
      royalCounterFor: room.pendingClaim.royalCounterFor || null,
    } : null,
    pendingGuardReaction: room.pendingGuardReaction ? {
      claimantId: room.pendingGuardReaction.claimantId,
      character: room.pendingGuardReaction.character,
      targetId: room.pendingGuardReaction.targetId,
    } : null,
    pendingSeerChoice: room.pendingSeerChoice ? {
      seerId: room.pendingSeerChoice.seerId,
      targetId: room.pendingSeerChoice.targetId,
    } : null,
    pendingDiscard: room.pendingDiscard ? { playerId: room.pendingDiscard.playerId, reason: room.pendingDiscard.reason } : null,
    pendingTrickster: room.pendingTrickster ? { claimantId: room.pendingTrickster.claimantId } : null,
    log: room.log.slice(-50),
  };
}

function serializePrivateHand(room, playerId) {
  const p = getPlayer(room, playerId);
  return p ? { hand: p.hand } : { hand: [] };
}

module.exports = {
  CHARACTERS, CHARACTER_KEYS, CLAIMABLE_CHARACTER_KEYS, MIN_PLAYERS, MAX_PLAYERS, WINNING_TICKETS,
  createRoom, addPlayer, removePlayer, canStart, startGame,
  makeClaim, pass, challenge, claimRoyalToo, resolveUnchallenged,
  resolveGuardReaction, resolveSeerChoice, resolveDiscard, resolveTrickster,
  serializePublicState, serializePrivateHand, getPlayer, alivePlayers,
};
