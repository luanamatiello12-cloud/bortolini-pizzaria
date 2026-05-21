@echo off
cd /d "%~dp0"
echo ============================================
echo    Bortolini Pizzaria - Sistema de Gestao
echo ============================================
echo.
echo Iniciando servidor...
echo.
echo  Painel Admin:   http://127.0.0.1:8000/admin
echo  Cardapio:       http://127.0.0.1:8000/cardapio
echo  Entregadores:   http://127.0.0.1:8000/entregador/[id]
echo.
echo Pressione CTRL+C para encerrar.
echo.
python server.py
pause
