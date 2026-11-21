# pi-sakura

[Pi](https://pi.dev/) から [さくらのAI Engine](https://ai.sakura.ad.jp/sakura-ai/ai-engine/) を使うための非公式プロバイダー拡張。

Pi標準の通信処理を利用する。対応モデルの提供状況を照合し、APIトークンの登録と、セッション単位の利用量・円建て参考料金の表示に対応。

## 必要環境

- Pi 1.6.0以降（native provider APIを使用）
- さくらのAI Engineのアカウントトークン

## インストール

```sh
pi install git:github.com/yattn/pi-sakura
```

Pi内で `/login` → `Sakura AI Engine` を選び、発行済みのアカウントトークンを入力する。秘密入力を使い、認証情報はPiの `auth.json` に保存される。さくらの会員ID・パスワードによるログインではない。

環境変数 `SAKURA_AI_TOKEN` を使う場合は以下でも利用できる。

```sh
read -rsp 'Sakura account token: ' SAKURA_AI_TOKEN
printf '\n'
export SAKURA_AI_TOKEN
```

```sh
pi --provider sakura --model preview/DeepSeek-V4.1-Flash-1017
```

## コマンド

| Pi内のコマンド | 説明 |
| --- | --- |
| `/model` | 利用するモデルを選択 |
| `/sakura-sync` | モデル一覧を再取得 |
| `/sakura-usage` | 現在のPiセッションの利用量・円建て参考料金を表示 |

## モデル一覧の更新

さくらの `GET /v1/models` と、公式仕様に基づいて同梱した対応モデル一覧を照合する。

- 取得成功：**既知のTool Calling対応モデル**だけを表示し、提供終了したモデルを隠す
- API未接続・取得失敗・異常な応答：同梱一覧または最後に使えた一覧を保持する
- 未知の新規モデル：能力・料金を確認できるまで登録しない（プラグイン更新が必要）
- Piのモデル一覧更新時に照合し、`/sakura-sync` で手動再取得できる

`/v1/models` は動作報告があるものの、2026年11月時点の公式Inference APIリファレンスには掲載されていない。将来使えなくなる可能性があるため必須機能にはしていない。

## 対応モデル

[公式モデル仕様](https://manual.sakura.ad.jp/cloud/ai-engine/chat-models.html)（2026年11月18日更新）に掲載されたTool Calling対応モデルのみ。

| モデル | 画像入力 | コンテキスト長 |
| --- | :---: | ---: |
| GPT OSS 120B | × | 131,072 |
| Gemma 4 31B | ○ | 262,144 |
| Qwen3.6 35B A3B | ○ | 262,144 |
| Kimi K2.7 Code | ○ | 262,144 |
| GLM 5.3 Flash | ○ | 1,048,575 |
| DeepSeek V4.1 Flash | ○ | 1,048,575 |

## 利用量と料金表示の制約

`/sakura-usage` は**現在のPiセッションファイルの応答を集計**する。同じセッション内で別の会話ブランチに移動した場合も、既に発生したAPI呼び出しは集計対象。

- トークン数：Piが記録したレスポンスの使用量
- 円建て参考料金：[さくらの公開単価](https://ai.sakura.ad.jp/sakura-ai/ai-engine/)から単純計算した値
- 無償枠：Chat Completions全体で月3,000リクエストという**上限の参考情報のみ**を表示

**実際の請求額・無料枠残量ではない。** 他のPiセッション・アプリ・失敗したリクエストは取得しない。また、無料枠や従量課金時の最小単位（10,000トークン／60秒）も再現していない。

Pi標準のドル建て料金欄は暫定的に0にして、円建て参考料金を別コマンドで表示する。実際の請求額・利用枠は[さくらのコントロールパネル](https://secure.sakura.ad.jp)で確認すること。

## 今後の検証

- さくらのAPIトークンを使ったTool Calling、Reasoning、画像入力の実通信検証
- 未知の新規モデルのメタデータ更新
- さくらが利用量・請求管理APIを提供した場合の連携

APIエラー時のモデル自動切替とモデル別の高度な互換性補正は実装していない。

## 開発

```sh
npm install
npm run check
npm test
```

## ライセンス

MIT
