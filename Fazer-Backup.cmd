@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Estacionamento - Backup agora
echo.
echo  Fazendo backup do banco (o estacionamento pode continuar funcionando)...
echo.
call npm run backup -w @estacionamento/local-server --silent -- criar
echo.
call npm run backup -w @estacionamento/local-server --silent -- listar
echo.
pause
