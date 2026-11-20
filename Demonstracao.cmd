@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Estacionamento - Demonstração
set "URL=http://localhost:8081"

rem Já está rodando? Só abre o painel.
curl -s -f -o nul -m 2 %URL%/api/v1/health/live >nul 2>nul
if not errorlevel 1 (
  start "" %URL%
  exit /b 0
)

if not exist "apps\admin-web\dist\index.html" (
  echo.
  echo  O painel ainda não foi compilado. Rode Atualizar.cmd primeiro.
  goto erro
)

echo.
echo  ===  Modo demonstração  ===
echo.
echo  Usa um banco SEPARADO ("estacionamento_demo") com 7 dias de movimento
echo  gerado automaticamente. O seu banco real NÃO é alterado.
echo  A cada vez que este arquivo é aberto, os dados são recriados.
echo.
call npm run demo:criar --silent
if errorlevel 1 goto erro

set "DB_NAME=estacionamento_demo"
set "PORT=8081"
rem Links do QR Code abrem o app do cliente da demonstração (App-Cliente-Demonstracao.cmd)
set "PUBLIC_PWA_URL=http://localhost:5174"
start "Servidor de Demonstração" /min cmd /k npm start

for /l %%i in (1,1,60) do (
  timeout /t 1 /nobreak >nul
  curl -s -f -o nul -m 2 %URL%/api/v1/health/live >nul 2>nul && goto pronto
)
echo.
echo  O servidor de demonstração não respondeu. Abra a janela
echo  "Servidor de Demonstração" na barra de tarefas e envie um print.
goto erro

:pronto
echo.
echo  Abrindo %URL%   Login: demo   Senha: Painel2026
echo  Para encerrar, feche a janela "Servidor de Demonstração".
start "" %URL%
timeout /t 8 >nul
exit /b 0

:erro
echo.
pause
exit /b 1
