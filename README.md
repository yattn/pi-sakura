# pi-sakura

Pi でさくらのAI Engine のモデルを使うための非公式拡張です。 [Pi 公式サイト](https://pi.dev/) ・ [さくらのAI Engine](https://ai.sakura.ad.jp/sakura-ai/ai-engine/)

## インストールと初期設定

Pi 1.6.0 以降と、さくらのAI Engine のアカウントトークンを用意してください。 [アカウントトークンの発行手順](https://manual.sakura.ad.jp/cloud/ai-engine/02-howto.html)

```sh
pi install git:github.com/yattn/pi-sakura
```

1. Pi を起動し、`/login` を実行して `Sakura AI Engine` を選びます。
2. 発行したアカウントトークンを入力します。入力欄は伏せ字で表示され、Pi はトークンを `auth.json` に保存します。
3. `/model` を実行し、使いたいモデルを選びます。

起動時にモデルを指定することもできます。

```sh
pi --provider sakura --model preview/DeepSeek-V4.1-Flash-1017
```

### 環境変数でトークンを渡す場合

`/login` の代わりに、Pi を起動するシェルで環境変数 `SAKURA_AI_TOKEN` を設定できます。

```bash
read -rsp 'Sakura account token: ' SAKURA_AI_TOKEN
printf '\n'
export SAKURA_AI_TOKEN
```

## コマンド

| Pi 内のコマンド | 説明 |
| --- | --- |
| `/model` | 使うモデルを選ぶ |
| `/sakura-sync` | さくらのモデル一覧を取り直す |
| `/sakura-usage` | アカウントの月間利用量と、現在のセッションの利用量・参考料金を確認する |

## 利用量と参考料金

### アカウントの月間利用量（Server Usage）

さくら側の集計をもとに、今月の Chat Completions リクエスト数と契約プランの月間上限を表示します。月の区切りは日本時間です。無償枠の残りは、上限からリクエスト数を引いた目安です。

月間利用量を表示するには、さくらのクラウドの API キーが必要です。対象プロジェクトで発行したキーのアクセストークンとシークレットを、Pi を起動するシェルで設定してください。 [API キーの発行手順](https://manual.sakura.ad.jp/cloud/api/apikey.html)

```bash
read -rsp 'Sakura Cloud access token: ' SAKURA_ACCESS_TOKEN
printf '\n'
read -rsp 'Sakura Cloud access token secret: ' SAKURA_ACCESS_TOKEN_SECRET
printf '\n'
export SAKURA_ACCESS_TOKEN SAKURA_ACCESS_TOKEN_SECRET
```

`/sakura-usage` を実行すると、設定した API キーでコントロールパネルの管理 API（`/auth/` と `/usages/`）に問い合わせます。タイムアウトは 5 秒です。キーが未設定の場合や利用量を取得できない場合も、セッションの集計を表示します。

### セッションの利用量（Session Usage）

現在の Pi セッションに記録された、さくらのモデルからの応答を集計します。会話を途中で分岐した場合は、各ブランチの応答も含めます。

- 応答数は、正常終了、エラー・中断、状態不明に分けて表示します。
- トークン数には、応答や追加の利用量記録に残っている入力・出力のトークンを含めます。使用量が記録されたエラー応答も集計します。
- 参考料金は、記録されたトークン数とさくらの公開単価から求めた円建ての概算です。無償枠や課金の最小単位（10,000 トークン／60 秒）を適用する前の金額です。 [公開単価](https://ai.sakura.ad.jp/sakura-ai/ai-engine/)

Pi 標準のドル建て料金欄には `0` を表示します。実際の請求額は、さくらのコントロールパネルで確認できます。 [コントロールパネル](https://secure.sakura.ad.jp)

## 対応モデル

同梱しているモデルは、いずれもツール呼び出し（Tool Calling）に対応しています。 [さくらの公式モデル仕様（2026 年 11 月 18 日更新）](https://manual.sakura.ad.jp/cloud/ai-engine/chat-models.html)

| モデル | 画像入力 | コンテキスト長 |
| --- | :---: | ---: |
| GPT OSS 120B | × | 131,072 |
| Gemma 4 31B | ○ | 262,144 |
| Qwen3.6 35B A3B | ○ | 262,144 |
| Kimi K2.7 Code | ○ | 262,144 |
| GLM 5.3 Flash | ○ | 1,048,575 |
| DeepSeek V4.1 Flash | ○ | 1,048,575 |

### モデル一覧の更新

Pi がモデル一覧を更新するとき、`pi-sakura` はさくらの `GET /v1/models` を呼び出します。手動で取り直すには `/sakura-sync` を実行してください。

- 取得に成功すると、同梱モデルのうち、API の応答に含まれるモデルだけを Pi に表示します。空の一覧が返ると、さくらのモデルは 0 件になります。
- トークンの未設定や通信エラーなどで一覧を取得できないときは、直前の一覧を使います。初回の取得に成功するまでは、同梱の一覧を使います。
- HTTP `401` や `403` が返ったら、アカウントトークンと権限を確認してください。`/login` で保存したトークンは、さくらの API に接続したときに認証されます。
- 新しいモデルに対応するには、機能と料金を確認し、同梱一覧に追加する必要があります。

`GET /v1/models` は 2026 年 11 月時点で、さくらの公開 API リファレンスに掲載されていません。同梱モデルが Pi に表示されないときは、API の応答にそのモデルの ID があるか確認してください。

### 推論レベル（Thinking）

対応モデルでは、Pi の推論レベル `off`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max` を選べます。

```sh
pi --provider sakura --model preview/DeepSeek-V4.1-Flash-1017 --thinking max
```

Pi 標準の OpenAI 互換処理でリクエストを送ります。`xhigh` と `max` は、そのまま `reasoning_effort` の値として送ります。

モデルや API によっては、指定した推論レベルが無視されたり、エラーが返ったりします。エラー時はモデルや推論レベルを手動で選び直してください。`off` を選んだ場合も、モデル側では推論が行われることがあります。

## 開発

```sh
npm install
npm run check
npm test
npm run smoke
```

`npm run smoke` は、実際の Pi CLI にローカルの拡張を入れて、オフラインでさくらのモデルが一覧に出ることを確認します。

さくらの API を使ったツール呼び出し、推論、画像入力の動作は今後検証します。

## ライセンス

MIT
