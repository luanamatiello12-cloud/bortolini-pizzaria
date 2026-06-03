#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script para consultar a API da e-publica (Prefeitura de Chapeco)
Endpoints suportados: /contratos, /licitacoes, /empenhos, /pagamentos
"""

import json
import requests
import sys
from datetime import datetime
from urllib.parse import urlencode
from collections import defaultdict

# Configuracao da API
BASE_URL = "https://sc.e-publica.net/epublica/api/v1"
HEADERS = {
    "x-alias": "chapeco",
    "x-nome-chave": "massimiliano",
    "x-api-key": "da7c7fb2-0bff-4e09-a5f8-78515f422026",
    "Accept": "application/json"
}


def consultar(endpoint, data_de=None, data_ate=None, pagina_inicial=0, tamanho_pagina=20, max_paginas=50):
    """
    Consulta um endpoint da API com paginacao e filtro de data.
    """
    todos_dados = []
    pagina = pagina_inicial
    
    print(f"[INFO] Consultando /{endpoint}...")
    if data_de or data_ate:
        print(f"[INFO] Periodo: {data_de or 'inicio'} ate {data_ate or 'atual'}")
    
    for _ in range(max_paginas):
        params = {
            "page": pagina,
            "size": tamanho_pagina,
            "sort": "emissao,asc"
        }
        
        if data_de:
            params["de"] = data_de
        if data_ate:
            params["ate"] = data_ate
        
        url = f"{BASE_URL}/{endpoint}?{urlencode(params)}"
        
        try:
            response = requests.get(url, headers=HEADERS, timeout=60)
            response.raise_for_status()
            
            dados = response.json()
            registros = dados.get("data", [])
            
            if not registros:
                break
            
            todos_dados.extend(registros)
            print(f"[OK] Pagina {pagina}: {len(registros)} registros (total: {len(todos_dados)})")
            
            if len(registros) < tamanho_pagina:
                break
            
            pagina += 1
            
        except requests.exceptions.RequestException as e:
            print(f"[ERRO] Pagina {pagina}: {e}")
            break
    
    print(f"[INFO] Total de registros obtidos: {len(todos_dados)}")
    return todos_dados


def salvar_json(dados, nome_arquivo):
    """Salva os dados em um arquivo JSON."""
    with open(nome_arquivo, "w", encoding="utf-8") as f:
        json.dump(dados, f, ensure_ascii=False, indent=2)
    print(f"[OK] Dados salvos em: {nome_arquivo}")


def resumo_contratos(contratos):
    """Exibe um resumo dos contratos."""
    if not contratos:
        print("Nenhum contrato encontrado.")
        return
    
    print("\n" + "="*60)
    print("RESUMO DOS CONTRATOS")
    print("="*60)
    
    # Top 10 maiores valores
    contratos_com_valor = [c for c in contratos if c.get("valorTotal")]
    contratos_ordenados = sorted(contratos_com_valor, key=lambda x: x.get("valorTotal", 0), reverse=True)
    
    print("\nTOP 10 MAIORES CONTRATOS:")
    for i, c in enumerate(contratos_ordenados[:10], 1):
        numero = c.get("numero", "N/A")
        emissao = c.get("emissao", "N/A")
        objeto = c.get("objeto", "")[:50]
        if len(c.get("objeto", "")) > 50:
            objeto += "..."
        valor = c.get("valorTotal", 0)
        credor = c.get("credorFornecedor", {}).get("nome", "N/A")[:30]
        print(f"  {i}. {numero} | {emissao} | R$ {valor:,.2f}")
        print(f"     {credor} | {objeto}")
    
    # Total por ano
    por_ano = defaultdict(float)
    for c in contratos:
        ano = c.get("emissao", "")[:4]
        if ano.isdigit():
            por_ano[ano] += c.get("valorTotal", 0)
    
    print(f"\nTOTAL POR ANO:")
    for ano in sorted(por_ano.keys(), reverse=True):
        print(f"  {ano}: R$ {por_ano[ano]:,.2f}")
    
    print(f"\nVALOR TOTAL GERAL: R$ {sum(c.get('valorTotal', 0) for c in contratos):,.2f}")


def main():
    print("="*60)
    print("CONSULTA API E-PUBLICA - PREFEITURA DE CHAPECÓ")
    print("="*60)
    
    # Verifica argumentos da linha de comando
    if len(sys.argv) > 1:
        endpoint = sys.argv[1]
        data_de = sys.argv[2] if len(sys.argv) > 2 else None
        data_ate = sys.argv[3] if len(sys.argv) > 3 else None
    else:
        # Modo interativo
        print("\nEndpoints disponiveis:")
        print("  1. contratos")
        print("  2. licitacoes")
        print("  3. empenhos")
        print("  4. pagamentos")
        
        escolha = input("\nEscolha o endpoint (1-4) ou digite o nome: ").strip().lower()
        
        mapa = {"1": "contratos", "2": "licitacoes", "3": "empenhos", "4": "pagamentos"}
        endpoint = mapa.get(escolha, escolha)
        
        usar_filtro = input("Filtrar por data? (s/n): ").strip().lower()
        data_de = None
        data_ate = None
        if usar_filtro == "s":
            data_de = input("Data de inicio (YYYY-MM-DD): ").strip()
            data_ate = input("Data de fim (YYYY-MM-DD): ").strip()
    
    # Consulta
    dados = consultar(endpoint, data_de=data_de, data_ate=data_ate)
    
    if not dados:
        print("Nenhum dado encontrado.")
        return
    
    # Salva em JSON
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    arquivo = f"{endpoint}_{timestamp}.json"
    salvar_json(dados, arquivo)
    
    # Resumo especifico para contratos
    if endpoint == "contratos":
        resumo_contratos(dados)
    else:
        print(f"\nPrimeiro registro:")
        amostra = json.dumps(dados[0], indent=2, ensure_ascii=False)[:500]
        print(amostra + "...")


if __name__ == "__main__":
    main()
