import { connect, randomRoomCode } from './net.js';

// ---------- DOM ----------
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const screens = {
  menu: document.getElementById('screen-menu'),
  join: document.getElementById('screen-join'),
  waiting: document.getElementById('screen-waiting'),
  countdown: document.getElementById('screen-countdown'),
  gameover: document.getElementById('screen-gameover'),
  disconnected: document.getElementById('screen-disconnected')
};

function showScreen(name) {
  for (const key in screens) screens[key].classList.toggle('hidden', key !== name);
  document.getElementById('overlay').style.display = name ? 'flex' : 'none';
}

// A phone/tablet has no keyboard, so point people at drag controls instead.
if (window.matchMedia('(pointer: coarse)').matches) {
  document.getElementById('control-hint').textContent = 'Drag anywhere on the screen to move your paddle';
}

// ---------- Constants ----------
const PADDLE_W = 14;
const PADDLE_H = 100;
const PADDLE_MARGIN = 28;
const BALL_R = 9;
const BASE_BALL_SPEED = 420;   // px/sec
const MAX_BALL_SPEED = 980;    // px/sec
const PADDLE_SPEED = 620;      // px/sec
const WIN_SCORE = 7;
const TRAIL_LEN = 10;

// ---------- Canvas sizing (crisp on high-DPI screens) ----------
let W = 0, H = 0;
function resize() {
  const dpr = window.devicePixelRatio || 1;
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();

// ---------- Tiny WebAudio beeps (no audio files = zero extra weight) ----------
let audioCtx = null;
function beep(freq, duration = 0.06, type = 'square', volume = 0.05) {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = volume;
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
    osc.stop(audioCtx.currentTime + duration);
  } catch { /* audio isn't essential to gameplay */ }
}
const sfx = {
  wall: () => beep(220, 0.05),
  paddle: () => beep(440, 0.06),
  score: () => beep(140, 0.25, 'sawtooth', 0.06)
};

// ---------- Particles (hit sparks) ----------
let particles = [];
function spawnParticles(x, y, color) {
  for (let i = 0; i < 10; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 60 + Math.random() * 160;
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 0.35 + Math.random() * 0.15,
      age: 0,
      color
    });
  }
}
function updateParticles(dt) {
  particles.forEach(p => { p.x += p.vx * dt; p.y += p.vy * dt; p.age += dt; });
  particles = particles.filter(p => p.age < p.life);
}
function drawParticles() {
  particles.forEach(p => {
    const t = 1 - p.age / p.life;
    ctx.globalAlpha = t;
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
  });
  ctx.globalAlpha = 1;
}

// ---------- Match / network state ----------
let netApi = null;
let amHost = false;
let vsBot = false;
let roomId = null;
let appState = 'menu'; // menu | waiting | countdown | playing | gameover | disconnected

let myY = 0;      // my own paddle, local & instantly responsive
let oppY = 0;      // opponent paddle: host receives via 'paddle'/client via 'state', or bot-driven
let ball = { x: 0, y: 0, dx: 0, dy: 0 };
let leftScore = 0, rightScore = 0;
let ballTrail = [];
let screenFlash = 0; // brief brightness pulse on score

// ---------- Bot AI (used only in single-player mode) ----------
// Re-targets periodically rather than every frame, and aims with some
// random error, so it reacts and misses a bit like a person would instead
// of tracking the ball with perfect, instant precision.
const BOT_SPEED_FACTOR = 0.78;    // slower than the player's max paddle speed
const BOT_REACTION_MS = 200;
const BOT_AIM_ERROR = 55;         // px of random aim error; occasionally exceeds half the
                                   // 100px paddle height so the bot actually whiffs sometimes
let botTargetY = 0;
let botLastReaction = 0;

function updateBot(dt, now) {
  if (now - botLastReaction > BOT_REACTION_MS) {
    botLastReaction = now;
    botTargetY = ball.dx > 0
      ? ball.y - PADDLE_H / 2 + (Math.random() * 2 - 1) * BOT_AIM_ERROR
      : H / 2 - PADDLE_H / 2; // drift back to center while the ball is moving away
  }
  const diff = botTargetY - oppY;
  const step = PADDLE_SPEED * BOT_SPEED_FACTOR * dt;
  if (Math.abs(diff) < step) oppY = botTargetY;
  else oppY += Math.sign(diff) * step;
  oppY = Math.max(0, Math.min(H - PADDLE_H, oppY));
}

function resetPositions(serveTowardLeft = Math.random() < 0.5) {
  myY = H / 2 - PADDLE_H / 2;
  oppY = H / 2 - PADDLE_H / 2;
  const angle = (Math.random() * 0.6 - 0.3); // slight vertical variety
  ball.x = W / 2;
  ball.y = H / 2;
  ball.dx = (serveTowardLeft ? -1 : 1) * BASE_BALL_SPEED;
  ball.dy = BASE_BALL_SPEED * angle;
  ballTrail = [];
}

function resetMatch() {
  leftScore = 0;
  rightScore = 0;
  resetPositions();
}

// ---------- Idle attract-mode ball (purely cosmetic, runs behind the menu) ----------
let idleBall = { x: 100, y: 100, dx: 260, dy: 190 };
function updateIdleBall(dt) {
  idleBall.x += idleBall.dx * dt;
  idleBall.y += idleBall.dy * dt;
  if (idleBall.x < 20 || idleBall.x > W - 20) idleBall.dx *= -1;
  if (idleBall.y < 20 || idleBall.y > H - 20) idleBall.dy *= -1;
}
function drawIdleBall() {
  drawGlowCircle(idleBall.x, idleBall.y, 7, '#4dfbff');
}

// ---------- Drawing helpers ----------
function drawGlowRect(x, y, w, h, color) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 16;
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}
function drawGlowCircle(x, y, r, color) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 18;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function render() {
  ctx.clearRect(0, 0, W, H);

  // center dashed line
  ctx.save();
  ctx.strokeStyle = 'rgba(77, 251, 255, 0.25)';
  ctx.setLineDash([10, 14]);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(W / 2, 0);
  ctx.lineTo(W / 2, H);
  ctx.stroke();
  ctx.restore();

  if (appState === 'playing') {
    const leftY = amHost ? myY : oppY;
    const rightY = amHost ? oppY : myY;
    const oppColor = vsBot ? '#ffb347' : '#ff3ec9';
    const oppColorSoft = vsBot ? 'rgba(255, 179, 71, 0.9)' : 'rgba(255, 62, 201, 0.9)';
    const oppLabel = vsBot ? 'BOT' : 'OPPONENT';

    // ball trail (fading afterimage)
    ballTrail.forEach((t, i) => {
      ctx.globalAlpha = (i / ballTrail.length) * 0.35;
      drawGlowCircle(t.x, t.y, BALL_R * 0.8, '#4dfbff');
    });
    ctx.globalAlpha = 1;

    drawGlowRect(PADDLE_MARGIN, leftY, PADDLE_W, PADDLE_H, '#4dfbff');
    drawGlowRect(W - PADDLE_MARGIN - PADDLE_W, rightY, PADDLE_W, PADDLE_H, oppColor);
    drawGlowCircle(ball.x, ball.y, BALL_R, '#ffffff');
    drawParticles();

    // score
    ctx.textAlign = 'center';
    ctx.font = "36px 'Press Start 2P', monospace";
    ctx.fillStyle = 'rgba(77, 251, 255, 0.9)';
    ctx.shadowColor = '#4dfbff';
    ctx.shadowBlur = 12;
    ctx.fillText(leftScore, W / 2 - 70, 60);
    ctx.fillStyle = oppColorSoft;
    ctx.shadowColor = oppColor;
    ctx.fillText(rightScore, W / 2 + 70, 60);
    ctx.shadowBlur = 0;

    // "YOU" label under your own paddle
    ctx.font = "11px 'Segoe UI', sans-serif";
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText('YOU', amHost ? PADDLE_MARGIN + PADDLE_W / 2 : W - PADDLE_MARGIN - PADDLE_W / 2, H - 18);
    ctx.fillText(oppLabel, amHost ? W - PADDLE_MARGIN - PADDLE_W / 2 : PADDLE_MARGIN + PADDLE_W / 2, H - 18);
  } else {
    drawIdleBall();
  }

  if (screenFlash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${screenFlash})`;
    ctx.fillRect(0, 0, W, H);
    screenFlash = Math.max(0, screenFlash - 0.04);
  }
}

// ---------- Input ----------
function clampPaddleY(y) {
  return Math.max(0, Math.min(H - PADDLE_H, y));
}

// Keyboard: both W/S and the arrow keys move MY paddle (each player has
// one keyboard).
const keys = {};
window.addEventListener('keydown', e => { keys[e.key.toLowerCase()] = true; });
window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });

function moveMyPaddle(dt) {
  const up = keys['w'] || keys['arrowup'];
  const down = keys['s'] || keys['arrowdown'];
  if (up) myY -= PADDLE_SPEED * dt;
  if (down) myY += PADDLE_SPEED * dt;
  myY = clampPaddleY(myY);
}

// Touch: drag anywhere on the canvas and the paddle follows your finger,
// same as the original game's touch controls. Listeners are on the canvas
// element specifically (not window), which sits *behind* the full-viewport
// menu overlay in stacking order - so a tap on a menu button never reaches
// these handlers, no appState check needed to keep them from colliding.
function handleTouch(e) {
  const touch = e.touches[0];
  if (!touch) return;
  e.preventDefault();
  myY = clampPaddleY(touch.clientY - PADDLE_H / 2);
}
canvas.addEventListener('touchstart', handleTouch, { passive: false });
canvas.addEventListener('touchmove', handleTouch, { passive: false });

// ---------- Host-authoritative physics ----------
function stepHostPhysics(dt) {
  const leftY = myY, rightY = oppY;

  ball.x += ball.dx * dt;
  ball.y += ball.dy * dt;

  if (ball.y <= BALL_R || ball.y >= H - BALL_R) {
    ball.dy *= -1;
    ball.y = Math.max(BALL_R, Math.min(H - BALL_R, ball.y));
    sfx.wall();
  }

  const hitLeft = ball.x - BALL_R <= PADDLE_MARGIN + PADDLE_W &&
                  ball.dx < 0 &&
                  ball.y >= leftY && ball.y <= leftY + PADDLE_H;
  const hitRight = ball.x + BALL_R >= W - PADDLE_MARGIN - PADDLE_W &&
                    ball.dx > 0 &&
                    ball.y >= rightY && ball.y <= rightY + PADDLE_H;

  if (hitLeft || hitRight) {
    const paddleY = hitLeft ? leftY : rightY;
    const relative = (ball.y - (paddleY + PADDLE_H / 2)) / (PADDLE_H / 2); // -1..1
    const speed = Math.min(MAX_BALL_SPEED, Math.hypot(ball.dx, ball.dy) * 1.07);
    const dir = hitLeft ? 1 : -1;
    ball.dx = dir * speed * Math.cos(relative * 0.5);
    ball.dy = speed * Math.sin(relative * 0.5) + (relative * 40);
    ball.x = hitLeft ? PADDLE_MARGIN + PADDLE_W + BALL_R : W - PADDLE_MARGIN - PADDLE_W - BALL_R;
    spawnParticles(ball.x, ball.y, hitLeft ? '#4dfbff' : '#ff3ec9');
    sfx.paddle();
  }

  if (ball.x < -30) {
    rightScore++;
    sfx.score();
    screenFlash = 0.5;
    checkWinOrServe(false);
  } else if (ball.x > W + 30) {
    leftScore++;
    sfx.score();
    screenFlash = 0.5;
    checkWinOrServe(true);
  }

  ballTrail.push({ x: ball.x, y: ball.y });
  if (ballTrail.length > TRAIL_LEN) ballTrail.shift();
}

function checkWinOrServe(serveTowardLeft) {
  if (leftScore >= WIN_SCORE || rightScore >= WIN_SCORE) {
    endMatch();
  } else {
    resetPositions(serveTowardLeft);
  }
}

// Shared by both roles: the host calls this directly when it detects a win;
// the client calls it when the host's broadcast state carries `over: true`,
// since only the host runs physics/scoring.
function endMatch() {
  appState = 'gameover';
  const iWon = amHost ? leftScore > rightScore : rightScore > leftScore;
  document.getElementById('result-text').textContent = iWon ? 'YOU WIN!' : 'YOU LOSE';
  document.getElementById('result-text').className = 'big-result ' + (iWon ? 'win' : 'lose');
  document.getElementById('final-score').textContent = `${leftScore} - ${rightScore}`;
  showScreen('gameover');
}

// ---------- Main loop ----------
let lastTime = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;

  if (appState === 'playing') {
    moveMyPaddle(dt);
    if (vsBot) updateBot(dt, now);
    if (amHost) stepHostPhysics(dt); // may flip appState to 'gameover' on a win
    updateParticles(dt);
  } else if (appState !== 'gameover') {
    updateIdleBall(dt);
  }

  // Keep sending through the game-over frame too, so the host's final score
  // and the `over` flag are guaranteed to reach the client at least once.
  if (netApi && (appState === 'playing' || appState === 'gameover')) {
    netApi.sendPaddle(myY);
    if (amHost) {
      netApi.sendState({ lY: myY, rY: oppY, bx: ball.x, by: ball.y, lS: leftScore, rS: rightScore, over: appState === 'gameover' });
    }
  }

  render();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ---------- Networking wiring ----------
function wireNetworkCommon() {
  netApi.onPeerLeave(() => {
    if (appState === 'playing' || appState === 'countdown' || appState === 'gameover') {
      appState = 'disconnected';
      showScreen('disconnected');
    }
  });

  netApi.onRematch(() => {
    resetMatch();
    appState = 'playing';
    showScreen(null);
  });
}

// onComplete differs by role: the host owns match state and starts the
// match itself; the client just waits here until the host's first real
// 'state' broadcast arrives (handled in joinGame's onState), which avoids
// the two sides ever guessing independent, potentially-mismatched starts.
function startCountdown(onComplete) {
  showScreen('countdown');
  appState = 'countdown';
  let n = 3;
  const el = document.getElementById('countdown-number');
  el.textContent = n;
  const iv = setInterval(() => {
    n--;
    if (n <= 0) {
      clearInterval(iv);
      onComplete();
    } else {
      el.textContent = n;
    }
  }, 800);
}

function startBotGame() {
  amHost = true;
  vsBot = true;
  netApi = null;
  roomId = null;

  document.getElementById('countdown-title').textContent = 'Practice Match';
  startCountdown(() => {
    resetMatch();
    appState = 'playing';
    showScreen(null);
  });
}

function hostGame() {
  roomId = randomRoomCode();
  amHost = true;
  vsBot = false;
  netApi = connect(roomId);
  wireNetworkCommon();

  netApi.onPaddle(y => { oppY = y; });

  netApi.onPeerJoin(() => {
    if (netApi.peerCount() >= 1 && appState === 'waiting') {
      document.getElementById('countdown-title').textContent = 'Opponent Connected!';
      startCountdown(() => {
        resetMatch();
        appState = 'playing';
        showScreen(null);
      });
    }
  });

  document.getElementById('room-code-display').textContent = roomId;
  document.querySelector('#screen-waiting .subtitle').textContent = 'Share this code or link with your friend';
  document.querySelector('#screen-waiting .link-row').classList.remove('hidden');
  showScreen('waiting');
  appState = 'waiting';

  const url = `${location.origin}${location.pathname}?room=${roomId}`;
  document.getElementById('btn-copy-code').onclick = () => copyText(roomId, 'btn-copy-code', 'Copy Code');
  document.getElementById('btn-copy-link').onclick = () => copyText(url, 'btn-copy-link', 'Copy Link');
}

function joinGame(code) {
  roomId = code.toUpperCase();
  amHost = false;
  vsBot = false;
  netApi = connect(roomId);
  wireNetworkCommon();

  netApi.onState(s => {
    oppY = s.lY;
    ball.x = s.bx; ball.y = s.by;
    leftScore = s.lS; rightScore = s.rS;
    ballTrail.push({ x: ball.x, y: ball.y });
    if (ballTrail.length > TRAIL_LEN) ballTrail.shift();

    if (s.over) {
      if (appState !== 'gameover') endMatch();
    } else if (appState !== 'playing') {
      appState = 'playing';
      showScreen(null);
    }
  });

  netApi.onPeerJoin(() => {
    if (appState === 'waiting') {
      document.getElementById('countdown-title').textContent = 'Opponent Connected!';
      // No onComplete action needed: the client transitions to 'playing'
      // as soon as the host's first 'state' message arrives above, so it
      // never has to guess the starting state on its own.
      startCountdown(() => {
        document.getElementById('countdown-number').textContent = '...';
      });
    }
  });

  showScreen('waiting');
  document.getElementById('room-code-display').textContent = roomId;
  document.querySelector('#screen-waiting .subtitle').textContent = 'Connecting to host...';
  document.querySelector('#screen-waiting .link-row').classList.add('hidden');
  appState = 'waiting';
}

async function copyText(text, btnId, resetLabel) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
  const btn = document.getElementById(btnId);
  btn.textContent = 'Copied!';
  setTimeout(() => { btn.textContent = resetLabel; }, 1200);
}

function leaveToMenu() {
  if (netApi) { try { netApi.leave(); } catch {} netApi = null; }
  vsBot = false;
  appState = 'menu';
  showScreen('menu');
}

// ---------- Menu wiring ----------
document.getElementById('btn-bot').addEventListener('click', startBotGame);
document.getElementById('btn-create').addEventListener('click', hostGame);

document.getElementById('btn-join').addEventListener('click', () => {
  showScreen('join');
  document.getElementById('join-error').textContent = '';
  document.getElementById('input-code').focus();
});
document.getElementById('btn-join-back').addEventListener('click', () => showScreen('menu'));

document.getElementById('btn-join-confirm').addEventListener('click', () => {
  const code = document.getElementById('input-code').value.trim();
  if (code.length < 4) {
    document.getElementById('join-error').textContent = 'Enter the code your friend shared.';
    return;
  }
  joinGame(code);
});
document.getElementById('input-code').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-join-confirm').click();
});

document.getElementById('btn-cancel-wait').addEventListener('click', leaveToMenu);
document.getElementById('btn-disconnected-menu').addEventListener('click', leaveToMenu);
document.getElementById('btn-leave').addEventListener('click', leaveToMenu);

document.getElementById('btn-rematch').addEventListener('click', () => {
  if (netApi) netApi.sendRematch();
  resetMatch();
  appState = 'playing';
  showScreen(null);
});

window.addEventListener('beforeunload', () => { if (netApi) netApi.leave(); });

// ---------- Auto-fill room code from a shared link (?room=CODE) ----------
const sharedRoom = new URLSearchParams(location.search).get('room');
if (sharedRoom) {
  showScreen('join');
  document.getElementById('input-code').value = sharedRoom.toUpperCase();
}
