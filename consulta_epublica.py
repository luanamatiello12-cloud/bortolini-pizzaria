#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script para consultar a API da e-publica (Prefeitura de Chapeco)

Endpoints suportados:
  - /contratos
  - /licitacoes
  - /empenhos
  - /pagamentos

Parametros funcionais descobertos via brute-force:
  - de=YYYY-MM-DD        : data inicio
  - ate=YYYY-MM-DD       : data fim
  - page=N               : pagina (0-based)
  - sort=campo,direcao   : ordenacao (ex: emissao,asc)

A API IGNORA parametros desconhecidos sem erro.
O parametro 'size' NAO tem efeito observado (retorna lote grande fixo).
"""

import json
import csv
import os
import requests
import sys
from datetime import datetime
from urllib.parse import urlencode
from collections import defaultdict

# ============================================================================
# CONFIGURACAO DA API
# ============================================================================
BASE_URL = "https://sc.e-publica.net/epublica/api/v1"
HEADERS = {
    "x-alias": "chapeco",
    "x-nome-chave": "massimiliano",
    "x-api-key": "da7c7fb2-0bff-4e09-a5f8-78515f422026",
    "Accept": "application/json"
}

# ============================================================================
# CORE FUNCTIONS
# ============================================================================

def consultar(endpoint, data_de=None, data_ate=None, max_paginas=100):
    """
    Consulta um endpoint da API com paginacao e filtro de data.
    Retorna lista completa de registros.
    """
    todos_dados = []
    pagina = 0
    
    print(f"[INFO] Consultando /{endpoint}...")
    if data_de or data_ate:
        print(f"[INFO] Periodo: {data_de or 'inicio'} ate {data_ate or 'atual'}")
    
    for tentativa in range(max_paginas):
        params = {
            "page": pagina,
            "sort": "emissao,asc"
        }
        
        if data_de:
            params["de"] = data_de
        if data_ate:
            params["ate"] = data_ate
        
        url = f"{BASE_URL}/{endpoint}?{urlencode(params)}"
        
        try:
            response = requests.get(url, headers=HEADERS, timeout=120)
            response.raise_for_status()
            
            dados = response.json()
            registros = dados.get("data", [])
            
            if not registros:
                print(f"[INFO] Pagina {pagina}: vazia. Fim da coleta.")
                break
            
            todos_dados.extend(registros)
            print(f"[OK] Pagina {pagina}: +{len(registros)} regs | acumulado: {len(todos_dados)}")
            
            # Se retornou menos de 50, provavelmente eh a ultima pagina
            if len(registros) < 50:
                break
            
            pagina += 1
            
        except requests.exceptions.Timeout:
            print(f"[AVISO] Timeout na pagina {pagina}. Salvando dados parciais...")
            break
        except requests.exceptions.RequestException as e:
            print(f"[ERRO] Pagina {pagina}: {e}")
            break
    
    print(f"[INFO] Total de registros obtidos: {len(todos_dados)}")
    return todos_dados


def salvar_json(dados, nome_arquivo):
    """Salva os dados em um arquivo JSON com UTF-8."""
    with open(nome_arquivo, "w", encoding="utf-8") as f:
        json.dump(dados, f, ensure_ascii=False, indent=2)
    print(f"[OK] JSON salvo: {nome_arquivo}")
    return nome_arquivo


def salvar_csv(dados, nome_arquivo, endpoint):
    """Salva os dados em um arquivo CSV com campos principais."""
    if not dados:
        print("[AVISO] Nenhum dado para salvar em CSV.")
        return None
    
    # Define colunas por endpoint
    if endpoint == "contratos":
        colunas = [
            ("numero", lambda x: x.get("numero", "")),
            ("emissao", lambda x: x.get("emissao", "")),
            ("valorTotal", lambda x: x.get("valorTotal", 0)),
            ("objeto", lambda x: x.get("objeto", "")),
            ("credor", lambda x: x.get("credorFornecedor", {}).get("nome", "")),
            ("cnpjCredor", lambda x: x.get("credorFornecedor", {}).get("cnpj", "")),
            ("despesa", lambda x: x.get("despesa", "")),
            ("licitacao", lambda x: x.get("licitacao", "")),
            ("orgao", lambda x: x.get("orgao", "")),
        ]
    elif endpoint == "licitacoes":
        colunas = [
            ("numero", lambda x: x.get("numero", "")),
            ("emissao", lambda x: x.get("emissao", "")),
            ("objeto", lambda x: x.get("objeto", "")),
            ("modalidade", lambda x: x.get("modalidade", "")),
            ("status", lambda x: x.get("status", "")),
            ("orgao", lambda x: x.get("orgao", "")),
        ]
    elif endpoint == "empenhos":
        colunas = [
            ("numero", lambda x: x.get("numero", "")),
            ("emissao", lambda x: x.get("emissao", "")),
            ("valor", lambda x: x.get("valor", 0)),
            ("objeto", lambda x: x.get("objeto", "")),
            ("credor", lambda x: x.get("credorFornecedor", {}).get("nome", "")),
            ("despesa", lambda x: x.get("despesa", "")),
        ]
    elif endpoint == "pagamentos":
        colunas = [
            ("numero", lambda x: x.get("numero", "")),
            ("emissao", lambda x: x.get("emissao", "")),
            ("valor", lambda x: x.get("valor", 0)),
            ("credor", lambda x: x.get("credorFornecedor", {}).get("nome", "")),
            ("despesa", lambda x: x.get("despesa", "")),
        ]
    else:
        colunas = [(k, lambda x, k=k: x.get(k, "")) for k in dados[0].keys()]
    
    with open(nome_arquivo, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f, delimiter=";")
        writer.writerow([c[0] for c in colunas])
        for reg in dados:
            writer.writerow([c[1](reg) for c in colunas])
    
    print(f"[OK] CSV salvo: {nome_arquivo}")
    return nome_arquivo


# ============================================================================
# RESUMOS / ANALISES
# ============================================================================

def resumo_contratos(contratos):
    """Exibe resumo estatistico dos contratos no console."""
    if not contratos:
        print("Nenhum contrato encontrado.")
        return
    
    print("\n" + "=" * 70)
    print("RESUMO DOS CONTRATOS")
    print("=" * 70)
    
    # Top 10 maiores valores
    contratos_com_valor = [c for c in contratos if c.get("valorTotal")]
    contratos_ordenados = sorted(
        contratos_com_valor, key=lambda x: x.get("valorTotal", 0), reverse=True
    )
    
    print("\n--- TOP 10 MAIORES CONTRATOS ---")
    for i, c in enumerate(contratos_ordenados[:10], 1):
        numero = c.get("numero", "N/A")
        emissao = c.get("emissao", "N/A")
        objeto = c.get("objeto", "")[:55]
        if len(c.get("objeto", "")) > 55:
            objeto += "..."
        valor = c.get("valorTotal", 0)
        credor = c.get("credorFornecedor", {}).get("nome", "N/A")[:35]
        print(f"  {i:2}. {numero} | {emissao} | R$ {valor:>15,.2f}")
        print(f"      {credor} | {objeto}")
    
    # Total por ano
    por_ano = defaultdict(float)
    for c in contratos:
        ano = c.get("emissao", "")[:4]
        if ano.isdigit():
            por_ano[ano] += c.get("valorTotal", 0)
    
    print("\n--- TOTAL POR ANO ---")
    for ano in sorted(por_ano.keys(), reverse=True):
        print(f"  {ano}: R$ {por_ano[ano]:,.2f}")
    
    total_geral = sum(c.get("valorTotal", 0) for c in contratos)
    print(f"\n--- VALOR TOTAL GERAL: R$ {total_geral:,.2f} ---")


def resumo_generico(dados, endpoint):
    """Exibe resumo generico para outros endpoints."""
    if not dados:
        print("Nenhum dado encontrado.")
        return
    
    print("\n" + "=" * 70)
    print(f"RESUMO DE {endpoint.upper()}")
    print("=" * 70)
    print(f"Total de registros: {len(dados)}")
    
    # Mostra primeira amostra
    print("\n--- Primeiro registro (campos principais) ---")
    amostra = dados[0]
    for chave in list(amostra.keys())[:8]:
        val = amostra[chave]
        if isinstance(val, str) and len(val) > 60:
            val = val[:60] + "..."
        print(f"  {chave}: {val}")


# ============================================================================
# CLI
# ============================================================================

def print_ajuda():
    ajuda = """
Uso: python consulta_epublica.py <endpoint> [de] [ate] [opcoes]

ENDPOINTS:
  contratos    - Contratos municipais
  licitacoes   - Licitacoes
  empenhos     - Empenhos orcamentarios
  pagamentos   - Pagamentos efetuados

FILTRO DE DATA:
  de   = data inicio (YYYY-MM-DD)
  ate  = data fim    (YYYY-MM-DD)

OPCOES:
  --csv          : exporta tambem para CSV
  --json         : exporta para JSON (padrao)
  --max-pages N  : limite de paginas (padrao: 100)
  --help         : mostra esta ajuda

EXEMPLOS:
  python consulta_epublica.py contratos 2025-01-01 2025-12-31 --csv
  python consulta_epublica.py licitacoes 2025-06-01 2025-06-30
  python consulta_epublica.py empenhos --max-pages 5
"""
    print(ajuda)


def main():
    args = sys.argv[1:]
    
    if not args or "--help" in args or "-h" in args:
        print_ajuda()
        return
    
    # Parse argumentos
    endpoint = args[0]
    data_de = None
    data_ate = None
    exportar_csv = "--csv" in args
    exportar_json = "--json" in args or not exportar_csv  # JSON eh padrao
    max_paginas = 100
    
    # Data filtering (args posicionais apos endpoint)
    idx = 1
    if idx < len(args) and not args[idx].startswith("-"):
        data_de = args[idx]
        idx += 1
    if idx < len(args) and not args[idx].startswith("-"):
        data_ate = args[idx]
        idx += 1
    
    # Opcoes
    if "--max-pages" in args:
        try:
            pos = args.index("--max-pages")
            max_paginas = int(args[pos + 1])
        except (ValueError, IndexError):
            print("[AVISO] Valor invalido para --max-pages. Usando padrao 100.")
    
    print("=" * 70)
    print("CONSULTA API E-PUBLICA - PREFEITURA DE CHAPECO")
    print("=" * 70)
    
    # Consulta
    dados = consultar(endpoint, data_de=data_de, data_ate=data_ate, max_paginas=max_paginas)
    
    if not dados:
        print("Nenhum dado encontrado.")
        return
    
    # Gera nome de arquivo com timestamp
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    base_nome = f"{endpoint}_{timestamp}"
    
    # Exporta JSON
    if exportar_json:
        salvar_json(dados, f"{base_nome}.json")
    
    # Exporta CSV
    if exportar_csv:
        salvar_csv(dados, f"{base_nome}.csv", endpoint)
    
    # Resumo no console
    if endpoint == "contratos":
        resumo_contratos(dados)
    else:
        resumo_generico(dados, endpoint)


if __name__ == "__main__":
    main()
