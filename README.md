# pi-sakura

[Pi](https://pi.dev/) から [さくらのAI Engine](https://ai.sakura.ad.jp/sakura-ai/ai-engine/) のモデルを使うための非公式拡張。

OpenAI互換のChat Completions APIを利用し、Pi標準の通信・ツール呼び出し機能をそのまま使う。独自のストリーミング実装や外部の実行時依存はない。

## インストール

```sh
pi install git:github.com/yattn/pi-sakura
```

さくらのAI Engineで発行したアカウントトークンを環境変数に設定する。

```sh
read -rsp 'Sakura AI token: ' SAKURA_AI_TOKEN
printf '\n'
export SAKURA_AI_TOKEN
```

Piを起動して `/model` で `sakura` のモデルを選択する。コマンドラインからも指定できる。

```sh
pi --provider sakura --model preview/DeepSeek-V4.1-Flash-1017
```

トークンはリポジトリや設定ファイルに直接書き込まないこと。

## 対応モデル

2026年11月18日更新の[さくら公式モデル仕様](https://manual.sakura.ad.jp/cloud/ai-engine/chat-models.html)に基づき、Piのコーディング操作に必要なTool Calling対応モデルのみ登録している。

| モデルID | 画像入力 | コンテキスト長 |
| --- | :---: | ---: |
| `gpt-oss-120b` | × | 131,072 |
| `preview/gemma-4-31B-it` | ○ | 262,144 |
| `preview/Qwen3.6-35B-A3B` | ○ | 262,144 |
| `preview/Kimi-K2.7-Code` | ○ | 262,144 |
| `preview/GLM-5.3-Flash` | ○ | 1,048,575 |
| `preview/DeepSeek-V4.1-Flash-1017` | ○ | 1,048,575 |

モデル一覧は固定。さくらの公開仕様でモデル一覧取得APIを確認できなかったため、起動時の自動取得は実装していない。モデルが追加・終了されたら更新が必要。

## 制約

- APIの互換性はモデルによって異なる。Tool CallingとReasoningの実機動作は、APIトークンを使った動作確認が必要。
- さくらのAI Engineはプロンプトキャッシュ非対応。`preview/` モデルは仕様変更や提供終了の可能性がある。
- **Pi上の料金表示は正しくない。** さくらの請求は円建てだがPiの料金メタデータは米ドル建てのため、拡張は暫定的に料金を0としている。実際の課金や無料枠は[さくら公式](https://ai.sakura.ad.jp/sakura-ai/ai-engine/)で確認すること。

## 開発

```sh
npm test
```

Node.js 22以降で、外部パッケージなしでプロバイダー登録内容をテストできる。これはローカルの設定テストであり、さくらのAPIへの接続テストではない。

## ライセンス

MIT
