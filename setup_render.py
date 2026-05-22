#!/usr/bin/env python3
"""
Script para configurar o banco PostgreSQL no Render.

Passos:
1. No dashboard do Render, crie um PostgreSQL (Free tier: 1GB)
2. Copie a Internal Database URL (ex: postgres://user:pass@host:5432/dbname)
3. No servico web, adicione a variavel de ambiente DATABASE_URL com esse valor
4. Reinicie o servico web
5. Rode este script localmente para popular o banco:

   python setup_render.py https://bortolini-pizzaria.onrender.com SEU_TOKEN

O token pode ser obtido fazendo login:
   curl -X POST https://bortolini-pizzaria.onrender.com/api/login \
     -H "Content-Type: application/json" -d '{"username":"adm","pin":"3725"}'
"""
import sys
import urllib.request
import json


def api_request(base, token, method, path, body=None):
    url = base.rstrip("/") + path
    req = urllib.request.Request(url, method=method)
    req.add_header("X-Session-Token", token)
    if body is not None:
        req.add_header("Content-Type", "application/json")
        req.data = json.dumps(body).encode()
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return {"error": e.read().decode(), "status": e.code}


def main():
    if len(sys.argv) < 3:
        print("Uso: python setup_render.py <BASE_URL> <TOKEN>")
        print("Ex:  python setup_render.py https://bortolini-pizzaria.onrender.com WypxZOi6...")
        sys.exit(1)
    base = sys.argv[1]
    token = sys.argv[2]

    print("1. Populando banco (seed)...")
    result = api_request(base, token, "POST", "/api/seed")
    print(f"   Resultado: {result}")

    print("2. Verificando cardapio...")
    menu = api_request(base, token, "GET", "/api/menu")
    print(f"   {len(menu)} itens no cardapio")

    print("3. Verificando usuarios...")
    users = api_request(base, token, "GET", "/api/users")
    print(f"   {len(users)} usuarios")

    print("4. Verificando configuracoes...")
    settings = api_request(base, token, "GET", "/api/settings")
    print(f"   Evolution URL: {settings.get('evolution_url') or '(vazio)'}")

    print("\n✅ Setup concluido!")
    print("   Agora va em Configuracoes > Integracoes > Evolution API")
    print("   e preencha URL, Instancia e API Key.")


if __name__ == "__main__":
    main()
