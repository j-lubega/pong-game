# 🏓 Neon Pong Online

A classic Pong game, rebuilt as a lightweight, real-time **online multiplayer**
game you can play against a friend on a different computer — no install, no
account, no backend server to run.

## ▶️ Play Now

**[https://j-lubega.github.io/pong-game/](https://j-lubega.github.io/pong-game/)**

Open that link on two computers (or two browser windows/tabs), have one
player click **Create Game**, share the code or link it gives you with the
other player, and play.

---

## 🎮 Controls

Each player uses **their own keyboard** to move their own paddle:

- **W** or **↑ (Up Arrow)** — move up
- **S** or **↓ (Down Arrow)** — move down

First to **7 points** wins.

---

## 🌐 How Online Play Works

1. **Player 1** clicks **Create Game**. A 6-character room code (and a
   shareable link) is generated.
2. **Player 1** sends that code/link to **Player 2** (text, Discord, email —
   however you'd normally share a link).
3. **Player 2** clicks **Join Game** and enters the code (or just opens the
   shared link, which fills the code in automatically).
4. Once connected, a 3-second countdown runs and the match starts.

Under the hood, the two browsers connect **directly to each other** over
WebRTC using [Trystero](https://github.com/dmotz/trystero) for match­making —
there's no game server involved, just two browsers finding each other via
public BitTorrent tracker infrastructure and then exchanging paddle/ball
positions peer-to-peer. This is what makes the game work from a plain static
GitHub Pages site with no backend to host or pay for.

**A few honest caveats that come with that approach:**
- Matchmaking is usually near-instant but can occasionally take up to ~20–30
  seconds depending on which public trackers respond fastest.
- Very restrictive corporate/school networks that block WebRTC/UDP may
  prevent a direct connection from forming at all. Home Wi-Fi, mobile data,
  and most normal networks work fine.
- If your opponent's tab closes or their connection drops, the game notices
  within roughly 10–15 seconds (that's a browser-level WebRTC timeout, not
  something the app can speed up) and shows a "opponent left" screen.

---

## ✨ What's in the Game

- **Lightweight** — vanilla JS + `<canvas>`, no framework, no build step, and
  no heavyweight in-browser runtime. The entire game (HTML + CSS + JS) is a
  few tens of KB; the only external dependency is the small Trystero
  networking module loaded from a CDN.
- **Host-authoritative netcode** — one peer's browser simulates the ball and
  scoring and streams state to the other ~60 times a second, so both players
  see a consistent match instead of two independently-drifting simulations.
- **Neon/retro visual style** — glowing paddles and ball, a fading ball
  trail, hit-spark particles, a screen flash on scoring, a CRT-style
  scanline overlay, and an animated attract-mode ball on the menu screen.
- **Tiny synthesized sound effects** (wall bounce, paddle hit, score) via the
  Web Audio API — no audio files to download.
- **Shareable room links** (`?room=CODE`) so joining is a single click, plus
  a copy-to-clipboard button for both the code and the link.
- **Rematch support** and graceful handling of an opponent disconnecting
  mid-match.

---

## 🛠️ Running It Locally

Because the game loads its networking code as an ES module, it needs to be
served over `http://`/`https://` rather than opened directly as a `file://`
URL. From the project folder:

```bash
python3 -m http.server 8000
# then open http://localhost:8000 in two browser tabs
```

Any other static file server (`npx serve`, VS Code's Live Server, etc.)
works just as well.

## 📁 Project Structure

```
.
├── index.html   # Page structure and menu/lobby screens
├── styles.css   # Neon/retro visual styling
├── net.js       # Trystero peer-to-peer networking wrapper
└── game.js      # Game loop, physics, rendering, input, and matchmaking UI logic
```
