"""
migrate_db.py — Exporta dados do bortolini.db para SQL compatível com Supabase (PostgreSQL).
Execute: python migrate_db.py
Resultado: migration_data.sql  (cole no SQL Editor do Supabase)
"""
import sqlite3, json, re
from pathlib import Path
from datetime import datetime

DB_PATH = Path("bortolini.db")
OUT_PATH = Path("migration_data.sql")

TABLES = [
    "users", "menu_items", "orders", "order_items", "promotions",
    "customers", "settings", "ingredients", "menu_ingredients",
    "stock_movements", "drivers", "delivery_zones",
    "ai_conversations", "ai_messages",
]

def escape(v):
    if v is None:          return "NULL"
    if isinstance(v, int): return str(v)
    if isinstance(v, float): return str(v)
    return "'" + str(v).replace("'", "''") + "'"

def main():
    if not DB_PATH.exists():
        print(f"Arquivo {DB_PATH} não encontrado."); return

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    lines = [
        f"-- Migração gerada em {datetime.now().isoformat()}",
        "-- Cole no SQL Editor do Supabase\n",
    ]

    for table in TABLES:
        try:
            rows = conn.execute(f"SELECT * FROM {table}").fetchall()
        except Exception as e:
            print(f"Tabela {table} ignorada: {e}"); continue
        if not rows:
            continue
        cols = rows[0].keys()
        # Pula colunas que não existem no schema novo (pin plaintext vira pin_hash)
        lines.append(f"\n-- {table} ({len(rows)} registros)")
        for row in rows:
            vals = [escape(row[c]) for c in cols]
            col_list = ", ".join(cols)
            val_list = ", ".join(vals)
            lines.append(f"INSERT INTO {table} ({col_list}) VALUES ({val_list}) ON CONFLICT DO NOTHING;")

    conn.close()
    OUT_PATH.write_text("\n".join(lines), encoding="utf-8")
    print(f"Gerado: {OUT_PATH}  ({len(lines)} linhas)")

if __name__ == "__main__":
    main()
