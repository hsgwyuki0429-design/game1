(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const scoreEl = document.getElementById('score');
  const overlay = document.getElementById('overlay');
  const overlayTitle = document.getElementById('overlay-title');
  const overlaySub = document.getElementById('overlay-sub');
  const bestEl = document.getElementById('best');
  const startBtn = document.getElementById('start-btn');

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

  function reset() {
    bird = { x: 90, y: H / 2, r: 14, vy: 0, rot: 0 };
    pipes = [];
    score = 0;
    elapsed = 0;
    speed = BASE_SPEED;
    spawnTimer = 0;
    groundOffset = 0;
    flashTimer = 0;
    scoreEl.textContent = '0';
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
    if (score > best) {
      best = score;
      localStorage.setItem(STORAGE_KEY, String(best));
    }
    bestEl.textContent = best;
    overlayTitle.textContent = 'ゲームオーバー';
    overlaySub.textContent = `スコア: ${score}`;
    startBtn.textContent = 'もう一度';
    overlay.classList.remove('hidden');
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

  function drawBird() {
    ctx.save();
    ctx.translate(bird.x, bird.y);
    ctx.rotate(bird.rot);
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
    drawBackground();
    drawPipes();
    drawGround();
    drawBird();
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
