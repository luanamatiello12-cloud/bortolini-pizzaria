# Como subir no GitHub

## 1. Instalar GitHub CLI

No PowerShell:

```powershell
winget install --id GitHub.cli -e --source winget --accept-package-agreements --accept-source-agreements
```

Feche e abra um novo terminal.

## 2. Login

```powershell
gh auth login
```

Escolha GitHub.com, HTTPS e login pelo navegador.

## 3. Ir para o projeto

```powershell
cd "C:\Users\04254966008\Documents\Codex\2026-05-04\oii-chat"
```

## 4. Primeiro envio

O arquivo `.env` e bancos `*.db` estão no `.gitignore`, então dados sensíveis e clientes não devem subir.

```powershell
git init
git add .
git commit -m "primeiro commit - bortolini delivery"
gh repo create bortolini-delivery --private --source=. --remote=origin --push
```

## Atualizar depois

```powershell
git add .
git commit -m "atualiza sistema"
git push
```
