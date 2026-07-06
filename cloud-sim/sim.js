/* 入道雲シミュレータ — 対流と積乱雲のライフサイクルを簡易気象物理で再現する */
(() => {
  "use strict";

  const canvas = document.getElementById("sky");
  const ctx = canvas.getContext("2d");
  const profCanvas = document.getElementById("profile");
  const profCtx = profCanvas.getContext("2d");

  // ---------- 定数 ----------
  const DRY_LAPSE = 9.8;   // 乾燥断熱減率 [°C/km]
  const TROPOPAUSE = 12;   // 圏界面 [km]
  const MAX_ALT = 14;      // 表示する高さ [km]
  const DAY_START = 6, DAY_END = 19; // 日の出・日の入り [時]

  const GROUND_FACTOR = { sea: 0.35, grass: 1.0, forest: 0.7, city: 1.35 };

  // ---------- 入力状態 ----------
  const env = {
    airTemp: 32,   // 地上気温 [°C]
    humidity: 70,  // 湿度 [%]
    lapse: 7.5,    // 環境減率 [°C/km]
    wind: 3,       // 風 [m/s]
    ground: "grass",
    minutesPerSec: 5,
  };

  // ---------- シミュレーション状態 ----------
  const sim = {
    timeMin: 8 * 60,      // シミュレーション内時刻 [分]
    paused: false,
    cloudTop: 0,          // 雲頂 [km] (0 = 雲なし)
    cloudBase: 1.0,       // 雲底 [km]
    anvil: 0,             // かなとこ雲の広がり [0..1+]
    maturity: 0,          // 深い対流が続いた時間 [シミュレーション時間(h)]
    rain: 0,              // 降水強度 [0..1]
    coldPool: 0,          // 雨による地上の冷え [°C]
    groundHeat: 0,        // 地面の温まり具合 (ゆっくり変化する)
    hotspotX: 0.5,        // 上昇気流の中心 (画面幅比)
    heatPulse: 0,         // クリックによる加熱ブースト
    cx: 0.5,              // 雲の中心 (画面幅比)
    flash: 0,             // 雷の画面フラッシュ
    // 直近の診断値
    lcl: 1.0, el: 0, cape: 0, sun: 0, heating: 0, stage: "快晴",
  };

  let puffs = [];    // 雲を構成するもくもく
  let thermals = []; // 上昇気流の泡
  let drops = [];    // 雨粒
  let bolts = [];    // 稲妻

  let W = 0, H = 0, groundY = 0, kmPx = 0;

  // ---------- ユーティリティ ----------
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const yOf = altKm => groundY - altKm * kmPx;

  function resize() {
    const r = canvas.getBoundingClientRect();
    W = canvas.width = Math.round(r.width * devicePixelRatio);
    H = canvas.height = Math.round(r.height * devicePixelRatio);
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    W = r.width; H = r.height;
    groundY = H * 0.9;
    kmPx = (groundY - H * 0.04) / MAX_ALT;
  }
  window.addEventListener("resize", resize);

  // ---------- 気象物理 ----------
  // 持ち上げた空気塊とまわりの空気の温度を比べ、凝結高度・浮力エネルギー・到達高度を求める
  function computeProfile(dtH) {
    const dayFrac = clamp((sim.timeMin / 60 - DAY_START) / (DAY_END - DAY_START), 0, 1);
    sim.sun = Math.sin(Math.PI * dayFrac) * (dayFrac > 0 && dayFrac < 1 ? 1 : 0);

    // 地面はゆっくり温まる(熱的慣性)ため、加熱のピークは正午より数時間おくれる
    const gf = GROUND_FACTOR[env.ground];
    sim.groundHeat += (sim.sun * gf - sim.groundHeat) * clamp(dtH / 2.2, 0, 1);
    sim.heating = sim.groundHeat;

    // 地表の空気塊: 日射で加熱、クリックでブースト、雨の冷気で減
    const tParcel = env.airTemp + sim.heating * 5 + sim.heatPulse * 2.5 - sim.coldPool;
    const tEnv0 = env.airTemp;

    // 露点と持ち上げ凝結高度 (LCL)
    const dew = tParcel - (100 - env.humidity) / 5;
    sim.lcl = clamp(0.125 * Math.max(0.5, tParcel - dew), 0.3, 5);

    // 100mごとに持ち上げて浮力を積算
    let cape = 0, el = 0;
    for (let a = 0.1; a <= 15; a += 0.1) {
      const tp = parcelTempAt(a, tParcel);
      const te = envTempAt(a);
      const buoy = tp - te;
      if (a <= sim.lcl) {
        if (buoy < -2) break; // 地表近くで強く抑えられていたら対流は起きない
        continue;
      }
      if (buoy > 0) { cape += buoy * 0.1; el = a; }
      else if (buoy < -0.6) break; // 浮力を失った高さが到達高度
    }
    sim.cape = cape;
    sim.el = Math.min(el, 13);
  }

  function envTempAt(a) {
    return env.airTemp - env.lapse * Math.min(a, TROPOPAUSE);
  }

  // 湿潤断熱減率は上空ほど大きくなる(水蒸気が減るため)近似: 5.2 + 0.38a [°C/km]
  function parcelTempAt(a, tParcel) {
    if (a < sim.lcl) return tParcel - DRY_LAPSE * a;
    const tLcl = tParcel - DRY_LAPSE * sim.lcl;
    return tLcl - (5.2 * (a - sim.lcl) + 0.19 * (a * a - sim.lcl * sim.lcl));
  }

  // ---------- 更新 ----------
  function update(dt) {
    if (sim.paused) return;

    sim.timeMin = (sim.timeMin + dt * env.minutesPerSec) % (24 * 60);
    const dtH = dt * env.minutesPerSec / 60; // シミュレーション内の経過時間 [h]

    sim.heatPulse *= Math.exp(-dt / 20);
    computeProfile(dtH);

    // 雲がどこまで育とうとするか(浮力を失う高さまで)
    let target = 0;
    if (sim.heating > 0.12 && sim.cape > 0.3) target = sim.el;
    else if (sim.heating > 0.3 && env.humidity > 65) target = sim.lcl + 0.4; // 湿った日の浅い積雲

    // 発達は不安定エネルギーが大きいほど速く(数十分スケール)、衰退はゆっくり
    const growRate = target > sim.cloudTop ? 1.2 + sim.cape * 0.05 : 0.9; // [1/シミュレーション時間h]
    sim.cloudTop += (target - sim.cloudTop) * clamp(growRate * dtH, 0, 1);
    if (sim.cloudTop < 0.05) sim.cloudTop = 0;
    sim.cloudBase = lerp(sim.cloudBase, sim.lcl, clamp(dtH * 2, 0, 1));

    // 成熟・降水・冷気プール
    const deep = sim.cloudTop > 6.5;
    sim.maturity = deep ? sim.maturity + dtH : Math.max(0, sim.maturity - dtH * 2);
    const rainTarget = deep ? clamp((sim.cloudTop - 7) / 4, 0, 1) * clamp(sim.maturity / 0.6, 0, 1) : 0;
    sim.rain = lerp(sim.rain, rainTarget, clamp(dtH * 6, 0, 1));
    sim.coldPool = clamp(sim.coldPool + sim.rain * dtH * 9 - sim.coldPool * dtH * 0.8, 0, 7);

    // かなとこ雲: 圏界面近くまで達すると横に広がる
    const hitCeil = sim.cloudTop > 8 && sim.cloudTop > sim.el - 1.5;
    sim.anvil = clamp(sim.anvil + (hitCeil ? dtH * 1.2 : -dtH * 0.6), 0, 1.4);

    // ステージ判定
    if (sim.sun <= 0) sim.stage = sim.cloudTop > 0.3 ? "夜 — 雲は静かに消えていく" : "夜";
    else if (sim.cloudTop < 0.3) sim.stage = "快晴 — 地面があたたまるのを待とう";
    else if (sim.rain > 0.25) sim.stage = "積乱雲・成熟期 ⚡ 雷雨!";
    else if (sim.cloudTop > 7 && target < sim.cloudTop - 1) sim.stage = "積乱雲・衰退期";
    else if (sim.cloudTop > 7) sim.stage = "積乱雲・発達期(入道雲)";
    else if (sim.cloudTop - sim.cloudBase > 1.3) sim.stage = "雄大積雲 — ぐんぐん成長中";
    else sim.stage = "積雲(わた雲)";

    // 雲の中心はクリック地点へゆっくり寄り、風で流される
    sim.cx += (sim.hotspotX - sim.cx) * clamp(dt * 0.15, 0, 1);
    sim.cx = clamp(sim.cx + env.wind * dt * 0.0018, 0.18, 0.82);
    sim.hotspotX = clamp(sim.hotspotX + env.wind * dt * 0.0018, 0.18, 0.82);

    updateThermals(dt);
    updatePuffs(dt);
    updateRain(dt);
    updateBolts(dt);
  }

  // ---------- 上昇気流の泡 ----------
  function updateThermals(dt) {
    const rate = sim.heating * (1 + sim.heatPulse) * 6; // 個/秒
    if (Math.random() < rate * dt && thermals.length < 40) {
      thermals.push({
        x: sim.hotspotX * W + rand(-90, 90),
        a: 0.02,
        r: rand(12, 26),
        wob: Math.random() * 6.28,
      });
    }
    const ceil = Math.max(sim.lcl, 0.5);
    for (let i = thermals.length - 1; i >= 0; i--) {
      const t = thermals[i];
      t.a += dt * 0.45;                       // 上昇 [km/s 相当(演出速度)]
      t.wob += dt * 3;
      t.x += Math.sin(t.wob) * 12 * dt + env.wind * 1.5 * dt;
      if (t.a >= ceil) thermals.splice(i, 1);
    }
  }

  // ---------- 雲のもくもく ----------
  function cloudHalfWidth(altKm) {
    const base = sim.cloudBase, top = Math.max(sim.cloudTop, base + 0.01);
    const depth = top - base;
    const rel = clamp((altKm - base) / depth, 0, 1);
    let w = kmPx * (1.3 + depth * 0.28) * (1 - 0.45 * rel);
    // かなとこ雲: 上端が横に大きく広がる
    if (sim.anvil > 0.05 && altKm > top - 2.2) {
      const arel = clamp((altKm - (top - 2.2)) / 2.2, 0, 1);
      w += sim.anvil * arel * kmPx * 4.5;
    }
    return w;
  }

  function updatePuffs(dt) {
    const depth = sim.cloudTop - sim.cloudBase;
    const targetCount = sim.cloudTop <= 0 ? 0
      : Math.min(480, Math.round(30 + depth * 60 * (1 + sim.anvil * 0.6)));

    while (puffs.length < targetCount) {
      // 35%は雲頂近くに集中させ、わき立つ「頭」を表現する
      const a = sim.cloudBase + Math.max(0, depth) *
        (Math.random() < 0.35 ? 0.72 + 0.28 * Math.random() : Math.random());
      const hw = cloudHalfWidth(a);
      puffs.push({
        a,
        x: sim.cx * W + rand(-1, 1) * hw,
        r: rand(0.3, 0.55) * kmPx * (1 + Math.max(depth, 0) * 0.05),
        life: 0,
        ttl: rand(5, 11),
        rise: rand(0.02, 0.09),
        seed: Math.random() * 6.28,
      });
    }
    for (let i = puffs.length - 1; i >= 0; i--) {
      const p = puffs[i];
      p.life += dt;
      p.a += p.rise * dt * (sim.cloudTop > sim.cloudBase + 0.3 ? 1 : 0);
      p.x += env.wind * dt * (0.8 + (p.a - sim.cloudBase) * 0.25);
      p.x += Math.sin(p.seed + p.life * 0.7) * 4 * dt;
      const outside = p.a > sim.cloudTop + 0.6 || p.a < sim.cloudBase - 0.5;
      if (p.life > p.ttl || outside || puffs.length > targetCount + 40) puffs.splice(i, 1);
    }
  }

  // ---------- 雨 ----------
  function updateRain(dt) {
    if (sim.rain > 0.05) {
      const n = Math.round(sim.rain * 260 * dt);
      const hw = cloudHalfWidth(sim.cloudBase + 0.2) * 0.85;
      for (let i = 0; i < n && drops.length < 420; i++) {
        drops.push({ x: sim.cx * W + rand(-1, 1) * hw, y: yOf(sim.cloudBase) + rand(0, 30) });
      }
    }
    const vy = 560, vx = env.wind * 14;
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      d.y += vy * dt; d.x += vx * dt;
      if (d.y > groundY) drops.splice(i, 1);
    }
    // 雷
    if (sim.rain > 0.4 && Math.random() < dt * (0.25 + sim.rain * 0.5)) spawnBolt();
    sim.flash = Math.max(0, sim.flash - dt * 2.5);
  }

  function spawnBolt() {
    const x0 = sim.cx * W + rand(-1, 1) * cloudHalfWidth(sim.cloudBase + 1) * 0.5;
    const y0 = yOf(rand(sim.cloudBase + 0.5, Math.min(sim.cloudTop - 1, 6)));
    const pts = [[x0, y0]];
    let x = x0, y = y0;
    while (y < groundY) {
      y += rand(20, 55);
      x += rand(-38, 38);
      pts.push([x, Math.min(y, groundY)]);
    }
    bolts.push({ pts, life: 0.35 });
    sim.flash = 0.55;
  }

  function updateBolts(dt) {
    for (let i = bolts.length - 1; i >= 0; i--) {
      bolts[i].life -= dt;
      if (bolts[i].life <= 0) bolts.splice(i, 1);
    }
  }

  // ---------- 空の色 ----------
  // 時刻ごとの [上端色, 下端色]
  const SKY_KEYS = [
    [0,   [8, 12, 30],    [18, 24, 48]],
    [4.5, [8, 12, 30],    [18, 24, 48]],
    [6,   [70, 90, 150],  [255, 170, 110]],
    [8,   [90, 150, 220], [190, 220, 245]],
    [12,  [70, 140, 230], [175, 215, 245]],
    [16,  [80, 140, 220], [200, 215, 235]],
    [18,  [90, 100, 170], [255, 160, 90]],
    [19.5,[25, 28, 60],   [90, 60, 90]],
    [21,  [8, 12, 30],    [18, 24, 48]],
    [24,  [8, 12, 30],    [18, 24, 48]],
  ];

  function skyColors() {
    const h = sim.timeMin / 60;
    let i = 0;
    while (i < SKY_KEYS.length - 2 && SKY_KEYS[i + 1][0] < h) i++;
    const [h0, t0, b0] = SKY_KEYS[i], [h1, t1, b1] = SKY_KEYS[i + 1];
    const t = clamp((h - h0) / (h1 - h0 || 1), 0, 1);
    const mix = (c0, c1) => c0.map((v, k) => Math.round(lerp(v, c1[k], t)));
    let top = mix(t0, t1), bot = mix(b0, b1);
    // 雷雨のときは暗くする
    const dark = sim.rain * 0.45;
    top = top.map(v => Math.round(v * (1 - dark)));
    bot = bot.map(v => Math.round(v * (1 - dark)));
    return [top, bot];
  }

  // 夕方は雲がオレンジに染まる
  function cloudTint() {
    const h = sim.timeMin / 60;
    if (h > 16.5 && h < 19.5) {
      const t = 1 - Math.abs(h - 18) / 1.5;
      return [255, Math.round(lerp(255, 190, t)), Math.round(lerp(255, 150, t))];
    }
    if (h < 7.5 && h > 5.5) {
      const t = 1 - Math.abs(h - 6.5) / 1;
      return [255, Math.round(lerp(255, 205, t)), Math.round(lerp(255, 175, t))];
    }
    return [255, 255, 255];
  }

  // ---------- 描画 ----------
  function render() {
    const [top, bot] = skyColors();
    const g = ctx.createLinearGradient(0, 0, 0, groundY);
    g.addColorStop(0, `rgb(${top})`);
    g.addColorStop(1, `rgb(${bot})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    drawSun();
    drawAltitudeGuides();
    drawThermals();
    drawCloud();
    drawRain();
    drawBoltsAndFlash();
    drawGround();
    drawProfileChart();
  }

  function drawSun() {
    const dayFrac = clamp((sim.timeMin / 60 - DAY_START) / (DAY_END - DAY_START), 0, 1);
    if (sim.sun <= 0) { drawStars(); return; }
    const sx = W * (0.12 + 0.76 * dayFrac);
    const sy = groundY - Math.sin(Math.PI * dayFrac) * (groundY - H * 0.12);
    const r = 26;
    const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 5);
    glow.addColorStop(0, "rgba(255,235,170,0.9)");
    glow.addColorStop(0.25, "rgba(255,220,130,0.35)");
    glow.addColorStop(1, "rgba(255,220,130,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(sx - r * 5, sy - r * 5, r * 10, r * 10);
    ctx.fillStyle = "#fff3c4";
    ctx.beginPath(); ctx.arc(sx, sy, r, 0, 6.29); ctx.fill();
  }

  let starSeed = null;
  function drawStars() {
    if (!starSeed) starSeed = Array.from({ length: 90 }, () => [Math.random(), Math.random() * 0.7, Math.random()]);
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    for (const [fx, fy, s] of starSeed) {
      ctx.globalAlpha = 0.3 + 0.6 * s;
      ctx.fillRect(fx * W, fy * groundY, s > 0.8 ? 2 : 1, s > 0.8 ? 2 : 1);
    }
    ctx.globalAlpha = 1;
  }

  function drawAltitudeGuides() {
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.font = "10px sans-serif";
    ctx.setLineDash([3, 7]);
    for (let a = 2; a <= 12; a += 2) {
      const y = yOf(a);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      ctx.fillText(`${a}km`, 6, y - 4);
    }
    ctx.setLineDash([]);
    // 凝結高度ライン
    if (sim.heating > 0.1) {
      ctx.strokeStyle = "rgba(150,210,255,0.30)";
      ctx.setLineDash([8, 6]);
      const y = yOf(sim.lcl);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(170,220,255,0.6)";
      ctx.fillText("凝結高度(ここから上で雲ができる)", W - 215, y - 5);
    }
  }

  function drawThermals() {
    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.lineWidth = 1.5;
    for (const t of thermals) {
      const y = yOf(t.a);
      ctx.globalAlpha = clamp(1 - t.a / Math.max(sim.lcl, 0.6), 0.1, 0.5);
      ctx.beginPath();
      ctx.ellipse(t.x, y, t.r, t.r * 0.55, 0, 0, 6.29);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawCloud() {
    if (!puffs.length) return;
    const tint = cloudTint();
    const sorted = puffs.slice().sort((p, q) => p.a - q.a); // 低い雲から描く
    for (const p of sorted) {
      const y = yOf(p.a);
      const rel = clamp((p.a - sim.cloudBase) / Math.max(sim.cloudTop - sim.cloudBase, 0.1), 0, 1);
      // 下ほど影、雨が近いと暗い鉛色に
      const gloom = clamp(sim.rain * 1.6 + clamp((sim.cloudTop - 6) / 6, 0, 0.35), 0, 1);
      const shade = lerp(lerp(0.86, 1, rel), lerp(0.45, 0.95, rel), gloom);
      const cr = Math.round(tint[0] * shade), cg = Math.round(tint[1] * shade), cb = Math.round(tint[2] * shade * 1.03);
      const fade = Math.min(p.life / 1.2, (p.ttl - p.life) / 1.5, 1);
      const grad = ctx.createRadialGradient(p.x, y, 0, p.x, y, p.r);
      grad.addColorStop(0, `rgba(${cr},${cg},${cb},${0.8 * fade})`);
      grad.addColorStop(0.55, `rgba(${cr},${cg},${cb},${0.45 * fade})`);
      grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(p.x, y, p.r, 0, 6.29); ctx.fill();
    }
  }

  function drawRain() {
    if (!drops.length) return;
    ctx.strokeStyle = `rgba(160,190,230,${0.25 + sim.rain * 0.3})`;
    ctx.lineWidth = 1;
    const slant = env.wind * 0.35;
    ctx.beginPath();
    for (const d of drops) {
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x - slant, d.y - 18);
    }
    ctx.stroke();
  }

  function drawBoltsAndFlash() {
    for (const b of bolts) {
      const a = clamp(b.life / 0.35, 0, 1);
      ctx.strokeStyle = `rgba(255,255,230,${a})`;
      ctx.lineWidth = 2.5;
      ctx.shadowColor = "rgba(180,200,255,0.9)";
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.moveTo(b.pts[0][0], b.pts[0][1]);
      for (const [x, y] of b.pts) ctx.lineTo(x, y);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    if (sim.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${sim.flash * 0.35})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  function drawGround() {
    const night = sim.sun <= 0 ? 0.45 : 1;
    const shade = (1 - sim.rain * 0.35) * night;
    const col = (r, g2, b) => `rgb(${Math.round(r * shade)},${Math.round(g2 * shade)},${Math.round(b * shade)})`;
    const gh = H - groundY;

    if (env.ground === "sea") {
      const g = ctx.createLinearGradient(0, groundY, 0, H);
      g.addColorStop(0, col(40, 90, 140));
      g.addColorStop(1, col(20, 50, 90));
      ctx.fillStyle = g;
      ctx.fillRect(0, groundY, W, gh);
      ctx.strokeStyle = `rgba(255,255,255,${0.18 * night})`;
      for (let i = 0; i < 14; i++) {
        const y = groundY + 6 + Math.random() * (gh - 10);
        const x = Math.random() * W;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + rand(20, 60), y); ctx.stroke();
      }
    } else if (env.ground === "grass") {
      ctx.fillStyle = col(96, 150, 70);
      ctx.fillRect(0, groundY, W, gh);
      ctx.fillStyle = col(80, 130, 58);
      for (let x = 0; x < W; x += 90) {
        ctx.beginPath();
        ctx.ellipse(x + 45, groundY + 4, 60, 7, 0, 0, 6.29);
        ctx.fill();
      }
    } else if (env.ground === "forest") {
      ctx.fillStyle = col(46, 90, 55);
      ctx.fillRect(0, groundY, W, gh);
      ctx.fillStyle = col(32, 72, 44);
      for (let x = 0; x < W; x += 26) {
        const h2 = 14 + ((x * 7919) % 13);
        ctx.beginPath();
        ctx.moveTo(x, groundY + 2);
        ctx.lineTo(x + 13, groundY - h2);
        ctx.lineTo(x + 26, groundY + 2);
        ctx.fill();
      }
    } else { // city
      ctx.fillStyle = col(90, 92, 100);
      ctx.fillRect(0, groundY, W, gh);
      for (let x = 0; x < W; x += 46) {
        const bh = 18 + ((x * 2654435761) % 34);
        ctx.fillStyle = col(60 + (x % 3) * 8, 62 + (x % 3) * 8, 74);
        ctx.fillRect(x + 4, groundY - bh, 34, bh);
        if (sim.sun <= 0.05) {
          ctx.fillStyle = "rgba(255,220,130,0.8)";
          for (let wy = groundY - bh + 4; wy < groundY - 4; wy += 8)
            for (let wx = x + 8; wx < x + 34; wx += 9)
              if ((wx * wy) % 7 < 3) ctx.fillRect(wx, wy, 3, 4);
        }
      }
    }

    // クリック加熱スポットの表示
    if (sim.heatPulse > 0.05) {
      const hx = sim.hotspotX * W;
      const g = ctx.createRadialGradient(hx, groundY, 0, hx, groundY, 90);
      g.addColorStop(0, `rgba(255,120,50,${sim.heatPulse * 0.4})`);
      g.addColorStop(1, "rgba(255,120,50,0)");
      ctx.fillStyle = g;
      ctx.fillRect(hx - 90, groundY - 90, 180, 90);
    }
  }

  // ---------- 温度プロファイル図 ----------
  function drawProfileChart() {
    const pw = profCanvas.width, ph = profCanvas.height;
    profCtx.clearRect(0, 0, pw, ph);
    profCtx.fillStyle = "#0d1524";
    profCtx.fillRect(0, 0, pw, ph);

    const tMin = -75, tMax = 45;
    const px = t => ((t - tMin) / (tMax - tMin)) * (pw - 34) + 30;
    const py = a => ph - 16 - (a / MAX_ALT) * (ph - 26);

    profCtx.strokeStyle = "rgba(255,255,255,0.12)";
    profCtx.fillStyle = "rgba(255,255,255,0.4)";
    profCtx.font = "9px sans-serif";
    for (let a = 0; a <= 12; a += 4) {
      profCtx.beginPath(); profCtx.moveTo(28, py(a)); profCtx.lineTo(pw - 4, py(a)); profCtx.stroke();
      profCtx.fillText(`${a}km`, 3, py(a) + 3);
    }
    for (let t = -60; t <= 40; t += 20) profCtx.fillText(`${t}°`, px(t) - 7, ph - 4);

    const tParcel = env.airTemp + sim.heating * 5 + sim.heatPulse * 2.5 - sim.coldPool;
    // まわりの空気
    profCtx.strokeStyle = "#7dd3fc";
    profCtx.lineWidth = 1.8;
    profCtx.beginPath();
    for (let a = 0; a <= MAX_ALT; a += 0.25) {
      const te = envTempAt(a);
      a === 0 ? profCtx.moveTo(px(te), py(a)) : profCtx.lineTo(px(te), py(a));
    }
    profCtx.stroke();
    // 上昇する空気塊
    profCtx.strokeStyle = "#fb923c";
    profCtx.beginPath();
    for (let a = 0; a <= MAX_ALT; a += 0.25) {
      const tp = parcelTempAt(a, tParcel);
      a === 0 ? profCtx.moveTo(px(tp), py(a)) : profCtx.lineTo(px(tp), py(a));
    }
    profCtx.stroke();
    // LCL / 雲頂
    profCtx.strokeStyle = "rgba(170,220,255,0.5)";
    profCtx.setLineDash([4, 4]);
    profCtx.beginPath(); profCtx.moveTo(28, py(sim.lcl)); profCtx.lineTo(pw - 4, py(sim.lcl)); profCtx.stroke();
    profCtx.setLineDash([]);
    if (sim.cloudTop > 0.3) {
      profCtx.fillStyle = "rgba(255,255,255,0.75)";
      profCtx.fillText("☁ 雲頂", pw - 44, py(sim.cloudTop) - 2);
    }
  }

  // ---------- HUD ----------
  const el = id => document.getElementById(id);
  function updateHud() {
    const hh = Math.floor(sim.timeMin / 60), mm = Math.floor(sim.timeMin % 60);
    el("hud-time").textContent = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
    el("hud-stage").textContent = sim.stage;
    el("hud-top").textContent = sim.cloudTop > 0.3 ? `${sim.cloudTop.toFixed(1)} km` : "—";
    el("hud-base").textContent = sim.heating > 0.1 ? `${sim.lcl.toFixed(1)} km` : "—";
    el("cape-fill").style.width = `${clamp(sim.cape / 30 * 100, 0, 100)}%`;
  }

  // ---------- 入力 ----------
  function bindRange(id, key, fmt, valEl) {
    const s = el(id);
    const show = () => { el(valEl).textContent = fmt(parseFloat(s.value)); };
    s.addEventListener("input", () => { env[key] = parseFloat(s.value); show(); });
    env[key] = parseFloat(s.value);
    show();
  }
  bindRange("s-temp", "airTemp", v => `${v}°C`, "v-temp");
  bindRange("s-hum", "humidity", v => `${v}%`, "v-hum");
  bindRange("s-lapse", "lapse", v =>
    v < 6.5 ? "安定" : v < 7.5 ? "ふつう" : v < 8.5 ? "不安定" : "とても不安定", "v-lapse");
  bindRange("s-wind", "wind", v => `${v} m/s`, "v-wind");
  bindRange("s-speed", "minutesPerSec", v => `×${v}`, "v-speed");

  document.querySelectorAll("#grounds button").forEach(b => {
    b.addEventListener("click", () => {
      env.ground = b.dataset.g;
      document.querySelectorAll("#grounds button").forEach(x => x.classList.toggle("on", x === b));
    });
  });

  const PRESETS = {
    calm:   { airTemp: 27, humidity: 40, lapse: 6.2, wind: 2 },
    summer: { airTemp: 37, humidity: 65, lapse: 8.8, wind: 3 },
    muggy:  { airTemp: 33, humidity: 88, lapse: 8.0, wind: 5 },
  };
  document.querySelectorAll("#presets button").forEach(b => {
    b.addEventListener("click", () => {
      const p = PRESETS[b.dataset.p];
      Object.assign(env, p);
      el("s-temp").value = p.airTemp; el("s-hum").value = p.humidity;
      el("s-lapse").value = p.lapse; el("s-wind").value = p.wind;
      ["s-temp", "s-hum", "s-lapse", "s-wind"].forEach(id =>
        el(id).dispatchEvent(new Event("input")));
    });
  });

  el("b-pause").addEventListener("click", () => {
    sim.paused = !sim.paused;
    el("b-pause").textContent = sim.paused ? "▶ 再開" : "⏸ 一時停止";
  });

  el("b-reset").addEventListener("click", () => {
    sim.timeMin = 8 * 60;
    sim.cloudTop = 0; sim.anvil = 0; sim.maturity = 0;
    sim.rain = 0; sim.coldPool = 0; sim.heatPulse = 0; sim.groundHeat = 0;
    sim.hotspotX = sim.cx = 0.5;
    puffs = []; thermals = []; drops = []; bolts = [];
  });

  canvas.addEventListener("pointerdown", e => {
    const r = canvas.getBoundingClientRect();
    sim.hotspotX = clamp((e.clientX - r.left) / r.width, 0.15, 0.85);
    sim.heatPulse = 1;
  });

  // ---------- メインループ ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    update(dt);
    render();
    updateHud();
    requestAnimationFrame(frame);
  }

  resize();
  requestAnimationFrame(frame);
})();
