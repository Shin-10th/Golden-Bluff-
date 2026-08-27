# Golden Bluff — Tech Stack Decision

**Decided:** 2026-08-27

## Chosen stack

- **Backend:** Node.js + Express + Socket.IO
- **Frontend:** Plain HTML/CSS/JavaScript (no build step, no framework yet)
- **State:** In-memory, per-room (a JS object per active game — no database)
- **Rooms:** Short room codes (host creates a room, others join with a code) — no accounts/login
- **Hosting (when ready for real internet play):** Render or Railway free/cheap tier — one Node service serves both the game logic and the static client

## Why this combo

Golden Bluff is a real-time, hidden-information party game (like Coup or Secret Hitler):
players need to see public info (everyone's ticket count, whose turn it is) while each
player's own Character cards stay private to them. Socket.IO is built exactly for this —
each player gets their own private channel plus the shared room broadcast, which maps
directly onto "public tickets, private hand, challenge windows."

Plain HTML/JS keeps the frontend simple to build and change quickly during early
playtesting. If the UI grows complex later (animations, richer card interactions) we can
migrate to React without touching the server.

No database is needed because games are short (20–35 min), state doesn't need to
survive a server restart, and there's no persistent player profile in v1.

## How to run it locally

From this project folder, in a normal terminal (not needed inside Claude):

```
npm install
npm start
```

Then open http://localhost:3000 in a browser. Other people on the same wifi network can
join by visiting http://<your-computer's-LAN-IP>:3000.

## Later: real online play (not just same-wifi)

Deploy the same Node app to Render.com or Railway.app (both have free tiers suitable for
a small party game). No code changes needed — just push the project and set the start
command to `npm start`.

## Open questions for later

- React migration once UI/animation needs grow
- Reconnect handling if a player's phone drops mid-game
- Spectator mode
