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
4. 確認画面でスタッフ ID・勤務／非勤務を確定
5. **月次CSVをダウンロード** → Medical Force にアップロード

## テスト

```bash
npm test
./node_modules/.bin/tsx scripts/smoke-convert.ts 2026.12
```

## Vercel へのデプロイ

1. このリポジトリを GitHub に push
2. [Vercel](https://vercel.com) で Import → Framework Preset は Next.js
3. ビルド設定はそのまま（`npm run build`）
4. Deploy

環境変数は当面不要です（認証は後から追加予定）。

設定データは `data/` にあります。

| ファイル | 内容 |
|---|---|
| `data/config.json` | 灰色・小数時刻・特殊記号などの承認フラグ |
| `data/staff_registry.csv` | Excel 名 ↔ MF ID |
| `data/mf_staff_master.csv` | MF スタッフマスター |

## 旧 CLI（Python）

`mf_shift_converter.py` と `ExcelからMFシフトへ変換.command` は互換用に残しています。通常運用は本 Web 版を使ってください。詳細は [README_使い方.md](README_使い方.md) を参照。
