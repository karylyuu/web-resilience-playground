#!/usr/bin/env sh
# macOS / Linux: ./start.sh
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js가 설치되어 있지 않아요. https://nodejs.org 에서 LTS 버전을 설치하세요."
  exit 1
fi

[ -d backend/node_modules ] || npm install --prefix backend
[ -d frontend/node_modules ] || npm install --prefix frontend
npm run build --prefix frontend

echo "준비 완료: http://localhost:${PORT:-3000}  (끝내려면 Ctrl+C)"
npm start --prefix backend
