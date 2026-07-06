/* GPU上の3D気象流体エンジン
   オイラー法: 半ラグランジュ移流 + 浮力(温位・水蒸気・雲水) + 圧力投影(非圧縮)
   + 渦度強化 + 雲微物理(凝結・蒸発の潜熱、雨への変換)
   3D格子は2Dテクスチャのタイルアトラスに展開して1パス=1描画で更新する */
window.CloudFluid = (() => {
  "use strict";

  // 格子: 96x64x64 セル、1セル250m → 領域 24km x 16km x 16km
  const NX = 96, NY = 64, NZ = 64;
  const TX = 8, TY = 8;              // Zスライスをタイル状に並べる
  const AW = NX * TX, AH = NY * TY;  // アトラス 768x512
  const H = 250.0;                   // セルサイズ [m]

  // 全シェーダ共通ヘッダ: アトラス座標変換・3D補間・大気の状態量
  const COMMON = `#version 300 es
  precision highp float;
  precision highp sampler2D;
  const int NX=${NX}, NY=${NY}, NZ=${NZ}, TX=${TX};
  const float H=${H.toFixed(1)};
  uniform float uT0;     // 地上気温 [K]
  uniform float uLapse;  // 環境減率 [K/m]
  uniform float uRH;     // 地上湿度 [0-1]

  ivec2 tileOf(int k){ return ivec2((k%TX)*NX, (k/TX)*NY); }
  vec4 F(sampler2D t, ivec3 c){
    c = clamp(c, ivec3(0), ivec3(NX-1,NY-1,NZ-1));
    return texelFetch(t, tileOf(c.z)+c.xy, 0);
  }
  // 連続格子座標 (セル単位, 中心=i+0.5) でのトリリニア補間
  vec4 S(sampler2D t, vec3 g){
    g = clamp(g-0.5, vec3(0.0), vec3(float(NX-1), float(NY-1), float(NZ-1)));
    ivec3 i0 = ivec3(floor(g));
    vec3 w = g - vec3(i0);
    vec4 c00=mix(F(t,i0),                F(t,i0+ivec3(1,0,0)), w.x);
    vec4 c10=mix(F(t,i0+ivec3(0,1,0)),   F(t,i0+ivec3(1,1,0)), w.x);
    vec4 c01=mix(F(t,i0+ivec3(0,0,1)),   F(t,i0+ivec3(1,0,1)), w.x);
    vec4 c11=mix(F(t,i0+ivec3(0,1,1)),   F(t,i0+ivec3(1,1,1)), w.x);
    return mix(mix(c00,c10,w.y), mix(c01,c11,w.y), w.z);
  }
  ivec3 cellOf(vec2 fc){
    int x = int(fc.x), y = int(fc.y);
    int i = x % NX, j = y % NY;
    int k = (y/NY)*TX + (x/NX);
    return ivec3(i,j,k);
  }
  // 大気の基本場
  float pres(float z){ return 101325.0*exp(-z/8500.0); }
  float exner(float z){ return pow(pres(z)/101325.0, 0.2854); }
  float envT(float z){ return uT0 - uLapse*min(z, 12000.0); }   // 12kmから上は等温(圏界面)
  float qsat(float T, float p){
    float es = 611.2*exp(17.67*(T-273.15)/(T-29.65));
    return 0.622*es/max(p-es, 1000.0);
  }
  // 湿度は境界層に集中し、上空は乾く (現実的なプロファイル)
  float envRH(float z){ return uRH*(0.22+0.78*exp(-z/2800.0)); }
  float envQv(float z){ return envRH(z)*qsat(envT(z), pres(z)); }
  // 境界スポンジ (横・上端で場を環境へ戻す) 0=内部 1=境界
  float sponge(ivec3 c){
    float dx = min(float(c.x), float(NX-1-c.x));
    float dz = min(float(c.z), float(NZ-1-c.z));
    float dy = float(NY-1-c.y);
    float d = min(min(dx,dz), dy*0.75);
    return 1.0-smoothstep(0.0, 5.0, d);
  }
  float hash12(vec2 p){ vec3 q=fract(vec3(p.xyx)*0.1031); q+=dot(q,q.yzx+33.33); return fract((q.x+q.y)*q.z); }
  float n2(vec2 x){
    vec2 i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f);
    return mix(mix(hash12(i),hash12(i+vec2(1,0)),f.x), mix(hash12(i+vec2(0,1)),hash12(i+vec2(1,1)),f.x), f.y);
  }
  `;

  const VS = `#version 300 es
  layout(location=0) in vec2 aP;
  void main(){ gl_Position=vec4(aP,0.,1.); }`;

  // 初期化: 静止大気 (θ'=0, qv=環境値, qc=0)
  const FS_INIT = COMMON + `
  uniform float uWhich; // 0=熱力学 1=その他ゼロ
  out vec4 o;
  void main(){
    ivec3 c = cellOf(gl_FragCoord.xy);
    if(uWhich < 0.5){
      float z = (float(c.y)+0.5)*H;
      o = vec4(0.0, envQv(z), 0.0, 0.0);
    } else o = vec4(0.0);
  }`;

  // 熱力学: 移流 + 地表フラックス + 凝結/蒸発 + 雨への変換 + スポンジ
  const FS_THERMO = COMMON + `
  uniform sampler2D uVel;
  uniform sampler2D uThm;
  uniform float uDt;
  uniform float uHeat;    // 地表加熱の強さ (0..1.5)
  uniform float uTime;
  uniform vec2  uHot;     // ホットスポット位置 [m] (格子内座標)
  uniform float uHotAmp;
  out vec4 o;
  void main(){
    ivec3 c = cellOf(gl_FragCoord.xy);
    vec3 v = F(uVel, c).xyz;
    vec3 g = vec3(c)+0.5 - v*uDt/H;
    vec4 t = S(uThm, g);
    float th = t.x, qv = t.y, qc = t.z;
    float z = (float(c.y)+0.5)*H;

    // 全温位の厳密保存: θ'に「出発点と到着点の環境温位の差」を足す
    // (上昇した空気は乾燥断熱で冷え、下降した空気は暖まる)
    float zsrc = clamp(g.y, 0.5, float(NY)-0.5)*H;
    th += envT(zsrc)/exner(zsrc) - envT(z)/exner(z);

    // 地表からの熱と水蒸気の供給 (下2セル)。むらのある加熱がサーマルの種になる
    // 空気が地面より暖まる/湿りすぎるとフラックスは止まる (現実の地表熱収支のブレーキ)
    if(c.y < 2){
      vec2 xz = (vec2(c.xz)+0.5)*H;
      // パッチ状の加熱 (約4kmスケール): 熱いところと涼しいところのむらが、まばらな積雲の並びを作る
      float pat = max(3.2*n2(xz*0.00025 + vec2(uTime*0.002, 0.0)) - 1.9, 0.0);
      pat += uHotAmp*5.0*exp(-dot(xz-uHot, xz-uHot)/(2000.0*2000.0));
      float f = uHeat*pat*(c.y==0 ? 1.0 : 0.6);
      float brakeT = clamp(1.0 - th/6.0, 0.0, 1.0);
      float brakeQ = clamp(1.0 - (qv-envQv(z))/0.006, 0.0, 1.0);
      th += f*0.0022*uDt*brakeT;
      qv += f*1.0e-6*uDt*(0.35+0.65*uRH)*brakeQ;
    }

    // 凝結・蒸発 (飽和調整) と潜熱
    float p  = pres(z);
    float PI = exner(z);
    float T  = (envT(z)/PI + th)*PI;   // 実温度
    float qs = qsat(T, p);
    float dq = qv - qs;
    dq = dq > 0.0 ? dq*0.6 : max(dq*0.6, -qc);  // 凝結は緩和、蒸発は雲水まで
    dq = clamp(dq, -0.0012, 0.0012);            // 1ステップの潜熱解放を制限 (安定化)
    qv -= dq;  qc += dq;
    th += 2.5e6/(1004.0*PI)*dq;

    // 雲水が濃くなると雨に変換されて抜ける (自動変換)。
    // 落下する雨の一部は蒸発して空気を冷やす (潜熱の30%を返す)
    float rainOut = max(qc-0.0022, 0.0)*(1.0-exp(-uDt*0.0009));
    qc -= rainOut;
    th -= 0.35 * 2.5e6/(1004.0*PI) * rainOut;

    // ニュートン緩和: 放射・大規模場への調整の近似 (晴天域は速く、雲内は遅く)
    // 極端な偏差ほど速く戻す (小さな箱では沈降昇温が現実より強く出るため)
    float tau = qc > 1e-4 ? 3600.0 : 600.0;
    tau = mix(tau, 120.0, smoothstep(5.0, 13.0, abs(th)));
    th *= exp(-uDt/tau);
    qv = mix(qv, envQv(z), min(uDt/1500.0, 1.0));

    // スポンジ: 境界で環境場へ戻す
    float sp = sponge(c)*0.25;
    th = mix(th, 0.0, sp);
    qv = mix(qv, envQv(z), sp);
    qc = mix(qc, 0.0, sp);

    o = vec4(clamp(th,-15.0,15.0), clamp(qv,0.0,0.05), clamp(qc,0.0,0.02), 0.0);
  }`;

  // 渦度 ω = ∇×v
  const FS_CURL = COMMON + `
  uniform sampler2D uVel;
  out vec4 o;
  void main(){
    ivec3 c = cellOf(gl_FragCoord.xy);
    vec3 dx = (F(uVel,c+ivec3(1,0,0)).xyz - F(uVel,c-ivec3(1,0,0)).xyz)/(2.0*H);
    vec3 dy = (F(uVel,c+ivec3(0,1,0)).xyz - F(uVel,c-ivec3(0,1,0)).xyz)/(2.0*H);
    vec3 dz = (F(uVel,c+ivec3(0,0,1)).xyz - F(uVel,c-ivec3(0,0,1)).xyz)/(2.0*H);
    vec3 w = vec3(dy.z-dz.y, dz.x-dx.z, dx.y-dy.x);
    o = vec4(w, length(w));
  }`;

  // 速度: 移流 + 浮力 + 渦度強化 + 風 + スポンジ
  const FS_VEL = COMMON + `
  uniform sampler2D uVel;
  uniform sampler2D uThm;   // 更新済み熱力学場
  uniform sampler2D uCrl;
  uniform float uDt;
  uniform float uWind;      // [m/s]
  out vec4 o;
  void main(){
    ivec3 c = cellOf(gl_FragCoord.xy);
    vec3 v0 = F(uVel, c).xyz;
    vec3 g = vec3(c)+0.5 - v0*uDt/H;
    vec3 v = S(uVel, g).xyz;

    // 浮力: 温位偏差 + 水蒸気の軽さ - 雲水の重さ
    vec4 t = F(uThm, c);
    float z = (float(c.y)+0.5)*H;
    float thEnv = envT(z)/exner(z);
    float B = 9.81*( t.x/thEnv + 0.61*(t.y-envQv(z)) - t.z );
    v.y += clamp(B, -0.45, 0.45)*uDt;

    // 成層圏 (11kmより上) は安定なので鉛直運動を強く減衰 (重力波吸収層)
    if(z > 11000.0) v.y *= exp(-uDt/300.0*(z-11000.0)/2500.0);

    // 渦度強化: 数値拡散で失われる小さな渦を復元
    vec4 w = F(uCrl, c);
    vec3 eta = vec3(
      F(uCrl,c+ivec3(1,0,0)).w - F(uCrl,c-ivec3(1,0,0)).w,
      F(uCrl,c+ivec3(0,1,0)).w - F(uCrl,c-ivec3(0,1,0)).w,
      F(uCrl,c+ivec3(0,0,1)).w - F(uCrl,c-ivec3(0,0,1)).w);
    float el = length(eta);
    if(el > 1e-9){
      vec3 fc2 = 0.35*H*cross(eta/el, w.xyz);
      v += fc2*uDt;
    }

    // 風への緩和と弱い抵抗
    v.xz += (vec2(uWind,0.0)-v.xz)*min(uDt/900.0, 1.0);
    v *= 1.0 - min(uDt*5.0e-4, 0.08);

    // スポンジと地面
    v *= 1.0 - sponge(c)*0.35;
    if(c.y == 0) v.y = max(v.y, 0.0);

    o = vec4(clamp(v, vec3(-30.0), vec3(30.0)), 0.0);
  }`;

  // 発散
  const FS_DIV = COMMON + `
  uniform sampler2D uVel;
  out vec4 o;
  void main(){
    ivec3 c = cellOf(gl_FragCoord.xy);
    float d =
      (F(uVel,c+ivec3(1,0,0)).x - F(uVel,c-ivec3(1,0,0)).x
     + F(uVel,c+ivec3(0,1,0)).y - F(uVel,c-ivec3(0,1,0)).y
     + F(uVel,c+ivec3(0,0,1)).z - F(uVel,c-ivec3(0,0,1)).z)/(2.0*H);
    o = vec4(d,0.,0.,0.);
  }`;

  // 圧力のヤコビ反復
  const FS_JACOBI = COMMON + `
  uniform sampler2D uPrs;
  uniform sampler2D uDiv;
  out vec4 o;
  void main(){
    ivec3 c = cellOf(gl_FragCoord.xy);
    float s =
      F(uPrs,c+ivec3(1,0,0)).x + F(uPrs,c-ivec3(1,0,0)).x
    + F(uPrs,c+ivec3(0,1,0)).x + F(uPrs,c-ivec3(0,1,0)).x
    + F(uPrs,c+ivec3(0,0,1)).x + F(uPrs,c-ivec3(0,0,1)).x;
    o = vec4((s - H*H*F(uDiv,c).x)/6.0, 0.,0.,0.);
  }`;

  // 圧力勾配を引いて非圧縮に
  const FS_PROJ = COMMON + `
  uniform sampler2D uVel;
  uniform sampler2D uPrs;
  out vec4 o;
  void main(){
    ivec3 c = cellOf(gl_FragCoord.xy);
    vec3 v = F(uVel, c).xyz;
    v.x -= (F(uPrs,c+ivec3(1,0,0)).x - F(uPrs,c-ivec3(1,0,0)).x)/(2.0*H);
    v.y -= (F(uPrs,c+ivec3(0,1,0)).x - F(uPrs,c-ivec3(0,1,0)).x)/(2.0*H);
    v.z -= (F(uPrs,c+ivec3(0,0,1)).x - F(uPrs,c-ivec3(0,0,1)).x)/(2.0*H);
    if(c.y == 0) v.y = max(v.y, 0.0);
    o = vec4(clamp(v, vec3(-30.0), vec3(30.0)), 0.0);
  }`;

  let gl = null, fbo = null, quad = null;
  const prog = {}, tex = {};
  let envU = { uT0: 305, uLapse: 0.007, uRH: 0.65 };

  function compile(vs, fs){
    const p = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]){
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if(!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw new Error("fluid shader: " + gl.getShaderInfoLog(s) + src.split("\n").slice(0,3).join(" "));
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    if(!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error("fluid link: " + gl.getProgramInfoLog(p));
    return p;
  }

  function makeTex(){
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, AW, AH);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  function runPass(p, out, inputs, uniforms){
    gl.useProgram(p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, out, 0);
    gl.viewport(0, 0, AW, AH);
    let unit = 0;
    for(const name in inputs){
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, inputs[name]);
      gl.uniform1i(gl.getUniformLocation(p, name), unit);
      unit++;
    }
    const all = Object.assign({}, envU, uniforms);
    for(const name in all){
      const l = gl.getUniformLocation(p, name);
      if(l === null) continue;
      const v = all[name];
      if(typeof v === "number") gl.uniform1f(l, v);
      else if(v.length === 2) gl.uniform2f(l, v[0], v[1]);
      else gl.uniform3f(l, v[0], v[1], v[2]);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function init(glCtx){
    gl = glCtx;
    if(!gl.getExtension("EXT_color_buffer_float")) return false;
    try {
      prog.init   = compile(VS, FS_INIT);
      prog.thermo = compile(VS, FS_THERMO);
      prog.curl   = compile(VS, FS_CURL);
      prog.vel    = compile(VS, FS_VEL);
      prog.div    = compile(VS, FS_DIV);
      prog.jacobi = compile(VS, FS_JACOBI);
      prog.proj   = compile(VS, FS_PROJ);
    } catch(e){ console.error(e); return false; }
    for(const n of ["thmA","thmB","velA","velB","prsA","prsB","crl","div"]) tex[n] = makeTex();
    fbo = gl.createFramebuffer();
    quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
    return true;
  }

  // 環境が変わったら大気を初期化 (θ'=0, qv=環境値)
  function reset(envParams){
    setEnv(envParams);
    runPass(prog.init, tex.thmA, {}, { uWhich: 0 });
    runPass(prog.init, tex.thmB, {}, { uWhich: 0 });
    for(const n of ["velA","velB","prsA","prsB","crl","div"])
      runPass(prog.init, tex[n], {}, { uWhich: 1 });
  }

  function setEnv(p){
    envU = {
      uT0: p.airTemp + 273.15,
      uLapse: p.lapse / 1000.0,
      uRH: p.humidity / 100.0,
    };
  }

  let simTime = 0;

  // 1サブステップ (dt ≦ 8s 推奨)
  function step(dt, prm){
    simTime += dt;
    runPass(prog.thermo, tex.thmB, { uVel: tex.velA, uThm: tex.thmA }, {
      uDt: dt, uHeat: prm.heat, uTime: simTime,
      uHot: [prm.hotX, prm.hotZ], uHotAmp: prm.hotAmp,
    });
    [tex.thmA, tex.thmB] = [tex.thmB, tex.thmA];

    runPass(prog.curl, tex.crl, { uVel: tex.velA }, {});
    runPass(prog.vel, tex.velB, { uVel: tex.velA, uThm: tex.thmA, uCrl: tex.crl }, {
      uDt: dt, uWind: prm.wind,
    });
    [tex.velA, tex.velB] = [tex.velB, tex.velA];

    runPass(prog.div, tex.div, { uVel: tex.velA }, {});
    for(let i = 0; i < 12; i++){
      runPass(prog.jacobi, tex.prsB, { uPrs: tex.prsA, uDiv: tex.div }, {});
      [tex.prsA, tex.prsB] = [tex.prsB, tex.prsA];
    }
    runPass(prog.proj, tex.velB, { uVel: tex.velA, uPrs: tex.prsA }, {});
    [tex.velA, tex.velB] = [tex.velB, tex.velA];
  }

  return {
    init, reset, step, setEnv,
    texture: () => tex.thmA,
    grid: { NX, NY, NZ, TX, TY, AW, AH, H },
  };
})();
