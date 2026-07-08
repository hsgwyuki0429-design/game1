# Flappy Byte

Flappy Bird 風のブラウザゲーム。難易度（レベル）別のポイントランキングを備えています。

- **レベル別ランキング**: ノーマル / ハード / 鬼 / 重力反転 それぞれ独立した上位ランキング。
- **自己ベスト時の名前登録**: 自己ベストを更新すると名前入力ダイアログが出て、その名前でランキングに登録されます。
- **世界共通ランキング**: Firebase を設定すると、世界中のプレイヤーと同じランキングを競えます。
- **未設定でも動作**: Firebase 未設定・オフライン・読み込み失敗時は、自動でその端末だけの「ローカル保存」ランキングに切り替わります（ゲームは常に遊べます）。

## ファイル構成

| ファイル | 役割 |
| --- | --- |
| `index.html` | 画面。スクリプトの読み込み順を定義。 |
| `game.js` | ゲーム本体。ランキングは `window.LB` 経由で読み書き。 |
| `leaderboard.js` | ランキングのバックエンド。設定があれば世界共通(global)、なければローカル(local)。 |
| `firebase-config.js` | **ここに Firebase の設定を貼る**（世界共通ランキングを使うとき）。 |

## 世界共通ランキングを有効にする手順

1. [Firebase コンソール](https://console.firebase.google.com/) で無料プロジェクトを作成。
2. プロジェクト設定 →「マイアプリ」→「ウェブアプリを追加」。表示される `firebaseConfig`（apiKey などの一式）をコピー。
3. `firebase-config.js` の `window.FLAPPY_FIREBASE_CONFIG = { ... }` の中身を、コピーした値に貼り替える。
   （`apiKey` などクライアントに公開される値です。アクセス制御は下記の Firestore ルールで行います。）
4. Firebase コンソールで **Authentication → ログイン方法 → 匿名** を有効化。
5. **Firestore Database** を作成し、ルールを以下に設定して公開:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       // 難易度ごとのランキング（leaderboard-normal / -hard / -insane / -gravity）。
       // 1人1難易度につき1ドキュメント（ドキュメントID = 自分のuid）で、
       // より高いスコアを出したときだけ上書きできる。
       match /artifacts/{appId}/public/data/{board}/{userId} {
         allow read: if true;
         allow create: if request.auth != null
           && userId == request.auth.uid
           && request.resource.data.uid == request.auth.uid
           && request.resource.data.score is number;
         allow update: if request.auth != null
           && userId == request.auth.uid
           && request.resource.data.uid == request.auth.uid
           && request.resource.data.score is number
           && request.resource.data.score > resource.data.score;
         allow delete: if false;
       }
     }
   }
   ```

   （誰でも閲覧可・ログイン済みユーザーが自分の記録のみ登録可・記録更新時のみ上書き可・削除は不可。）

   > **注意（旧バージョンからの更新）**: 以前は全難易度を 1 つの `leaderboard`
   > コレクションに追記していましたが、現在は難易度ごとの
   > `leaderboard-<難易度>` コレクションに「1人1件」で保存する方式に変わりました。
   > 既に運用中の場合は Firestore ルールを上記に更新してください
   > （旧ルールのままだと新しい記録が書き込めません）。旧 `leaderboard`
   > コレクションのデータはランキングに表示されなくなるため、不要なら
   > コンソールから削除して構いません。
   >
   > **世界ランキングを丸ごとリセットしたいとき**: `leaderboard.js` の
   > `LB_VERSION` の値を上げてください（例: `'v2'` → `'v3'`）。コレクション名が
   > `leaderboard-<難易度>-<LB_VERSION>` に変わり、削除権限なしでも
   > 空のランキングから再スタートできます。旧バージョンのデータは
   > Firestore 上に残ったままなので、不要ならコンソールから削除してください。

設定が正しければ、ランキング画面のタイトルが「🏆 世界ランキング」になり、
「🌐 世界中のプレイヤーと共通」と表示されます。未設定のときは「📱 この端末に保存中」になります。

## ローカルでの動作確認

```
python3 -m http.server 8000
# ブラウザで http://localhost:8000/ を開く
```

`file://` で直接開くと ES モジュール（`leaderboard.js`）が読めないため、上記のように
簡易サーバー経由で開いてください（GitHub Pages ではそのまま動作します）。

## デプロイ

`main` ブランチへ push すると GitHub Pages に自動デプロイされます
（`.github/workflows/deploy-pages.yml`）。
