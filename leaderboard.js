// ==========================================================================
// ランキングのバックエンド (期間別・日時表示対応版 v3)
// ==========================================================================

const LOCAL_KEY = 'flappy-byte-local-history-v3';
const UID_KEY   = 'flappy-byte-uid';
const MAX_KEEP  = 3000; // ローカル保存で保持する最大履歴件数
const TOP_N     = 50;   // 表示する上位件数

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

// 期間キーの計算（今日、今週、今年）
function getPeriodKeys() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  
  // 今年の第何週か（日曜日始まり）
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const pastDaysOfYear = (now.getTime() - startOfYear.getTime()) / 86400000;
  const weekNum = Math.ceil((pastDaysOfYear + startOfYear.getDay() + 1) / 7);

  return {
    daily: `${yyyy}${mm}${dd}`,
    weekly: `${yyyy}W${String(weekNum).padStart(2, '0')}`,
    yearly: `${yyyy}`,
    all: 'all'
  };
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
    list.push(entry);
    
    // データが膨大になるのを防ぐため、古い履歴から削除
    if (list.length > MAX_KEEP) list.splice(0, list.length - MAX_KEEP);
    writeLocal(list);
  },
  async top(diff, period = 'all') {
    const now = new Date();
    let startTime = 0;
    
    // 期間によるフィルタリング基準時刻
    if (period === 'daily') {
      startTime = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    } else if (period === 'weekly') {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      d.setDate(d.getDate() - d.getDay()); // 直近の日曜日まで戻る
      startTime = d.getTime();
    } else if (period === 'yearly') {
      startTime = new Date(now.getFullYear(), 0, 1).getTime();
    }

    const best = new Map();
    for (const e of readLocal()) {
      if (e.difficulty !== diff) continue;
      if (e.timestamp < startTime) continue;
      
      const key = e.uid || ('name:' + e.name);
      const cur = best.get(key);
      if (!cur || (Number(e.score) || 0) > (Number(cur.score) || 0)) best.set(key, e);
    }
    return [...best.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_N);
  },
};

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
      // 修正: query, orderBy, limit を追加インポート
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

      const cache = new Map(); 
      const CACHE_MS = 30 * 1000;

      window.LB.mode = 'global';
      window.LB.getUid = () => uid;
      
      window.LB.save = async (name, score, diff) => {
        const val = Number(score) || 0;
        const periods = getPeriodKeys();
        
        const promises = Object.entries(periods).map(async ([periodType, periodKey]) => {
          const colName = `leaderboard-${diff}-${periodType}-${periodKey}-v3`;
          const ref = doc(collection(db, 'artifacts', appId, 'public', 'data', colName), uid);
          
          const prev = await getDoc(ref);
          if (prev.exists() && (Number(prev.data().score) || 0) >= val) return; 
          
          await setDoc(ref, {
            name: (name || '名無し').slice(0, 15),
            score: val,
            difficulty: diff,
            timestamp: Date.now(),
            uid,
          });
        });
        
        await Promise.all(promises);
        cache.clear(); 
      };
      
      window.LB.top = async (diff, period = 'all') => {
        const periodKey = getPeriodKeys()[period] || 'all';
        const cacheKey = `${diff}-${period}-${periodKey}`;
        const hit = cache.get(cacheKey);
        
        if (hit && Date.now() - hit.t < CACHE_MS) return hit.data;
        
        const colName = `leaderboard-${diff}-${period}-${periodKey}-v3`;
        const colRef = collection(db, 'artifacts', appId, 'public', 'data', colName);
        
        // 修正: パフォーマンスとコストのためにFirestore側でソートと制限を行う
        const q = query(colRef, orderBy('score', 'desc'), limit(TOP_N));
        const snap = await getDocs(q);
        
        const out = [];
        snap.forEach(d => out.push(d.data()));
        
        cache.set(cacheKey, { t: Date.now(), data: out });
        return out;
      };

      console.info('[leaderboard] 世界共通ランキング(global)モードで動作中');
      return 'global';
    } catch (e) {
      console.warn('[leaderboard] Firebase 初期化に失敗:', e);
      window.LB.mode = 'local';
      return 'local';
    }
  })();
} else {
  console.info('[leaderboard] Firebase 未設定のためローカル保存(local)モードで動作中');
}