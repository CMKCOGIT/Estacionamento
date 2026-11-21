@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Estacionamento - Iniciar
set "URL=http://localhost:8080"
rem Com o HTTPS ligado (Ativar-HTTPS.cmd), o painel responde em https://
findstr /b /c:"HTTPS_CERT_FILE=" "apps\local-server\.env" >nul 2>nul && set "URL=https://localhost:8080"

rem Já está rodando? Só abre o painel.
curl -s -k -f -o nul -m 2 %URL%/api/v1/health/live >nul 2>nul
if not errorlevel 1 (
  start "" %URL%
  exit /b 0
)

if not exist "apps\admin-web\dist\index.html" (
  echo.
  echo  O painel ainda não foi compilado. Rode Atualizar.cmd primeiro.
  echo.
  pause
  exit /b 1
)

echo.
echo  Ligando o servidor...
echo  Ele fica numa janela minimizada chamada "Servidor do Estacionamento".
echo  Para desligar, feche essa janela.
start "Servidor do Estacionamento" /min cmd /k npm start

rem Espera até 60 segundos o servidor responder.
for /l %%i in (1,1,60) do (
  timeout /t 1 /nobreak >nul
  curl -s -k -f -o nul -m 2 %URL%/api/v1/health/live >nul 2>nul && goto pronto
)
echo.
echo  O servidor não respondeu. Abra a janela "Servidor do Estacionamento"
echo  na barra de tarefas, tire um print e envie.
echo.
pause
exit /b 1

:pronto
start "" %URL%
exit /b 0
