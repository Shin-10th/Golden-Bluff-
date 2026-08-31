// Golden Bluff - Socket.IO server wiring around the pure game engine.
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const engine = require('./game/engine');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();       // code -> room
const socketInfo = new Map();  // socket.id -> { roomCode }
const roomTimers = new Map();  // code -> Timeout

const CHALLENGE_WINDOW_MS = 20000;
const REACTION_WINDOW_MS = 12000; // Guard-reveal / Seer-choice windows: shorter, single-player decisions
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O to avoid confusion with 1/0

function makeRoomCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function clearRoomTimer(code) {
  const t = roomTimers.get(code);
  if (t) { clearTimeout(t); roomTimers.delete(code); }
}

function armRoomTimer(room) {
  clearRoomTimer(room.code);
  const phaseAtArmTime = room.phase;
  const delay = phaseAtArmTime === 'challengeWindow' ? CHALLENGE_WINDOW_MS : REACTION_WINDOW_MS;
  const t = setTimeout(() => {
    // Re-check the phase at fire time — it may have already moved on.
    if (room.phase === 'challengeWindow') {
      engine.resolveUnchallenged(room);
    } else if (room.phase === 'awaitingGuardReaction' && room.pendingGuardReaction) {
      engine.resolveGuardReaction(room, room.pendingGuardReaction.targetId, false);
    } else if (room.phase === 'awaitingSeerChoice' && room.pendingSeerChoice) {
      engine.resolveSeerChoice(room, room.pendingSeerChoice.targetId, 0); // auto-pick first card if nobody responds
    } else {
      return;
    }
    broadcastRoom(room);
  }, delay);
  roomTimers.set(room.code, t);
}

function broadcastRoom(room) {
  io.to(room.code).emit('state', engine.serializePublicState(room));
  for (const p of room.players) {
    io.to(p.id).emit('hand', engine.serializePrivateHand(room, p.id));
  }
  if (room.lastSeerReveal) {
    const { seerId, targetId, character } = room.lastSeerReveal;
    const target = engine.getPlayer(room, targetId);
    io.to(seerId).emit('seerReveal', {
      targetId,
      targetName: target ? target.name : 'them',
      character,
      characterName: engine.CHARACTERS[character].name,
      emoji: engine.CHARACTERS[character].emoji,
    });
    room.lastSeerReveal = null;
  }
  if (room.phase === 'gameover') clearRoomTimer(room.code);
}

function getRoomForSocket(socket) {
  const info = socketInfo.get(socket.id);
  if (!info) return null;
  return rooms.get(info.roomCode) || null;
}

// Wraps a mutating action: resolves the room+playerId for this socket, runs fn,
// re-arms the challenge timer if needed, and broadcasts fresh state to everyone.
function withRoom(socket, fn) {
  return (data, cb) => {
    const room = getRoomForSocket(socket);
    if (!room) { if (cb) cb({ ok: false, error: 'You are not in a room.' }); return; }
    clearRoomTimer(room.code);
    let result;
    try {
      result = fn(room, socket.id, data || {}) || { ok: true };
    } catch (err) {
      console.error('Action error:', err);
      result = { ok: false, error: 'Server error.' };
    }
    if (room.phase === 'challengeWindow' || room.phase === 'awaitingGuardReaction' || room.phase === 'awaitingSeerChoice') {
      armRoomTimer(room);
    }
    broadcastRoom(room);
    if (cb) cb(result);
  };
}

io.on('connection', (socket) => {
  socket.on('createRoom', ({ name, avatar }, cb) => {
    const trimmed = (name || '').trim().slice(0, 20);
    if (!trimmed) return cb && cb({ ok: false, error: 'Enter a name.' });
    const code = makeRoomCode();
    const room = engine.createRoom(code);
    engine.addPlayer(room, socket.id, trimmed, avatar);
    rooms.set(code, room);
    socketInfo.set(socket.id, { roomCode: code });
    socket.join(code);
    cb && cb({ ok: true, code, playerId: socket.id });
    broadcastRoom(room);
  });

  socket.on('joinRoom', ({ code, name, avatar }, cb) => {
    const trimmed = (name || '').trim().slice(0, 20);
    const roomCode = (code || '').trim().toUpperCase();
    if (!trimmed) return cb && cb({ ok: false, error: 'Enter a name.' });
    const room = rooms.get(roomCode);
    if (!room) return cb && cb({ ok: false, error: 'Room not found.' });
    const res = engine.addPlayer(room, socket.id, trimmed, avatar);
    if (!res.ok) return cb && cb(res);
    socketInfo.set(socket.id, { roomCode });
    socket.join(roomCode);
    cb && cb({ ok: true, code: roomCode, playerId: socket.id });
    broadcastRoom(room);
  });

  socket.on('startGame', withRoom(socket, (room, playerId) => {
    if (room.hostId !== playerId) return { ok: false, error: 'Only the host can start the game.' };
    return engine.startGame(room);
  }));

  socket.on('makeClaim', withRoom(socket, (room, playerId, data) => {
    return engine.makeClaim(room, playerId, data.character, data.targetId || null);
  }));

  socket.on('pass', withRoom(socket, (room, playerId) => engine.pass(room, playerId)));

  socket.on('challenge', withRoom(socket, (room, playerId) => engine.challenge(room, playerId)));

  socket.on('claimRoyalToo', withRoom(socket, (room, playerId) => engine.claimRoyalToo(room, playerId)));

  socket.on('resolveDiscard', withRoom(socket, (room, playerId, data) => engine.resolveDiscard(room, playerId, data.cardIndex)));

  socket.on('resolveTrickster', withRoom(socket, (room, playerId, data) => engine.resolveTrickster(room, playerId, data.cardIndex)));

  socket.on('guardReact', withRoom(socket, (room, playerId, data) => engine.resolveGuardReaction(room, playerId, !!data.reveal, data.cardIndex)));

  socket.on('seerChoice', withRoom(socket, (room, playerId, data) => engine.resolveSeerChoice(room, playerId, data.cardIndex)));

  socket.on('announce', (data) => {
    const room = getRoomForSocket(socket);
    if (!room) return;
    const player = engine.getPlayer(room, socket.id);
    if (!player) return;
    const message = (data && data.message || '').trim().slice(0, 200);
    if (!message) return;
    io.to(room.code).emit('chatMessage', { name: player.name, message, ts: Date.now() });
  });

  socket.on('disconnect', () => {
    const room = getRoomForSocket(socket);
    socketInfo.delete(socket.id);
    if (!room) return;
    engine.removePlayer(room, socket.id);
    if (room.players.length === 0) {
      rooms.delete(room.code);
      clearRoomTimer(room.code);
    } else {
      broadcastRoom(room);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Golden Bluff server running on http://localhost:${PORT}`);
});
