// ==========================================================================
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
// ==========================================================================

const LOCAL_KEY = 'flappy-byte-local-leaderboard';
const UID_KEY   = 'flappy-byte-uid';
const MAX_KEEP  = 200; // ローカル保存で保持する最大件数
const TOP_N     = 50;  // 表示する上位件数

// 「みんなのベスト」一括リセットの基準時刻。
// これより前に登録されたスコアはランキングに表示しない（＝全員のベストをゼロからに戻す）。
// Firestore のセキュリティルール上クライアントからは過去データを削除できないため、
// この基準時刻で「新シーズン」として扱い、全ユーザーの表示を即リセットする。
const RESET_BEFORE = Date.UTC(2026, 6, 8, 0, 0, 0); // 2026-07-08 00:00 UTC

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
    const list = readLocal();
    list.push({
      name: (name || '名無し').slice(0, 15),
      score: Number(score) || 0,
      difficulty: diff,
      timestamp: Date.now(),
      uid: ensureUid(),
    });
    list.sort((a, b) => b.score - a.score);
    writeLocal(list.slice(0, MAX_KEEP));
  },
  async top(diff) {
    return readLocal()
      .filter(e => e.difficulty === diff && (e.timestamp || 0) >= RESET_BEFORE)
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
      const { getFirestore, collection, addDoc, getDocs } = fsMod;

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

      // 全ゲーム共通のリーダーボードコレクション。難易度(diff)はドキュメントの
      // フィールドで区別し、取得時にクライアント側で絞り込む（複合インデックス不要）。
      const colRef = () => collection(db, 'artifacts', appId, 'public', 'data', 'leaderboard');

      window.LB.mode = 'global';
      window.LB.getUid = () => uid;
      window.LB.save = async (name, score, diff) => {
        await addDoc(colRef(), {
          name: (name || '名無し').slice(0, 15),
          score: Number(score) || 0,
          difficulty: diff,
          timestamp: Date.now(),
          uid,
        });
      };
      window.LB.top = async (diff) => {
        const snap = await getDocs(colRef());
        const out = [];
        snap.forEach(d => {
          const x = d.data();
          if (x.difficulty === diff && (x.timestamp || 0) >= RESET_BEFORE) out.push(x);
        });
        out.sort((a, b) => b.score - a.score);
        return out.slice(0, TOP_N);
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
