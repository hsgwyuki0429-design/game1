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
  const stage = document.getElementById('stage');
  const gravityBadge = document.getElementById('gravity-badge');
  const diffButtons = Array.from(document.querySelectorAll('.diff-btn'));
  const overlayInner = document.getElementById('overlay-inner');
  const menuButtons = Array.from(document.querySelectorAll('.menu-btn'));
  const backButtons = Array.from(document.querySelectorAll('[data-back]'));
  const subpanels = {
    char: document.getElementById('panel-char'),
    pipe: document.getElementById('panel-pipe'),
    tutorial: document.getElementById('panel-tutorial'),
  };
  const charGrid = document.getElementById('char-grid');
  const pipeGrid = document.getElementById('pipe-grid');

  const W = canvas.width;
  const H = canvas.height;
  const GROUND_H = 80;
  const PIPE_WIDTH = 64;
  const PIPE_INTERVAL = 1.4;

  const DIFFICULTIES = {
    normal: {
      label: 'ノーマル', gravity: 1500, flap: -430, gapBase: 165, gapMin: 120, baseSpeed: 180,
      movingPipeScore: 6, movingChance: 0.3, moveAmp: 40, moveSpeed: 1.1,
      gravityFlipScore: 12, flipArmDelay: 5, flipNormalDur: [7, 4], flipReversedDur: [3, 1.5],
    },
    hard: {
      label: 'ハード', gravity: 1680, flap: -450, gapBase: 145, gapMin: 105, baseSpeed: 205,
      movingPipeScore: 3, movingChance: 0.45, moveAmp: 52, moveSpeed: 1.5,
      gravityFlipScore: 6, flipArmDelay: 3.5, flipNormalDur: [5.5, 3], flipReversedDur: [3.2, 1.8],
    },
    insane: {
      label: '鬼', gravity: 1850, flap: -470, gapBase: 128, gapMin: 95, baseSpeed: 228,
      movingPipeScore: 0, movingChance: 0.6, moveAmp: 62, moveSpeed: 1.9,
      gravityFlipScore: 2, flipArmDelay: 2.5, flipNormalDur: [4, 2], flipReversedDur: [3.5, 2],
    },
  };

  // --- 選べるキャラクター（見た目のみ変化、性能は同じ） ---
  const CHARACTERS = {
    byte:  { name: 'バイト',   body: '#ffd166', stroke: '#c99a2e', beak: '#ff8c42', cheek: '#ffb3ba', glow: '255,209,102' },
    robin: { name: 'コマドリ', body: '#ff6b6b', stroke: '#c1440e', beak: '#ffb300', cheek: '#ffd1d1', glow: '255,107,107' },
    mint:  { name: 'ミント',   body: '#4dd0e1', stroke: '#00838f', beak: '#ffca28', cheek: '#b2ebf2', glow: '77,208,225'  },
    grape: { name: 'グレープ', body: '#ba68c8', stroke: '#6a1b9a', beak: '#ffd166', cheek: '#e1bee7', glow: '186,104,200' },
    leaf:  { name: 'リーフ',   body: '#81c784', stroke: '#2e7d32', beak: '#ff8c42', cheek: '#c8e6c9', glow: '129,199,132' },
    snow:  { name: 'スノウ',   body: '#eceff1', stroke: '#90a4ae', beak: '#ffb300', cheek: '#ffd1d1', glow: '236,239,241' },
  };

  // --- 選べる土管デザイン（通常・動く土管の色を変更） ---
  const PIPE_SKINS = {
    classic: { name: 'クラシック', fill: '#4caf50', stroke: '#2e7d32', cap: '#66bb6a', mFill: '#42a5f5', mStroke: '#1565c0', mCap: '#64b5f6' },
    candy:   { name: 'キャンディ', fill: '#ff8fab', stroke: '#c9184a', cap: '#ffb3c6', mFill: '#ffca3a', mStroke: '#e09f00', mCap: '#ffe08a' },
    steel:   { name: 'スチール',   fill: '#90a4ae', stroke: '#455a64', cap: '#cfd8dc', mFill: '#78909c', mStroke: '#37474f', mCap: '#b0bec5' },
    sunset:  { name: 'サンセット', fill: '#ff7043', stroke: '#bf360c', cap: '#ffab91', mFill: '#ab47bc', mStroke: '#6a1b9a', mCap: '#ce93d8' },
    ocean:   { name: 'オーシャン', fill: '#26c6da', stroke: '#00838f', cap: '#80deea', mFill: '#5c6bc0', mStroke: '#283593', mCap: '#9fa8da' },
    forest:  { name: 'フォレスト', fill: '#2e7d32', stroke: '#1b5e20', cap: '#66bb6a', mFill: '#8d6e63', mStroke: '#4e342e', mCap: '#bcaaa4' },
  };

  let character = localStorage.getItem('flappy-byte-character') || 'byte';
  if (!CHARACTERS[character]) character = 'byte';
  let charCfg = CHARACTERS[character];

  let pipeSkinKey = localStorage.getItem('flappy-byte-pipeskin') || 'classic';
  if (!PIPE_SKINS[pipeSkinKey]) pipeSkinKey = 'classic';
  let pipeSkin = PIPE_SKINS[pipeSkinKey];

  const STORAGE_KEY = 'flappy-byte-best';
  let difficulty = localStorage.getItem('flappy-byte-difficulty') || 'normal';
  if (!DIFFICULTIES[difficulty]) difficulty = 'normal';
  let cfg = DIFFICULTIES[difficulty];

  function bestKey(diff) {
    return diff === 'normal' ? STORAGE_KEY : `${STORAGE_KEY}-${diff}`;
  }

  let best = Number(localStorage.getItem(bestKey(difficulty)) || 0);
  bestEl.textContent = best;

  function selectDifficulty(diff) {
    difficulty = diff;
    cfg = DIFFICULTIES[diff];
    localStorage.setItem('flappy-byte-difficulty', diff);
    best = Number(localStorage.getItem(bestKey(diff)) || 0);
    bestEl.textContent = best;
    diffButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.diff === diff));
  }

  diffButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      selectDifficulty(btn.dataset.diff);
    });
  });
  selectDifficulty(difficulty);

  // --- サブパネル（キャラ選択 / 土管デザイン / 遊び方）の開閉 ---
  function openPanel(name) {
    overlayInner.classList.add('hidden');
    Object.entries(subpanels).forEach(([k, el]) => el.classList.toggle('hidden', k !== name));
  }
  function closePanels() {
    overlayInner.classList.remove('hidden');
    Object.values(subpanels).forEach(el => el.classList.add('hidden'));
  }
  menuButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openPanel(btn.dataset.panel);
    });
  });
  backButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      closePanels();
    });
  });

  // キャラ選択カードを生成
  function buildCharGrid() {
    charGrid.innerHTML = '';
    Object.entries(CHARACTERS).forEach(([key, c]) => {
      const card = document.createElement('button');
      card.className = 'option-card' + (key === character ? ' active' : '');
      card.dataset.char = key;
      const cv = document.createElement('canvas');
      cv.width = 52; cv.height = 52; cv.className = 'swatch';
      drawBirdSwatch(cv.getContext('2d'), c, 26, 26, 15);
      const name = document.createElement('span');
      name.className = 'option-name';
      name.textContent = c.name;
      card.appendChild(cv);
      card.appendChild(name);
      card.addEventListener('click', (e) => {
        e.stopPropagation();
        selectCharacter(key);
      });
      charGrid.appendChild(card);
    });
  }
  function selectCharacter(key) {
    character = key;
    charCfg = CHARACTERS[key];
    localStorage.setItem('flappy-byte-character', key);
    Array.from(charGrid.children).forEach(card => card.classList.toggle('active', card.dataset.char === key));
    playFlap();
  }

  // 土管デザインカードを生成
  function buildPipeGrid() {
    pipeGrid.innerHTML = '';
    Object.entries(PIPE_SKINS).forEach(([key, s]) => {
      const card = document.createElement('button');
      card.className = 'option-card' + (key === pipeSkinKey ? ' active' : '');
      card.dataset.pipe = key;
      const sw = document.createElement('div');
      sw.className = 'pipe-swatch';
      sw.style.background = `linear-gradient(${s.fill} 0 70%, ${s.cap} 70% 100%)`;
      sw.style.border = `2px solid ${s.stroke}`;
      const name = document.createElement('span');
      name.className = 'option-name';
      name.textContent = s.name;
      card.appendChild(sw);
      card.appendChild(name);
      card.addEventListener('click', (e) => {
        e.stopPropagation();
        selectPipeSkin(key);
      });
      pipeGrid.appendChild(card);
    });
  }
  function selectPipeSkin(key) {
    pipeSkinKey = key;
    pipeSkin = PIPE_SKINS[key];
    localStorage.setItem('flappy-byte-pipeskin', key);
    Array.from(pipeGrid.children).forEach(card => card.classList.toggle('active', card.dataset.pipe === key));
    playScore(false);
  }

  buildCharGrid();
  buildPipeGrid();

  let state = 'ready';
  let bird, pipes, score, elapsed, speed, spawnTimer, groundOffset, flashTimer, flashMaxTimer, flashColor;
  let particles, floaters, shakeTime, shakeMag, squash, punch, clouds, bgTime, trail, shockwaves;
  let gravityDir, gravityArmed, gravityPhaseTimer, gravityWarn, noSpawnTimer, combo;
  
  // 鬼モード専用の操作変更タイム用変数
  let controlChaosMode, controlChaosTimer, controlChaosCooldown;

  const GRAVITY_WARN_LEAD = 1;
  const GRAVITY_CLEAR_AFTER = 2.5;
  // 重力反転中のゆるめ係数（重力と横スクロール速度を弱める）
  const GRAVITY_REVERSED_GRAV_MUL = 0.72;
  const GRAVITY_REVERSED_SPEED_MUL = 0.8;

  function initClouds() {
    clouds = [];
    for (let i = 0; i < 6; i++) {
      clouds.push({
        x: Math.random() * W,
        y: 20 + Math.random() * (H - GROUND_H - 80),
        r: 18 + Math.random() * 26,
        speedFactor: 0.15 + Math.random() * 0.2,
      });
    }
  }

  function reset() {
    bird = { x: 90, y: H / 2, r: 14, vy: 0, rot: 0 };
    pipes = [];
    score = 0;
    combo = 0;
    elapsed = 0;
    speed = cfg.baseSpeed;
    spawnTimer = 0;
    groundOffset = 0;
    flashTimer = 0;
    flashMaxTimer = 0.15;
    flashColor = '255,255,255';
    particles = [];
    floaters = [];
    trail = [];
    shockwaves = [];
    shakeTime = 0;
    shakeMag = 0;
    squash = 1;
    punch = 0;
    bgTime = 0;
    gravityDir = 1;
    gravityArmed = false;
    gravityPhaseTimer = 0;
    gravityWarn = false;
    noSpawnTimer = 0;

    // 鬼モードイベント変数の初期化
    controlChaosMode = false;
    controlChaosTimer = 0;
    controlChaosCooldown = 15; // スコア20達成後、15秒経過で初回発動
    combo = 0;

    gravityBadge.classList.add('hidden');
    gravityBadge.classList.remove('warn', 'active');
    initClouds();
    scoreEl.textContent = '0';
    newBestLine.classList.add('hidden');
  }

  // --- audio (synthesized, no external assets) ---
  // やわらかく心地よい響きにするため、全体を「ローパス＋軽いリバーブ」の
  // マスターチェーンに通し、各音は角の立たないsine/triangle中心＆
  // なめらかなフェードで鳴らす。
  let audioCtx = null;
  let masterGain = null;
  let masterFilter = null;
  let reverbGain = null;

  function buildReverbImpulse(ctxA, seconds = 1.6, decay = 3.2) {
    const rate = ctxA.sampleRate;
    const len = Math.floor(rate * seconds);
    const buffer = ctxA.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buffer;
  }

  function getAudioCtx() {
    if (!audioCtx) {
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      audioCtx = AudioCtor ? new AudioCtor() : null;
      if (audioCtx) {
        // やさしいトーンにするマスターローパス
        masterFilter = audioCtx.createBiquadFilter();
        masterFilter.type = 'lowpass';
        masterFilter.frequency.value = 3800;
        masterFilter.Q.value = 0.4;
        masterGain = audioCtx.createGain();
        masterGain.gain.value = 0.85;
        masterFilter.connect(masterGain).connect(audioCtx.destination);
        // ほんのり響きを足す軽いリバーブ
        try {
          const convolver = audioCtx.createConvolver();
          convolver.buffer = buildReverbImpulse(audioCtx);
          reverbGain = audioCtx.createGain();
          reverbGain.gain.value = 0.18;
          masterGain.connect(convolver).connect(reverbGain).connect(audioCtx.destination);
        } catch (e) { /* リバーブ非対応環境は素通し */ }
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  // なめらかなアタック/リリース付きの単音
  function tone({ freq = 440, duration = 0.1, type = 'sine', volume = 0.2, glideTo = null, delay = 0, attack = 0.012 }) {
    const ctxA = getAudioCtx();
    if (!ctxA) return;
    const t0 = ctxA.currentTime + delay;
    const osc = ctxA.createOscillator();
    const gain = ctxA.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + duration);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(volume, t0 + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain).connect(masterFilter || ctxA.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.03);
  }

  // 基音＋やわらかい倍音を重ねて丸い音色に
  function beep(opts) {
    tone(opts);
    if (opts.rich !== false && opts.type !== 'sine') {
      tone({ ...opts, type: 'sine', volume: (opts.volume || 0.2) * 0.5, rich: false });
    }
  }

  function playFlap() {
    tone({ freq: 420, glideTo: 640, duration: 0.11, type: 'sine', volume: 0.14, attack: 0.006 });
    tone({ freq: 840, glideTo: 1280, duration: 0.08, type: 'triangle', volume: 0.05, attack: 0.004 });
  }
  function playScore(milestone) {
    // 気持ちのよいベル（メジャー系）
    tone({ freq: 784, duration: 0.16, type: 'triangle', volume: 0.16 }); // G5
    tone({ freq: 1175, duration: 0.2, type: 'sine', volume: 0.11, delay: 0.05 }); // D6
    if (milestone) {
      tone({ freq: 1568, duration: 0.28, type: 'triangle', volume: 0.13, delay: 0.11 }); // G6
      tone({ freq: 2349, duration: 0.28, type: 'sine', volume: 0.06, delay: 0.11 });
    }
  }
  function playCombo() {
    // 上昇するペンタトニックのきらめき
    [659, 880, 1174, 1568].forEach((f, i) => {
      tone({ freq: f, duration: 0.16, type: 'triangle', volume: 0.12, delay: i * 0.055 });
      tone({ freq: f * 2, duration: 0.12, type: 'sine', volume: 0.04, delay: i * 0.055 });
    });
  }
  function playHit() {
    // 角の立たない、やわらかな着地の低音
    tone({ freq: 300, glideTo: 90, duration: 0.34, type: 'sine', volume: 0.22, attack: 0.004 });
    tone({ freq: 150, glideTo: 60, duration: 0.4, type: 'triangle', volume: 0.1, attack: 0.006 });
  }
  function playGravityWarn() {
    tone({ freq: 660, duration: 0.16, type: 'sine', volume: 0.12 });
    tone({ freq: 660, duration: 0.16, type: 'sine', volume: 0.12, delay: 0.2 });
  }
  function playGravityFlip(reversed) {
    // 反転＝上昇、復帰＝下降のなめらかなスウィープ
    tone({ freq: reversed ? 440 : 880, glideTo: reversed ? 880 : 440, duration: 0.4, type: 'sine', volume: 0.16, attack: 0.02 });
    tone({ freq: reversed ? 660 : 1320, glideTo: reversed ? 1320 : 660, duration: 0.4, type: 'triangle', volume: 0.06, attack: 0.02 });
  }
  function playBest() {
    // 明るいメジャーのアルペジオ・ファンファーレ
    [523, 659, 784, 1047, 1319].forEach((freq, i) => {
      tone({ freq, duration: 0.26, type: 'triangle', volume: 0.14, delay: i * 0.1 });
      tone({ freq: freq * 1.5, duration: 0.22, type: 'sine', volume: 0.05, delay: i * 0.1 + 0.02 });
    });
  }

  function vibrate(pattern) {
    if (navigator.vibrate) navigator.vibrate(pattern);
  }

  function spawnBurst(x, y, colors, count, opts = {}) {
    const { speed = 220, life = 0.6, size = 3, starRatio = 0, gravity = 500 } = opts;
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
        shape: Math.random() < starRatio ? 'star' : 'circle',
        rot: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 8,
        gravity,
      });
    }
  }

  function spawnConfettiRain(colors, count) {
    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * W,
        y: -20 - Math.random() * 200,
        vx: (Math.random() - 0.5) * 60,
        vy: 140 + Math.random() * 120,
        life: 1.8 + Math.random() * 0.8,
        maxLife: 1.8,
        size: 3 + Math.random() * 3,
        color: colors[Math.floor(Math.random() * colors.length)],
        shape: Math.random() < 0.5 ? 'star' : 'circle',
        rot: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 6,
        gravity: 60,
      });
    }
  }

  function spawnFloater(x, y, text, color, scale = 1) {
    floaters.push({ x, y, text, color, life: 0.8, maxLife: 0.8, scale });
  }

  function triggerShake(mag, duration) {
    shakeTime = duration;
    shakeMag = mag;
  }

  function triggerFlash(color, duration) {
    flashTimer = duration;
    flashMaxTimer = duration;
    flashColor = color;
  }

  function triggerPunch(amount) {
    punch = Math.max(punch, amount);
  }

  function triggerInvertPulse(cls) {
    stage.classList.remove('fx-invert', 'fx-invert-big', 'fx-invert-hit');
    void stage.offsetWidth;
    stage.classList.add(cls);
  }

  function spawnShockwave(x, y, color, maxR, life) {
    shockwaves.push({ x, y, color, maxR, life, maxLife: life });
  }

  function updateFX(dt) {
    bgTime += dt;

    for (const c of clouds) {
      c.x -= speed * dt * c.speedFactor * (state === 'playing' ? 1 : 0.3);
      if (c.x < -c.r * 2) {
        c.x = W + c.r * 2;
        c.y = 20 + Math.random() * (H - GROUND_H - 80);
      }
    }

    for (const p of particles) {
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      p.rot += p.rotSpeed * dt;
    }
    particles = particles.filter(p => p.life > 0);
    if (particles.length > 280) particles.splice(0, particles.length - 280);

    for (const f of floaters) {
      f.y -= 40 * dt;
      f.life -= dt;
    }
    floaters = floaters.filter(f => f.life > 0);

    if (shakeTime > 0) shakeTime = Math.max(0, shakeTime - dt);
    squash += (1 - squash) * Math.min(1, dt * 10);
    punch += (0 - punch) * Math.min(1, dt * 9);

    if (state === 'playing') {
      trail.push({ x: bird.x, y: bird.y, life: 0.35, maxLife: 0.35 });
    }
    for (const t of trail) t.life -= dt;
    trail = trail.filter(t => t.life > 0);

    for (const s of shockwaves) s.life -= dt;
    shockwaves = shockwaves.filter(s => s.life > 0);
  }

  function currentGap() {
    return Math.max(cfg.gapMin, cfg.gapBase - score * 1.5);
  }

  function spawnPipe() {
    const gap = currentGap();
    const canMove = score >= cfg.movingPipeScore && Math.random() < cfg.movingChance;
    const moveAmp = canMove ? cfg.moveAmp * (0.6 + Math.random() * 0.6) : 0;
    const margin = 40 + moveAmp;
    const span = Math.max(20, H - GROUND_H - margin * 2 - gap);
    
    // ④ 新しい土管: スライド
    const isSlideX = score >= 8 && Math.random() < 0.2;
    // ⑤ 新しい土管: 奇襲 (上、中、下のいずれかに固定)
    const isAmbush = score >= 12 && !isSlideX && Math.random() < 0.3;
    let ambushDir = Math.random() < 0.5 ? 'bottom' : 'side';

    // ノーマルモード以外でのみ、重力反転時に青い土管にする
    const isBlue = (gravityDir === -1) && (difficulty !== 'normal');

    let baseGapY = margin + Math.random() * span + gap / 2;

    if (isAmbush) {
       const r = Math.random();
       if (r < 0.33) baseGapY = margin + gap / 2;
       else if (r < 0.66) baseGapY = H / 2;
       else baseGapY = H - GROUND_H - margin - gap / 2;
    }

    pipes.push({
      x: W + PIPE_WIDTH,
      baseX: W + PIPE_WIDTH,
      gapY: baseGapY,
      baseGapY,
      gap,
      passed: false,
      moving: canMove,
      moveAmp,
      moveSpeed: canMove ? cfg.moveSpeed * (0.8 + Math.random() * 0.4) : 0,
      movePhase: Math.random() * Math.PI * 2,
      isSlideX,
      slideXPhase: Math.random() * Math.PI * 2,
      isAmbush,
      ambushDir,
      ambushT: 0,
      ambushStartX: W * 0.35, // 画面内に入ってから奇襲開始
      isBlue,
    });
  }

  function flap() {
    if (state === 'ready') {
      startGame();
      return;
    }
    if (state === 'playing') {
      
      // 鬼モードの操作変更タイム中は、タップで重力が反転する
      if (controlChaosMode) {
        gravityDir *= -1;
        bird.vy = 0; // 重力反転時に速度リセット
        triggerFlash('186,104,200', 0.15);
        triggerShake(5, 0.1);
        playGravityFlip(gravityDir === -1);
        vibrate([10, 15]);
        return; // 通常のジャンプは行わない
      }

      bird.vy = cfg.flap * gravityDir;
      squash = 1.4;
      triggerPunch(0.015);
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
    bird.vy = cfg.flap;
  }

  function endGame() {
    state = 'gameover';
    triggerFlash('255,255,255', 0.15);
    triggerShake(8, 0.25);
    triggerPunch(0.12);
    triggerInvertPulse('fx-invert-hit');
    playHit();
    vibrate([30, 40, 30]);
    spawnBurst(bird.x, bird.y, ['#8d6e3a', '#c9b96a', '#ffd166'], 16, { speed: 260, life: 0.7, size: 3.5 });
    spawnShockwave(bird.x, bird.y, '#ff6b6b', 110, 0.4);
    gravityBadge.classList.add('hidden');

    const isNewBest = score > best;
    if (isNewBest) {
      best = score;
      localStorage.setItem(bestKey(difficulty), String(best));
    }
    bestEl.textContent = best;
    overlayTitle.textContent = 'ゲームオーバー';
    overlaySub.textContent = `スコア: ${score}`;
    startBtn.textContent = 'もう一度';
    overlay.classList.remove('hidden');

    if (isNewBest && score > 0) {
      newBestLine.classList.remove('hidden');
      const rainbow = ['#ffd166', '#ff6b6b', '#4caf50', '#66bb6a', '#4dd0e1', '#ba68c8', '#fff'];
      setTimeout(() => {
        playBest();
        triggerFlash('255,209,102', 0.35);
        triggerPunch(0.2);
        triggerInvertPulse('fx-invert-big');
        spawnBurst(W / 2, H * 0.35, rainbow, 34, { speed: 280, life: 1, size: 4.5, starRatio: 0.4 });
        spawnConfettiRain(rainbow, 50);
        spawnShockwave(W / 2, H * 0.35, '#ffd166', 260, 0.8);
        setTimeout(() => spawnShockwave(W / 2, H * 0.35, '#4dd0e1', 260, 0.8), 150);
        setTimeout(() => spawnShockwave(W / 2, H * 0.35, '#ba68c8', 260, 0.8), 300);
      }, 200);
    } else {
      newBestLine.classList.add('hidden');
    }
  }

  function randRange([a, b]) {
    return a + Math.random() * (b - a);
  }

  function updateGravityFlip(dt) {
    if (controlChaosMode) return; // 操作変更イベント中は自動タイマーをストップ

    if (!gravityArmed) {
      if (score >= cfg.gravityFlipScore) {
        gravityArmed = true;
        gravityPhaseTimer = cfg.flipArmDelay;
      }
      return;
    }
    gravityPhaseTimer -= dt;
    if (!gravityWarn && gravityPhaseTimer <= GRAVITY_WARN_LEAD && gravityPhaseTimer > 0) {
      gravityWarn = true;
      playGravityWarn();
      gravityBadge.textContent = gravityDir === 1 ? '⚠ まもなく重力反転' : '⚠ まもなく復帰';
      gravityBadge.classList.remove('hidden', 'active');
      gravityBadge.classList.add('warn');
    }
    if (gravityPhaseTimer <= 0) {
      gravityDir *= -1;
      gravityWarn = false;
      
      // ① レベルが高くなるほど反転している時間を増やす
      const levelBonus = Math.floor(score / 5) * 1.0; 
      gravityPhaseTimer = gravityDir === -1 ? randRange(cfg.flipReversedDur) + levelBonus : randRange(cfg.flipNormalDur);
      
      // 反転時も土管を残すため削除処理は書かない
      
      noSpawnTimer = Math.max(noSpawnTimer, GRAVITY_CLEAR_AFTER);
      triggerFlash(gravityDir === -1 ? '186,104,200' : '255,255,255', 0.3);
      triggerShake(10, 0.3);
      triggerPunch(0.1);
      triggerInvertPulse('fx-invert');
      spawnShockwave(bird.x, bird.y, gravityDir === -1 ? '#ba68c8' : '#4dd0e1', 160, 0.6);
      playGravityFlip(gravityDir === -1);
      vibrate([20, 30, 20, 30]);
      if (gravityDir === -1) {
        gravityBadge.textContent = '🙃 重力反転中';
        gravityBadge.classList.remove('warn');
        gravityBadge.classList.add('active');
      } else {
        gravityBadge.classList.add('hidden');
        gravityBadge.classList.remove('warn', 'active');
      }
    }
  }

  function update(dt) {
    if (state !== 'playing') return;

    elapsed += dt;
    speed = cfg.baseSpeed + Math.min(140, elapsed * 6);
    // 重力反転中はむずかしくなりすぎるので、進む速度を少しゆるめて反応する余裕を持たせる
    if (gravityDir === -1) speed *= GRAVITY_REVERSED_SPEED_MUL;
    groundOffset = (groundOffset + speed * dt) % 40;

    // 鬼モードの操作変更タイムイベントの管理
    if (difficulty === 'insane' && score >= 20) {
      if (!controlChaosMode) {
        controlChaosCooldown -= dt;
        if (controlChaosCooldown <= 0) {
          controlChaosMode = true;
          controlChaosTimer = 10; // 10秒間操作変更
          gravityBadge.textContent = '⚠ 警告: タップで重力反転';
          gravityBadge.classList.remove('hidden', 'active');
          gravityBadge.classList.add('warn');
          playGravityWarn();
        }
      } else {
        controlChaosTimer -= dt;
        if (controlChaosTimer <= 0) {
          controlChaosMode = false;
          controlChaosCooldown = 20 + Math.random() * 10; // 次の発生まで20〜30秒
          gravityBadge.classList.add('hidden');
          gravityBadge.classList.remove('warn');
          spawnFloater(W / 2, H / 2 - 40, "SYSTEM RESTORED", "#4caf50", 1.5);
          beep({ freq: 800, glideTo: 1200, duration: 0.2, type: 'square', volume: 0.1 });
          
          // イベント終了後、安全に通常の重力サイクルに戻す
          if (gravityDir === -1) {
            gravityPhaseTimer = 1.5;
            gravityWarn = false;
          } else {
            gravityPhaseTimer = randRange(cfg.flipNormalDur);
            gravityWarn = false;
          }
        }
      }
    }

    updateGravityFlip(dt);

    // 重力反転中は重力を少し弱めて、操作しやすくする
    const gravMul = gravityDir === -1 ? GRAVITY_REVERSED_GRAV_MUL : 1;
    bird.vy += cfg.gravity * gravityDir * gravMul * dt;
    bird.y += bird.vy * dt;
    bird.rot = Math.max(-0.5, Math.min(1.2, (bird.vy / 600) * gravityDir));

    if (noSpawnTimer > 0) noSpawnTimer = Math.max(0, noSpawnTimer - dt);
    spawnTimer -= dt;
    if (noSpawnTimer <= 0 && spawnTimer <= 0) {
      
      // ② 重力の向きが変わる瞬間前後一秒は土管がないようにする
      let willArriveAt = (W + PIPE_WIDTH - bird.x) / speed;
      let safeToSpawn = true;
      if (gravityArmed && gravityPhaseTimer > 0 && !controlChaosMode) {
        if (Math.abs(willArriveAt - gravityPhaseTimer) <= 1.0) safeToSpawn = false; 
      }
      
      if (safeToSpawn) {
        spawnPipe();
        spawnTimer = PIPE_INTERVAL;
      }
    }

    for (const p of pipes) {
      if (p.moving) {
        p.gapY = p.baseGapY + Math.sin(elapsed * p.moveSpeed + p.movePhase) * p.moveAmp;
      }
      
      // ⑤ 新しい土管（奇襲）のアニメーション進行 → 画面内に入ってから奇襲開始
      if (p.isAmbush) {
        if (p.x < p.ambushStartX) {
          p.ambushT += dt * 3.5;
          if (p.ambushT > 1) p.ambushT = 1;
        }
      }

      // ④ 新しい土管（横スライド）の移動
      if (p.isSlideX) {
        p.baseX -= speed * dt;
        p.x = p.baseX + Math.sin(elapsed * 3.5 + p.slideXPhase) * 60; 
      } else {
        p.x -= speed * dt;
      }

      if (!p.passed && p.x + PIPE_WIDTH < bird.x - bird.r) {
        p.passed = true;

        score++;
        scoreEl.textContent = String(score);
        const milestone = score % 5 === 0;
        playScore(milestone);
        vibrate(milestone ? [15, 30, 15] : 15);
        triggerPunch(milestone ? 0.07 : 0.03);
        if (milestone) {
          triggerFlash('255,209,102', 0.16);
          triggerInvertPulse('fx-invert');
          spawnShockwave(bird.x, bird.y, '#ffd166', 130, 0.5);
        }

        spawnFloater(bird.x, bird.y - 20, milestone ? `+${Math.floor(score / 5)}` : '+1', milestone ? '#ff6b6b' : '#ffd166', milestone ? 1.2 : 1);

        spawnBurst(
          bird.x, bird.y,
          milestone ? ['#ffd166', '#ff6b6b', '#4caf50', '#fff'] : ['#ffd166', '#fff8e1'],
          milestone ? 26 : 10,
          { speed: milestone ? 280 : 180, life: milestone ? 0.9 : 0.5, size: milestone ? 4.5 : 3, starRatio: milestone ? 0.45 : 0 }
        );
        scoreEl.classList.remove('pop', 'pop-big');
        void scoreEl.offsetWidth;
        scoreEl.classList.add(milestone ? 'pop-big' : 'pop');
      }
    }
    pipes = pipes.filter(p => p.x > -PIPE_WIDTH);

    const groundY = H - GROUND_H;
    if (gravityDir === 1) {
      if (bird.y + bird.r > groundY) {
        bird.y = groundY - bird.r;
        endGame();
        return;
      }
      if (bird.y - bird.r < 0) {
        bird.y = bird.r;
        bird.vy = 0;
      }
    } else {
      if (bird.y - bird.r < 0) {
        bird.y = bird.r;
        endGame();
        return;
      }
      if (bird.y + bird.r > groundY) {
        bird.y = groundY - bird.r;
        bird.vy = 0;
      }
    }

    // 当たり判定
    for (const p of pipes) {
      let cx = p.x;
      let cyOffset = 0;
      if (p.isAmbush) {
         const ease = 1 - Math.pow(1 - p.ambushT, 4); 
         if (p.ambushDir === 'bottom') cyOffset = (1 - ease) * H;
         else cx = p.x + (1 - ease) * W;
      }

      const inX = bird.x + bird.r > cx && bird.x - bird.r < cx + PIPE_WIDTH;
      if (inX) {
        const topH = p.gapY - p.gap / 2 + cyOffset;
        const botY = p.gapY + p.gap / 2 + cyOffset;
        if (bird.y - bird.r < topH || bird.y + bird.r > botY) {
          endGame();
          return;
        }
      }
    }
  }

  function drawBackground() {
    const tier = Math.min(6, Math.floor(score / 5));
    const speedMul = 1 + tier * 0.7;
    const ampMul = 1 + tier * 0.9;
    const baseHue = gravityDir === -1 ? 300 : 190;
    const hue = baseHue + Math.sin(bgTime * 0.12 * speedMul) * 18 * ampMul;
    const sat = 62 + tier * 4;
    const topColor = `hsl(${hue}, ${sat}%, 68%)`;
    const botColor = `hsl(${hue + 20}, ${sat + 8}%, 84%)`;
    const grd = ctx.createLinearGradient(0, 0, 0, H - GROUND_H);
    grd.addColorStop(0, topColor);
    grd.addColorStop(1, botColor);
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, W, H - GROUND_H);

    for (const c of clouds) {
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, c.r, c.r * 0.6, 0, 0, Math.PI * 2);
      ctx.ellipse(c.x + c.r * 0.6, c.y + c.r * 0.1, c.r * 0.7, c.r * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawStarPath(cx, cy, outerR, innerR) {
    const spikes = 5;
    let rot = -Math.PI / 2;
    const step = Math.PI / spikes;
    ctx.beginPath();
    ctx.moveTo(cx, cy - outerR);
    for (let i = 0; i < spikes; i++) {
      ctx.lineTo(cx + Math.cos(rot) * outerR, cy + Math.sin(rot) * outerR);
      rot += step;
      ctx.lineTo(cx + Math.cos(rot) * innerR, cy + Math.sin(rot) * innerR);
      rot += step;
    }
    ctx.closePath();
  }

  function drawPipes() {
    for (const p of pipes) {
      let renderX = p.x;
      let renderOffsetY = 0;
      
      if (p.isAmbush) {
         const ease = 1 - Math.pow(1 - p.ambushT, 4);
         if (p.ambushDir === 'bottom') renderOffsetY = (1 - ease) * H;
         else renderX = p.x + (1 - ease) * W;
      }

      const topH = p.gapY - p.gap / 2 + renderOffsetY;
      const botY = p.gapY + p.gap / 2 + renderOffsetY;

      if (p.isAmbush) {
        ctx.fillStyle = '#ffb300';
        ctx.strokeStyle = '#ff8f00';
      } else if (p.isSlideX) {
        ctx.fillStyle = '#ab47bc';
        ctx.strokeStyle = '#7b1fa2';
      } else if (p.isBlue) {
        // 青い土管のカラーリング
        ctx.fillStyle = '#00e5ff';
        ctx.strokeStyle = '#00b8d4';
      } else {
        // 選択中の土管デザインを反映（通常/動く土管）
        ctx.fillStyle = p.moving ? pipeSkin.mFill : pipeSkin.fill;
        ctx.strokeStyle = p.moving ? pipeSkin.mStroke : pipeSkin.stroke;
      }
      ctx.lineWidth = 3;

      const topHeight = Math.max(0, topH);
      const bottomHeight = Math.max(0, H - GROUND_H - botY);

      ctx.fillRect(renderX, 0, PIPE_WIDTH, topHeight);
      ctx.strokeRect(renderX, 0, PIPE_WIDTH, topHeight);
      ctx.fillRect(renderX, botY, PIPE_WIDTH, bottomHeight);
      ctx.strokeRect(renderX, botY, PIPE_WIDTH, bottomHeight);

      if (p.isAmbush) {
        ctx.fillStyle = '#ffca28';
      } else if (p.isSlideX) {
        ctx.fillStyle = '#ce93d8';
      } else if (p.isBlue) {
        ctx.fillStyle = '#84ffff'; // 青い土管のハイライト
      } else {
        ctx.fillStyle = p.moving ? pipeSkin.mCap : pipeSkin.cap;
      }

      ctx.fillRect(renderX - 4, topH - 20, PIPE_WIDTH + 8, 20);
      ctx.strokeRect(renderX - 4, topH - 20, PIPE_WIDTH + 8, 20);
      ctx.fillRect(renderX - 4, botY, PIPE_WIDTH + 8, 20);
      ctx.strokeRect(renderX - 4, botY, PIPE_WIDTH + 8, 20);
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

  function drawShockwaves() {
    ctx.globalCompositeOperation = 'lighter';
    for (const s of shockwaves) {
      const t = 1 - s.life / s.maxLife;
      const ease = 1 - Math.pow(1 - t, 3); // やわらかく広がる
      const r = s.maxR * ease;
      const a = Math.max(0, 1 - t);
      ctx.strokeStyle = s.color;
      // メインの輪
      ctx.lineWidth = 4 * (1 - t) + 1;
      ctx.globalAlpha = a * 0.7;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.stroke();
      // 内側のやわらかいエコー
      ctx.lineWidth = 2 * (1 - t) + 0.5;
      ctx.globalAlpha = a * 0.35;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r * 0.72, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  function drawParticles() {
    // やわらかいブルーム層（加算合成で光が滲むような気持ちよさ）
    ctx.globalCompositeOperation = 'lighter';
    for (const p of particles) {
      const a = Math.max(0, p.life / p.maxLife);
      ctx.globalAlpha = a * 0.35;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * 2.1, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    for (const p of particles) {
      const a = Math.max(0, p.life / p.maxLife);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      if (p.shape === 'star') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        drawStarPath(0, 0, p.size, p.size / 2.2);
        ctx.fill();
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawTrail() {
    // キャラ色のなめらかな光の尾（加算合成でやさしく発光）
    ctx.globalCompositeOperation = 'lighter';
    const n = trail.length;
    for (let i = 0; i < n; i++) {
      const t = trail[i];
      const life = Math.max(0, t.life / t.maxLife);
      const grow = (i / n); // 新しいほど太く
      const a = life * 0.28;
      ctx.globalAlpha = a;
      ctx.fillStyle = `rgba(${charCfg.glow}, 1)`;
      ctx.beginPath();
      ctx.arc(t.x, t.y, bird.r * (0.35 + grow * 0.55), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  function drawBirdGlow() {
    const pulse = 0.5 + Math.sin(bgTime * 6) * 0.5;
    const tier = Math.min(4, Math.floor(score / 5));
    if (tier <= 0) return;
    const g = charCfg.glow;
    const radius = bird.r * (2.2 + tier * 0.5);
    const grd = ctx.createRadialGradient(bird.x, bird.y, bird.r * 0.5, bird.x, bird.y, radius);
    const alpha = (0.12 + tier * 0.05) * (0.7 + pulse * 0.3);
    grd.addColorStop(0, `rgba(${g}, ${alpha})`);
    grd.addColorStop(1, `rgba(${g}, 0)`);
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(bird.x, bird.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawFloaters() {
    ctx.textAlign = 'center';
    for (const f of floaters) {
      const a = Math.max(0, f.life / f.maxLife);
      const growth = 1 + (1 - a) * 0.15;
      
      // 通常のスコアと同じフォントスタイルに統一
      ctx.font = `bold ${Math.round(22 * (f.scale || 1) * growth)}px sans-serif`;
      ctx.globalAlpha = a;
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = 'left';
  }

  // 選択中キャラの見た目で鳥を描く（本体スケール後の座標系で呼ぶ）
  function paintBird(c, r) {
    ctx.fillStyle = c.body;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = c.stroke;
    ctx.lineWidth = 2;
    ctx.stroke();
    // ほっぺ
    ctx.fillStyle = c.cheek;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.arc(-r * 0.15, r * 0.28, r * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    // 白目
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(r * 0.36, -r * 0.28, r * 0.32, 0, Math.PI * 2);
    ctx.fill();
    // 黒目
    ctx.fillStyle = '#3a2b00';
    ctx.beginPath();
    ctx.arc(r * 0.46, -r * 0.28, r * 0.14, 0, Math.PI * 2);
    ctx.fill();
    // くちばし
    ctx.fillStyle = c.beak;
    ctx.beginPath();
    ctx.moveTo(r - 2, 0);
    ctx.lineTo(r + 10, 3);
    ctx.lineTo(r - 2, 7);
    ctx.closePath();
    ctx.fill();
  }

  function drawBird() {
    ctx.save();
    ctx.translate(bird.x, bird.y);
    ctx.rotate(bird.rot * gravityDir);
    ctx.scale(1 / Math.sqrt(squash), (Math.sqrt(squash)) * gravityDir);
    paintBird(charCfg, bird.r);
    ctx.restore();
  }

  // 選択画面用の小さな鳥アイコン
  function drawBirdSwatch(c2, cfg2, cx, cy, r) {
    c2.save();
    c2.clearRect(0, 0, cx * 2, cy * 2);
    c2.translate(cx, cy);
    c2.fillStyle = cfg2.body;
    c2.beginPath();
    c2.arc(0, 0, r, 0, Math.PI * 2);
    c2.fill();
    c2.strokeStyle = cfg2.stroke;
    c2.lineWidth = 2;
    c2.stroke();
    c2.fillStyle = cfg2.cheek;
    c2.globalAlpha = 0.7;
    c2.beginPath();
    c2.arc(-r * 0.15, r * 0.28, r * 0.22, 0, Math.PI * 2);
    c2.fill();
    c2.globalAlpha = 1;
    c2.fillStyle = '#fff';
    c2.beginPath();
    c2.arc(r * 0.36, -r * 0.28, r * 0.32, 0, Math.PI * 2);
    c2.fill();
    c2.fillStyle = '#3a2b00';
    c2.beginPath();
    c2.arc(r * 0.46, -r * 0.28, r * 0.14, 0, Math.PI * 2);
    c2.fill();
    c2.fillStyle = cfg2.beak;
    c2.beginPath();
    c2.moveTo(r - 2, 0);
    c2.lineTo(r + 9, 3);
    c2.lineTo(r - 2, 6);
    c2.closePath();
    c2.fill();
    c2.restore();
  }

  function draw() {
    ctx.save();
    if (shakeTime > 0) {
      ctx.translate((Math.random() * 2 - 1) * shakeMag, (Math.random() * 2 - 1) * shakeMag);
    }
    if (punch > 0.001) {
      ctx.translate(W / 2, H / 2);
      ctx.scale(1 + punch, 1 + punch);
      ctx.translate(-W / 2, -H / 2);
    }
    drawBackground();
    drawPipes();
    drawGround();
    drawShockwaves();
    drawParticles();
    drawTrail();
    drawBirdGlow();
    drawBird();
    drawFloaters();
    ctx.restore();
    if (flashTimer > 0) {
      ctx.fillStyle = `rgba(${flashColor},${(flashTimer / flashMaxTimer) * 0.55})`;
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