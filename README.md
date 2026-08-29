# Golden Bluff! 🎟️

A bluffing card game — claim any Character's ability, get challenged, lose a life if
you're caught lying. First to 10 Golden Tickets wins.

Full rules are in the attached Claude project. Tech stack notes are in `docs/TECH-STACK.md`.

## How to play (v1 — online, same wifi network)

1. In this folder, run:
   ```
   npm install
   npm start
   ```
2. Open http://localhost:3000 — create a room, get the 4-letter code.
3. Other players on the same wifi open http://<your-computer's-LAN-IP>:3000 and join with that code.
   (Find your LAN IP with `ipconfig` on Windows — look for "IPv4 Address".)
4. 2–6 players, host clicks Start once everyone's in.

Real internet play (not just same wifi) needs deploying the server somewhere like
Render or Railway — happy to do that once you're happy with the rules on the local network.

## What's implemented

All 6 Characters, claims, challenges (lying and truthful outcomes), the reveal →
return → shuffle → draw cycle, Guard blocking, eliminations, and both win conditions
(via Stable Income or via a Character claim). There's also a "Table Talk" chat box for
bluffing out loud, and a private popup for the Seer's peek.

## Deploying so anyone can join (real internet, not just wifi)

One-time setup:
1. Create an empty repo on GitHub (github.com/new) — don't add a README/gitignore there, this project already has them.
2. In a terminal in this folder:
   ```
   git remote add origin https://github.com/<your-username>/<repo-name>.git
   git push -u origin main
   ```
3. Go to render.com, sign in with GitHub, click New + → Web Service, pick this repo.
4. Settings: Build Command `npm install`, Start Command `npm start`, Instance Type: Free. Create Web Service.
5. Render gives you a public URL like `https://<something>.onrender.com` — that's the link to share with anyone, anywhere.

Note: on the free tier, the server falls asleep after 15 minutes with no players connected, and
takes about a minute to wake back up when the next person opens the link. Open it a minute before
you actually want to start playing.

Shipping an update later: after I change files here, run
`git add -A && git commit -m "..." && git push` in this folder — Render redeploys automatically.

## Rules judgment calls (the original rules didn't fully specify these)

- **Assassin needs 2+ tickets to even claim it** (bluff or not) — otherwise you could
  claim it, go unchallenged, and owe tickets you don't have. If this feels too
  restrictive in practice (e.g. you want to bluff Assassin with 0 tickets, banking on
  nobody challenging), tell me and I'll change it.
- **Guard still costs the Assassin their 2 tickets even when it blocks the attack** —
  paying is treated as part of attempting the ability, not refunded by the target's Guard.
- **If only one player is left un-eliminated, they win immediately** — rather than
  playing out a solo grind to 10 tickets.
- **Simultaneous challenges** are resolved by whoever's "CHALLENGE!" reaches the server
  first, not the clockwise tie-break rule from the doc (that's very hard to do fairly
  over a network with a class of milliseconds of natural lag anyway).
- **If nobody challenges within 20 seconds**, the claim auto-resolves as truthful/unchallenged,
  so the game doesn't stall if someone steps away.

## Known limitations (v1)

- No reconnect support — if your browser tab closes mid-game, that player is stuck
  (fine for a same-room prototype where everyone's watching one laptop or on the same call).
- No persistence — closing the server ends all games in progress.

## Project layout

- `game/engine.js` — all game rules and state transitions (pure, no networking)
- `game/engine.test.js` — scenario tests, run with `node game/engine.test.js` (no install needed)
- `server.js` — Socket.IO server wiring
- `public/` — client (HTML/CSS/JS, no build step)
