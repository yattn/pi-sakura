# pi-sakura

[Pi](https://pi.dev/) から [さくらのAI Engine](https://ai.sakura.ad.jp/sakura-ai/ai-engine/) を使うための非公式プロバイダー拡張。

Pi標準の通信処理を利用する。取得したモデル一覧に合わせて登録モデルを更新し、APIトークンの登録、アカウントの月間利用量、セッションの利用量と円建て参考料金の表示に対応。

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
| `/sakura-sync` | モデル一覧を再取得してPiのモデル選択肢を更新 |
| `/sakura-usage` | アカウントの月間利用量と、現在のPiセッションの利用量・円建て参考料金を表示 |

## モデル一覧の更新

さくらの `GET /v1/models` と、公式仕様に基づいて同梱した対応モデル一覧を照合する。

- 取得成功：**同梱済みの対応モデルと取得結果の共通部分だけを表示**する。取得結果にないモデルはPiの一覧から除外する（空の一覧なら0件）
- APIトークン未設定・通信失敗・異常な応答：現在のモデル一覧を維持する。初回起動時は同梱一覧を使用する
- HTTP 401/403：認証または権限の問題として表示する。`/login` はトークンの保存のみであり、登録時点で有効性は検証しない
- 未知の新規モデル：能力・料金が確認できるまで登録しない（プラグイン更新が必要）
- Piのモデル一覧更新時に取得し、`/sakura-sync` で手動再取得できる

`/v1/models` は動作報告があるものの、2026年11月時点の公式Inference APIリファレンスには掲載されていない。**取得成功時は一覧にないモデルを除外する**。取得結果が不完全な可能性もあるため、必要に応じて利用者自身がAPIの取得結果を確認すること。API取得に失敗した場合は現在のモデル一覧を維持する。

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

## 推論レベル（Thinking）

全モデルでPiの7段階（`off` / `minimal` / `low` / `medium` / `high` / `xhigh` / `max`）を選択できる。モデルごとの対応レベルによる制限や、自動補正・エラー時の自動切替は行わない。

```sh
pi --provider sakura --model preview/DeepSeek-V4.1-Flash-1017 --thinking max
```

**選択できることは、さくら側での対応を保証しない。** Pi標準のOpenAI互換通信を利用し、`xhigh` と `max` はそれぞれ同名の `reasoning_effort` 値として送信を試みる。モデルやAPIによっては値が無視されたり、エラーになる可能性がある。`off` は推論を明示的に無効化する指定ではなく、Pi標準の動作に従うため、モデル側で推論が続く場合もある。

## 利用量と参考料金

### Server Usage

さくらが集計した今月（日本時間）の Chat Completions のリクエスト数と契約プランの月間上限を表示する。無償枠の残りは、この2つの値の差から求めた目安。

利用するには、対象プロジェクトで発行した[さくらのクラウドのAPIキー](https://manual.sakura.ad.jp/cloud/api/apikey.html)のアクセストークンとシークレットを Pi の起動環境に設定する。推論用の `SAKURA_AI_TOKEN` は、AI Engine のアカウントトークンを引き続き使う。

```bash
read -rsp 'Sakura Cloud access token: ' SAKURA_ACCESS_TOKEN
printf '\n'
read -rsp 'Sakura Cloud access token secret: ' SAKURA_ACCESS_TOKEN_SECRET
printf '\n'
export SAKURA_ACCESS_TOKEN SAKURA_ACCESS_TOKEN_SECRET
```

この機能は任意。両方の環境変数を設定すると、`/sakura-usage` の実行時にコントロールパネルが使う管理APIの `/auth/` と `/usages/` を読み取る。タイムアウトは5秒。設定がそろっていない場合や取得に失敗した場合も、セッションの集計を表示する。

### Session Usage

現在のPiセッションファイルに保存された全ブランチを集計する。記録済みのレスポンスを正常終了、エラー・中断、状態不明に分けて表示する。トークン数には、使用量が記録されたエラー応答と追加利用量エントリも含む。

円建て参考料金は、記録されたトークン数と[さくらの公開単価](https://ai.sakura.ad.jp/sakura-ai/ai-engine/)から計算する。無償枠の適用と課金の最小単位（10,000トークン／60秒）を反映する前の金額。Pi標準のドル建て料金欄は0を表示する。実際の請求額は[さくらのコントロールパネル](https://secure.sakura.ad.jp)で確認できる。

## 今後の検証

- さくらのAPIトークンを使ったTool Calling、Reasoning、画像入力の実通信検証
- 未知の新規モデルのメタデータ更新

APIエラー時のモデル自動切替とモデル別の高度な互換性補正は実装していない。

## 開発

```sh
npm install
npm run check
npm test
npm run smoke
```

`smoke` は実際のPi CLIにローカルパッケージをインストールし、ネットワークを無効化してモデルを列挙する検査。実際のさくらのAPIトークンや課金は使用しない。

## ライセンス

MIT
