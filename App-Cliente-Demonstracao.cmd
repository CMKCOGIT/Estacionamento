@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Estacionamento - App do cliente (demonstração)

echo.
echo  ===  App do cliente (PWA) - demonstração  ===
echo.
echo  Liga, neste computador, a API externa e o app do cliente. O painel de
echo  demonstração (Demonstracao.cmd) envia os dados para a API sozinho, pela
echo  sincronização. Abra antes o Demonstracao.cmd.
echo.

curl -s -f -o nul -m 2 http://localhost:8081/api/v1/health/live >nul 2>nul
if errorlevel 1 (
  echo  O painel de demonstração não está ligado. Abra o Demonstracao.cmd primeiro.
  goto erro
)

rem Mesmas credenciais do MySQL usadas pelo servidor local
for /f "usebackq eol=# tokens=1,* delims==" %%a in ("apps\local-server\.env") do (
  if "%%a"=="DB_HOST" set "DB_HOST=%%b"
  if "%%a"=="DB_PORT" set "DB_PORT=%%b"
  if "%%a"=="DB_USER" set "DB_USER=%%b"
  if "%%a"=="DB_PASSWORD" set "DB_PASSWORD=%%b"
)
set "DB_NAME=estacionamento_nuvem_demo"
rem Credencial SÓ de demonstração (a mesma configurada no Demonstracao.cmd).
rem Em produção a chave mestra é secreta e a credencial é criada com
rem "npm run integracao -- criar" (veja docs/API-EXTERNA.md).
set "SYNC_CHAVE_MESTRA=demonstracao-local-nao-use-em-producao-0001"
set "PWA_ORIGENS=http://localhost:5174"
set "PORT=8090"
set "NODE_ENV=development"
set "VITE_API_URL=http://localhost:8090"
set "VITE_SITE_SLUG=estacionamento-demonstracao"

echo  Preparando o banco da nuvem (demonstração, recriado do zero)...
call npm run db:migrar -w @estacionamento/cloud-api --silent -- --recriar
if errorlevel 1 goto erro
call npm run integracao -w @estacionamento/cloud-api --silent -- criar --id 01JDEMONSTRACAOSERVIDORLCL --nome "Demonstração" --se-nao-existir >nul
if errorlevel 1 goto erro
echo  Compilando a API pública e o app do cliente...
call npm run build:pacotes --silent >nul
call npm run build -w @estacionamento/cloud-api --silent
if errorlevel 1 goto erro
call npm run build -w @estacionamento/pwa --silent
if errorlevel 1 goto erro

start "API externa (demonstração)" /min cmd /k node apps\cloud-api\dist\server.js
start "App do cliente (demonstração)" /min cmd /k npm run preview -w @estacionamento/pwa

for /l %%i in (1,1,40) do (
  timeout /t 1 /nobreak >nul
  curl -s -f -o nul -m 2 http://localhost:5174/ >nul 2>nul && goto pronto
)
echo  O app do cliente não respondeu. Veja as janelas minimizadas na barra de tarefas.
goto erro

:pronto
echo.
echo  App do cliente: http://localhost:5174
echo  Para ver um ticket: no painel, registre uma entrada e abra o link do QR Code.
echo  Os dados chegam pela sincronização em alguns segundos (Configurações no painel
echo  mostra a situação do envio). Para encerrar, feche as duas janelas minimizadas.
start "" http://localhost:5174
timeout /t 8 >nul
exit /b 0

:erro
echo.
pause
exit /b 1
