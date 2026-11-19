@echo off
chcp 65001 >nul
setlocal

rem O "git pull" pode atualizar ESTE arquivo enquanto ele roda, e o Windows
rem lê arquivos .cmd aos poucos. Por isso ele se copia para a pasta temporária
rem e continua a partir da cópia.
if /i not "%~1"=="--copia" (
  copy /y "%~f0" "%TEMP%\estacionamento-atualizar.cmd" >nul
  "%TEMP%\estacionamento-atualizar.cmd" --copia "%~dp0."
)
cd /d "%~2"
title Estacionamento - Atualizar

echo.
echo  ===  Atualizando o sistema do estacionamento  ===
echo.

where git >nul 2>nul || (echo  Git não encontrado. Instale em https://git-scm.com/download/win & goto erro)
where npm >nul 2>nul || (echo  Node.js não encontrado. Instale em https://nodejs.org & goto erro)

rem O servidor precisa estar desligado (no Windows ele trava os arquivos).
curl -s -f -o nul -m 2 http://localhost:8080/api/v1/health/live >nul 2>nul
if not errorlevel 1 (
  echo  O servidor está ligado. Feche a janela "Servidor do Estacionamento"
  echo  na barra de tarefas e rode este arquivo de novo.
  goto erro
)

echo  [1/4] Baixando a versão mais recente do GitHub...
git restore package-lock.json 2>nul
git pull
if errorlevel 1 goto erro

echo.
echo  [2/4] Instalando dependências (pode levar alguns minutos)...
call npm ci --no-fund --no-audit
if errorlevel 1 goto erro

if not exist "apps\local-server\.env" (
  copy "apps\local-server\.env.example" "apps\local-server\.env" >nul
  echo.
  echo  Arquivo de configuração criado. Preencha DB_PASSWORD com a senha
  echo  do MySQL, salve, feche o Bloco de Notas e rode este arquivo de novo.
  notepad "apps\local-server\.env"
  goto fim
)

echo.
echo  [3/4] Atualizando o banco de dados...
call npm run db:migrar
if errorlevel 1 goto erro

echo.
echo  [4/4] Compilando o painel...
call npm run build
if errorlevel 1 goto erro

echo.
echo  ======================================================
echo   Pronto! Agora dê dois cliques em Iniciar.cmd
echo  ======================================================
goto fim

:erro
echo.
echo  *** Algo deu errado. Tire um print desta janela e envie. ***
echo.
pause
exit /b 1

:fim
echo.
pause
exit /b 0
