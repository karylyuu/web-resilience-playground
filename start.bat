@echo off
chcp 65001 >nul
cd /d "%~dp0"
title re:silience

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js가 설치되어 있지 않아요.
  echo  https://nodejs.org 에서 LTS 버전을 설치한 뒤 이 파일을 다시 실행하세요.
  echo.
  pause
  exit /b 1
)

if "%PORT%"=="" set PORT=3000

if not exist backend\node_modules (
  echo  [1/3] 서버 패키지 설치 중...
  call npm install --prefix backend || goto fail
)
if not exist frontend\node_modules (
  echo  [2/3] 화면 패키지 설치 중...
  call npm install --prefix frontend || goto fail
)
echo  [3/3] 화면 빌드 중...
call npm run build --prefix frontend || goto fail

echo.
echo  준비 완료. 잠시 후 브라우저가 열립니다: http://localhost:%PORT%
echo  끝내려면 이 창에서 Ctrl+C 를 누르세요.
echo.
start "" cmd /c "timeout /t 3 >nul & start http://localhost:%PORT%"
call npm start --prefix backend
exit /b 0

:fail
echo.
echo  설치 또는 빌드에 실패했어요. 위의 오류 메시지를 확인하세요.
pause
exit /b 1
