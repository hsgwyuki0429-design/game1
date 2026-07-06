/* 入道雲シミュレータ
   気象物理: GPU流体エンジン(fluid.js) + 診断用のパーセル法
   描画: WebGLボリュームレイマーチング(render.js) + 2Dオーバーレイ */
(() => {
  "use strict";

  const glCanvas = document.getElementById("gl");
  const canvas = document.getElementById("sky"); // オーバーレイ(稲妻・雨・ガイド)
  const ctx = canvas.getContext("2d");
  const profCanvas = document.getElementById("profile");
  const profCtx = profCanvas.getContext("2d");

  let glOK = false, fluidOK = false;
  try { glOK = window.CloudGL.init(glCanvas); } catch (e) { console.error(e); }
  if (!glOK) {
    document.getElementById("hud-stage").textContent = "WebGL2が使えないため表示できません";
  } else {
    try { fluidOK = window.CloudFluid.init(window.CloudGL.context()); } catch (e) { console.error(e); }
  }

  // ---------- 定数 ----------
  const DRY_LAPSE = 9.8;   // 乾燥断熱減率 [°C/km]
  const TROPOPAUSE = 12;   // 圏界面 [km]
  const MAX_ALT = 14;      // 表示する高さ [km]
  const DAY_START = 6, DAY_END = 19;

  const GROUND_FACTOR = { sea: 0.35, grass: 1.0, forest: 0.7, city: 1.35 };
  const GROUND_ID = { sea: 0, grass: 1, forest: 2, city: 3 };

  const TANV = 0.62;
  // 流体領域 [km]
  const DOM = { x0: -12, x1: 12, y1: 16, z0: -8, z1: 8 };

  // ---------- 入力状態 ----------
  const env = {
    airTemp: 32, humidity: 65, lapse: 7.0, wind: 3,
    ground: "grass", minutesPerSec: 5,
  };

  // ---------- カメラ (オービット) ----------
  const cam = {
    yaw: 0, el: -0.09, dist: 21,
    target: [0, 2.6, 0],
    ro: [0, 0, 0], fwd: [0, 0, 1], up: [0, 1, 0], right: [1, 0, 0],
  };
  function computeCam() {
    cam.dist = clamp(cam.dist, 6, 45);
    // 目線が地面(0.2km)より下がらない範囲で仰角をクランプ
    const elMin = Math.asin(clamp((0.2 - cam.target[1]) / cam.dist, -1, 1));
    cam.el = clamp(cam.el, elMin, 1.35);
    const ce = Math.cos(cam.el), se = Math.sin(cam.el);
    cam.ro = [
      cam.target[0] + cam.dist * Math.sin(cam.yaw) * ce,
      cam.target[1] + cam.dist * se,
      cam.target[2] - cam.dist * Math.cos(cam.yaw) * ce,
    ];
    const f = norm3(sub3(cam.target, cam.ro));
    const r = norm3(cross3(f, [0, 1, 0]));
    cam.fwd = f; cam.right = r; cam.up = cross3(r, f);
  }

  // ---------- シミュレーション状態 ----------
  const sim = {
    timeMin: 8 * 60,
    paused: false,
    cloudTop: 0, cloudBase: 1.0,
    anvil: 0, maturity: 0, rain: 0, coldPool: 0,
    groundHeat: 0,
    heatPulse: 0,
    hx: 0, hz: 0,          // 上昇気流の中心 (世界座標 km)
    cx: 0.5, hotspotX: 0.5, // 解析モード用 (画面幅比)
    flash: 0, flashPos: [0, 2, 0],
    lcl: 1.0, el: 0, cape: 0, sun: 0, heating: 0, stage: "快晴",
    guides: false,
    fluidOn: fluidOK,
  };

  let drops = [];
  let bolts = [];
  let W = 0, H = 0;
  let renderScale = 0.7;
  let slowFrames = 0;

  // ---------- ユーティリティ ----------
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  function norm3(a) { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  const cloudX = () => sim.fluidOn ? sim.hx : (sim.cx - 0.5) * 12;
  const cloudZ = () => sim.fluidOn ? sim.hz : 0;

  // 世界座標 [km] → 画面座標 [px]
  function project(x, y, z) {
    const rel = [x - cam.ro[0], y - cam.ro[1], z - cam.ro[2]];
    const cz = rel[0] * cam.fwd[0] + rel[1] * cam.fwd[1] + rel[2] * cam.fwd[2];
    if (cz <= 0.1) return null;
    const cx = rel[0] * cam.right[0] + rel[1] * cam.right[1] + rel[2] * cam.right[2];
    const cy = rel[0] * cam.up[0] + rel[1] * cam.up[1] + rel[2] * cam.up[2];
    return [W * 0.5 + (cx / cz) / TANV * H * 0.5, H * 0.5 - (cy / cz) / TANV * H * 0.5];
  }

  // 画面座標 → 視線が地面(y=0)と交わる点
  function screenToGround(px, py) {
    const ux = (2 * px - W) / H * TANV;
    const uy = (H - 2 * py) / H * TANV;
    const rd = norm3([
      cam.fwd[0] + cam.right[0] * ux + cam.up[0] * uy,
      cam.fwd[1] + cam.right[1] * ux + cam.up[1] * uy,
      cam.fwd[2] + cam.right[2] * ux + cam.up[2] * uy,
    ]);
    if (rd[1] >= -0.001) return null;
    const t = -cam.ro[1] / rd[1];
    return [cam.ro[0] + rd[0] * t, cam.ro[2] + rd[2] * t];
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    W = Math.round(r.width); H = Math.round(r.height);
    canvas.width = W; canvas.height = H;
    if (glOK) window.CloudGL.resize(W, H, renderScale);
  }
  window.addEventListener("resize", resize);

  // ---------- 診断用パーセル法 (HUD・ステージ判定・雨) ----------
  function computeProfile(dtH) {
    const dayFrac = clamp((sim.timeMin / 60 - DAY_START) / (DAY_END - DAY_START), 0, 1);
    sim.sun = Math.sin(Math.PI * dayFrac) * (dayFrac > 0 && dayFrac < 1 ? 1 : 0);

    const gf = GROUND_FACTOR[env.ground];
    sim.groundHeat += (sim.sun * gf - sim.groundHeat) * clamp(dtH / 2.2, 0, 1);
    sim.heating = sim.groundHeat;

    const tParcel = env.airTemp + sim.heating * 5 + sim.heatPulse * 2.5 - sim.coldPool;
    const dew = tParcel - (100 - env.humidity) / 5;
    sim.lcl = clamp(0.125 * Math.max(0.5, tParcel - dew), 0.3, 5);

    let cape = 0, el = 0;
    for (let a = 0.1; a <= 15; a += 0.1) {
      const tp = parcelTempAt(a, tParcel);
      const te = envTempAt(a);
      const buoy = tp - te;
      if (a <= sim.lcl) {
        if (buoy < -2) break;
        continue;
      }
      if (buoy > 0) { cape += buoy * 0.1; el = a; }
      else if (buoy < -0.6) break;
    }
    sim.cape = cape;
    sim.el = Math.min(el, 13);
  }

  function envTempAt(a) {
    return env.airTemp - env.lapse * Math.min(a, TROPOPAUSE);
  }

  function parcelTempAt(a, tParcel) {
    if (a < sim.lcl) return tParcel - DRY_LAPSE * a;
    const tLcl = tParcel - DRY_LAPSE * sim.lcl;
    return tLcl - (5.2 * (a - sim.lcl) + 0.19 * (a * a - sim.lcl * sim.lcl));
  }

  // ---------- 更新 ----------
  let fluidAcc = 0;
  function update(dt) {
    if (sim.paused) return;

    sim.timeMin = (sim.timeMin + dt * env.minutesPerSec) % (24 * 60);
    const dtH = dt * env.minutesPerSec / 60;

    sim.heatPulse *= Math.exp(-dt / 20);
    computeProfile(dtH);

    // パーセル法による見積もり (HUD・雨・ステージ用。流体OFF時は描画も駆動)
    let target = 0;
    if (sim.heating > 0.12 && sim.cape > 0.3) target = sim.el;
    else if (sim.heating > 0.3 && env.humidity > 65) target = sim.lcl + 0.4;

    const growRate = target > sim.cloudTop ? 1.2 + sim.cape * 0.05 : 0.9;
    sim.cloudTop += (target - sim.cloudTop) * clamp(growRate * dtH, 0, 1);
    if (sim.cloudTop < 0.05) sim.cloudTop = 0;
    sim.cloudBase = lerp(sim.cloudBase, sim.lcl, clamp(dtH * 2, 0, 1));

    const deep = sim.cloudTop > 6.5;
    sim.maturity = deep ? sim.maturity + dtH : Math.max(0, sim.maturity - dtH * 2);
    const rainTarget = deep ? clamp((sim.cloudTop - 7) / 4, 0, 1) * clamp(sim.maturity / 0.6, 0, 1) : 0;
    sim.rain = lerp(sim.rain, rainTarget, clamp(dtH * 6, 0, 1));
    sim.coldPool = clamp(sim.coldPool + sim.rain * dtH * 9 - sim.coldPool * dtH * 0.8, 0, 7);

    const hitCeil = sim.cloudTop > 8 && sim.cloudTop > sim.el - 1.5;
    sim.anvil = clamp(sim.anvil + (hitCeil ? dtH * 1.2 : -dtH * 0.6), 0, 1.4);

    if (sim.sun <= 0) sim.stage = sim.cloudTop > 0.3 ? "夜 — 雲は静かに消えていく" : "夜";
    else if (sim.cloudTop < 0.3) sim.stage = "快晴 — 地面があたたまるのを待とう";
    else if (sim.rain > 0.25) sim.stage = "積乱雲・成熟期 ⚡ 雷雨!";
    else if (sim.cloudTop > 7 && target < sim.cloudTop - 1) sim.stage = "積乱雲・衰退期";
    else if (sim.cloudTop > 7) sim.stage = "積乱雲・発達期(入道雲)";
    else if (sim.cloudTop - sim.cloudBase > 1.3) sim.stage = "雄大積雲 — ぐんぐん成長中";
    else sim.stage = "積雲(わた雲)";

    // 解析モードの雲中心 (流体は風で自然に流される)
    sim.cx += (sim.hotspotX - sim.cx) * clamp(dt * 0.15, 0, 1);
    sim.cx = clamp(sim.cx + env.wind * dt * 0.0018, 0.18, 0.82);
    sim.hotspotX = clamp(sim.hotspotX + env.wind * dt * 0.0018, 0.18, 0.82);

    // 流体エンジンを進める (シミュレーション内経過秒をサブステップに分割)
    if (sim.fluidOn && fluidOK) {
      fluidAcc = Math.min(fluidAcc + dt * env.minutesPerSec * 60, 25);
      const steps = Math.min(Math.ceil(fluidAcc / 5), 5);
      if (fluidAcc > 1) {
        const dtSub = fluidAcc / steps;
        for (let i = 0; i < steps; i++) window.CloudFluid.step(dtSub, fluidParams());
        fluidAcc = 0;
      }
    }

    updateRain(dt);
    updateBolts(dt);
  }

  function fluidParams() {
    return {
      heat: sim.heating * (1 + sim.heatPulse * 0.5),
      wind: env.wind,
      hotX: (sim.hx - DOM.x0) * 1000,  // 領域内メートル座標
      hotZ: (sim.hz - DOM.z0) * 1000,
      hotAmp: sim.heatPulse,
    };
  }

  // ---------- 前景の雨・雷 ----------
  function updateRain(dt) {
    if (sim.rain > 0.1) {
      const n = Math.round(sim.rain * 160 * dt);
      for (let i = 0; i < n && drops.length < 260; i++) {
        drops.push({ x: rand(0, W), y: rand(-40, H * 0.5), v: rand(700, 1100), l: rand(14, 30), a: rand(0.05, 0.16) });
      }
    }
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      d.y += d.v * dt; d.x += env.wind * 18 * dt;
      if (d.y > H) drops.splice(i, 1);
    }
    if (sim.rain > 0.4 && Math.random() < dt * (0.25 + sim.rain * 0.5)) spawnBolt();
    sim.flash = Math.max(0, sim.flash - dt * 2.5);
  }

  function spawnBolt() {
    const rad = 1.3 + (sim.cloudTop - sim.cloudBase) * 0.28;
    const fx = cloudX() + rand(-1, 1) * rad * 0.5;
    const fz = cloudZ() + rand(-1.5, 1.5);
    let y = Math.min(sim.cloudBase + rand(0.5, 2.0), 5);
    sim.flashPos = [fx, y + 0.5, fz];
    const pts = [[fx, y, fz]];
    let x = fx, z = fz;
    while (y > 0) {
      y -= rand(0.12, 0.35);
      x += rand(-0.22, 0.22);
      z += rand(-0.1, 0.1);
      pts.push([x, Math.max(y, 0), z]);
    }
    bolts.push({ pts, life: 0.4 });
    sim.flash = 1;
  }

  function updateBolts(dt) {
    for (let i = bolts.length - 1; i >= 0; i--) {
      bolts[i].life -= dt;
      if (bolts[i].life <= 0) bolts.splice(i, 1);
    }
  }

  // ---------- 空と光の色 ----------
  function palettes() {
    const dayFrac = (sim.timeMin / 60 - DAY_START) / (DAY_END - DAY_START);
    const sEl = Math.sin(Math.PI * dayFrac); // 太陽高度 (夜は負)
    const day = clamp(sEl * 2.6, 0, 1);
    const dusk = clamp(1 - Math.abs(sEl) / 0.45, 0, 1);

    let zen = mix3([0.010, 0.014, 0.040], [0.055, 0.19, 0.58], day);
    let hor = mix3([0.020, 0.028, 0.060], [0.42, 0.55, 0.72], day);
    hor = mix3(hor, [0.95, 0.50, 0.28], dusk * 0.75);
    zen = mix3(zen, [0.20, 0.16, 0.36], dusk * 0.45);
    let sun = mix3([1.0, 0.98, 0.92], [1.0, 0.42, 0.16], clamp(1 - sEl / 0.5, 0, 1));
    const sunAmt = clamp(sEl * 6 + 0.05, 0, 1);
    sun = [sun[0] * sunAmt, sun[1] * sunAmt, sun[2] * sunAmt];

    const dark = 1 - sim.rain * 0.45;
    zen = zen.map(v => v * dark);
    hor = hor.map(v => v * dark);
    sun = sun.map(v => v * (1 - sim.rain * 0.3));

    const E = Math.PI * clamp(dayFrac, 0, 1);
    const sd = [-Math.cos(E) * 1.0, Math.max(sEl, -0.25) * 0.85 + 0.02, 0.42];
    const len = Math.hypot(...sd);

    return {
      zenith: zen, horizon: hor, sunCol: sun,
      sunDir: sd.map(v => v / len),
      night: clamp(-sEl * 3 + 0.05, 0, 1),
    };
  }

  // ---------- 描画 ----------
  let t0 = performance.now();
  function render(now) {
    computeCam();
    const pal = palettes();
    if (glOK) {
      window.CloudGL.render({
        time: (now - t0) / 1000,
        sunDir: pal.sunDir, sunCol: pal.sunCol,
        zenith: pal.zenith, horizon: pal.horizon, night: pal.night,
        base: sim.cloudBase,
        top: sim.cloudTop > 0.05 ? sim.cloudTop : 0,
        rad: 1.3 + Math.max(sim.cloudTop - sim.cloudBase, 0) * 0.28,
        anvil: sim.anvil,
        rain: sim.rain,
        flash: sim.flash,
        flashPos: sim.flashPos,
        cx: cloudX(), cz: cloudZ(),
        cumu: clamp(sim.heating * 1.3, 0, 1) * clamp((env.humidity - 45) / 45, 0, 1),
        gtype: GROUND_ID[env.ground],
        ro: cam.ro, fwd: cam.fwd, up: cam.up, right: cam.right,
        mode: sim.fluidOn && fluidOK ? 1 : 0,
        volTex: fluidOK ? window.CloudFluid.texture() : null,
      });
    }

    ctx.clearRect(0, 0, W, H);
    drawSkyline();
    drawHeatSpot();
    drawBolts();
    drawDrops();
    if (sim.guides) drawGuides();
  }

  function drawSkyline() {
    const fh = norm3([cam.fwd[0], 0, cam.fwd[2]]);
    const hz = project(cam.ro[0] + fh[0] * 5000, 0, cam.ro[2] + fh[2] * 5000);
    if (!hz) return;
    const y = hz[1];
    if (y < -20 || y > H + 20) return;
    ctx.fillStyle = "rgba(8,11,17,0.75)";
    if (env.ground === "forest") {
      ctx.beginPath();
      ctx.moveTo(0, y + 1);
      for (let x = 0; x <= W; x += 14) {
        const h = 5 + ((x * 7919) % 9);
        ctx.lineTo(x + 7, y - h);
        ctx.lineTo(x + 14, y + 1);
      }
      ctx.lineTo(W, y + 1);
      ctx.fill();
    } else if (env.ground === "city") {
      for (let x = 0; x < W; x += 26) {
        const bh = 6 + ((x * 2654435761) % 22);
        ctx.fillRect(x + 2, y - bh, 20, bh + 1);
      }
    }
  }

  function drawHeatSpot() {
    if (sim.heatPulse < 0.05) return;
    const p = project(sim.hx, 0.02, sim.hz);
    const p2 = project(sim.hx, 0.5, sim.hz);
    if (!p || !p2) return;
    const r = clamp(Math.abs(p[1] - p2[1]) * 1.5, 8, 60);
    const g = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], r);
    g.addColorStop(0, `rgba(255,140,60,${sim.heatPulse * 0.18})`);
    g.addColorStop(1, "rgba(255,140,60,0)");
    ctx.fillStyle = g;
    ctx.fillRect(p[0] - r, p[1] - r, r * 2, r * 2);
  }

  function drawBolts() {
    for (const b of bolts) {
      const a = clamp(b.life / 0.4, 0, 1);
      ctx.strokeStyle = `rgba(255,252,235,${a * 0.95})`;
      ctx.lineWidth = 2.2;
      ctx.shadowColor = "rgba(170,190,255,0.95)";
      ctx.shadowBlur = 22;
      ctx.beginPath();
      let started = false;
      for (const [x, y, z] of b.pts) {
        const p = project(x, y, z);
        if (!p) continue;
        if (!started) { ctx.moveTo(p[0], p[1]); started = true; }
        else ctx.lineTo(p[0], p[1]);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }

  function drawDrops() {
    if (!drops.length) return;
    ctx.lineWidth = 1;
    const slant = env.wind * 0.03;
    for (const d of drops) {
      ctx.strokeStyle = `rgba(200,215,235,${d.a})`;
      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x - d.l * slant, d.y - d.l);
      ctx.stroke();
    }
  }

  function drawGuides() {
    ctx.font = "11px sans-serif";
    for (let a = 2; a <= 12; a += 2) {
      const p0 = project(-10, a, 0), p1 = project(10, a, 0);
      if (!p0 || !p1) continue;
      ctx.strokeStyle = "rgba(255,255,255,0.22)";
      ctx.setLineDash([4, 8]);
      ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.fillText(`${a}km`, Math.max(Math.min(p0[0], W - 40), 6), p0[1] - 4);
    }
    if (sim.heating > 0.1) {
      const p0 = project(-10, sim.lcl, 0), p1 = project(10, sim.lcl, 0);
      if (p0 && p1) {
        ctx.strokeStyle = "rgba(150,210,255,0.5)";
        ctx.setLineDash([8, 6]);
        ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "rgba(170,220,255,0.75)";
        ctx.fillText("凝結高度(ここから上で雲ができる)", clamp(p1[0] - 220, 6, W - 230), p1[1] - 5);
      }
    }
  }

  // ---------- 温度プロファイル図 ----------
  function drawProfileChart() {
    const pw = profCanvas.width, ph = profCanvas.height;
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
    profCtx.strokeStyle = "#7dd3fc";
    profCtx.lineWidth = 1.8;
    profCtx.beginPath();
    for (let a = 0; a <= MAX_ALT; a += 0.25) {
      const te = envTempAt(a);
      a === 0 ? profCtx.moveTo(px(te), py(a)) : profCtx.lineTo(px(te), py(a));
    }
    profCtx.stroke();
    profCtx.strokeStyle = "#fb923c";
    profCtx.beginPath();
    for (let a = 0; a <= MAX_ALT; a += 0.25) {
      const tp = parcelTempAt(a, tParcel);
      a === 0 ? profCtx.moveTo(px(tp), py(a)) : profCtx.lineTo(px(tp), py(a));
    }
    profCtx.stroke();
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

  // ---------- 入力 (パネル) ----------
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

  // 環境が変わったら流体の大気を作り直す
  function reinitFluid() {
    if (fluidOK) window.CloudFluid.reset(env);
  }
  ["s-temp", "s-hum", "s-lapse"].forEach(id =>
    el(id).addEventListener("change", reinitFluid));
  reinitFluid();

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
      reinitFluid();
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
    sim.hotspotX = sim.cx = 0.5; sim.hx = 0; sim.hz = 0;
    drops = []; bolts = [];
    reinitFluid();
  });

  el("c-guides").addEventListener("change", e => { sim.guides = e.target.checked; });

  const fluidChk = el("c-fluid");
  if (fluidChk) {
    fluidChk.checked = sim.fluidOn;
    fluidChk.disabled = !fluidOK;
    fluidChk.addEventListener("change", e => { sim.fluidOn = e.target.checked && fluidOK; });
  }

  // ---------- 全画面 ----------
  const view = document.getElementById("view");
  const fsBtn = el("b-fs");
  function fsLabel() {
    const on = document.fullscreenElement || document.body.classList.contains("fsfake");
    fsBtn.textContent = on ? "✕" : "⛶";
    fsBtn.title = on ? "全画面をやめる" : "全画面で見る";
  }
  fsBtn.addEventListener("click", async () => {
    try {
      if (!document.fullscreenElement) await view.requestFullscreen();
      else await document.exitFullscreen();
    } catch {
      document.body.classList.toggle("fsfake");
    }
    setTimeout(() => { resize(); fsLabel(); }, 120);
  });
  document.addEventListener("fullscreenchange", () => { resize(); fsLabel(); });

  // ---------- 視点操作 (ドラッグ回転 / ホイール・ピンチでズーム / タップで上昇気流) ----------
  const pointers = new Map();
  let dragMoved = false, pinchDist = 0;

  canvas.addEventListener("pointerdown", e => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) dragMoved = false;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    }
  });

  canvas.addEventListener("pointermove", e => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    if (pointers.size === 1) {
      if (Math.abs(dx) + Math.abs(dy) > 6) dragMoved = true;
      if (dragMoved) {
        cam.yaw += dx * 0.005;
        cam.el += dy * 0.004;
      }
    }
    p.x = e.clientX; p.y = e.clientY;
    if (pointers.size === 2) {
      dragMoved = true;
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDist > 0) cam.dist = clamp(cam.dist * pinchDist / Math.max(d, 20), 6, 45);
      pinchDist = d;
    }
  });

  function pointerEnd(e) {
    const was = pointers.has(e.pointerId);
    pointers.delete(e.pointerId);
    if (!was) return;
    // 動かさずに離した = タップ → 上昇気流を発生
    if (!dragMoved && pointers.size === 0) {
      const r = canvas.getBoundingClientRect();
      const g = screenToGround(e.clientX - r.left, e.clientY - r.top);
      if (g) {
        sim.hx = clamp(g[0], DOM.x0 + 2, DOM.x1 - 2);
        sim.hz = clamp(g[1], DOM.z0 + 2, DOM.z1 - 2);
        sim.hotspotX = clamp(sim.hx / 12 + 0.5, 0.18, 0.82);
        sim.heatPulse = 1;
      }
    }
  }
  canvas.addEventListener("pointerup", pointerEnd);
  canvas.addEventListener("pointercancel", pointerEnd);

  canvas.addEventListener("wheel", e => {
    e.preventDefault();
    cam.dist = clamp(cam.dist * (e.deltaY > 0 ? 1.1 : 0.9), 6, 45);
  }, { passive: false });

  canvas.addEventListener("dblclick", () => {
    cam.yaw = 0; cam.el = -0.09; cam.dist = 21;
  });

  // ---------- メインループ ----------
  let last = performance.now();
  let profTimer = 0;
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;

    if (dt > 0.045) { if (++slowFrames > 30 && renderScale > 0.45) { renderScale = 0.45; resize(); slowFrames = -9999; } }
    else if (slowFrames > 0) slowFrames--;

    update(dt);
    render(now);
    updateHud();
    profTimer += dt;
    if (profTimer > 0.2) { drawProfileChart(); profTimer = 0; }
    requestAnimationFrame(frame);
  }

  // テスト用フック
  window.__sim = sim;
  window.__env = env;
  window.__cam = cam;
  window.__fluidBurst = (n, dt) => {
    for (let i = 0; i < n; i++) window.CloudFluid.step(dt || 8, fluidParams());
    if (glOK) window.CloudGL.context().finish();
  };

  resize();
  requestAnimationFrame(frame);
})();
