// Plain-node scenario tests for the game engine — no dependencies required.
// Run with: node game/engine.test.js
const assert = require('assert');
const engine = require('./engine');

let passCount = 0;
function test(name, fn) {
  try {
    fn();
    passCount++;
    console.log(`  ok - ${name}`);
  } catch (err) {
    console.error(`  FAIL - ${name}`);
    console.error('    ' + err.message);
    process.exitCode = 1;
  }
}

function freshRoom(names) {
  const room = engine.createRoom('TEST', Math.random);
  names.forEach((n, i) => engine.addPlayer(room, 'p' + i, n));
  engine.startGame(room);
  return room;
}
function byName(room, name) { return room.players.find((p) => p.name === name); }
function setHand(room, name, hand) { byName(room, name).hand = hand.slice(); }
function forceTurn(room, seatIndex) {
  room.turnIndex = seatIndex;
  room.activePlayerId = room.players[seatIndex].id;
  room.phase = 'claim';
}

test('lobby requires 3-6 players to start', () => {
  const room = engine.createRoom('R1');
  engine.addPlayer(room, 'a', 'Alice');
  engine.addPlayer(room, 'b', 'Bob');
  assert.strictEqual(engine.canStart(room), false);
  engine.addPlayer(room, 'c', 'Cara');
  assert.strictEqual(engine.canStart(room), true);
});

test('stable income is applied and cannot be challenged (no API to challenge it)', () => {
  const room = freshRoom(['Alice', 'Bob', 'Cara']);
  const active = room.players.find((p) => p.id === room.activePlayerId);
  assert.strictEqual(active.tickets, 1);
  assert.strictEqual(room.phase, 'claim');
});

test('caught lying: ability cancelled, claimant discards, challenger +1 ticket', () => {
  const room = freshRoom(['Alice', 'Bob', 'Cara']);
  forceTurn(room, 0);
  setHand(room, 'Alice', ['THIEF', 'TRICKSTER']); // does NOT have Royal
  const alice = byName(room, 'Alice');
  const bob = byName(room, 'Bob');
  alice.tickets = 3;
  bob.tickets = 0;

  const claimRes = engine.makeClaim(room, 'p0', 'ROYAL', null);
  assert.strictEqual(claimRes.ok, true);
  assert.strictEqual(room.phase, 'challengeWindow');

  const chRes = engine.challenge(room, 'p1'); // Bob challenges
  assert.strictEqual(chRes.ok, true);
  assert.strictEqual(chRes.truthful, false);
  assert.strictEqual(bob.tickets, 1, 'challenger gains 1 ticket for a correct challenge');
  assert.strictEqual(alice.tickets, 3, 'ability was cancelled, no +2');
  assert.strictEqual(room.phase, 'awaitingDiscard');
  assert.strictEqual(room.pendingDiscard.playerId, 'p0');

  const discardRes = engine.resolveDiscard(room, 'p0', 0); // Alice discards THIEF
  assert.strictEqual(discardRes.ok, true);
  assert.strictEqual(alice.hand.length, 1);
  assert.strictEqual(room.phase, 'claim', 'turn advances to next alive player');
});

test('truthful non-targeted claim (Royal) survives challenge: challenger discards, ability + reveal/redraw happen', () => {
  const room = freshRoom(['Alice', 'Bob', 'Cara']);
  forceTurn(room, 0);
  setHand(room, 'Alice', ['ROYAL', 'TRICKSTER']);
  setHand(room, 'Bob', ['THIEF', 'SEER']);
  setHand(room, 'Cara', ['THIEF', 'GUARD']); // fixed so no rival Royal skews the payout below
  const alice = byName(room, 'Alice');
  const bob = byName(room, 'Bob');
  alice.tickets = 2;

  engine.makeClaim(room, 'p0', 'ROYAL', null);
  const chRes = engine.challenge(room, 'p1');
  assert.strictEqual(chRes.truthful, true);
  assert.strictEqual(alice.tickets, 3, '+1 for winning the challenge (ability not yet applied)');
  assert.strictEqual(room.pendingDiscard.playerId, 'p1');

  engine.resolveDiscard(room, 'p1', 0); // Bob discards THIEF
  assert.strictEqual(bob.hand.length, 1);
  assert.strictEqual(alice.tickets, 5, '+2 more from Royal ability resolving = 3+2');
  assert.strictEqual(alice.hand.length, 2, 'reveal/return/redraw keeps hand size the same');
  assert.strictEqual(room.phase, 'claim');
});

test('GUARD can never be claimed on your own turn', () => {
  const room = freshRoom(['Alice', 'Bob', 'Cara']);
  forceTurn(room, 0);
  const res = engine.makeClaim(room, 'p0', 'GUARD', null);
  assert.strictEqual(res.ok, false);
});

test('every targeted ability opens a Guard-reaction window for the target first', () => {
  const room = freshRoom(['Alice', 'Bob', 'Cara']);
  forceTurn(room, 0);
  byName(room, 'Bob').tickets = 5;
  setHand(room, 'Alice', ['THIEF', 'TRICKSTER']);

  engine.makeClaim(room, 'p0', 'THIEF', 'p1');
  engine.pass(room, 'p1');
  engine.pass(room, 'p2');
  assert.strictEqual(room.phase, 'awaitingGuardReaction');
  assert.strictEqual(room.pendingGuardReaction.targetId, 'p1');
});

test('revealing a real Guard blocks Thief and cycles the Guard card back into the deck', () => {
  const room = freshRoom(['Alice', 'Bob', 'Cara']);
  forceTurn(room, 0);
  // Target Cara (not the next player in turn order) so her ticket count isn't
  // confounded by the next player's stable income when the turn advances.
  const cara = byName(room, 'Cara');
  cara.tickets = 5;
  setHand(room, 'Cara', ['GUARD', 'SEER']);
  setHand(room, 'Alice', ['THIEF', 'TRICKSTER']);

  engine.makeClaim(room, 'p0', 'THIEF', 'p2');
  engine.pass(room, 'p1');
  engine.pass(room, 'p2');

  const res = engine.resolveGuardReaction(room, 'p2', true, 0); // reveal the GUARD at index 0
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.blocked, true);
  assert.strictEqual(cara.tickets, 5, 'steal blocked entirely');
  assert.ok(!cara.hand.includes('GUARD'), 'the revealed Guard was returned to the deck');
  assert.strictEqual(cara.hand.length, 2, 'drew a replacement, hand size unchanged');
  assert.strictEqual(room.phase, 'claim', 'turn advanced once resolved');
});

test('cannot fake a Guard reveal without actually holding one', () => {
  const room = freshRoom(['Alice', 'Bob', 'Cara']);
  forceTurn(room, 0);
  byName(room, 'Bob').tickets = 5;
  setHand(room, 'Bob', ['SEER', 'TRICKSTER']); // no Guard
  setHand(room, 'Alice', ['THIEF', 'ROYAL']);

  engine.makeClaim(room, 'p0', 'THIEF', 'p1');
  engine.pass(room, 'p1');
  engine.pass(room, 'p2');

  const res = engine.resolveGuardReaction(room, 'p1', true, 0);
  assert.strictEqual(res.ok, false, 'server rejects a reveal claim for a card that is not actually Guard');
  assert.strictEqual(room.phase, 'awaitingGuardReaction', 'nothing changed, still waiting');
});

test('declining the Guard reaction lets Thief steal normally', () => {
  const room = freshRoom(['Alice', 'Bob', 'Cara']);
  forceTurn(room, 0);
  const alice = byName(room, 'Alice');
  const cara = byName(room, 'Cara');
  alice.tickets = 1; // known baseline, independent of freshRoom's random starting player
  cara.tickets = 5;
  setHand(room, 'Alice', ['THIEF', 'ROYAL']);

  engine.makeClaim(room, 'p0', 'THIEF', 'p2');
  engine.pass(room, 'p1');
  engine.pass(room, 'p2');
  engine.resolveGuardReaction(room, 'p2', false);

  assert.strictEqual(cara.tickets, 3, 'lost 2 to the steal');
  assert.strictEqual(alice.tickets, 3, 'gained the stolen 2 (1 + 2 stolen)');
  assert.strictEqual(room.phase, 'claim');
});

test('assassin still pays 2 tickets even when Guard blocks the discard', () => {
  const room = freshRoom(['Alice', 'Bob', 'Cara']);
  forceTurn(room, 0);
  const alice = byName(room, 'Alice');
  const bob = byName(room, 'Bob');
  alice.tickets = 4;
  setHand(room, 'Alice', ['ASSASSIN', 'ROYAL']);
  setHand(room, 'Bob', ['GUARD', 'SEER']);

  engine.makeClaim(room, 'p0', 'ASSASSIN', 'p1');
  engine.pass(room, 'p1');
  engine.pass(room, 'p2');
  assert.strictEqual(alice.tickets, 2, 'paid 2 tickets for the assassin attempt');

  const res = engine.resolveGuardReaction(room, 'p1', true, 0);
  assert.strictEqual(res.blocked, true);
  assert.strictEqual(bob.hand.length, 2, 'no discard happened, Guard cycled instead');
  assert.strictEqual(room.phase, 'claim');
});

test('assassin forces the target to choose a discard when Guard is declined', () => {
  const room = freshRoom(['Alice', 'Bob', 'Cara']);
  forceTurn(room, 0);
  const alice = byName(room, 'Alice');
  const bob = byName(room, 'Bob');
  alice.tickets = 4;
  setHand(room, 'Alice', ['ASSASSIN', 'ROYAL']);
  setHand(room, 'Bob', ['SEER']); // Bob only has 1 card left

  engine.makeClaim(room, 'p0', 'ASSASSIN', 'p1');
  engine.pass(room, 'p1');
  engine.pass(room, 'p2');
  engine.resolveGuardReaction(room, 'p1', false);
  assert.strictEqual(room.pendingDiscard.playerId, 'p1', 'target chooses their own discard');

  engine.resolveDiscard(room, 'p1', 0);
  assert.strictEqual(bob.alive, false, 'eliminated after losing last card');
  assert.strictEqual(bob.tickets, 0, 'tickets return to supply on elimination');
  assert.strictEqual(room.phase, 'claim');
});

test('seer target with 2 cards must choose which one to reveal', () => {
  const room = freshRoom(['Alice', 'Bob', 'Cara']);
  forceTurn(room, 0);
  setHand(room, 'Alice', ['SEER', 'ROYAL']);
  setHand(room, 'Bob', ['GUARD', 'ASSASSIN']);

  engine.makeClaim(room, 'p0', 'SEER', 'p1');
  engine.pass(room, 'p1');
  engine.pass(room, 'p2');
  engine.resolveGuardReaction(room, 'p1', false); // Bob has Guard but chooses not to reveal it
  assert.strictEqual(room.phase, 'awaitingSeerChoice');
  assert.strictEqual(room.pendingSeerChoice.targetId, 'p1');

  const res = engine.resolveSeerChoice(room, 'p1', 1); // Bob shows his ASSASSIN, keeps GUARD secret
  assert.strictEqual(res.ok, true);
  assert.strictEqual(room.lastSeerReveal.character, 'ASSASSIN');
  assert.strictEqual(room.phase, 'claim');
});

test('seer target with only 1 card auto-reveals it, no choice needed', () => {
  const room = freshRoom(['Alice', 'Bob', 'Cara']);
  forceTurn(room, 0);
  setHand(room, 'Alice', ['SEER', 'ROYAL']);
  setHand(room, 'Bob', ['TRICKSTER']);

  engine.makeClaim(room, 'p0', 'SEER', 'p1');
  engine.pass(room, 'p1');
  engine.pass(room, 'p2');
  engine.resolveGuardReaction(room, 'p1', false);

  assert.strictEqual(room.phase, 'claim', 'resolved immediately, no choice phase for a single card');
  assert.strictEqual(room.lastSeerReveal.character, 'TRICKSTER');
});

test('trickster with 2 cards requires an explicit swap choice; with 1 card auto-resolves', () => {
  const room = freshRoom(['Alice', 'Bob', 'Cara']);
  forceTurn(room, 0);
  setHand(room, 'Alice', ['TRICKSTER', 'ROYAL']);

  engine.makeClaim(room, 'p0', 'TRICKSTER', null);
  engine.pass(room, 'p1');
  engine.pass(room, 'p2');
  assert.strictEqual(room.phase, 'awaitingTrickster');

  engine.resolveTrickster(room, 'p0', 0);
  assert.strictEqual(room.phase, 'claim', 'turn advances once the swap choice is made');
});

test('thief cannot target a player with 0 tickets', () => {
  const room = freshRoom(['Alice', 'Bob', 'Cara']);
  forceTurn(room, 0);
  byName(room, 'Bob').tickets = 0;
  const res = engine.makeClaim(room, 'p0', 'THIEF', 'p1');
  assert.strictEqual(res.ok, false);
});

test('cannot claim assassin without at least 2 tickets', () => {
  const room = freshRoom(['Alice', 'Bob', 'Cara']);
  forceTurn(room, 0);
  byName(room, 'Alice').tickets = 1;
  const res = engine.makeClaim(room, 'p0', 'ASSASSIN', 'p1');
  assert.strictEqual(res.ok, false);
});

test('royal payout stays 2 tickets when no rival secretly holds a Royal', () => {
  const room = freshRoom(['Alice', 'Bob', 'Cara']);
  forceTurn(room, 0);
  const alice = byName(room, 'Alice');
  alice.tickets = 3;
  setHand(room, 'Alice', ['ROYAL', 'TRICKSTER']);
  setHand(room, 'Bob', ['THIEF', 'SEER']);
  setHand(room, 'Cara', ['GUARD', 'ASSASSIN']);

  engine.makeClaim(room, 'p0', 'ROYAL', null);
  engine.pass(room, 'p1');
  engine.pass(room, 'p2');

  assert.strictEqual(alice.tickets, 5, 'full +2, nobody else holds a Royal');
});

test('royal payout drops to 1 ticket when a rival secretly holds a Royal', () => {
  const room = freshRoom(['Alice', 'Bob', 'Cara']);
  forceTurn(room, 0);
  const alice = byName(room, 'Alice');
  alice.tickets = 3;
  setHand(room, 'Alice', ['ROYAL', 'TRICKSTER']);
  setHand(room, 'Bob', ['ROYAL', 'SEER']); // a rival secretly holds Royal too
  setHand(room, 'Cara', ['THIEF', 'GUARD']);

  engine.makeClaim(room, 'p0', 'ROYAL', null);
  engine.pass(room, 'p1');
  engine.pass(room, 'p2');

  assert.strictEqual(alice.tickets, 4, 'only +1 because a rival secretly holds a Royal too');
});

test('royal payout ignores an eliminated player who happened to hold a Royal', () => {
  const room = freshRoom(['Alice', 'Bob', 'Cara']);
  forceTurn(room, 0);
  const alice = byName(room, 'Alice');
  const bob = byName(room, 'Bob');
  alice.tickets = 3;
  setHand(room, 'Alice', ['ROYAL', 'TRICKSTER']);
  setHand(room, 'Bob', []); // already eliminated, hand empty regardless of past cards
  bob.alive = false;
  bob.tickets = 0;
  setHand(room, 'Cara', ['THIEF', 'GUARD']);

  engine.makeClaim(room, 'p0', 'ROYAL', null);
  engine.pass(room, 'p2'); // Bob is dead, only Cara can act

  assert.strictEqual(alice.tickets, 5, 'full +2, the eliminated player does not count as a rival');
});

console.log(`\n${passCount} test(s) passed.`);
