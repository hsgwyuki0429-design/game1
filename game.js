(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const scoreEl = document.getElementById('score');
  const overlay = document.getElementById('overlay');
  const overlayTitle = document.getElementById('overlay-title');
  const overlaySub = document.getElementById('overlay-sub');
  const bestEl = document.getElementById('best');
  const startBtn = document.getElementById('start-btn');
  const newBestLine = document.getElementById('new-best-line');

  const W = canvas.width;
  const H = canvas.height;
  const GROUND_H = 80;

  const STORAGE_KEY = 'flappy-byte-best';
  let best = Number(localStorage.getItem(STORAGE_KEY) || 0);
  bestEl.textContent = best;

  const GRAVITY = 1500;
  const FLAP_VELOCITY = -430;
  const PIPE_WIDTH = 64;
  const PIPE_GAP_BASE = 165;
  const PIPE_GAP_MIN = 120;
  const PIPE_INTERVAL = 1.4;
  const BASE_SPEED = 180;

  let state = 'ready';
  let bird, pipes, score, elapsed, speed, spawnTimer, groundOffset, flashTimer;
  let particles, floaters, shakeTime, shakeMag, squash;

  function reset() {
    bird = { x: 90, y: H / 2, r: 14, vy: 0, rot: 0 };
    pipes = [];
    score = 0;
    elapsed = 0;
    speed = BASE_SPEED;
    spawnTimer = 0;
    groundOffset = 0;
    flashTimer = 0;
    particles = [];
    floaters = [];
    shakeTime = 0;
    shakeMag = 0;
    squash = 1;
    scoreEl.textContent = '0';
    newBestLine.classList.add('hidden');
  }

  // --- audio (synthesized, no external assets) ---
  let audioCtx = null;
  function getAudioCtx() {
    if (!audioCtx) {
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      audioCtx = AudioCtor ? new AudioCtor() : null;
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  function beep({ freq = 440, duration = 0.1, type = 'sine', volume = 0.2, glideTo = null, delay = 0 }) {
    const ctxA = getAudioCtx();
    if (!ctxA) return;
    const t0 = ctxA.currentTime + delay;
    const osc = ctxA.createOscillator();
    const gain = ctxA.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + duration);
    gain.gain.setValueAtTime(volume, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    osc.connect(gain).connect(ctxA.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  function playFlap() {
    beep({ freq: 480, glideTo: 720, duration: 0.08, type: 'square', volume: 0.1 });
  }
  function playScore(milestone) {
    beep({ freq: 880, duration: 0.09, type: 'triangle', volume: 0.18 });
    beep({ freq: 1175, duration: 0.12, type: 'triangle', volume: 0.16, delay: 0.06 });
    if (milestone) {
      beep({ freq: 1568, duration: 0.16, type: 'triangle', volume: 0.16, delay: 0.14 });
    }
  }
  function playHit() {
    beep({ freq: 160, glideTo: 55, duration: 0.28, type: 'sawtooth', volume: 0.2 });
  }
  function playBest() {
    [660, 880, 1108, 1320].forEach((freq, i) => {
      beep({ freq, duration: 0.16, type: 'triangle', volume: 0.16, delay: i * 0.09 });
    });
  }

  function vibrate(pattern) {
    if (navigator.vibrate) navigator.vibrate(pattern);
  }

  // --- particles & floating text ---
  function spawnBurst(x, y, colors, count, opts = {}) {
    const { speed = 220, life = 0.6, size = 3 } = opts;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random() * 0.6);
      particles.push({
        x, y,
        vx: Math.cos(angle) * v,
        vy: Math.sin(angle) * v - 60,
        life,
        maxLife: life,
        size: size * (0.6 + Math.random() * 0.8),
        color: colors[Math.floor(Math.random() * colors.length)],
      });
    }
  }

  function spawnFloater(x, y, text, color) {
    floaters.push({ x, y, text, color, life: 0.8, maxLife: 0.8 });
  }

  function triggerShake(mag, duration) {
    shakeTime = duration;
    shakeMag = mag;
  }

  function updateFX(dt) {
    for (const p of particles) {
      p.vy += 500 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    }
    particles = particles.filter(p => p.life > 0);

    for (const f of floaters) {
      f.y -= 40 * dt;
      f.life -= dt;
    }
    floaters = floaters.filter(f => f.life > 0);

    if (shakeTime > 0) shakeTime = Math.max(0, shakeTime - dt);
    squash += (1 - squash) * Math.min(1, dt * 10);
  }

  function currentGap() {
    return Math.max(PIPE_GAP_MIN, PIPE_GAP_BASE - score * 1.5);
  }

  function spawnPipe() {
    const gap = currentGap();
    const margin = 40;
    const gapY = margin + Math.random() * (H - GROUND_H - margin * 2 - gap) + gap / 2;
    pipes.push({ x: W + PIPE_WIDTH, gapY, gap, passed: false });
  }

  function flap() {
    if (state === 'ready') {
      startGame();
      return;
    }
    if (state === 'playing') {
      bird.vy = FLAP_VELOCITY;
      squash = 1.4;
      playFlap();
      vibrate(8);
      spawnBurst(bird.x - bird.r, bird.y + 6, ['#fff8e1', '#ffe9b3'], 3, { speed: 90, life: 0.35, size: 2 });
    } else if (state === 'gameover') {
      startGame();
    }
  }

  function startGame() {
    reset();
    state = 'playing';
    overlay.classList.add('hidden');
    bird.vy = FLAP_VELOCITY;
  }

  function endGame() {
    state = 'gameover';
    flashTimer = 0.15;
    triggerShake(8, 0.25);
    playHit();
    vibrate([30, 40, 30]);
    spawnBurst(bird.x, bird.y, ['#8d6e3a', '#c9b96a', '#ffd166'], 16, { speed: 260, life: 0.7, size: 3.5 });

    const isNewBest = score > best;
    if (isNewBest) {
      best = score;
      localStorage.setItem(STORAGE_KEY, String(best));
    }
    bestEl.textContent = best;
    overlayTitle.textContent = 'ゲームオーバー';
    overlaySub.textContent = `スコア: ${score}`;
    startBtn.textContent = 'もう一度';
    overlay.classList.remove('hidden');

    if (isNewBest && score > 0) {
      newBestLine.classList.remove('hidden');
      setTimeout(() => {
        playBest();
        spawnBurst(W / 2, H * 0.35, ['#ffd166', '#ff6b6b', '#4caf50', '#66bb6a', '#fff'], 30, { speed: 260, life: 1, size: 4 });
      }, 200);
    } else {
      newBestLine.classList.add('hidden');
    }
  }

  function update(dt) {
    if (state !== 'playing') return;

    elapsed += dt;
    speed = BASE_SPEED + Math.min(140, elapsed * 6);
    groundOffset = (groundOffset + speed * dt) % 40;

    bird.vy += GRAVITY * dt;
    bird.y += bird.vy * dt;
    bird.rot = Math.max(-0.5, Math.min(1.2, bird.vy / 600));

    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnPipe();
      spawnTimer = PIPE_INTERVAL;
    }

    for (const p of pipes) {
      p.x -= speed * dt;
      if (!p.passed && p.x + PIPE_WIDTH < bird.x - bird.r) {
        p.passed = true;
        score++;
        scoreEl.textContent = String(score);
        const milestone = score % 5 === 0;
        playScore(milestone);
        vibrate(milestone ? [15, 30, 15] : 15);
        spawnFloater(bird.x, bird.y - 20, '+1', milestone ? '#ff6b6b' : '#ffd166');
        spawnBurst(
          bird.x, bird.y,
          milestone ? ['#ffd166', '#ff6b6b', '#4caf50', '#fff'] : ['#ffd166', '#fff8e1'],
          milestone ? 22 : 10,
          { speed: milestone ? 260 : 180, life: milestone ? 0.8 : 0.5, size: milestone ? 4 : 3 }
        );
        scoreEl.classList.remove('pop', 'pop-big');
        void scoreEl.offsetWidth;
        scoreEl.classList.add(milestone ? 'pop-big' : 'pop');
      }
    }
    pipes = pipes.filter(p => p.x > -PIPE_WIDTH);

    const groundY = H - GROUND_H;
    if (bird.y + bird.r > groundY) {
      bird.y = groundY - bird.r;
      endGame();
      return;
    }
    if (bird.y - bird.r < 0) {
      bird.y = bird.r;
      bird.vy = 0;
    }

    for (const p of pipes) {
      const inX = bird.x + bird.r > p.x && bird.x - bird.r < p.x + PIPE_WIDTH;
      if (inX) {
        const topH = p.gapY - p.gap / 2;
        const botY = p.gapY + p.gap / 2;
        if (bird.y - bird.r < topH || bird.y + bird.r > botY) {
          endGame();
          return;
        }
      }
    }
  }

  function drawBackground() {
    ctx.fillStyle = '#70c5ce';
    ctx.fillRect(0, 0, W, H);
    const grd = ctx.createLinearGradient(0, 0, 0, H - GROUND_H);
    grd.addColorStop(0, '#70c5ce');
    grd.addColorStop(1, '#b3e8ef');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, W, H - GROUND_H);
  }

  function drawPipes() {
    for (const p of pipes) {
      const topH = p.gapY - p.gap / 2;
      const botY = p.gapY + p.gap / 2;
      ctx.fillStyle = '#4caf50';
      ctx.strokeStyle = '#2e7d32';
      ctx.lineWidth = 3;
      ctx.fillRect(p.x, 0, PIPE_WIDTH, topH);
      ctx.strokeRect(p.x, 0, PIPE_WIDTH, topH);
      ctx.fillRect(p.x, botY, PIPE_WIDTH, H - GROUND_H - botY);
      ctx.strokeRect(p.x, botY, PIPE_WIDTH, H - GROUND_H - botY);
      ctx.fillStyle = '#66bb6a';
      ctx.fillRect(p.x - 4, topH - 20, PIPE_WIDTH + 8, 20);
      ctx.strokeRect(p.x - 4, topH - 20, PIPE_WIDTH + 8, 20);
      ctx.fillRect(p.x - 4, botY, PIPE_WIDTH + 8, 20);
      ctx.strokeRect(p.x - 4, botY, PIPE_WIDTH + 8, 20);
    }
  }

  function drawGround() {
    const groundY = H - GROUND_H;
    ctx.fillStyle = '#ded895';
    ctx.fillRect(0, groundY, W, GROUND_H);
    ctx.fillStyle = '#c9b96a';
    for (let x = -groundOffset; x < W; x += 40) {
      ctx.fillRect(x, groundY, 20, 10);
    }
    ctx.fillStyle = '#8d6e3a';
    ctx.fillRect(0, groundY, W, 4);
  }

  function drawParticles() {
    for (const p of particles) {
      const a = Math.max(0, p.life / p.maxLife);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawFloaters() {
    ctx.textAlign = 'center';
    ctx.font = 'bold 22px sans-serif';
    for (const f of floaters) {
      const a = Math.max(0, f.life / f.maxLife);
      ctx.globalAlpha = a;
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = 'left';
  }

  function drawBird() {
    ctx.save();
    ctx.translate(bird.x, bird.y);
    ctx.rotate(bird.rot);
    ctx.scale(1 / Math.sqrt(squash), Math.sqrt(squash));
    ctx.fillStyle = '#ffd166';
    ctx.beginPath();
    ctx.arc(0, 0, bird.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#c99a2e';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(5, -4, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3a2b00';
    ctx.beginPath();
    ctx.arc(6.5, -4, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ff8c42';
    ctx.beginPath();
    ctx.moveTo(bird.r - 2, 0);
    ctx.lineTo(bird.r + 10, 3);
    ctx.lineTo(bird.r - 2, 7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function draw() {
    ctx.save();
    if (shakeTime > 0) {
      ctx.translate((Math.random() * 2 - 1) * shakeMag, (Math.random() * 2 - 1) * shakeMag);
    }
    drawBackground();
    drawPipes();
    drawGround();
    drawParticles();
    drawBird();
    drawFloaters();
    ctx.restore();
    if (flashTimer > 0) {
      ctx.fillStyle = `rgba(255,255,255,${flashTimer / 0.15 * 0.6})`;
      ctx.fillRect(0, 0, W, H);
      flashTimer -= 1 / 60;
    }
  }

  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    update(dt);
    updateFX(dt);
    draw();
    requestAnimationFrame(loop);
  }

  reset();
  draw();
  requestAnimationFrame(loop);

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    flap();
  });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code === 'ArrowUp') {
      e.preventDefault();
      flap();
    }
  });
  startBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    flap();
  });
})();
