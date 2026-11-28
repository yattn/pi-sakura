# pi-sakura

Pi でさくらのAI Engine のモデルを使うための非公式拡張です。 [Pi 公式サイト](https://pi.dev/) ・ [さくらのAI Engine](https://ai.sakura.ad.jp/sakura-ai/ai-engine/)

## インストールと初期設定

Pi 1.6.0 以降と、さくらのAI Engine のアカウントトークンを用意してください。 [アカウントトークンの発行手順](https://manual.sakura.ad.jp/cloud/ai-engine/02-howto.html)

```sh
pi install git:github.com/yattn/pi-sakura
```

1. Pi を起動し、`/login` で `Sign in with an API key` を選びます。次の画面で `sakura` と入力し、`Sakura AI Engine` を選びます。
2. 発行したアカウントトークンを入力します。Pi 1.6.1 では、入力した文字が画面に表示されます。トークンの保存先は Pi の `auth.json` です。
3. `/model` を実行し、使いたいモデルを選びます。

起動時にモデルを指定することもできます。

```sh
pi --provider sakura --model preview/DeepSeek-V4.1-Flash-1017
```

### 環境変数でトークンを渡す場合

`/login` の代わりに、Bash でトークンを画面に出さずに入力できます。`SAKURA_AI_TOKEN` を設定したシェルから Pi を起動してください。

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

月間利用量を表示するには、対象プロジェクトで発行したさくらのクラウド API キーが必要です。 [API キーの発行手順](https://manual.sakura.ad.jp/cloud/api/apikey.html)

1. Pi で `/login sakura-usage` を実行します。
2. クラウド API キーのアクセストークン、シークレットの順に入力します。Pi 1.6.0、1.6.1、1.7.0 では、入力した文字が画面に表示されます。
3. `/sakura-usage` を実行します。

キーは Pi の `auth.json` に `sakura-usage` として保存されます。削除するには `/logout` で `Sakura Cloud Usage` を選びます。

環境変数を使う場合は、次のように設定して同じシェルから Pi を起動します。Pi に保存したキーがある場合は、そちらを優先します。

```bash
read -rsp 'Sakura Cloud access token: ' SAKURA_ACCESS_TOKEN
printf '\n'
read -rsp 'Sakura Cloud access token secret: ' SAKURA_ACCESS_TOKEN_SECRET
printf '\n'
export SAKURA_ACCESS_TOKEN SAKURA_ACCESS_TOKEN_SECRET
```

`/sakura-usage` を実行すると、設定した API キーでコントロールパネルの管理 API（`/auth/` と `/usages/`）に問い合わせます。タイムアウトは 5 秒です。キーが未設定の場合や利用量を取得できない場合も、セッションの集計を表示します。

### スクリプトから今月のリクエスト数を取得する

`pi-sakura` のディレクトリで、Node.js 22.19 以降を使って実行できます。

```sh
node scripts/sakura-usage.ts
```

日本時間で今月の Chat Completions リクエスト数を、整数 1 行で出力します。Pi の `auth.json` に保存した `sakura-usage` のキーを優先し、未登録なら環境変数を使います。`PI_CODING_AGENT_DIR` を指定している場合は、そのディレクトリの `auth.json` を読みます。取得に失敗すると、標準出力は空で終了コードは `1` です。

### セッションの利用量（Session Usage）

現在の Pi セッションに記録された、さくらのモデルからの応答を集計します。会話を途中で分岐した場合は、各ブランチの応答も含めます。

- 応答数は、正常終了、エラー・中断、状態不明に分けて表示します。
- トークン数には、応答や追加の利用量記録に残っている入力・出力のトークンを含めます。使用量が記録されたエラー応答も集計します。
- 参考料金は、記録されたトークン数とさくらの公開単価から求めた円建ての概算です。無償枠や課金の最小単位（10,000 トークン／60 秒）を適用する前の金額です。 [公開単価](https://ai.sakura.ad.jp/sakura-ai/ai-engine/)

Pi のドル建て集計では、さくらの利用分を 0 ドルとして扱います。実際の請求額は、さくらのコントロールパネルで確認できます。 [コントロールパネル](https://secure.sakura.ad.jp)

## 対応モデル

同梱モデルはすべてツール呼び出し（Tool Calling）に対応しています。表の画像入力とコンテキスト長は、さくらの公開仕様に基づきます。 [さくらの公式モデル仕様（2026 年 11 月 18 日更新）](https://manual.sakura.ad.jp/cloud/ai-engine/chat-models.html)

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

## ライセンス

MIT
