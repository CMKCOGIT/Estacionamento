@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Estacionamento - Restaurar backup
echo.
echo  ===  Restaurar o banco a partir de um backup  ===
echo.
echo  ATENÇÃO: o banco atual será APAGADO e substituído pelo backup escolhido.
echo  Antes de continuar, FECHE a janela do Iniciar.cmd (servidor parado).
echo  Passo a passo completo: docs\BACKUP.md
echo.
echo  Backups disponíveis (o mais recente primeiro):
call npm run backup -w @estacionamento/local-server --silent -- listar
echo.
set "ARQUIVO="
set /p "ARQUIVO=Nome do arquivo (Enter = o mais recente): "
echo.
set /p "CONFIRMA=Digite RESTAURAR para confirmar: "
if /i not "%CONFIRMA%"=="RESTAURAR" (
  echo  Cancelado. Nada foi alterado.
  goto fim
)
if "%ARQUIVO%"=="" (
  call npm run backup -w @estacionamento/local-server --silent -- restaurar --confirmar
) else (
  call npm run backup -w @estacionamento/local-server --silent -- restaurar --arquivo "%ARQUIVO%" --confirmar
)
if errorlevel 1 (
  echo.
  echo  A restauração FALHOU. O erro está acima. Veja docs\BACKUP.md.
  goto fim
)
echo.
echo  Agora abra o Iniciar.cmd. Confira no painel: Backups e Configurações - Sincronização.
:fim
echo.
pause
