@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Estacionamento - Ativar HTTPS no painel
echo.
echo  ===  HTTPS no painel da rede local  ===
echo.
echo  Gera um certificado para este computador e liga o HTTPS no servidor local.
echo  Depois, abra o painel por https://^<ip-deste-pc^>:8080
echo.
if not exist "apps\local-server\.env" (
  echo  Arquivo apps\local-server\.env não encontrado. Rode o Atualizar.cmd primeiro.
  goto fim
)
call npm run https:certificado -w @estacionamento/local-server --silent
if errorlevel 1 goto fim
findstr /b /c:"HTTPS_CERT_FILE=" "apps\local-server\.env" >nul
if errorlevel 1 (
  echo.>> "apps\local-server\.env"
  echo # HTTPS na rede local (Ativar-HTTPS.cmd)>> "apps\local-server\.env"
  echo HTTPS_CERT_FILE=certificados/servidor.crt>> "apps\local-server\.env"
  echo HTTPS_KEY_FILE=certificados/servidor.key>> "apps\local-server\.env"
  echo.
  echo  HTTPS ligado no .env. Feche e abra de novo o Iniciar.cmd.
) else (
  echo.
  echo  O .env já tinha o HTTPS configurado: o certificado foi renovado.
)
echo.
echo  Na primeira vez, cada navegador avisa que o certificado não é conhecido.
echo  Para não ver mais o aviso, instale apps\local-server\certificados\servidor.crt
echo  como "Autoridades de Certificação Raiz Confiáveis" nos computadores do caixa
echo  (veja docs\SEGURANCA.md).
:fim
echo.
pause
