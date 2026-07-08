// ==========================================================================
// Firebase 設定（世界共通ランキングを有効にするにはここを書き換える）
// --------------------------------------------------------------------------
// 手順:
//   1. https://console.firebase.google.com/ で無料プロジェクトを作成
//   2. 「ウェブアプリを追加」して表示される firebaseConfig をコピー
//   3. 下の window.FLAPPY_FIREBASE_CONFIG = { ... } の中身を貼り替える
//   4. Firebase コンソールで「Authentication → ログイン方法 → 匿名」を有効化
//   5. 「Firestore Database」を作成（本番/テストどちらでも可）し、ルールを設定
//      （詳しい手順・推奨ルールは README.md を参照）
//
// このファイルを書き換えなければ、ランキングは自動的に「この端末だけのローカル保存」
// で動作します（ゲーム自体は常に遊べます）。
// なお apiKey などは公開して問題ない値です（アクセス制御は Firestore のルールで行う）。
// ==========================================================================

window.FLAPPY_FIREBASE_CONFIG = {
  apiKey:            "AIzaSyBHX-kxzJVM3l9_3RZN-89sFlv5DWkHods",
  authDomain:        "abcdd-c3d0a.firebaseapp.com",
  projectId:         "abcdd-c3d0a",
  storageBucket:     "abcdd-c3d0a.firebasestorage.app",
  messagingSenderId: "449731343890",
  appId:             "1:449731343890:web:25ce352b5e8260ccf54acb",
};

// ランキングを分ける名前空間（複数ゲームで同じ Firebase を使うとき以外は変更不要）
window.FLAPPY_APP_ID = "flappy-byte";
