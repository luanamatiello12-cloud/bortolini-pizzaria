@echo off
chcp 65001 >nul
setlocal
echo ================================================
echo  Enviar codigo da Bortolini para o GitHub (push)
echo ================================================
echo.

rem --- entra na pasta deste arquivo (removendo a barra final) ---
set "DIR=%~dp0"
if "%DIR:~-1%"=="\" set "DIR=%DIR:~0,-1%"
cd /d "%DIR%"

echo Cole seu token do GitHub (com permissao 'repo') e aperte Enter:
set /p TOKEN=Token:

echo.
echo Enviando...
git push "https://%TOKEN%@github.com/luanamatiello12-cloud/bortolini-pizzaria.git" main

echo.
echo ================================================
echo  Se apareceu "-^> main" acima, deu certo!
echo  (Depois revogue o token no github.com/settings/tokens)
echo ================================================
endlocal
pause
