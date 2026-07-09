// ランキングのバックエンド
//   - firebase-config.js が正しく設定されていれば「世界共通ランキング」(global)
//   - 未設定 / 読み込み失敗時は「この端末だけのローカル保存」(local) に自動フォールバック
//
// game.js からは window.LB を通して以下の形で利用する:
//   window.LB.mode              'global' | 'local'
//   window.LB.getUid()          自分の識別子（自分の記録をハイライトする用）
//   await window.LB.save(name, score, diff)
//   await window.LB.top(diff)   → [{ name, score, difficulty, timestamp, uid }, ...] (score降順)
//
// レベル（難易度 diff: normal / hard / insane / gravity）ごとに別ランキングとして扱う。
//
// 記録は「1プレイヤー×1難易度につき1件」だけ保持し、より高いスコアを出したときのみ
// 上書き更新する（同じ人が同じレベルに何行も並ばない）。
// ==========================================================================

const LOCAL_KEY = 'flappy-byte-local-leaderboard';
const UID_KEY   = 'flappy-byte-uid';
const MAX_KEEP  = 200; // ローカル保存で保持する最大件数
const TOP_N     = 50;  // 表示する上位件数

function ensureUid() {
  let u = null;
  try { u = localStorage.getItem(UID_KEY); } catch (e) {}
  if (!u) {
    u = 'u-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    try { localStorage.setItem(UID_KEY, u); } catch (e) {}
  }
  return u;
}

function readLocal() {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]'); }
  catch (e) { return []; }
}
function writeLocal(list) {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(list)); } catch (e) {}
}

// --- ローカル実装（既定 / フォールバック） ------------------------------------
const localBackend = {
  mode: 'local',
  ready: Promise.resolve('local'),
  getUid: () => ensureUid(),
  async save(name, score, diff) {
    const uid = ensureUid();
    const entry = {
      name: (name || '名無し').slice(0, 15),
      score: Number(score) || 0,
      difficulty: diff,
      timestamp: Date.now(),
      uid,
    };
    const list = readLocal();
    const idx = list.findIndex(e => e.uid === uid && e.difficulty === diff);
    if (idx >= 0) {
      if (entry.score > (Number(list[idx].score) || 0)) list[idx] = entry;
    } else {
      list.push(entry);
    }
    list.sort((a, b) => b.score - a.score);
    writeLocal(list.slice(0, MAX_KEEP));
  },
  async top(diff) {
    // 同一プレイヤー(uid)は最高記録の1件だけに絞る（過去に重複保存されたデータも吸収）
    const best = new Map();
    for (const e of readLocal()) {
      if (e.difficulty !== diff) continue;
      const key = e.uid || ('name:' + e.name);
      const cur = best.get(key);
      if (!cur || (Number(e.score) || 0) > (Number(cur.score) || 0)) best.set(key, e);
    }
    return [...best.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_N);
  },
};

// まずローカル実装を即座に有効化（Firebase の初期化を待たずにゲームは常に動く）
window.LB = localBackend;

// --- 世界共通（Firebase / Firestore）へのアップグレードを試みる --------------------
function isConfigured(c) {
  if (!c || typeof c !== 'object') return false;
  const bad = v => !v || String(v).includes('YOUR_');
  return !bad(c.apiKey) && !bad(c.projectId);
}

const cfg = window.FLAPPY_FIREBASE_CONFIG;
const appId = window.FLAPPY_APP_ID || 'flappy-byte-default';

if (isConfigured(cfg)) {
  const FB = 'https://www.gstatic.com/firebasejs/11.6.1/';
  window.LB.ready = (async () => {
    try {
      const [appMod, authMod, fsMod] = await Promise.all([
        import(FB + 'firebase-app.js'),
        import(FB + 'firebase-auth.js'),
        import(FB + 'firebase-firestore.js'),
      ]);
      const { initializeApp } = appMod;
      const { getAuth, signInAnonymously, onAuthStateChanged } = authMod;
      const { getFirestore, collection, doc, getDoc, setDoc, getDocs, query, orderBy, limit } = fsMod;

      const app = initializeApp(cfg);
      const auth = getAuth(app);
      const db = getFirestore(app);

      let uid = null;
      const authReady = new Promise((resolve) => {
        onAuthStateChanged(auth, (user) => {
          uid = user ? user.uid : null;
          if (user) resolve();
        });
      });
      await signInAnonymously(auth);
      await authReady;

      // 難易度ごとに別コレクション（leaderboard-normal-v2 など）に分け、
      // ドキュメントID = uid で「1人1難易度につき1件」だけ保持する。
      // 取得はスコア降順 + limit(TOP_N) で上位だけ読む
      // （単一フィールドの自動インデックスで動くため複合インデックス不要）。
      //
      // LB_VERSION を上げると、削除権限なしでも「世界ランキングの一斉リセット」が
      // できる（旧コレクションを読み書きしなくなり、新しい空のコレクションから始まる）。
      const LB_VERSION = 'v2';
      const colRef = (diff) => collection(db, 'artifacts', appId, 'public', 'data', 'leaderboard-' + diff + '-' + LB_VERSION);

      // 難易度ごとの取得結果キャッシュ（タブ切り替えのたびに再取得しない）
      const cache = new Map(); // diff -> { t: 取得時刻, data: [...] }
      const CACHE_MS = 30 * 1000;

      window.LB.mode = 'global';
      window.LB.getUid = () => uid;
      window.LB.save = async (name, score, diff) => {
        const val = Number(score) || 0;
        const ref = doc(colRef(diff), uid);
        const prev = await getDoc(ref);
        if (prev.exists() && (Number(prev.data().score) || 0) >= val) return; // 記録更新時のみ書き込む
        await setDoc(ref, {
          name: (name || '名無し').slice(0, 15),
          score: val,
          difficulty: diff,
          timestamp: Date.now(),
          uid,
        });
        cache.delete(diff); // 次回表示で最新を取得させる
      };
      window.LB.top = async (diff) => {
        const hit = cache.get(diff);
        if (hit && Date.now() - hit.t < CACHE_MS) return hit.data;
        const snap = await getDocs(query(colRef(diff), orderBy('score', 'desc'), limit(TOP_N)));
        const out = [];
        snap.forEach(d => out.push(d.data()));
        cache.set(diff, { t: Date.now(), data: out });
        return out;
      };

      console.info('[leaderboard] 世界共通ランキング(global)モードで動作中');
      return 'global';
    } catch (e) {
      console.warn('[leaderboard] Firebase 初期化に失敗したためローカル保存に切り替えます:', e);
      // localBackend のまま（window.LB は既にローカル実装）
      window.LB.mode = 'local';
      return 'local';
    }
  })();
} else {
  console.info('[leaderboard] Firebase 未設定のためローカル保存(local)モードで動作中');
}