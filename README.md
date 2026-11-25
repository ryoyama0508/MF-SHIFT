# MF-Shift（Next.js / Vercel）

クリニックのシフト表 Excel（`.xlsx`）を Medical Force 取込用 CSV に変換する Web アプリです。

## 使い方（ローカル）

```bash
npm install
npm run dev
```

ブラウザで [http://localhost:3000](http://localhost:3000) を開き:

1. Excel をドラッグ＆ドロップ（またはファイル選択）
2. 月別シートを選ぶ
3. **変換する** を押す
4. 確認画面でスタッフ ID などを確認
5. **月次CSVをダウンロード** → Medical Force にアップロード

判定の既定: **白い空欄＝出勤（10:00–19:00）**、**灰色＝休み**。意味不明の記号やメディフォ未登録の人はスキップして出力できます。

## 設定ファイル（`data/`）

| ファイル | 内容 |
|---|---|
| `data/config.json` | 灰色・小数時刻などの判定フラグ |
| `data/staff_registry.csv` | Excel 名 ↔ MF ID |
| `data/mf_staff_master.csv` | MF スタッフマスター |

## テスト

```bash
npm test
# 手元に シフト表原本.xlsx がある場合
./node_modules/.bin/tsx scripts/smoke-convert.ts 2026.12
```

## 認証

トップの前にパスワード画面があります。正解は環境変数 `APP_PASSWORD` です。

```bash
# ローカル
cp .env.example .env.local
# APP_PASSWORD=好きなパスワード に編集
```

## Vercel へのデプロイ

1. このリポジトリを GitHub に push
2. [Vercel](https://vercel.com) で Import → Framework Preset は Next.js
3. Project → Settings → Environment Variables に追加:
   - Name: `APP_PASSWORD`
   - Value: 決めたいパスワード
4. ビルドは `npm run build` のまま Deploy
