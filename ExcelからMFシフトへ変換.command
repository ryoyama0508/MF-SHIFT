#!/bin/zsh
# macOS: choose workbook and monthly tab. Produces only review files until settings approved.
cd "$(dirname "$0")" || exit 1
if ! command -v python3 >/dev/null 2>&1; then
  echo 'python3 が見つかりません。Python3 をインストールしてください。'; read '?Enterで終了'; exit 1
fi
INPUT=$(osascript -e 'POSIX path of (choose file with prompt "元のクリニックシフトExcel（.xlsx）を選択してください")' 2>/dev/null)
if [[ -z "$INPUT" ]]; then echo 'キャンセルしました';exit 0;fi
MONTHS=$(python3 - "$INPUT" <<'PYTHON'
import sys
from mf_shift_converter import Xlsx, month_for
book = Xlsx(sys.argv[1])
months = sorted((n.strip() for n in book.sheets if month_for(n)), key=month_for, reverse=True)
print('\n'.join(months))
PYTHON
) || { echo 'Excelを読み込めませんでした。'; read '?Enterで終了'; exit 1; }
if [[ -z "$MONTHS" ]]; then echo '月別シートが見つかりません。'; read '?Enterで終了'; exit 1; fi
SHEET=$(osascript - "${(@f)MONTHS}" <<'APPLESCRIPT'
on run sheetNames
  set choice to choose from list sheetNames with prompt "変換する月別シートを選択してください"
  if choice is false then return ""
  return item 1 of choice
end run
APPLESCRIPT
)
if [[ -z "$SHEET" ]];then echo 'キャンセルしました';exit 0;fi
OUT="$(pwd)/output/${SHEET}"
echo "入力: $INPUT"
echo "対象シート: $SHEET"
python3 "$(pwd)/mf_shift_converter.py" --input "$INPUT" --sheet "$SHEET" --out "$OUT"
rc=$?
if [[ $rc == 0 || $rc == 2 ]]; then
  open "$OUT/月次シフト確認.html"
  echo '月次シフト確認画面からCSVをダウンロードできます。'
else
  echo '変換に失敗しました。上のエラーを確認してください。'
fi
read '?Enterで終了'
