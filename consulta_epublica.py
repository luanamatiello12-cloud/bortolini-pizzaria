#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script para consultar a API da e-publica (Prefeitura de Chapeco)

Endpoints suportados:
  - /contratos
  - /licitacoes
  - /empenhos
  - /pagamentos

COMPORTAMENTO DA API (descoberto via brute-force):
  - Parametros 'page', 'size' e 'sort' sao IGNORADOS pela API
  - A API retorna um LOTE FIXO maximo (~2000 registros) por requisicao
  - O UNICO filtro funcional e 'de'/'ate' (formato YYYY-MM-DD)
    que filtra por algum campo interno (nao e 'emissao' nem 'assinatura')
  - Para obter dados completos, divida o periodo em sub-ranges menores

Autenticacao:
  - x-alias: chapeco
  - x-nome-chave: massimiliano
  - x-api-key: (veja codigo)
"""

import json
import csv
import requests
import sys
from datetime import datetime, timedelta
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

LIMITE_ESTIMADO_API = 2000  # Maximo de registros por requisicao observado


# ============================================================================
# CORE FUNCTIONS
# ============================================================================

def consultar_uma_pagina(endpoint, data_de=None, data_ate=None):
    """
    Faz UMA requisicao ao endpoint.
    A API ignora paginacao; esta funcao retorna tudo que a API entregar.
    """
    params = {}
    if data_de:
        params["de"] = data_de
    if data_ate:
        params["ate"] = data_ate

    url = f"{BASE_URL}/{endpoint}"
    if params:
        url += f"?{urlencode(params)}"

    try:
        response = requests.get(url, headers=HEADERS, timeout=120)
        response.raise_for_status()
        dados = response.json()
        registros = dados.get("data", [])
        return registros
    except requests.exceptions.RequestException as e:
        print(f"[ERRO] Falha na requisicao: {e}")
        return []


def dividir_periodo(data_de, data_ate, meses_por_parte=2):
    """
    Divide um range de datas em sub-ranges menores (default: 2 meses cada).
    Isso contorna o limite de ~2000 registros da API.
    """
    de_dt = datetime.strptime(data_de, "%Y-%m-%d")
    ate_dt = datetime.strptime(data_ate, "%Y-%m-%d")
    
    partes = []
    atual = de_dt
    while atual <= ate_dt:
        fim = min(atual + timedelta(days=30 * meses_por_parte - 1), ate_dt)
        partes.append((atual.strftime("%Y-%m-%d"), fim.strftime("%Y-%m-%d")))
        atual = fim + timedelta(days=1)
    
    return partes


def consultar_com_range_division(endpoint, data_de=None, data_ate=None, meses_por_parte=2):
    """
    Consulta endpoint dividindo o periodo em partes menores para evitar
    o limite de ~2000 registros da API.
    """
    if not data_de or not data_ate:
        # Sem filtro de data: uma unica requisicao
        print(f"[INFO] Consultando /{endpoint} (sem filtro de data)...")
        return consultar_uma_pagina(endpoint)
    
    partes = dividir_periodo(data_de, data_ate, meses_por_parte)
    print(f"[INFO] Consultando /{endpoint} em {len(partes)} parte(s) ({meses_por_parte} mes(es) cada)...")
    print(f"[INFO] Periodo total: {data_de} ate {data_ate}")
    
    todos = []
    vistos = set()
    
    for i, (de_parte, ate_parte) in enumerate(partes, 1):
        print(f"[INFO] Parte {i}/{len(partes)}: {de_parte} ate {ate_parte}")
        regs = consultar_uma_pagina(endpoint, de_parte, ate_parte)
        
        novos = 0
        for r in regs:
            # Usa 'id' ou 'numero+emissao' como chave unica
            chave = r.get("id") or f"{r.get('numero','')}#{r.get('emissao','')}"
            if chave not in vistos:
                vistos.add(chave)
                todos.append(r)
                novos += 1
        
        print(f"[OK] Parte {i}: +{novos} novos regs | acumulado: {len(todos)}")
        
        # Aviso se a parte atingiu proximo do limite
        if len(regs) >= LIMITE_ESTIMADO_API * 0.9:
            print(f"[AVISO] Parte {i} retornou {len(regs)} regs, proximo do limite da API!")
            print(f"[AVISO] Considere usar --split-months 1 para ranges menores.")
    
    return todos


# ============================================================================
# EXPORTACAO
# ============================================================================

def salvar_json(dados, nome_arquivo):
    """Salva em JSON com UTF-8."""
    with open(nome_arquivo, "w", encoding="utf-8") as f:
        json.dump(dados, f, ensure_ascii=False, indent=2)
    print(f"[OK] JSON salvo: {nome_arquivo}")
    return nome_arquivo


def salvar_csv(dados, nome_arquivo, endpoint):
    """Salva em CSV com campos principais por endpoint."""
    if not dados:
        print("[AVISO] Nenhum dado para CSV.")
        return None
    
    schemas = {
        "contratos": [
            ("numero", lambda x: x.get("numero", "")),
            ("emissao", lambda x: x.get("emissao", "")),
            ("assinatura", lambda x: x.get("assinatura", "")),
            ("valorTotal", lambda x: x.get("valorTotal", 0)),
            ("objeto", lambda x: x.get("objeto", "")),
            ("credor", lambda x: x.get("credorFornecedor", {}).get("nome", "")),
            ("cnpjCredor", lambda x: x.get("credorFornecedor", {}).get("cnpj", "")),
            ("despesa", lambda x: x.get("despesa", "")),
            ("licitacao", lambda x: x.get("licitacao", "")),
            ("orgao", lambda x: x.get("orgao", "")),
        ],
        "licitacoes": [
            ("numero", lambda x: x.get("numero", "")),
            ("emissao", lambda x: x.get("emissao", "")),
            ("objeto", lambda x: x.get("objeto", "")),
            ("modalidade", lambda x: x.get("modalidade", "")),
            ("status", lambda x: x.get("status", "")),
            ("orgao", lambda x: x.get("orgao", "")),
        ],
        "empenhos": [
            ("numero", lambda x: x.get("numero", "")),
            ("emissao", lambda x: x.get("emissao", "")),
            ("valor", lambda x: x.get("valor", 0)),
            ("objeto", lambda x: x.get("objeto", "")),
            ("credor", lambda x: x.get("credorFornecedor", {}).get("nome", "")),
            ("despesa", lambda x: x.get("despesa", "")),
        ],
        "pagamentos": [
            ("numero", lambda x: x.get("numero", "")),
            ("emissao", lambda x: x.get("emissao", "")),
            ("valor", lambda x: x.get("valor", 0)),
            ("credor", lambda x: x.get("credorFornecedor", {}).get("nome", "")),
            ("despesa", lambda x: x.get("despesa", "")),
        ],
    }
    
    colunas = schemas.get(endpoint, [(k, lambda x, k=k: x.get(k, "")) for k in dados[0].keys()])
    
    with open(nome_arquivo, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f, delimiter=";")
        writer.writerow([c[0] for c in colunas])
        for reg in dados:
            writer.writerow([c[1](reg) for c in colunas])
    
    print(f"[OK] CSV salvo: {nome_arquivo}")
    return nome_arquivo


# ============================================================================
# RESUMOS
# ============================================================================

def resumo_contratos(contratos):
    if not contratos:
        print("Nenhum contrato encontrado.")
        return
    
    print("\n" + "=" * 70)
    print("RESUMO DOS CONTRATOS")
    print("=" * 70)
    
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
    if not dados:
        print("Nenhum dado encontrado.")
        return
    print("\n" + "=" * 70)
    print(f"RESUMO DE {endpoint.upper()}")
    print("=" * 70)
    print(f"Total de registros: {len(dados)}")
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

FILTRO DE DATA (funcional - unico filtro que a API respeita):
  de   = data inicio (YYYY-MM-DD)
  ate  = data fim    (YYYY-MM-DD)
  NOTA: O filtro nao atua sobre 'emissao' ou 'assinatura', mas sim
        sobre algum campo interno da API. Teste ranges para refinar.

OPCOES:
  --csv               : exporta tambem para CSV
  --json              : exporta para JSON (padrao)
  --split-months N    : divide o periodo em partes de N meses
                        (padrao: 2, use 1 se houver muitos registros)
  --help              : mostra esta ajuda

EXEMPLOS:
  python consulta_epublica.py contratos 2025-01-01 2025-12-31 --csv
  python consulta_epublica.py licitacoes 2025-06-01 2025-06-30
  python consulta_epublica.py empenhos --split-months 1
  python consulta_epublica.py pagamentos 2025-01-01 2025-03-31 --csv --split-months 1
"""
    print(ajuda)


def main():
    args = sys.argv[1:]
    
    if not args or "--help" in args or "-h" in args:
        print_ajuda()
        return
    
    endpoint = args[0]
    data_de = None
    data_ate = None
    exportar_csv = "--csv" in args
    exportar_json = "--json" in args or not exportar_csv
    meses_por_parte = 2
    
    # Datas posicionais
    idx = 1
    if idx < len(args) and not args[idx].startswith("-"):
        data_de = args[idx]
        idx += 1
    if idx < len(args) and not args[idx].startswith("-"):
        data_ate = args[idx]
        idx += 1
    
    # Opcoes
    if "--split-months" in args:
        try:
            pos = args.index("--split-months")
            meses_por_parte = int(args[pos + 1])
        except (ValueError, IndexError):
            print("[AVISO] Valor invalido para --split-months. Usando 2.")
    
    print("=" * 70)
    print("CONSULTA API E-PUBLICA - PREFEITURA DE CHAPECO")
    print("=" * 70)
    
    # Consulta com divisao de periodo
    dados = consultar_com_range_division(endpoint, data_de, data_ate, meses_por_parte)
    
    if not dados:
        print("Nenhum dado encontrado.")
        return
    
    # Exporta
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    base_nome = f"{endpoint}_{timestamp}"
    
    if exportar_json:
        salvar_json(dados, f"{base_nome}.json")
    if exportar_csv:
        salvar_csv(dados, f"{base_nome}.csv", endpoint)
    
    # Resumo
    if endpoint == "contratos":
        resumo_contratos(dados)
    else:
        resumo_generico(dados, endpoint)


if __name__ == "__main__":
    main()
