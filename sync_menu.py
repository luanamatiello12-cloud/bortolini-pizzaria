#!/usr/bin/env python3
"""Sincroniza o cardápio do Bortolini no banco local (SQLite) ou PostgreSQL."""
import os
import sqlite3
import sys

# Se houver DATABASE_URL no ambiente, conecta ao PostgreSQL
DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
USE_POSTGRES = DATABASE_URL.startswith(("postgres://", "postgresql://"))

MENU_ITEMS = [
    {"name": "Calabresa", "category": "Pizzas", "description": "Molho de tomate, muçarela, calabresa fatiada, queijo parmesão, orégano", "price": 0, "active": 1},
    {"name": "Calabresa com Cebola", "category": "Pizzas", "description": "Molho de tomate, muçarela, calabresa fatiada, cebola em rodelas, orégano", "price": 0, "active": 1},
    {"name": "Calabresa com Farofa de Bacon", "category": "Pizzas", "description": "Molho de tomate, muçarela, calabresa fatiada, farofa de bacon, orégano", "price": 0, "active": 1},
    {"name": "Portuguesa", "category": "Pizzas", "description": "Molho de tomate, muçarela, presunto, ovo cozido, cebola, ervilha, azeitona, orégano", "price": 0, "active": 1},
    {"name": "Marguerita", "category": "Pizzas", "description": "Molho de tomate, muçarela, tomate em rodelas, orégano. Manjericão fresco adicionado após o forno", "price": 0, "active": 1},
    {"name": "Mexicana com Doritos", "category": "Pizzas", "description": "Molho de tomate, muçarela, carne moída temperada, pimentão, cebola, milho, pimenta calabresa, orégano, Doritos. Doritos adicionados após o forno para manter crocância", "price": 0, "active": 1},
    {"name": "Brócolis com Bacon", "category": "Pizzas", "description": "Molho de tomate, muçarela (base), brócolis, farofa de bacon, muçarela (finalização), orégano", "price": 0, "active": 1},
    {"name": "Alho e Óleo", "category": "Pizzas", "description": "Molho de tomate, pasta de alho e óleo, queijo parmesão, orégano", "price": 0, "active": 1},
    {"name": "Bacon", "category": "Pizzas", "description": "Molho de tomate, muçarela (base), bacon crocante, muçarela (finalização), orégano", "price": 0, "active": 1},
    {"name": "Milho", "category": "Pizzas", "description": "Molho de tomate, muçarela, milho verde, orégano", "price": 0, "active": 1},
    {"name": "Milho com Bacon", "category": "Pizzas", "description": "Molho de tomate, muçarela, milho verde, bacon em cubos, orégano", "price": 0, "active": 1},
    {"name": "Vegetariana", "category": "Pizzas", "description": "Molho de tomate, muçarela, milho, ervilha, brócolis, azeitona, palmito, muçarela finalização, orégano", "price": 0, "active": 1},
    {"name": "Coração", "category": "Pizzas", "description": "Molho de tomate, muçarela, coração bovino em fatias, muçarela finalização, orégano", "price": 0, "active": 1},
    {"name": "Filé ao Molho Mostarda", "category": "Pizzas", "description": "Molho de tomate, muçarela, filé mignon ao molho mostarda, muçarela finalização, orégano", "price": 0, "active": 1},
    {"name": "Filé Cremoso", "category": "Pizzas", "description": "Molho de tomate, muçarela, filé mignon cremoso (requeijão + creme de leite), catupiry em espirais, orégano", "price": 0, "active": 1},
    {"name": "Frango com Catupiry", "category": "Pizzas", "description": "Molho de tomate, muçarela, frango desfiado temperado, catupiry em espirais, orégano", "price": 0, "active": 1},
    {"name": "Frango Cremoso", "category": "Pizzas", "description": "Molho de tomate, muçarela, frango cremoso (creme de leite + requeijão), queijo parmesão, orégano", "price": 0, "active": 1},
    {"name": "Atum", "category": "Pizzas", "description": "Molho de tomate, muçarela, atum sólido em óleo escorrido, orégano", "price": 0, "active": 1},
    {"name": "Atum Especial", "category": "Pizzas", "description": "Molho de tomate, muçarela, atum sólido em óleo, requeijão cremoso em fios, orégano", "price": 0, "active": 1},
    {"name": "Estrogonofe de Carne", "category": "Pizzas", "description": "Molho de tomate, muçarela, estrogonofe de carne, orégano. Batata palha adicionada após o forno", "price": 0, "active": 1},
    {"name": "Estrogonofe de Frango", "category": "Pizzas", "description": "Molho de tomate, muçarela, estrogonofe de frango em cubos, muçarela finalização, orégano. Batata palha adicionada após o forno", "price": 0, "active": 1},
    {"name": "Costela Barbecue", "category": "Pizzas", "description": "Molho de tomate, muçarela, costela desfiada ao molho barbecue, muçarela finalização, orégano. Toque extra de barbecue após o forno", "price": 0, "active": 1},
    {"name": "Lombo com Abacaxi", "category": "Pizzas", "description": "Molho de tomate, muçarela, lombo canadense, orégano. Abacaxi adicionado após o forno com leve queima de maçarico", "price": 0, "active": 1},
    {"name": "Lombo c/ Farofa de Bacon e Catupiry", "category": "Pizzas", "description": "Molho de tomate, muçarela, lombo canadense, farofa de bacon, catupiry em filetes, orégano. Catupiry distribuído em filetes antes de assar", "price": 0, "active": 1},
    {"name": "Cinco Queijos", "category": "Pizzas", "description": "Molho de tomate, muçarela, queijo prato, provolone, cheddar, catupiry, orégano", "price": 0, "active": 1},
    {"name": "Bortolini Campeira ⭐", "category": "Pizzas", "description": "Molho de tomate, muçarela, costela desfiada, creme de alho, queijo coalho. Finalizada com cebola crisps, chimichurri e cheiro verde (após forno)", "price": 0, "active": 1},
    {"name": "Tomate Seco e Rúcula", "category": "Pizzas", "description": "Molho de tomate, muçarela (base), tomate seco, orégano, muçarela (finalização). Rúcula fresca adicionada após o forno", "price": 0, "active": 1},
    {"name": "Pizza Sushi de Atum Premium ⭐", "category": "Pizzas", "description": "Molho de tomate, cream cheese, atum, cheiro verde, muçarela leve, molho teriyaki, gergelim. Cream cheese e teriyaki em riscos alternados", "price": 0, "active": 1},
    {"name": "Dois Amores", "category": "Pizzas", "description": "Massa de pizza, creme de leite, chocolate branco derretido, chocolate preto derretido. Círculos alternados de chocolate branco e preto", "price": 0, "active": 1},
    {"name": "Chocolate Branco", "category": "Pizzas", "description": "Massa de pizza, creme de leite, chocolate branco ralado. Finalizada com pedacinhos de Lacta após o forno", "price": 0, "active": 1},
    {"name": "Chocolate Preto", "category": "Pizzas", "description": "Massa de pizza, creme de leite, chocolate preto. Chamusque com queimador após o forno; finalizar com pedaços de Lacta", "price": 0, "active": 1},
    {"name": "Prestígio", "category": "Pizzas", "description": "Massa de pizza, creme de leite, chocolate ao leite, raspas/fios de chocolate, pedaços de Prestígio. Pedaços de Prestígio adicionados após o forno", "price": 0, "active": 1},
    {"name": "Charge", "category": "Pizzas", "description": "Massa de pizza, chocolate preto, paçoca de amendoim esfarelada, pedaços de Charge. Paçoca e Charge adicionados após o forno", "price": 0, "active": 1},
    {"name": "Kinder Bueno", "category": "Pizzas", "description": "Massa de pizza, creme de leite, chocolate preto (chamusquedo), pedaços de Kinder Bueno (Lacta). Chocolate chamusquedo com maçarico; Kinder Bueno após o forno", "price": 0, "active": 1},
    {"name": "Banana com Canela", "category": "Pizzas", "description": "Massa de pizza, creme de leite, banana em fatias, mel, açúcar com canela", "price": 0, "active": 1},
    {"name": "Pizza Bortolini ⭐", "category": "Pizzas", "description": "Massa de pizza, creme de leite, amendoim triturado, Nutella, chocolate ralado, morangos frescos. Chamusque com maçarico; morangos e amendoim adicionados após o forno", "price": 0, "active": 1},
    {"name": "Bortolini Campeira Doce", "category": "Pizzas", "description": "Massa de pizza, creme de leite, Nutella, amendoim triturado, chocolate ralado. Variação doce especial da casa", "price": 0, "active": 1},
    {"name": "Coca-Cola 2L", "category": "Bebidas", "description": "Refrigerante Coca-Cola garrafa 2 litros", "price": 0, "active": 1},
    {"name": "Guaraná 2L", "category": "Bebidas", "description": "Refrigerante Guaraná garrafa 2 litros", "price": 0, "active": 1},
    {"name": "Fanta 2L", "category": "Bebidas", "description": "Refrigerante Fanta garrafa 2 litros", "price": 0, "active": 1},
    {"name": "Água com gás 500ml", "category": "Bebidas", "description": "Água mineral com gás 500ml", "price": 0, "active": 1},
    {"name": "Água sem gás 500ml", "category": "Bebidas", "description": "Água mineral sem gás 500ml", "price": 0, "active": 1},
]


def sync_sqlite():
    db_path = os.environ.get("DATABASE_PATH", "bortolini.db")
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    # Criar tabela se não existir
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS menu_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            category TEXT NOT NULL,
            price REAL NOT NULL DEFAULT 0,
            description TEXT,
            size TEXT,
            image_url TEXT,
            active INTEGER NOT NULL DEFAULT 1,
            sales INTEGER NOT NULL DEFAULT 0,
            prep_time TEXT,
            addons TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()

    inserted = 0
    updated = 0
    for item in MENU_ITEMS:
        cursor.execute("SELECT id FROM menu_items WHERE name = ?", (item["name"],))
        row = cursor.fetchone()
        if row:
            cursor.execute(
                "UPDATE menu_items SET category = ?, description = ?, active = 1, price = 0 WHERE name = ?",
                (item["category"], item["description"], item["name"]),
            )
            updated += 1
        else:
            cursor.execute(
                "INSERT INTO menu_items (name, category, price, description, active) VALUES (?, ?, ?, ?, ?)",
                (item["name"], item["category"], item["price"], item["description"], item["active"]),
            )
            inserted += 1

    conn.commit()
    conn.close()
    print(f"SQLite: {inserted} inseridos, {updated} atualizados.")


def sync_postgres():
    import psycopg
    conn = psycopg.connect(DATABASE_URL)
    cursor = conn.cursor()

    inserted = 0
    updated = 0
    for item in MENU_ITEMS:
        cursor.execute("SELECT id FROM menu_items WHERE name = %s", (item["name"],))
        row = cursor.fetchone()
        if row:
            cursor.execute(
                "UPDATE menu_items SET category = %s, description = %s, active = 1, price = 0 WHERE name = %s",
                (item["category"], item["description"], item["name"]),
            )
            updated += 1
        else:
            cursor.execute(
                "INSERT INTO menu_items (name, category, price, description, active) VALUES (%s, %s, %s, %s, %s)",
                (item["name"], item["category"], item["price"], item["description"], item["active"]),
            )
            inserted += 1

    conn.commit()
    conn.close()
    print(f"PostgreSQL: {inserted} inseridos, {updated} atualizados.")


if __name__ == "__main__":
    if USE_POSTGRES:
        try:
            import psycopg
        except ImportError:
            print("psycopg não instalado. Instale com: pip install psycopg[binary]")
            sys.exit(1)
        sync_postgres()
    else:
        sync_sqlite()
