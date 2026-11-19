@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Estacionamento - Criar administrador
call npm run usuario:admin --silent
echo.
pause
