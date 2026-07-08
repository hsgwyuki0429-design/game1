// ==========================================
// Flappy Byte 本体
// ランキング(世界共通/ローカル)は leaderboard.js が window.LB として提供する。
// Firebase 設定は firebase-config.js に記入。未設定なら自動でローカル保存にフォールバック。
// ==========================================
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

  // ==========================================
  // ★ 自動操作モード（難易度とは別の括りのトグルボタン）
  //   自動操作中は自己ベストやランキングには一切影響しない。
  // ==========================================
  const autoBtn = document.getElementById('auto-btn');
  let isAutoPilot = false;
  function updateAutoBtn() {
    autoBtn.textContent = isAutoPilot ? '🤖 自動操作: ON' : '🤖 自動操作: OFF';
    autoBtn.classList.toggle('active', isAutoPilot);
  }
  autoBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    isAutoPilot = !isAutoPilot;
    updateAutoBtn();
  });
  updateAutoBtn();

  // ==========================================
  // ★ ランキングボタンの生成と配置
  // ==========================================
  const lbBtn = document.createElement('button');
  lbBtn.innerHTML = '🏆 ランキング';
  lbBtn.style.position = 'fixed';
  lbBtn.style.top = '20px';
  lbBtn.style.right = '20px';
  lbBtn.style.zIndex = '999999';
  lbBtn.style.padding = '10px 15px';
  lbBtn.style.background = 'rgba(0,0,0,0.7)';
  lbBtn.style.color = '#fff';
  lbBtn.style.border = '2px solid rgba(255,215,0,0.6)';
  lbBtn.style.borderRadius = '12px';
  lbBtn.style.fontFamily = 'sans-serif';
  lbBtn.style.fontWeight = 'bold';
  lbBtn.style.fontSize = '14px';
  lbBtn.style.cursor = 'pointer';
  lbBtn.style.boxShadow = '0 4px 8px rgba(0,0,0,0.5)';
  lbBtn.style.transition = 'background 0.2s, border-color 0.2s';
  document.body.appendChild(lbBtn);
  
  lbBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showLeaderboardModal();
  });


  const W = canvas.width;
  const H = canvas.height;
  const GROUND_H = 80;
  const PIPE_WIDTH = 64;
  const PIPE_INTERVAL = 1.4;

  const DIFFICULTIES = {
    normal: {
      label: 'ノーマル', gravity: 1500, flap: -430, gapBase: 165, gapMin: 120, baseSpeed: 180,
      movingPipeScore: 4, movingChance: 0.4, moveAmp: 40, moveSpeed: 1.1,
      slideChance: 0.3, ambushChance: 0.34, shrinkChance: 0.2,
      gravityFlip: false, road: false,
    },
    hard: {
      label: 'ハード', gravity: 1680, flap: -450, gapBase: 145, gapMin: 105, baseSpeed: 205,
      movingPipeScore: 2, movingChance: 0.5, moveAmp: 52, moveSpeed: 1.5,
      slideChance: 0.42, ambushChance: 0.46, shrinkChance: 0.3,
      gravityFlip: false, road: true,
    },
    insane: {
      label: '鬼', gravity: 1850, flap: -470, gapBase: 128, gapMin: 95, baseSpeed: 228,
      movingPipeScore: 0, movingChance: 0.6, moveAmp: 62, moveSpeed: 1.9,
      slideChance: 0.5, ambushChance: 0.55, shrinkChance: 0.4,
      gravityFlip: false, road: true,
    },
    gravity: {
      label: '重力反転', gravity: 1650, flap: -450, gapBase: 150, gapMin: 110, baseSpeed: 200,
      movingPipeScore: 4, movingChance: 0.4, moveAmp: 48, moveSpeed: 1.3,
      slideChance: 0.24, ambushChance: 0.3, shrinkChance: 0.16,
      gravityFlip: true, gravityFlipScore: 4, flipArmDelay: 3.5,
      flipNormalDur: [6, 3.5], flipReversedDur: [5, 3], road: false,
    },
  };

  // ==========================================
  // ★ モーダルUI (名前入力 ＆ ランキング)
  // ==========================================
  
  // フラグなどのクリックイベントが貫通しないようにストップする関数
  const stopEvent = (e) => {
      e.stopPropagation();
  };

  function showNameInputModal(newScore, diff) {
    const savedName = localStorage.getItem('flappy-byte-player-name') || '';
    
    const overlayDiv = document.createElement('div');
    overlayDiv.style.position = 'fixed';
    overlayDiv.style.top = '0';
    overlayDiv.style.left = '0';
    overlayDiv.style.width = '100%';
    overlayDiv.style.height = '100%';
    overlayDiv.style.backgroundColor = 'rgba(0, 0, 0, 0.75)';
    overlayDiv.style.zIndex = '1000000';
    overlayDiv.style.display = 'flex';
    overlayDiv.style.justifyContent = 'center';
    overlayDiv.style.alignItems = 'center';
    overlayDiv.style.backdropFilter = 'blur(4px)';
    
    // イベント貫通防止
    overlayDiv.addEventListener('pointerdown', stopEvent);
    overlayDiv.addEventListener('touchstart', stopEvent);
    overlayDiv.addEventListener('click', stopEvent);
    window.addEventListener('keydown', stopEvent, { capture: true });
    
    const box = document.createElement('div');
    box.style.background = '#333';
    box.style.padding = '30px';
    box.style.borderRadius = '15px';
    box.style.textAlign = 'center';
    box.style.color = '#fff';
    box.style.fontFamily = 'sans-serif';
    box.style.boxShadow = '0 10px 30px rgba(0,0,0,0.5)';
    box.style.border = '3px solid #ffd166';
    box.style.animation = 'popIn 0.4s ease-out forwards';
    
    // アニメーション用スタイル定義
    if(!document.getElementById('ranking-styles')) {
        const style = document.createElement('style');
        style.id = 'ranking-styles';
        style.innerHTML = `
            @keyframes popIn { from { transform: scale(0.8); opacity: 0; } to { transform: scale(1); opacity: 1; } }
            .lb-tab-btn:hover { opacity: 0.8; }
        `;
        document.head.appendChild(style);
    }

    box.innerHTML = `
      <h2 style="margin-top:0; color:#ffd166; font-size:24px;">🏆 新記録達成！</h2>
      <p style="font-size:18px; margin-bottom:20px;">スコア: <strong style="font-size:24px; color:#4dd0e1;">${newScore}</strong> <br><span style="font-size:14px; color:#aaa;">(${DIFFICULTIES[diff].label}モード)</span></p>
      <input type="text" id="player-name-input" placeholder="あなたの名前" value="${savedName}" maxlength="15" style="padding:12px; font-size:18px; width:80%; max-width:250px; margin-bottom:20px; border-radius:8px; border:none; outline:none; text-align:center;">
      <br>
      <div style="display:flex; justify-content:center; gap:10px;">
          <button id="save-score-btn" style="padding:12px 24px; background:#4caf50; color:#fff; border:none; border-radius:8px; font-size:16px; cursor:pointer; font-weight:bold;">保存して登録</button>
          <button id="skip-score-btn" style="padding:12px 24px; background:#757575; color:#fff; border:none; border-radius:8px; font-size:16px; cursor:pointer; font-weight:bold;">スキップ</button>
      </div>
    `;
    
    overlayDiv.appendChild(box);
    document.body.appendChild(overlayDiv);
    
    const input = box.querySelector('#player-name-input');
    input.focus();
    
    const cleanup = () => {
        document.body.removeChild(overlayDiv);
        window.removeEventListener('keydown', stopEvent, { capture: true });
    };

    box.querySelector('#save-score-btn').addEventListener('click', async () => {
      const name = input.value.trim() || '名無し';
      localStorage.setItem('flappy-byte-player-name', name);
      box.innerHTML = `<div style="padding:20px;"><h3 style="color:#4caf50; margin:0;">🌐 登録中...</h3></div>`;
      currentLbDiff = diff;
      await window.LB.save(name, newScore, diff);
      cleanup();
      // 登録後にランキングを表示してあげる
      showLeaderboardModal();
    });
    
    box.querySelector('#skip-score-btn').addEventListener('click', cleanup);
  }

  let currentLbDiff = null;
  function showLeaderboardModal() {
    if (!currentLbDiff) currentLbDiff = difficulty;
    const lbMode = (window.LB && window.LB.mode) || 'local';
    const overlayDiv = document.createElement('div');
    overlayDiv.style.position = 'fixed';
    overlayDiv.style.top = '0';
    overlayDiv.style.left = '0';
    overlayDiv.style.width = '100%';
    overlayDiv.style.height = '100%';
    overlayDiv.style.backgroundColor = 'rgba(0, 0, 0, 0.85)';
    overlayDiv.style.zIndex = '1000000';
    overlayDiv.style.display = 'flex';
    overlayDiv.style.justifyContent = 'center';
    overlayDiv.style.alignItems = 'center';
    overlayDiv.style.backdropFilter = 'blur(4px)';
    
    // イベント貫通防止
    overlayDiv.addEventListener('pointerdown', stopEvent);
    overlayDiv.addEventListener('touchstart', stopEvent);
    overlayDiv.addEventListener('click', stopEvent);
    window.addEventListener('keydown', stopEvent, { capture: true });

    const box = document.createElement('div');
    box.style.background = '#222';
    box.style.padding = '20px';
    box.style.borderRadius = '15px';
    box.style.width = '90%';
    box.style.maxWidth = '420px';
    box.style.maxHeight = '85vh';
    box.style.color = '#fff';
    box.style.fontFamily = 'sans-serif';
    box.style.display = 'flex';
    box.style.flexDirection = 'column';
    box.style.border = '2px solid #555';
    box.style.animation = 'popIn 0.3s ease-out forwards';
    
    // タブの生成
    let tabsHtml = '';
    for (const key in DIFFICULTIES) {
        tabsHtml += `<button class="lb-tab-btn" data-diff="${key}" style="flex:1; padding:10px 2px; margin:0 2px; background:${key === currentLbDiff ? '#4caf50' : '#444'}; color:#fff; border:none; border-radius:5px; cursor:pointer; font-size:12px; font-weight:bold; transition: background 0.2s;">${DIFFICULTIES[key].label}</button>`;
    }

    box.innerHTML = `
      <h2 style="text-align:center; margin-top:0; color:#ffd166; font-size:22px; display:flex; justify-content:center; align-items:center; gap:8px;">
         <span style="font-size:28px;">🏆</span> ${lbMode === 'global' ? '世界ランキング' : 'ランキング'}
      </h2>
      <p style="text-align:center; margin:-6px 0 12px; font-size:12px; color:${lbMode === 'global' ? '#81c784' : '#e0a94b'};">
        ${lbMode === 'global' ? '🌐 世界中のプレイヤーと共通' : '📱 この端末に保存中（Firebase未設定）'}
      </p>
      <div style="display:flex; justify-content:space-between; margin-bottom:15px;">
        ${tabsHtml}
      </div>
      <div id="lb-content" style="flex:1; overflow-y:auto; background:#111; border-radius:8px; padding:10px; min-height:250px;">
        <div style="text-align:center; padding:20px; color:#aaa;">読み込み中...</div>
      </div>
      <button id="close-lb-btn" style="margin-top:15px; padding:12px; background:#e53935; color:#fff; border:none; border-radius:8px; font-size:16px; font-weight:bold; cursor:pointer;">閉じる</button>
    `;
    
    overlayDiv.appendChild(box);
    document.body.appendChild(overlayDiv);
    
    const contentDiv = box.querySelector('#lb-content');
    
    const loadData = async (diff) => {
        contentDiv.innerHTML = '<div style="text-align:center; padding:20px; color:#aaa;">読み込み中...</div>';
        const data = await window.LB.top(diff);
        if (data.length === 0) {
            contentDiv.innerHTML = '<div style="text-align:center; padding:20px; color:#aaa;">まだ記録がありません</div>';
            return;
        }
        
        let html = '<table style="width:100%; border-collapse:collapse; text-align:left;">';
        data.forEach((entry, idx) => {
            let rankColor = '#aaa';
            let rankText = String(idx + 1);
            if(idx === 0) { rankColor = '#ffd700'; rankText = '🥇'; } // 金
            else if(idx === 1) { rankColor = '#c0c0c0'; rankText = '🥈'; } // 銀
            else if(idx === 2) { rankColor = '#cd7f32'; rankText = '🥉'; } // 銅
            
            const myUid = window.LB && window.LB.getUid ? window.LB.getUid() : null;
            const isMe = myUid && entry.uid === myUid;
            const bg = isMe ? 'rgba(76, 175, 80, 0.25)' : 'transparent';
            
            html += `
              <tr style="border-bottom:1px solid #333; background:${bg};">
                <td style="padding:12px 5px; font-weight:bold; color:${rankColor}; width:30px; text-align:center; font-size: ${idx < 3 ? '18px' : '14px'};">${rankText}</td>
                <td style="padding:12px 5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:140px; font-size:15px; font-weight: ${isMe ? 'bold' : 'normal'}; color: ${isMe ? '#81c784' : '#fff'};">${escapeHtml(entry.name)}</td>
                <td style="padding:12px 5px; text-align:right; font-weight:bold; color:#4dd0e1; font-size:18px;">${entry.score}</td>
              </tr>
            `;
        });
        html += '</table>';
        contentDiv.innerHTML = html;
    };
    
    const escapeHtml = (str) => {
        return str.replace(/[&<>'"]/g, tag => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
        }[tag]));
    };

    // タブクリックイベント
    box.querySelectorAll('.lb-tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            box.querySelectorAll('.lb-tab-btn').forEach(b => b.style.background = '#444');
            e.target.style.background = '#4caf50';
            currentLbDiff = e.target.dataset.diff;
            loadData(currentLbDiff);
        });
    });
    
    const cleanup = () => {
        document.body.removeChild(overlayDiv);
        window.removeEventListener('keydown', stopEvent, { capture: true });
    };

    box.querySelector('#close-lb-btn').addEventListener('click', cleanup);
    
    // 初期データの読み込み
    loadData(currentLbDiff);
  }
  // ==========================================


  const CHARACTERS = {
    byte:  { name: 'バイト',   body: '#ffd166', stroke: '#c99a2e', beak: '#ff8c42', cheek: '#ffb3ba', glow: '255,209,102' },
    robin: { name: 'コマドリ', body: '#ff6b6b', stroke: '#c1440e', beak: '#ffb300', cheek: '#ffd1d1', glow: '255,107,107' },
    mint:  { name: 'ミント',   body: '#4dd0e1', stroke: '#00838f', beak: '#ffca28', cheek: '#b2ebf2', glow: '77,208,225'  },
    grape: { name: 'グレープ', body: '#ba68c8', stroke: '#6a1b9a', beak: '#ffd166', cheek: '#e1bee7', glow: '186,104,200' },
    leaf:  { name: 'リーフ',   body: '#81c784', stroke: '#2e7d32', beak: '#ff8c42', cheek: '#c8e6c9', glow: '129,199,132' },
    snow:  { name: 'スノウ',   body: '#eceff1', stroke: '#90a4ae', beak: '#ffb300', cheek: '#ffd1d1', glow: '236,239,241' },
  };

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

  // これまでにユーザーが残した自己ベストを全難易度ぶん一度だけゼロにリセットする。
  // フラグを立てておくことで、リセットは各ユーザーにつき一回だけ実行される。
  const BEST_RESET_FLAG = 'flappy-byte-best-reset-v1';
  if (!localStorage.getItem(BEST_RESET_FLAG)) {
    Object.keys(DIFFICULTIES).forEach(d => localStorage.removeItem(bestKey(d)));
    localStorage.setItem(BEST_RESET_FLAG, '1');
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
  let roadActive, roadRemaining, roadSpawnTimer, roadPhase, roadCooldown, roadHue;
  let autoCooldown = 0;

  let controlChaosMode, controlChaosTimer, controlChaosCooldown;

  const GRAVITY_WARN_LEAD = 2.0;
  const GRAVITY_CLEAR_AFTER = 1.0;
  const FLIP_TIME_SCALE = 0.75;

  const ROAD_GAP = 150;
  const ROAD_INTERVAL = 0.3;
  const ROAD_COUNT = 16;
  const ROAD_PHASE_STEP = 0.32;
  const ROAD_COOLDOWN_MIN = 15;
  const ROAD_COOLDOWN_MAX = 24;

  const AMBUSH_GROW_START_X = W * 0.95;
  const AMBUSH_GROW_END_X = W * 0.42;
  function ambushGrow(p) {
    const t = (AMBUSH_GROW_START_X - p.x) / (AMBUSH_GROW_START_X - AMBUSH_GROW_END_X);
    const c = Math.max(0, Math.min(1, t));
    return c * c;
  }

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

    roadActive = false;
    roadRemaining = 0;
    roadSpawnTimer = 0;
    roadPhase = Math.random() * Math.PI * 2;
    roadHue = 0;
    roadCooldown = Math.random() < 0.3 ? 2 + Math.random() * 3 : 10 + Math.random() * 5;

    controlChaosMode = false;
    controlChaosTimer = 0;
    controlChaosCooldown = 15;
    combo = 0;
    autoCooldown = 0;

    gravityBadge.classList.add('hidden');
    gravityBadge.classList.remove('warn', 'active');
    initClouds();
    scoreEl.textContent = '0';
    newBestLine.classList.add('hidden');
  }

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
        masterFilter = audioCtx.createBiquadFilter();
        masterFilter.type = 'lowpass';
        masterFilter.frequency.value = 3800;
        masterFilter.Q.value = 0.4;
        masterGain = audioCtx.createGain();
        masterGain.gain.value = 0.85;
        masterFilter.connect(masterGain).connect(audioCtx.destination);
        try {
          const convolver = audioCtx.createConvolver();
          convolver.buffer = buildReverbImpulse(audioCtx);
          reverbGain = audioCtx.createGain();
          reverbGain.gain.value = 0.18;
          masterGain.connect(convolver).connect(reverbGain).connect(audioCtx.destination);
        } catch (e) { }
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

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
    tone({ freq: 784, duration: 0.16, type: 'triangle', volume: 0.16 });
    tone({ freq: 1175, duration: 0.2, type: 'sine', volume: 0.11, delay: 0.05 });
    if (milestone) {
      tone({ freq: 1568, duration: 0.28, type: 'triangle', volume: 0.13, delay: 0.11 });
      tone({ freq: 2349, duration: 0.28, type: 'sine', volume: 0.06, delay: 0.11 });
    }
  }
  function playHit() {
    tone({ freq: 300, glideTo: 90, duration: 0.34, type: 'sine', volume: 0.22, attack: 0.004 });
    tone({ freq: 150, glideTo: 60, duration: 0.4, type: 'triangle', volume: 0.1, attack: 0.006 });
  }
  function playGravityWarn() {
    tone({ freq: 660, duration: 0.16, type: 'sine', volume: 0.12 });
    tone({ freq: 660, duration: 0.16, type: 'sine', volume: 0.12, delay: 0.2 });
  }
  function playGravityFlip(reversed) {
    tone({ freq: reversed ? 440 : 880, glideTo: reversed ? 880 : 440, duration: 0.4, type: 'sine', volume: 0.16, attack: 0.02 });
    tone({ freq: reversed ? 660 : 1320, glideTo: reversed ? 1320 : 660, duration: 0.4, type: 'triangle', volume: 0.06, attack: 0.02 });
  }
  function playBest() {
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
    const isSlideX = score >= 8 && Math.random() < cfg.slideChance;
    const isAmbush = !isSlideX && score >= 12 && Math.random() < cfg.ambushChance;
    const isShrink = !isSlideX && !isAmbush && score >= 6 && Math.random() < (cfg.shrinkChance || 0);
    const canMove = !isSlideX && !isAmbush && !isShrink && score >= cfg.movingPipeScore && Math.random() < cfg.movingChance;

    const moveAmp = canMove ? cfg.moveAmp * (0.6 + Math.random() * 0.6) : 0;
    const margin = 40 + moveAmp;

    const shrinkStart = gap + 95;
    const layoutGap = isShrink ? shrinkStart : gap;
    const span = Math.max(20, H - GROUND_H - margin * 2 - layoutGap);
    const isBlue = gravityDir === -1; 
    let baseGapY = margin + Math.random() * span + layoutGap / 2;

    pipes.push({
      x: W + PIPE_WIDTH,
      baseX: W + PIPE_WIDTH,
      gapY: baseGapY,
      baseGapY,
      gap: isShrink ? shrinkStart : gap,
      gapFinal: gap,
      shrinkStart,
      passed: false,
      moving: canMove,
      moveAmp,
      moveSpeed: canMove ? cfg.moveSpeed * (0.8 + Math.random() * 0.4) : 0,
      movePhase: Math.random() * Math.PI * 2,
      isSlideX,
      slideXPhase: Math.random() * Math.PI * 2,
      isAmbush,
      isShrink,
      isBlue,
    });
  }

  function spawnRoadPipe(isStart) {
    const gap = ROAD_GAP;
    const margin = 46;
    const span = Math.max(20, H - GROUND_H - margin * 2 - gap);
    roadPhase += ROAD_PHASE_STEP;
    const gapY = margin + gap / 2 + (0.5 + 0.5 * Math.sin(roadPhase)) * span;

    roadHue = (roadHue + 25) % 360;
    const fill = `hsl(${roadHue}, 85%, 60%)`;
    const stroke = `hsl(${roadHue}, 90%, 35%)`;
    const cap = `hsl(${roadHue}, 85%, 75%)`;

    pipes.push({
      x: W + PIPE_WIDTH,
      baseX: W + PIPE_WIDTH,
      gapY,
      baseGapY: gapY,
      gap,
      passed: false,
      moving: false,
      moveAmp: 0,
      moveSpeed: 0,
      movePhase: 0,
      isSlideX: false,
      slideXPhase: 0,
      isAmbush: false,
      isBlue: false,
      isRoad: true,
      isRoadStart: isStart, 
      roadSkin: { fill, stroke, cap },
    });
  }

  function flap() {
    if (state === 'ready') {
      startGame();
      return;
    }
    if (state === 'playing') {
      if (controlChaosMode) {
        gravityDir *= -1;
        bird.vy = 0;
        triggerFlash('186,104,200', 0.15);
        triggerShake(5, 0.1);
        playGravityFlip(gravityDir === -1);
        vibrate([10, 15]);
        return;
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

    // 自動操作モードのプレイは自己ベストにもランキングにも反映しない。
    const isNewBest = !isAutoPilot && score > best;
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
        
        // ★ 演出の後に名前入力モーダルを表示 (約1秒後)
        setTimeout(() => showNameInputModal(score, difficulty), 1200);
      }, 200);
    } else {
      newBestLine.classList.add('hidden');
    }
  }

  function randRange([a, b]) {
    return a + Math.random() * (b - a);
  }

  function updateGravityFlip(dt) {
    if (!cfg.gravityFlip) return; 
    if (controlChaosMode) return;
    if (roadActive) return; 

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

      const levelBonus = Math.min(2, Math.floor(score / 10) * 0.5);
      gravityPhaseTimer = gravityDir === -1 ? randRange(cfg.flipReversedDur) + levelBonus : randRange(cfg.flipNormalDur);

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

  function aiGapAt(p, tAhead) {
    let gapY = p.gapY;
    if (p.moving) {
      gapY = p.baseGapY + Math.sin((elapsed + tAhead) * p.moveSpeed + p.movePhase) * p.moveAmp;
    }
    const gap = p.isShrink ? p.gapFinal : p.gap;
    return { top: gapY - gap / 2, bot: gapY + gap / 2 };
  }

  function aiCorridor(p) {
    const tIn = Math.max(0, (p.x - bird.r - bird.x) / speed);
    const tOut = Math.max(0, (p.x + PIPE_WIDTH + bird.r - bird.x) / speed);
    const tB = Math.min(tOut, tIn + 0.18);
    const a = aiGapAt(p, tIn);
    const b = aiGapAt(p, tB);
    return {
      top: Math.max(a.top, b.top),
      bot: Math.min(a.bot, b.bot),
    };
  }

  function doAutoPilot(dt) {
    if (autoCooldown > 0) autoCooldown -= dt;

    if (state === 'ready' || state === 'gameover') {
      if (autoCooldown <= 0) {
        flap(); 
        autoCooldown = 0.25;
      }
      return;
    }

    if (state !== 'playing' || autoCooldown > 0) return;

    const doFlap = () => {
      flap();
      autoCooldown = 0.06;
    };

    let first = null, second = null;
    for (const p of pipes) {
      if (p.x + PIPE_WIDTH + bird.r > bird.x) {
        if (!first) { first = p; }
        else { second = p; break; }
      }
    }

    const MARGIN = 5;
    let corTop = bird.r + 6;
    let corBot = H - GROUND_H - bird.r - 6;
    if (first) {
      const c = aiCorridor(first);
      corTop = Math.max(corTop, c.top + bird.r + MARGIN);
      corBot = Math.min(corBot, c.bot - bird.r - MARGIN);
      if (second && second.x - first.x < 210) {
        const c2 = aiCorridor(second);
        corTop = Math.max(corTop, c2.top + bird.r + MARGIN);
        corBot = Math.min(corBot, c2.bot - bird.r - MARGIN);
      }
      if (corTop > corBot) { const mid = (corTop + corBot) / 2; corTop = mid; corBot = mid; }
    }

    const flapRise = (cfg.flap * cfg.flap) / (2 * cfg.gravity);
    const predict = (t) => bird.y + bird.vy * t + 0.5 * cfg.gravity * gravityDir * t * t;

    if (controlChaosMode) {
      const fy = predict(0.09);
      if (gravityDir === 1 && fy > corBot) doFlap();
      else if (gravityDir === -1 && fy < corTop) doFlap();
      return;
    }

    const soon = predict(0.05);
    const urgent = predict(0.016);
    if (gravityDir === 1) {
      const pierce = bird.y - flapRise < corTop - 6;
      if (soon > corBot && (!pierce || urgent > corBot)) doFlap();
    } else {
      const pierce = bird.y + flapRise > corBot + 6;
      if (soon < corTop && (!pierce || urgent < corTop)) doFlap();
    }
  }

  function update(dt) {
    if (isAutoPilot) doAutoPilot(dt);

    if (state !== 'playing') return;

    elapsed += dt;
    speed = cfg.baseSpeed + Math.min(140, elapsed * 6);
    groundOffset = (groundOffset + speed * dt) % 40;

    if (difficulty === 'gravity' && score >= 20) {
      if (!controlChaosMode) {
        controlChaosCooldown -= dt;
        if (controlChaosCooldown <= 0) {
          controlChaosMode = true;
          controlChaosTimer = 10; 
          gravityBadge.textContent = '⚠ 警告: タップで重力反転';
          gravityBadge.classList.remove('hidden', 'active');
          gravityBadge.classList.add('warn');
          playGravityWarn();
        }
      } else {
        controlChaosTimer -= dt;
        if (controlChaosTimer <= 0) {
          controlChaosMode = false;
          controlChaosCooldown = 20 + Math.random() * 10; 
          gravityBadge.classList.add('hidden');
          gravityBadge.classList.remove('warn');
          spawnFloater(W / 2, H / 2 - 40, "SYSTEM RESTORED", "#4caf50", 1.5);
          beep({ freq: 800, glideTo: 1200, duration: 0.2, type: 'square', volume: 0.1 });
          
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

    bird.vy += cfg.gravity * gravityDir * dt;
    bird.y += bird.vy * dt;
    bird.rot = Math.max(-0.5, Math.min(1.2, (bird.vy / 600) * gravityDir));

    if (noSpawnTimer > 0) noSpawnTimer = Math.max(0, noSpawnTimer - dt);

    if (roadActive) {
      roadSpawnTimer -= dt;
      if (roadSpawnTimer <= 0 && roadRemaining > 0) {
        spawnRoadPipe(roadRemaining === ROAD_COUNT);
        roadRemaining--;
        roadSpawnTimer = ROAD_INTERVAL;
        if (roadRemaining <= 0) {
          roadActive = false;
          roadCooldown = ROAD_COOLDOWN_MIN + Math.random() * (ROAD_COOLDOWN_MAX - ROAD_COOLDOWN_MIN);
          spawnTimer = PIPE_INTERVAL * 1.2; 
        }
      }
    } else {
      if (cfg.road && score >= 1 && gravityDir === 1 && !gravityWarn && noSpawnTimer <= 0) {
        roadCooldown -= dt;
      }

      spawnTimer -= dt;
      if (spawnTimer <= 0 && noSpawnTimer <= 0 && !roadActive) {
        if (cfg.road && roadCooldown <= 0 && gravityDir === 1 && !gravityWarn) {
          roadActive = true;
          roadRemaining = ROAD_COUNT;
          
          roadHue = Math.random() * 360; 
          spawnFloater(W / 2, H / 2 - 60, '🌈 ロード!', '#ffca28', 1.5);
          beep({ freq: 660, glideTo: 990, duration: 0.18, type: 'triangle', volume: 0.12 });

          spawnRoadPipe(true); 
          roadRemaining--;
          roadSpawnTimer = ROAD_INTERVAL;
        } else {
          spawnPipe();
          spawnTimer = PIPE_INTERVAL;
        }
      }
    }

    for (const p of pipes) {
      if (p.moving) {
        p.gapY = p.baseGapY + Math.sin(elapsed * p.moveSpeed + p.movePhase) * p.moveAmp;
      }

      if (p.isShrink) {
        const t = Math.max(0, Math.min(1, (W - p.x) / (W - W * 0.3)));
        p.gap = p.shrinkStart + (p.gapFinal - p.shrinkStart) * t;
      }

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

    for (const p of pipes) {
      const inX = bird.x + bird.r > p.x && bird.x - bird.r < p.x + PIPE_WIDTH;
      if (inX) {
        let topH = p.gapY - p.gap / 2;
        let botY = p.gapY + p.gap / 2;
        
        if (p.isAmbush || (p.isRoad && !p.isRoadStart)) {
          const e = ambushGrow(p);
          topH = (p.gapY - p.gap / 2) * e;
          botY = (H - GROUND_H) - ((H - GROUND_H) - (p.gapY + p.gap / 2)) * e;
        }
        
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
      const renderX = p.x;

      let topH = p.gapY - p.gap / 2;
      let botY = p.gapY + p.gap / 2;
      
      if (p.isAmbush || (p.isRoad && !p.isRoadStart)) {
        const e = ambushGrow(p);
        topH = (p.gapY - p.gap / 2) * e;
        botY = (H - GROUND_H) - ((H - GROUND_H) - (p.gapY + p.gap / 2)) * e;
      }

      if (p.isRoad) {
        ctx.fillStyle = p.roadSkin.fill;
        ctx.strokeStyle = p.roadSkin.stroke;
      } else if (p.isShrink) {
        ctx.fillStyle = '#ef5350';
        ctx.strokeStyle = '#c62828';
      } else if (p.isAmbush) {
        ctx.fillStyle = '#ffb300';
        ctx.strokeStyle = '#ff8f00';
      } else if (p.isSlideX) {
        ctx.fillStyle = '#ab47bc';
        ctx.strokeStyle = '#7b1fa2';
      } else if (p.isBlue) {
        ctx.fillStyle = '#00e5ff';
        ctx.strokeStyle = '#00b8d4';
      } else {
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

      if (p.isRoad) {
        ctx.fillStyle = p.roadSkin.cap;
      } else if (p.isShrink) {
        ctx.fillStyle = '#e57373';
      } else if (p.isAmbush) {
        ctx.fillStyle = '#ffca28';
      } else if (p.isSlideX) {
        ctx.fillStyle = '#ce93d8';
      } else if (p.isBlue) {
        ctx.fillStyle = '#84ffff';
      } else {
        ctx.fillStyle = p.moving ? pipeSkin.mCap : pipeSkin.cap;
      }

      if (topHeight > 0.5) {
        ctx.fillRect(renderX - 4, topH - 20, PIPE_WIDTH + 8, 20);
        ctx.strokeRect(renderX - 4, topH - 20, PIPE_WIDTH + 8, 20);
      }
      if (bottomHeight > 0.5) {
        ctx.fillRect(renderX - 4, botY, PIPE_WIDTH + 8, 20);
        ctx.strokeRect(renderX - 4, botY, PIPE_WIDTH + 8, 20);
      }
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
      const ease = 1 - Math.pow(1 - t, 3);
      const r = s.maxR * ease;
      const a = Math.max(0, 1 - t);
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 4 * (1 - t) + 1;
      ctx.globalAlpha = a * 0.7;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.stroke();
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
    ctx.globalCompositeOperation = 'lighter';
    const n = trail.length;
    for (let i = 0; i < n; i++) {
      const t = trail[i];
      const life = Math.max(0, t.life / t.maxLife);
      const grow = (i / n);
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
      
      ctx.font = `bold ${Math.round(22 * (f.scale || 1) * growth)}px sans-serif`;
      ctx.globalAlpha = a;
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = 'left';
  }

  function paintBird(c, r) {
    ctx.fillStyle = c.body;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = c.stroke;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = c.cheek;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.arc(-r * 0.15, r * 0.28, r * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(r * 0.36, -r * 0.28, r * 0.32, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3a2b00';
    ctx.beginPath();
    ctx.arc(r * 0.46, -r * 0.28, r * 0.14, 0, Math.PI * 2);
    ctx.fill();
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

  function flipTimeScale() {
    if (state !== 'playing') return 1;
    const inFlipWindow =
      (gravityArmed && !controlChaosMode && gravityPhaseTimer > 0 && gravityPhaseTimer <= GRAVITY_WARN_LEAD) ||
      (noSpawnTimer > 0);
    return inFlipWindow ? FLIP_TIME_SCALE : 1;
  }

  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.033, (now - last) / 1000) * flipTimeScale();
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