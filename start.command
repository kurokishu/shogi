#!/bin/bash
# ==========================================================
#  将棋アプリ 起動スクリプト（このファイルをダブルクリック）
#
#  Node.js があれば server.js が動き、
#    ・思考エンジンが別スレッドで動く（本来の強さ）
#    ・同じWi-Fiのスマホ2台で対戦できる
#  終了するときは、このターミナルウィンドウを閉じてください。
# ==========================================================
cd "$(dirname "$0")" || exit 1

PORT=8777
for p in 8777 8778 8779 8780 8781; do
  if ! nc -z 127.0.0.1 "$p" >/dev/null 2>&1; then PORT="$p"; break; fi
done

URL="http://localhost:${PORT}/"

echo "=============================================="
echo " 将棋アプリ"
echo " ブラウザで ${URL} を開きます"
echo " 終了するには このウィンドウを閉じるか Ctrl+C"
echo "=============================================="

( sleep 1; open "$URL" ) &

if command -v node >/dev/null 2>&1; then
  exec node server.js "$PORT"
fi

echo ""
echo "※ Node.js が見つかりませんでした。"
echo "   簡易サーバーで起動します（2台対戦は使えません）。"
echo "   2台対戦を使うには Node.js を入れてください: https://nodejs.org/"
echo ""

if command -v python3 >/dev/null 2>&1; then
  exec python3 -m http.server "$PORT"
elif command -v ruby >/dev/null 2>&1; then
  exec ruby -run -e httpd . -p "$PORT"
elif command -v php >/dev/null 2>&1; then
  exec php -S "127.0.0.1:${PORT}"
else
  echo "サーバーを起動できるコマンドが見つかりませんでした。"
  echo "index.html を直接ブラウザで開いてもプレイできます（簡易モード）。"
  open "index.html"
  read -r -p "Enter キーで終了します"
  exit 1
fi
