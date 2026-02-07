# cwebproxy

1画面完結のシンプルWebプロキシです。

## 使い方

- 画面上部の入力欄にURLまたは検索語句を入力
- 「表示」を押すと、同一画面内の iframe でページを閲覧
- URLでない入力は DuckDuckGo 検索として扱います

## 構成

- `index.html`: シングルスクリーンUI
- `api/proxy.js`: Vercel Serverless Function の汎用プロキシ

## ローカル実行

```bash
npx vercel dev
```

その後 `http://localhost:3000` を開いて確認してください。
