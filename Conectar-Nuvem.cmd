@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Estacionamento - Conectar com a nuvem
echo.
echo  ===  Ligar o app do cliente (nuvem)  ===
echo.
echo  Tenha em maos: o endereco da API (Render), o endereco do app (Cloudflare)
echo  e a SYNC_CHAVE_MESTRA (Render). Passo a passo: docs\PUBLICAR.md
call npm run nuvem:conectar -w @estacionamento/local-server --silent
echo.
pause
