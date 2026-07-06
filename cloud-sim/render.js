/* WebGL2 ボリュームレイマーチングによる雲レンダラー
   uMode=1: 流体シミュレーションの3D密度場を描画 / uMode=0: 解析的な形状(フォールバック) */
window.CloudGL = (() => {
  "use strict";

  const VS = `#version 300 es
  layout(location=0) in vec2 aP;
  void main(){ gl_Position = vec4(aP, 0.0, 1.0); }`;

  const FS = `#version 300 es
  precision highp float;
  precision highp sampler2D;
  out vec4 outC;

  uniform vec2  uRes;
  uniform float uTime;
  uniform vec3  uSunDir;
  uniform vec3  uSunCol;
  uniform vec3  uZenith;
  uniform vec3  uHorizon;
  uniform float uNight;    // 0=昼 1=夜
  uniform float uBase;     // 雲底 [km]
  uniform float uTop;      // 雲頂 [km]
  uniform float uRad;      // 雲の基本半径 [km]
  uniform float uAnvil;    // かなとこ雲の広がり
  uniform float uRain;     // 降水強度
  uniform float uFlash;    // 雷の発光
  uniform vec3  uFlashPos; // 雷の位置 [km]
  uniform float uCx;       // 雲(雨柱)の中心x [km]
  uniform float uCz;       // 雲(雨柱)の中心z [km]
  uniform float uCumu;     // まわりに浮かぶ小さな積雲の量
  uniform float uGType;    // 0海 1草原 2森 3都市
  // カメラ
  uniform vec3 uRO;
  uniform vec3 uFwd;
  uniform vec3 uUp;
  uniform vec3 uRight;
  // 流体モード
  uniform float uMode;     // 0=解析形状 1=流体シミュレーション
  uniform sampler2D uVol;  // 流体アトラス (x:θ' y:qv z:qc)

  const float TANV = 0.62;
  const int NX=96, NY=64, NZ=64, TX=8;
  const vec3 DMIN = vec3(-12.0, 0.0, -8.0);  // 流体領域 [km]
  const vec3 DMAX = vec3( 12.0,16.0,  8.0);

  float hash13(vec3 p){ p = fract(p*0.1031); p += dot(p, p.zyx+31.32); return fract((p.x+p.y)*p.z); }
  float hash21(vec2 p){ vec3 q = fract(vec3(p.xyx)*0.1031); q += dot(q, q.yzx+33.33); return fract((q.x+q.y)*q.z); }

  float vnoise(vec3 x){
    vec3 i = floor(x), f = fract(x);
    f = f*f*(3.0-2.0*f);
    return mix(
      mix(mix(hash13(i),               hash13(i+vec3(1,0,0)), f.x),
          mix(hash13(i+vec3(0,1,0)),   hash13(i+vec3(1,1,0)), f.x), f.y),
      mix(mix(hash13(i+vec3(0,0,1)),   hash13(i+vec3(1,0,1)), f.x),
          mix(hash13(i+vec3(0,1,1)),   hash13(i+vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm5(vec3 p){
    float a = 0.5, s = 0.0;
    for(int i=0;i<5;i++){ s += a*vnoise(p); p = p*2.17 + vec3(3.1,1.7,4.3); a *= 0.52; }
    return s*1.05;
  }
  float fbm3(vec3 p){
    float a = 0.5, s = 0.0;
    for(int i=0;i<3;i++){ s += a*vnoise(p); p *= 2.3; a *= 0.5; }
    return s*1.15;
  }

  // ---- 流体場のサンプリング ----
  float fetchQC(ivec3 c){
    c = clamp(c, ivec3(0), ivec3(NX-1,NY-1,NZ-1));
    ivec2 o = ivec2((c.z%TX)*NX, (c.z/TX)*NY);
    return texelFetch(uVol, o+c.xy, 0).z;
  }
  float qcAt(vec3 p){ // p [km]
    if(any(lessThan(p, DMIN)) || any(greaterThan(p, DMAX))) return 0.0;
    vec3 g = (p - DMIN)/0.25;   // セル座標
    g = clamp(g-0.5, vec3(0.0), vec3(float(NX-1),float(NY-1),float(NZ-1)));
    ivec3 i0 = ivec3(floor(g));
    vec3 w = g-vec3(i0);
    float c00=mix(fetchQC(i0),               fetchQC(i0+ivec3(1,0,0)), w.x);
    float c10=mix(fetchQC(i0+ivec3(0,1,0)),  fetchQC(i0+ivec3(1,1,0)), w.x);
    float c01=mix(fetchQC(i0+ivec3(0,0,1)),  fetchQC(i0+ivec3(1,0,1)), w.x);
    float c11=mix(fetchQC(i0+ivec3(0,1,1)),  fetchQC(i0+ivec3(1,1,1)), w.x);
    return mix(mix(c00,c10,w.y), mix(c01,c11,w.y), w.z);
  }

  // ---- 解析形状 (フォールバック) ----
  float envelope(vec3 p){
    float depth = uTop - uBase;
    if(depth < 0.05) return 0.0;
    float h = p.y;
    float rel = (h - uBase) / depth;
    if(rel < -0.1 || rel > 1.12) return 0.0;
    float rad = uRad * (1.0 - 0.42*clamp(rel, 0.0, 1.0));
    rad += uAnvil * uRad * 2.4 * smoothstep(uTop-2.6, uTop-0.7, h);
    float wob = 0.72 + 0.56*vnoise(vec3(p.y*0.45, p.x*0.10+3.3, p.z*0.10));
    rad *= mix(0.95, wob, smoothstep(uBase, uBase+1.5, h));
    float r = length(p.xz - vec2(uCx, uCz));
    float e = 1.0 - smoothstep(rad*0.30, rad, r);
    e *= smoothstep(uBase-0.30, uBase+0.30, h);
    e *= 1.0 - smoothstep(uTop-0.4, uTop+0.35, h);
    return e;
  }

  float density(vec3 p){
    float d = 0.0;
    if(uMode > 0.5){
      // 流体の雲水量 + サブグリッドのディテールノイズ (薄い霧状の成分はカット)
      float raw = max(qcAt(p)-0.00025, 0.0)*460.0;
      if(raw > 0.015){
        float det = fbm3(p*1.35 + vec3(0.0, -uTime*0.06, 0.0));
        d = max(raw - det*0.55*clamp(1.5-raw, 0.0, 1.0), 0.0);
      }
    } else {
      float e = envelope(p);
      if(e > 0.004){
        vec3 q = p*0.34 + vec3(uTime*0.02, -uTime*0.055, 0.0);
        q.xz += (vnoise(p*0.13 + vec3(7.7)) - 0.5) * 2.6;
        float n = fbm5(q);
        d = clamp(e*1.15 + n*1.5 - 1.38, 0.0, 1.0);
        if(d > 0.01){
          float det = fbm3(p*1.6 + vec3(0.0, -uTime*0.09, 0.0));
          d = clamp(d - (1.0-clamp(e*1.8,0.0,1.0))*det*0.5, 0.0, 1.0);
        }
      }
      // まわりに浮かぶ小さな積雲の層 (解析モードのみ)
      if(uCumu > 0.01 && p.y > uBase-0.1 && p.y < uBase+0.9){
        float f = fbm5(vec3(p.x*0.16, p.y*0.6, p.z*0.16) + vec3(uTime*0.012, 0.0, 3.7));
        float c = clamp((f - 1.12 + uCumu*0.38)*1.6, 0.0, 0.55);
        c *= smoothstep(uBase-0.1, uBase+0.12, p.y) * (1.0 - smoothstep(uBase+0.55, uBase+0.9, p.y));
        d += c;
      }
    }
    // 雨柱
    if(uRain > 0.02 && p.y < uBase+0.2 && p.y > 0.0){
      float rr = length(p.xz - vec2(uCx, uCz));
      float shaft = (1.0 - smoothstep(uRad*0.35, uRad*0.8, rr)) * uRain * 0.08;
      shaft *= 0.6 + 0.4*vnoise(vec3(p.x*2.2, p.y*0.35 - uTime*1.4, p.z*2.2));
      d += shaft;
    }
    return d;
  }

  float hg(float mu, float g){
    float g2 = g*g;
    return (1.0-g2) / (4.18879 * pow(1.0+g2-2.0*g*mu, 1.5));
  }

  float lightMarch(vec3 p){
    float s = 0.0, ds = 0.35;
    for(int i=0;i<5;i++){
      p += uSunDir*ds;
      s += density(p)*ds;
      ds *= 1.35;
    }
    return s;
  }

  vec3 skyCol(vec3 rd){
    float t = clamp(rd.y*1.7 + 0.12, 0.0, 1.0);
    vec3 c = mix(uHorizon, uZenith, pow(t, 0.68));
    float mu = dot(rd, uSunDir);
    float mup = max(mu, 0.0);
    c += uSunCol * (pow(mup, 4.0)*0.10 + pow(mup, 32.0)*0.30);
    if(uSunDir.y > -0.05) c += uSunCol * smoothstep(0.99955, 0.99985, mu) * 24.0;
    if(uNight > 0.02 && rd.y > 0.02){
      float s = hash13(floor(rd*230.0));
      if(s > 0.9975) c += uNight * vec3(0.75,0.8,0.9) * (fract(s*713.7)*0.7+0.3);
    }
    return c;
  }

  vec3 groundCol(vec3 p, vec3 rd, float dist){
    vec3 c;
    float n = vnoise(vec3(p.xz*0.8, 0.0));
    if(uGType < 0.5){        // 海
      c = vec3(0.020,0.045,0.075) * (0.8+0.3*n);
      vec3 refl = reflect(rd, vec3(0.0,1.0,0.0));
      float spec = pow(max(dot(refl, uSunDir), 0.0), 90.0);
      c += uSunCol * spec * 0.9 * (0.35 + 0.65*vnoise(vec3(p.xz*3.0, uTime*0.6)));
      c += mix(uHorizon, uZenith, 0.3) * 0.10;
    } else if(uGType < 1.5){ // 草原
      c = vec3(0.055,0.085,0.035) * (0.7+0.5*n);
    } else if(uGType < 2.5){ // 森
      c = vec3(0.030,0.055,0.030) * (0.6+0.5*n);
    } else {                 // 都市
      c = vec3(0.055,0.055,0.062) * (0.7+0.4*n);
      if(uNight > 0.15){
        vec2 cell = floor(p.xz*3.0);
        float h = hash21(cell);
        if(h > 0.55){
          vec2 f = fract(p.xz*3.0) - 0.5;
          float glow = exp(-dot(f,f)*30.0);
          c += vec3(1.0,0.72,0.38) * uNight * 0.9 * glow * (h-0.55)/0.45 * exp(-dist*0.035);
        }
      }
    }
    // 雲の影
    if(uMode > 0.5){
      float sh = qcAt(vec3(p.x, 1.5, p.z)) + qcAt(vec3(p.x, 3.0, p.z)) + qcAt(vec3(p.x, 5.0, p.z));
      c *= 1.0 - clamp(sh*250.0, 0.0, 0.7);
    } else {
      float depth = uTop - uBase;
      if(depth > 0.3){
        float r = length(p.xz - vec2(uCx, uCz));
        float sh = 1.0 - smoothstep(uRad*0.6, uRad*1.5, r);
        c *= 1.0 - sh * clamp(depth/8.0, 0.0, 0.75) * (0.35 + 0.4*uRain);
      }
    }
    c *= clamp(uSunDir.y + 0.18, 0.06, 1.0) * 1.6;
    return c;
  }

  // 流体領域AABBとの交差
  vec2 boxT(vec3 ro, vec3 rd){
    vec3 inv = 1.0/rd;
    vec3 t0 = (DMIN-ro)*inv, t1 = (DMAX-ro)*inv;
    vec3 tmin = min(t0,t1), tmax = max(t0,t1);
    return vec2(max(max(tmin.x,tmin.y),tmin.z), min(min(tmax.x,tmax.y),tmax.z));
  }

  void main(){
    vec2 uv = (2.0*gl_FragCoord.xy - uRes) / uRes.y;
    vec3 rd = normalize(uFwd + uRight*uv.x*TANV + uUp*uv.y*TANV);
    vec3 ro = uRO;

    float tG = 1e5;
    if(rd.y < -0.001) tG = (0.0-ro.y) / rd.y;
    vec3 bg;
    if(tG < 1e4){
      vec3 gp = ro + rd*tG;
      bg = groundCol(gp, rd, tG);
      float fog = 1.0 - exp(-tG*0.030);
      bg = mix(bg, mix(uHorizon, uZenith, 0.06)*0.92, fog);
    } else {
      bg = skyCol(rd);
    }

    float depth = uTop - uBase;
    vec3 acc = vec3(0.0);
    float T = 1.0;
    float firstT = -1.0;
    bool anyCloud = uMode > 0.5 || depth > 0.05 || uRain > 0.02 || uCumu > 0.01;
    if(anyCloud){
      float tEnter, tExit;
      if(uMode > 0.5){
        vec2 bt = boxT(ro, rd);
        tEnter = max(bt.x, 0.0);
        tExit = min(bt.y, min(tG, 80.0));
      } else {
        float slabTop = max(uTop, uBase + 1.0) + 0.6;
        float t0 = (0.03 - ro.y)/rd.y, t1 = (slabTop - ro.y)/rd.y;
        tEnter = max(min(t0,t1), 0.0);
        tExit  = min(max(t0,t1), min(tG, 60.0));
        if(abs(rd.y) < 1e-4){ tEnter = 0.0; tExit = min(tG, 60.0); }
      }
      if(tExit > tEnter){
        float mu = dot(rd, uSunDir);
        float phase = mix(hg(mu, 0.55), hg(mu, -0.2), 0.42);
        float jitter = hash21(gl_FragCoord.xy);
        const float FINE = 0.16;
        float t = tEnter + jitter*0.3;
        bool wasIn = false;
        for(int i=0;i<110;i++){
          if(t > tExit || T < 0.012) break;
          vec3 p = ro + rd*t;
          float d = density(p);
          if(d > 0.003){
            if(!wasIn){
              wasIn = true;
              t = max(t - 0.4, tEnter);
              p = ro + rd*t;
              d = density(p);
            }
            if(d > 0.003){
              if(firstT < 0.0) firstT = t;
              float sh = lightMarch(p);
              float lT = exp(-sh*18.0);
              float powder = 1.0 - exp(-(sh + d*0.3)*14.0);
              float hrel = uMode > 0.5 ? clamp(p.y/9.0, 0.0, 1.0)
                                       : clamp((p.y-uBase)/max(depth,1.0), 0.0, 1.0);
              float gloom = 1.0 - uRain * 0.65 * (1.0 - hrel);
              vec3 amb = mix(uHorizon, uZenith, hrel) * (0.22 + 0.38*hrel) * gloom;
              vec3 sun = uSunCol * lT * mix(0.7, 1.0, powder) * phase * 4.4 * gloom;
              vec3 fl  = vec3(0.85,0.9,1.3) * uFlash * 7.0 * exp(-length(p-uFlashPos)*0.55);
              float sig = 42.0 * d;
              acc += T * (sun + amb + fl) * sig * FINE;
              T *= exp(-sig*FINE);
            }
            t += FINE;
          } else {
            wasIn = false;
            t += 0.5 + t*0.006;
          }
        }
      }
    }
    if(firstT > 0.0){
      float aer = 1.0 - exp(-firstT*0.012);
      acc = mix(acc, mix(uHorizon, uZenith, 0.35)*(1.0-T), aer);
    }
    vec3 col = bg*T + acc;

    col = 1.0 - exp(-col*1.25);
    col = pow(col, vec3(0.4545));
    vec2 vuv = gl_FragCoord.xy/uRes - 0.5;
    col *= 1.0 - dot(vuv,vuv)*0.22;
    col += (hash21(gl_FragCoord.xy + fract(uTime)*61.0) - 0.5) * 0.02;
    outC = vec4(col, 1.0);
  }`;

  let gl = null, prog = null, canvas = null, quad = null;
  const loc = {};
  const UNIFORMS = ["uRes","uTime","uSunDir","uSunCol","uZenith","uHorizon","uNight",
    "uBase","uTop","uRad","uAnvil","uRain","uFlash","uFlashPos","uCx","uCz","uCumu","uGType",
    "uRO","uFwd","uUp","uRight","uMode","uVol"];

  function compile(type, src){
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if(!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      throw new Error("shader: " + gl.getShaderInfoLog(s));
    return s;
  }

  function init(c){
    canvas = c;
    gl = canvas.getContext("webgl2", { antialias: false, alpha: false, depth: false });
    if(!gl) return false;
    prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if(!gl.getProgramParameter(prog, gl.LINK_STATUS))
      throw new Error("link: " + gl.getProgramInfoLog(prog));
    quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
    for(const u of UNIFORMS) loc[u] = gl.getUniformLocation(prog, u);
    return true;
  }

  function context(){ return gl; }

  function resize(w, h, scale){
    canvas.width  = Math.max(2, Math.round(w * scale));
    canvas.height = Math.max(2, Math.round(h * scale));
  }

  function render(u){
    gl.useProgram(prog);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    gl.uniform2f(loc.uRes, canvas.width, canvas.height);
    gl.uniform1f(loc.uTime, u.time);
    gl.uniform3fv(loc.uSunDir, u.sunDir);
    gl.uniform3fv(loc.uSunCol, u.sunCol);
    gl.uniform3fv(loc.uZenith, u.zenith);
    gl.uniform3fv(loc.uHorizon, u.horizon);
    gl.uniform1f(loc.uNight, u.night);
    gl.uniform1f(loc.uBase, u.base);
    gl.uniform1f(loc.uTop, u.top);
    gl.uniform1f(loc.uRad, u.rad);
    gl.uniform1f(loc.uAnvil, u.anvil);
    gl.uniform1f(loc.uRain, u.rain);
    gl.uniform1f(loc.uFlash, u.flash);
    gl.uniform3fv(loc.uFlashPos, u.flashPos);
    gl.uniform1f(loc.uCx, u.cx);
    gl.uniform1f(loc.uCz, u.cz);
    gl.uniform1f(loc.uCumu, u.cumu);
    gl.uniform1f(loc.uGType, u.gtype);
    gl.uniform3fv(loc.uRO, u.ro);
    gl.uniform3fv(loc.uFwd, u.fwd);
    gl.uniform3fv(loc.uUp, u.up);
    gl.uniform3fv(loc.uRight, u.right);
    gl.uniform1f(loc.uMode, u.mode);
    gl.activeTexture(gl.TEXTURE0);
    if(u.volTex) gl.bindTexture(gl.TEXTURE_2D, u.volTex);
    gl.uniform1i(loc.uVol, 0);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  return { init, resize, render, context };
})();
