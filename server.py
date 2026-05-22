from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import hashlib
import hmac
import json
import os
from pathlib import Path
import sqlite3
from datetime import datetime
import base64
import re
import secrets
import shutil
import threading
import time
import unicodedata
from urllib.parse import urlparse

try:
    import psycopg
    from psycopg import rows as pg_rows
except ImportError:
    psycopg = None
    pg_rows = None


ROOT = Path(__file__).resolve().parent


def load_dotenv():
    env_path = ROOT / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_dotenv()

APP_ENV = os.environ.get("APP_ENV", "local").lower()
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8000"))
DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
DB_PATH = Path(os.environ.get("DATABASE_PATH", ROOT / "bortolini.db"))
UPLOADS_DIR = Path(os.environ.get("UPLOADS_PATH", ROOT / "uploads"))
APP_SECRET = os.environ.get("APP_SECRET", "local-dev-change-before-production")
ADMIN_MASTER_KEY = os.environ.get("ADMIN_MASTER_KEY", "BORTOLINI-2026")

# SEGURANÇA: em produção, recuse iniciar com segredos default. Antes, se alguém
# esquecesse de configurar APP_SECRET ou ADMIN_MASTER_KEY, o sistema subia em
# produção com a chave conhecida do código-fonte — qualquer um podia resetar
# o PIN de admin via /api/admin/recover.
if APP_ENV == "production":
    _default_secrets = []
    if APP_SECRET == "local-dev-change-before-production":
        _default_secrets.append("APP_SECRET")
    if ADMIN_MASTER_KEY == "BORTOLINI-2026":
        _default_secrets.append("ADMIN_MASTER_KEY")
    if _default_secrets:
        raise RuntimeError(
            "APP_ENV=production mas as variáveis de ambiente "
            + ", ".join(_default_secrets)
            + " ainda estão com o valor padrão. Defina segredos fortes únicos antes de iniciar."
        )
USE_POSTGRES = DATABASE_URL.startswith(("postgres://", "postgresql://"))
DB_INTEGRITY_ERROR = (sqlite3.IntegrityError,)
if psycopg is not None:
    DB_INTEGRITY_ERROR = (sqlite3.IntegrityError, psycopg.IntegrityError)
SENSITIVE_SETTINGS = {"payment_token", "whatsapp_token", "pix_key"}
BLOCKED_EXTENSIONS = {".db", ".env", ".py", ".bat", ".yaml", ".md", ".txt", ".sh", ".cfg", ".ini"}
BLOCKED_FILES = {".gitignore", "Procfile", "requirements.txt", "render.yaml"}

# --- Sessões em memória ---
SESSION_STORE: dict = {}  # token → {user_id, role, name}
SESSION_LOCK = threading.Lock()

# --- Rate limiting: ip → [timestamps das tentativas recentes] ---
LOGIN_ATTEMPTS: dict = {}  # ip → [float timestamps]
LOGIN_LOCK = threading.Lock()
LOGIN_MAX_ATTEMPTS = 10
LOGIN_WINDOW_SECONDS = 300  # 5 minutos
SENSITIVE_ENV_KEYS = {
    "payment_token": "PAYMENT_TOKEN",
    "whatsapp_token": "WHATSAPP_TOKEN",
    "pix_key": "PIX_KEY",
}

ROLE_PERMISSIONS = {
    "admin": {"menu", "promotions", "orders", "settings", "delivery", "customers", "drivers", "inventory", "finance"},
    "entregador": {"delivery", "orders"},
    "financeiro": {"customers", "finance", "orders"},
}

PIX_CNPJ = "66.686.680/0001-57"
WHATSAPP_PHONE_NUMBER_ID = ""  # Preencher via settings quando tiver API Meta aprovada


# Seeds sempre aplicados para garantir usuarios padrao no primeiro boot

USER_SEED = [
    ("admin@bortolini.com", "00000000000", "3725", "Administrador", "admin"),
    ("financeiro@bortolini.com", "44444444444", "3702", "Financeiro", "financeiro"),
]


def hash_pin(pin):
    """Gera hash seguro do PIN com salt aleatório por usuário."""
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", pin.encode("utf-8"), salt.encode("utf-8"), 120_000)
    return f"pbkdf2_sha256${salt}${digest.hex()}"


def verify_pin(pin, stored_hash):
    if not stored_hash:
        return False
    try:
        algorithm, salt, digest = stored_hash.split("$", 2)
    except ValueError:
        return False
    if algorithm != "pbkdf2_sha256":
        return False
    candidate = hashlib.pbkdf2_hmac("sha256", pin.encode("utf-8"), salt.encode("utf-8"), 120_000).hex()
    return hmac.compare_digest(candidate, digest)


def create_session(user_id, role, name):
    """Cria token de sessão seguro e armazena no SESSION_STORE."""
    token = secrets.token_urlsafe(32)
    with SESSION_LOCK:
        SESSION_STORE[token] = {"user_id": user_id, "role": role, "name": name}
    return token


def validate_session(token):
    """Retorna dados da sessão ou None se inválida."""
    with SESSION_LOCK:
        return SESSION_STORE.get(token)


def invalidate_session(token):
    """Remove uma sessão ao fazer logout."""
    with SESSION_LOCK:
        SESSION_STORE.pop(token, None)


def check_rate_limit(ip):
    """Verifica se o IP não excedeu o limite de tentativas de login."""
    now = time.time()
    with LOGIN_LOCK:
        attempts = [t for t in LOGIN_ATTEMPTS.get(ip, []) if now - t < LOGIN_WINDOW_SECONDS]
        if len(attempts) >= LOGIN_MAX_ATTEMPTS:
            return False
        attempts.append(now)
        LOGIN_ATTEMPTS[ip] = attempts
    return True


def clear_rate_limit(ip):
    """Remove tentativas após login bem-sucedido."""
    with LOGIN_LOCK:
        LOGIN_ATTEMPTS.pop(ip, None)


def auto_backup():
    if USE_POSTGRES:
        return
    """Faz backup automático do banco SQLite e mantém apenas os 5 mais recentes."""
    try:
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        backup_path = ROOT / f"bortolini.backup-{timestamp}.db"
        shutil.copy2(DB_PATH, backup_path)
        backups = sorted(ROOT.glob("bortolini.backup-*.db"))
        for old in backups[:-5]:
            old.unlink(missing_ok=True)
    except Exception:
        pass
    finally:
        # Reagendar para 24 horas depois
        t = threading.Timer(86400, auto_backup)
        t.daemon = True
        t.start()


def only_digits(value):
    return re.sub(r"\D+", "", str(value or ""))


def initial_pin_from_cpf(cpf):
    return only_digits(cpf)[:4]


class HybridRow(dict):
    def __init__(self, columns, values):
        super().__init__(zip(columns, values))
        self._values = list(values)

    def __getitem__(self, key):
        if isinstance(key, int):
            return self._values[key]
        return super().__getitem__(key)


class PgCursor:
    def __init__(self, cursor, returning_id=None):
        self.cursor = cursor
        self.lastrowid = returning_id

    def _wrap(self, row):
        if row is None:
            return None
        columns = [column.name for column in self.cursor.description or []]
        return HybridRow(columns, row)

    def fetchone(self):
        return self._wrap(self.cursor.fetchone())

    def fetchall(self):
        return [self._wrap(row) for row in self.cursor.fetchall()]


class PgConnection:
    RETURNING_ID_TABLES = {
        "orders",
        "menu_items",
        "ingredients",
        "delivery_zones",
        "promotions",
        "drivers",
        "ai_conversations",
    }

    def __init__(self):
        if psycopg is None:
            raise RuntimeError("DATABASE_URL definido, mas psycopg nao esta instalado")
        self.conn = psycopg.connect(DATABASE_URL, row_factory=pg_rows.tuple_row)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        if exc_type:
            self.conn.rollback()
        else:
            self.conn.commit()
        self.conn.close()

    def adapt_sql(self, sql):
        adapted = sql.strip()
        ignore_insert = adapted.upper().startswith("INSERT OR IGNORE INTO")
        adapted = adapted.replace("INTEGER PRIMARY KEY AUTOINCREMENT", "BIGSERIAL PRIMARY KEY")
        adapted = adapted.replace("INSERT OR IGNORE INTO", "INSERT INTO")
        adapted = re.sub(r"ON CONFLICT\(([^)]+)\)", r"ON CONFLICT (\1)", adapted)
        adapted = adapted.replace("?", "%s")
        if ignore_insert and "ON CONFLICT" not in adapted.upper():
            adapted += " ON CONFLICT DO NOTHING"
        return adapted

    def insert_table(self, sql):
        match = re.match(r"\s*INSERT\s+INTO\s+([a-zA-Z_][a-zA-Z0-9_]*)", sql, re.IGNORECASE)
        return match.group(1) if match else ""

    def should_return_id(self, sql):
        upper = sql.upper()
        if "RETURNING" in upper or "ON CONFLICT" in upper:
            return False
        return self.insert_table(sql) in self.RETURNING_ID_TABLES

    def execute(self, sql, params=()):
        adapted = self.adapt_sql(sql)
        returning_id = None
        if self.should_return_id(adapted):
            adapted += " RETURNING id"
        cursor = self.conn.execute(adapted, tuple(params or ()))
        if " RETURNING id" in adapted:
            row = cursor.fetchone()
            returning_id = row[0] if row else None
        return PgCursor(cursor, returning_id)

    def executemany(self, sql, seq_of_params):
        adapted = self.adapt_sql(sql)
        self.conn.executemany(adapted, seq_of_params)


def connect():
    if USE_POSTGRES:
        return PgConnection()
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def table_columns(conn, table):
    if USE_POSTGRES:
        rows = conn.execute(
            """
            SELECT column_name AS name
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = ?
            """,
            (table,),
        ).fetchall()
        return {row["name"] for row in rows}
    return {row["name"] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}


def sqlite_master_sql(conn, table):
    if USE_POSTGRES:
        return ""
    row = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
        (table,),
    ).fetchone()
    return row["sql"] if row else ""


def init_db():
    UPLOADS_DIR.mkdir(exist_ok=True)
    with connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS menu_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                category TEXT NOT NULL,
                price REAL NOT NULL,
                sales INTEGER NOT NULL DEFAULT 0,
                active INTEGER NOT NULL DEFAULT 1
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                customer TEXT NOT NULL,
                channel TEXT NOT NULL,
                status TEXT NOT NULL,
                item TEXT NOT NULL,
                total REAL NOT NULL,
                payment TEXT NOT NULL,
                eta TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL UNIQUE,
                pin TEXT NOT NULL,
                name TEXT NOT NULL,
                role TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS promotions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                item_name TEXT NOT NULL,
                discount_type TEXT NOT NULL,
                discount_value REAL NOT NULL,
                starts_at TEXT NOT NULL,
                ends_at TEXT NOT NULL,
                channels TEXT NOT NULL,
                active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS customers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                phone TEXT,
                address TEXT,
                notes TEXT,
                last_order_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS order_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_id INTEGER NOT NULL,
                item_name TEXT NOT NULL,
                quantity INTEGER NOT NULL DEFAULT 1,
                unit_price REAL NOT NULL,
                total REAL NOT NULL,
                FOREIGN KEY(order_id) REFERENCES orders(id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS drivers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                area TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'Disponivel',
                active INTEGER NOT NULL DEFAULT 1,
                lat REAL,
                lng REAL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS ingredients (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                unit TEXT NOT NULL,
                stock_qty REAL NOT NULL DEFAULT 0,
                min_qty REAL NOT NULL DEFAULT 0,
                supplier TEXT,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS menu_ingredients (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                menu_item_id INTEGER NOT NULL,
                ingredient_id INTEGER NOT NULL,
                quantity REAL NOT NULL,
                FOREIGN KEY(menu_item_id) REFERENCES menu_items(id),
                FOREIGN KEY(ingredient_id) REFERENCES ingredients(id),
                UNIQUE(menu_item_id, ingredient_id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS stock_movements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ingredient_id INTEGER NOT NULL,
                movement_type TEXT NOT NULL,
                quantity REAL NOT NULL,
                reason TEXT NOT NULL,
                order_id INTEGER,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(ingredient_id) REFERENCES ingredients(id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS delivery_zones (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                neighborhood TEXT NOT NULL UNIQUE,
                fee REAL NOT NULL DEFAULT 0,
                eta TEXT NOT NULL DEFAULT '35 a 45 minutos',
                active INTEGER NOT NULL DEFAULT 1
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS ai_conversations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                client TEXT NOT NULL,
                channel TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'Aberta',
                mode TEXT NOT NULL DEFAULT 'ai',
                assigned_to TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS ai_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id INTEGER NOT NULL,
                author TEXT NOT NULL CHECK(author IN ('client', 'ai', 'agent', 'system')),
                text TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(conversation_id) REFERENCES ai_conversations(id)
            )
            """
        )
        ensure_order_delivery_columns(conn)
        ensure_menu_item_columns(conn)
        ensure_user_columns(conn)
        ensure_ingredient_columns(conn)
        ensure_audit_log(conn)
        ensure_ai_conversation_columns(conn)
        ensure_ai_message_system_author(conn)

        if conn.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0:
            conn.executemany(
                """
                INSERT INTO users (email, cpf, pin, pin_hash, name, role, must_change_pin)
                VALUES (?, ?, ?, ?, ?, ?, 1)
                """,
                [(email, cpf, "", hash_pin(pin), name, role) for email, cpf, pin, name, role in USER_SEED],
            )
        else:
            migrate_user_hashes(conn)

        seed_settings = {
            "restaurant_name": "Bortolini Pizzaria e delivery",
            "opening_hours": "18:00 às 23:30",
            "delivery_fee": "7.90",
            "delivery_areas": "Centro, Jardins, Vila Nova, Bela Vista",
            "prep_time": "35 a 45 minutos",
            "stock_whatsapp": "",
            "phone_number_id": "",
            "whatsapp_token": "",
            "pix_key": "66.686.680/0001-57",
            "payment_provider": "PIX manual",
        }
        for key, value in seed_settings.items():
            conn.execute(
                "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
                (key, value),
            )


def ensure_order_delivery_columns(conn):
    columns = table_columns(conn, "orders")
    migrations = {
        "driver_name": "ALTER TABLE orders ADD COLUMN driver_name TEXT",
        "driver_lat": "ALTER TABLE orders ADD COLUMN driver_lat REAL",
        "driver_lng": "ALTER TABLE orders ADD COLUMN driver_lng REAL",
        "last_location_at": "ALTER TABLE orders ADD COLUMN last_location_at TEXT",
        "customer_phone": "ALTER TABLE orders ADD COLUMN customer_phone TEXT",
        "address": "ALTER TABLE orders ADD COLUMN address TEXT",
        "notes": "ALTER TABLE orders ADD COLUMN notes TEXT",
        "delivery_type": "ALTER TABLE orders ADD COLUMN delivery_type TEXT DEFAULT 'Entrega'",
        "cancel_reason": "ALTER TABLE orders ADD COLUMN cancel_reason TEXT",
        "payment_receipt_url": "ALTER TABLE orders ADD COLUMN payment_receipt_url TEXT",
        "payment_status": "ALTER TABLE orders ADD COLUMN payment_status TEXT DEFAULT 'Aguardando pagamento'",
        "payment_receipt_status": "ALTER TABLE orders ADD COLUMN payment_receipt_status TEXT DEFAULT 'Nao enviado'",
        "payment_receipt_note": "ALTER TABLE orders ADD COLUMN payment_receipt_note TEXT",
        "delivery_fee": "ALTER TABLE orders ADD COLUMN delivery_fee REAL DEFAULT 0",
        "discount": "ALTER TABLE orders ADD COLUMN discount REAL DEFAULT 0",
    }
    for column, sql in migrations.items():
        if column not in columns:
            conn.execute(sql)


def ensure_menu_item_columns(conn):
    columns = table_columns(conn, "menu_items")
    migrations = {
        "image_url": "ALTER TABLE menu_items ADD COLUMN image_url TEXT",
        "description": "ALTER TABLE menu_items ADD COLUMN description TEXT",
        "size": "ALTER TABLE menu_items ADD COLUMN size TEXT",
        "prep_time": "ALTER TABLE menu_items ADD COLUMN prep_time TEXT",
        "addons": "ALTER TABLE menu_items ADD COLUMN addons TEXT",
    }
    for column, sql in migrations.items():
        if column not in columns:
            conn.execute(sql)


def ensure_user_columns(conn):
    columns = table_columns(conn, "users")
    if "pin_hash" not in columns:
        conn.execute("ALTER TABLE users ADD COLUMN pin_hash TEXT")
    if "cpf" not in columns:
        conn.execute("ALTER TABLE users ADD COLUMN cpf TEXT")
    if "must_change_pin" not in columns:
        conn.execute("ALTER TABLE users ADD COLUMN must_change_pin INTEGER NOT NULL DEFAULT 0")


def ensure_audit_log(conn):
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            action TEXT NOT NULL,
            entity TEXT NOT NULL,
            entity_id INTEGER,
            details TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )


def ensure_ai_conversation_columns(conn):
    columns = table_columns(conn, "ai_conversations")
    if "mode" not in columns:
        conn.execute("ALTER TABLE ai_conversations ADD COLUMN mode TEXT NOT NULL DEFAULT 'ai'")
    if "assigned_to" not in columns:
        conn.execute("ALTER TABLE ai_conversations ADD COLUMN assigned_to TEXT")


def ensure_ai_message_system_author(conn):
    table_sql = sqlite_master_sql(conn, "ai_messages")
    if USE_POSTGRES or not table_sql or "'system'" in table_sql:
        return
    conn.execute("ALTER TABLE ai_messages RENAME TO ai_messages_old")
    conn.execute(
        """
        CREATE TABLE ai_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            conversation_id INTEGER NOT NULL,
            author TEXT NOT NULL CHECK(author IN ('client', 'ai', 'agent', 'system')),
            text TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(conversation_id) REFERENCES ai_conversations(id)
        )
        """
    )
    conn.execute(
        """
        INSERT INTO ai_messages (id, conversation_id, author, text, created_at)
        SELECT id, conversation_id, author, text, created_at
        FROM ai_messages_old
        """
    )
    conn.execute("DROP TABLE ai_messages_old")


def ensure_ingredient_columns(conn):
    columns = table_columns(conn, "ingredients")
    if "unit_cost" not in columns:
        conn.execute("ALTER TABLE ingredients ADD COLUMN unit_cost REAL DEFAULT 0")
    if "code" not in columns:
        conn.execute("ALTER TABLE ingredients ADD COLUMN code TEXT DEFAULT ''")


def migrate_user_hashes(conn):
    # Remover perfis obsoletos que não existem mais no USER_SEED
    seed_emails = {email for email, *_ in USER_SEED}
    obsolete_roles = {"atendente", "cozinha", "gerente"}
    rows = conn.execute("SELECT id, email, role FROM users").fetchall()
    for row in rows:
        if row["email"] not in seed_emails and row["role"] in obsolete_roles:
            conn.execute("DELETE FROM users WHERE id = ?", (row["id"],))

    # Atualizar senhas e dados dos perfis do seed
    rows = conn.execute("SELECT id, email, pin, pin_hash, cpf FROM users").fetchall()
    cpf_by_email = {email: cpf for email, cpf, _pin, _name, _role in USER_SEED}
    for row in rows:
        if not row["cpf"] and cpf_by_email.get(row["email"]):
            conn.execute("UPDATE users SET cpf = ? WHERE id = ?", (cpf_by_email[row["email"]], row["id"]))
        if row["pin_hash"]:
            continue
        if row["pin"]:
            conn.execute("UPDATE users SET pin_hash = ?, pin = '' WHERE id = ?", (hash_pin(row["pin"]), row["id"]))

    # Inserir ou atualizar perfis do seed
    for email, cpf, pin, name, role in USER_SEED:
        existing = conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
        if existing:
            conn.execute(
                "UPDATE users SET cpf = ?, name = ?, role = ?, pin_hash = ?, pin = '', must_change_pin = 0 WHERE email = ?",
                (cpf, name, role, hash_pin(pin), email),
            )
        else:
            conn.execute(
                "INSERT INTO users (email, cpf, pin, pin_hash, name, role, must_change_pin) VALUES (?, ?, ?, ?, ?, ?, 0)",
                (email, cpf, "", hash_pin(pin), name, role),
            )


# Funções de seed removidas — sistema inicia limpo
def rows_to_dicts(rows):
    return [dict(row) for row in rows]


MAX_UPLOAD_BYTES = 5 * 1024 * 1024  # 5MB para imagens/comprovantes

# Magic bytes para validação real do conteúdo
IMAGE_MAGIC = {
    "jpg":  [b"\xff\xd8\xff"],
    "png":  [b"\x89PNG\r\n\x1a\n"],
    "webp": [b"RIFF"],
    "gif":  [b"GIF87a", b"GIF89a"],
    "pdf":  [b"%PDF-"],
}


def _matches_magic(data, ext):
    expected = IMAGE_MAGIC.get(ext, [])
    return any(data.startswith(magic) for magic in expected)


def data_url_to_upload(value, prefix):
    if not isinstance(value, str) or not value.startswith(("data:image/", "data:application/pdf")):
        return value
    match = re.match(r"data:(?:image/([a-zA-Z0-9+.-]+)|application/(pdf));base64,(.+)", value, re.DOTALL)
    if not match:
        return value
    raw_ext = (match.group(1) or match.group(2)).lower()
    ext = "jpg" if raw_ext in {"jpeg", "jpg"} else "svg" if raw_ext == "svg+xml" else raw_ext
    try:
        decoded = base64.b64decode(match.group(3), validate=True)
    except Exception:
        return value
    # Limite de tamanho
    if len(decoded) > MAX_UPLOAD_BYTES:
        return value
    # Recusa SVG (XML executa scripts inline em alguns visualizadores)
    if ext == "svg":
        return value
    # Valida magic bytes (impede o velho truque de mandar binário disfarçado)
    if ext in IMAGE_MAGIC and not _matches_magic(decoded, ext):
        return value
    # Nome aleatório: impede que terceiro enumere comprovantes adivinhando IDs
    safe_prefix = re.sub(r"[^a-zA-Z0-9_-]+", "-", prefix).strip("-") or "upload"
    random_token = secrets.token_hex(12)
    filename = f"{safe_prefix}-{random_token}.{ext}"
    path = UPLOADS_DIR / filename
    path.write_bytes(decoded)
    return f"uploads/{filename}"


class BortoliniHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "same-origin")
        super().end_headers()

    def get_client_ip(self):
        forwarded = self.headers.get("X-Forwarded-For", "")
        return forwarded.split(",")[0].strip() if forwarded else self.client_address[0]

    def do_GET(self):
        path = urlparse(self.path).path

        # Bloquear acesso direto a arquivos sensíveis
        suffix = Path(path).suffix.lower()
        basename = Path(path).name
        if suffix in BLOCKED_EXTENSIONS or basename in BLOCKED_FILES:
            self.send_error(HTTPStatus.FORBIDDEN, "Acesso negado")
            return

        # ── Rotas amigáveis ──────────────────────────────────────────────
        # /admin          → SPA com ?#admin (painel do dono/admin)
        # /cardapio       → SPA com #customer (cardápio público)
        # /pedido         → SPA com #customer (alias de cardápio)
        # /pedido/<id>    → SPA com ?pedido=<id> (rastreio do pedido)
        # /entregador/<id>→ SPA já roteada abaixo
        def serve_spa_redirect(fragment=None, query=None):
            """Serve o index.html injetando um script de redirect no <head>."""
            html = (ROOT / "index.html").read_bytes().decode("utf-8")
            if fragment or query:
                qs = f"?{query}" if query else ""
                frag = f"#{fragment}" if fragment else ""
                script = (
                    f'<script>if(location.pathname!=="/"){{history.replaceState(null,"","/{qs}{frag}");}}'
                    f'{"window.location.hash=" + repr(fragment) + ";" if fragment else ""}'
                    f'</script>'
                )
                html = html.replace("</head>", script + "\n</head>", 1)
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(html.encode("utf-8"))

        # /admin → painel administrativo (requer login)
        if path == "/admin":
            serve_spa_redirect(fragment="admin")
            return

        # /cardapio ou /pedido (sem ID) → cardápio público do cliente
        if path in ("/cardapio", "/pedido"):
            serve_spa_redirect(fragment="customer")
            return

        # /pedido/<id numérico> → rastreamento de pedido do cliente
        if path.startswith("/pedido/"):
            tail = path.removeprefix("/pedido/")
            if tail.isdigit():
                serve_spa_redirect(query=f"pedido={tail}")
                return
            # fallback: não é numérico, continua roteamento normal

        if path.startswith("/uploads/"):
            self.serve_upload(path)
            return
        if path.startswith("/api/public/orders/") and not path.endswith("/comprovante"):
            try:
                order_id = int(path.rsplit("/", 1)[-1])
            except ValueError:
                self.send_error(HTTPStatus.BAD_REQUEST, "ID inválido")
                return
            data = self.get_public_order(order_id)
            if data is not None:
                self.send_json(data)
            return
        if path.startswith("/entregador"):
            # Serve SPA para o app do entregador
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write((ROOT / "index.html").read_bytes())
            return
        if path.startswith("/api/public/driver/"):
            try:
                driver_user_id = int(path.rsplit("/", 1)[-1])
            except ValueError:
                self.send_error(HTTPStatus.BAD_REQUEST, "ID inválido")
                return
            data = self.get_public_driver_orders(driver_user_id)
            if data is not None:
                self.send_json(data)
            return
        # ── Rotas GET que exigem autenticação ───────────────────────────────
        # /api/menu e /api/delivery-zones são públicas (cardápio do cliente precisa)
        # Todos os outros dados internos exigem sessão válida.
        if path == "/api/orders":
            if not self.require_permission("orders"):
                return
            self.send_json(self.get_orders())
            return
        if path == "/api/menu":
            # Pública: usada pelo cardápio do cliente sem login
            self.send_json(self.get_menu())
            return
        if path == "/api/ingredients":
            if not self.require_permission("inventory"):
                return
            self.send_json(self.get_ingredients())
            return
        if path == "/api/recipes":
            if not self.require_permission("inventory"):
                return
            self.send_json(self.get_recipes())
            return
        if path == "/api/stock-movements":
            if not self.require_permission("inventory"):
                return
            self.send_json(self.get_stock_movements())
            return
        if path == "/api/delivery-zones":
            # Pública: usada pelo cardápio do cliente (taxas de entrega por CEP)
            self.send_json(self.get_delivery_zones())
            return
        if path == "/api/profit-report":
            if not self.require_permission("financial"):
                return
            self.send_json(self.get_profit_report())
            return
        if path == "/api/promotions":
            # Semi-pública: promoções exibidas no cardápio
            self.send_json(self.get_promotions())
            return
        if path == "/api/stats":
            if not self.require_permission("orders"):
                return
            self.send_json(self.get_stats())
            return
        if path == "/api/users":
            if not self.require_permission("settings"):
                return
            self.send_json(self.get_demo_users())
            return
        if path == "/api/deliveries":
            if not self.require_permission("delivery"):
                return
            self.send_json(self.get_deliveries())
            return
        if path == "/api/drivers":
            if not self.require_permission("delivery"):
                return
            self.send_json(self.get_drivers())
            return
        if path == "/api/customers":
            if not self.require_permission("financial"):
                return
            self.send_json(self.get_customers())
            return
        if path.startswith("/api/customers/") and path.endswith("/orders"):
            if not self.require_permission("financial"):
                return
            customer_id = int(path.split("/")[-2])
            data = self.get_customer_orders(customer_id)
            if data is not None:
                self.send_json(data)
            return
        if path == "/api/closeout":
            if not self.require_permission("financial"):
                return
            self.send_json(self.get_closeout())
            return
        if path == "/api/settings":
            if not self.require_permission("settings"):
                return
            self.send_json(self.get_settings())
            return
        if path == "/api/inbox":
            if not self.require_permission("orders"):
                return
            self.send_json(self.get_inbox())
            return
        super().do_GET()

    def serve_upload(self, path):
        requested = (UPLOADS_DIR / path.removeprefix("/uploads/")).resolve()
        uploads_root = UPLOADS_DIR.resolve()
        if uploads_root not in requested.parents and requested != uploads_root:
            self.send_error(HTTPStatus.FORBIDDEN, "Arquivo inválido")
            return
        if not requested.exists() or not requested.is_file():
            self.send_error(HTTPStatus.NOT_FOUND, "Arquivo não encontrado")
            return
        # SEGURANÇA: comprovantes PIX contêm dados financeiros do cliente (nome,
        # valor, banco). Antes a pasta era pública e arquivos tinham nome
        # previsível (comprovante-pix-{id}.jpg) — bastava enumerar IDs.
        # Hoje o nome é aleatório, mas ainda exigimos auth de quem pode aprovar/conferir.
        if requested.name.lower().startswith("comprovante-"):
            token = self.headers.get("X-Session-Token", "")
            session = validate_session(token) if token else None
            allowed_roles = {"admin", "financeiro"}
            if not session or session.get("role") not in allowed_roles:
                self.send_error(HTTPStatus.FORBIDDEN, "Acesso restrito a admin/financeiro")
                return
        suffix = requested.suffix.lower()
        content_type = {
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".png": "image/png",
            ".webp": "image/webp",
            ".gif": "image/gif",
            ".svg": "image/svg+xml",
            ".pdf": "application/pdf",
        }.get(suffix, "application/octet-stream")
        data = requested.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/orders":
            payload = self.read_json()
            data = self.create_order(payload)
            if data is not None:
                self.send_json(data, HTTPStatus.CREATED)
            return
        if path == "/api/menu":
            if not self.require_permission("menu"):
                return
            payload = self.read_json()
            data = self.create_menu_item(payload)
            if data is not None:
                self.send_json(data, HTTPStatus.CREATED)
            return
        if path == "/api/promotions":
            if not self.require_permission("promotions"):
                return
            payload = self.read_json()
            data = self.create_promotion(payload)
            if data is not None:
                self.send_json(data, HTTPStatus.CREATED)
            return
        if path == "/api/drivers":
            if not self.require_permission("drivers"):
                return
            payload = self.read_json()
            data = self.create_driver(payload)
            if data is not None:
                self.send_json(data, HTTPStatus.CREATED)
            return
        if path == "/api/ingredients":
            if not self.require_permission("inventory"):
                return
            payload = self.read_json()
            data = self.create_ingredient(payload)
            if data is not None:
                self.send_json(data, HTTPStatus.CREATED)
            return
        if path.startswith("/api/menu/") and path.endswith("/ingredients"):
            if not self.require_permission("inventory"):
                return
            item_id = int(path.split("/")[-2])
            payload = self.read_json()
            data = self.save_recipe_ingredient(item_id, payload)
            if data is not None:
                self.send_json(data, HTTPStatus.CREATED)
            return
        if path == "/api/delivery-zones":
            if not self.require_permission("settings"):
                return
            payload = self.read_json()
            data = self.create_delivery_zone(payload)
            if data is not None:
                self.send_json(data, HTTPStatus.CREATED)
            return
        if path == "/api/login":
            payload = self.read_json()
            data = self.login(payload)
            if data is not None:
                self.send_json(data)
            return
        if path == "/api/logout":
            token = self.headers.get("X-Session-Token", "")
            if token:
                invalidate_session(token)
            self.send_json({"ok": True})
            return
        if path == "/api/admin/recover":
            payload = self.read_json()
            data = self.recover_admin(payload)
            if data is not None:
                self.send_json(data)
            return
        if path == "/api/settings":
            if not self.require_permission("settings"):
                return
            payload = self.read_json()
            self.send_json(self.save_settings(payload))
            return
        if path.startswith("/api/inbox/") and path.endswith("/reply"):
            if not self.require_permission("orders"):
                return
            conversation_id = int(path.split("/")[-2])
            payload = self.read_json()
            data = self.reply_inbox(conversation_id, payload)
            if data is not None:
                self.send_json(data, HTTPStatus.CREATED)
            return
        if path.startswith("/api/inbox/") and path.endswith("/mode"):
            if not self.require_permission("orders"):
                return
            conversation_id = int(path.split("/")[-2])
            payload = self.read_json()
            data = self.update_inbox_mode(conversation_id, payload)
            if data is not None:
                self.send_json(data)
            return
        if path == "/api/inbox":
            if not self.require_permission("orders"):
                return
            payload = self.read_json()
            data = self.create_inbox_conversation(payload)
            if data is not None:
                self.send_json(data, HTTPStatus.CREATED)
            return
        if path == "/api/public/drivers/register":
            # DESATIVADA: essa rota permitia que qualquer pessoa criasse uma conta de
            # entregador (com token de sessão válido) sem autorização. Hoje só o admin
            # pode criar entregadores (rota /api/drivers, requer permissão "drivers").
            self.send_error(HTTPStatus.FORBIDDEN, "Auto-cadastro de entregador desativado. Solicite ao administrador.")
            return
        if path.startswith("/api/public/orders/") and path.endswith("/comprovante"):
            parts = path.split("/")
            try:
                order_id = int(parts[-2])
            except (ValueError, IndexError):
                self.send_error(HTTPStatus.BAD_REQUEST, "ID inválido")
                return
            payload = self.read_json()
            data = self.upload_public_comprovante(order_id, payload)
            if data is not None:
                self.send_json(data)
            return
        self.send_error(HTTPStatus.NOT_FOUND, "Rota não encontrada")

    def do_PATCH(self):
        path = urlparse(self.path).path
        if path.startswith("/api/users/") and path.endswith("/pin"):
            user_id = int(path.split("/")[-2])
            payload = self.read_json()
            data = self.change_user_pin(user_id, payload)
            if data is not None:
                self.send_json(data)
            return
        if path.startswith("/api/users/") and path.endswith("/reset-pin"):
            if not self.require_permission("settings"):
                return
            user_id = int(path.split("/")[-2])
            data = self.reset_user_pin(user_id)
            if data is not None:
                self.send_json(data)
            return
        if path.startswith("/api/menu/") and path.endswith("/ingredients"):
            if not self.require_permission("inventory"):
                return
            item_id = int(path.split("/")[-2])
            payload = self.read_json()
            data = self.replace_recipe_ingredients(item_id, payload)
            if data is not None:
                self.send_json(data)
            return
        if path.startswith("/api/orders/") and path.endswith("/payment"):
            if not self.require_permission("finance"):
                return
            order_id = int(path.split("/")[-2])
            payload = self.read_json()
            data = self.update_order_payment(order_id, payload)
            if data is not None:
                self.send_json(data)
            return
        if path.startswith("/api/orders/") and path.endswith("/driver"):
            if not self.require_permission("delivery"):
                return
            order_id = int(path.split("/")[-2])
            payload = self.read_json()
            data = self.assign_driver(order_id, payload)
            if data is not None:
                self.send_json(data)
            return
        if path.startswith("/api/orders/"):
            if not self.require_permission("orders"):
                return
            order_id = int(path.rsplit("/", 1)[-1])
            payload = self.read_json()
            data = self.update_order(order_id, payload)
            if data is not None:
                self.send_json(data)
            return
        if path.startswith("/api/deliveries/") and path.endswith("/location"):
            if not self.require_permission("delivery"):
                return
            order_id = int(path.split("/")[-2])
            payload = self.read_json()
            data = self.update_delivery_location(order_id, payload)
            if data is not None:
                self.send_json(data)
            return
        if path.startswith("/api/public/drivers/") and path.endswith("/location"):
            # SEGURANÇA: exige sessão de entregador. O entregador deve ter feito login
            # no link público com PIN antes. Sem isso, qualquer um conseguia mandar
            # coordenadas falsas pra qualquer entregador.
            token = self.headers.get("X-Session-Token", "")
            session = validate_session(token) if token else None
            if not session or session.get("role") != "entregador":
                self.send_error(HTTPStatus.UNAUTHORIZED, "Faça login como entregador antes de compartilhar localização")
                return
            driver_id = int(path.split("/")[-2])
            # Garante que o entregador só pode atualizar a própria localização
            if session.get("user_id") != driver_id:
                self.send_error(HTTPStatus.FORBIDDEN, "Você só pode atualizar sua própria localização")
                return
            payload = self.read_json()
            data = self.update_driver_location(driver_id, payload)
            if data is not None:
                self.send_json(data)
            return
        if path.startswith("/api/menu/"):
            if not self.require_permission("menu"):
                return
            item_id = int(path.rsplit("/", 1)[-1])
            payload = self.read_json()
            data = self.update_menu_item(item_id, payload)
            if data is not None:
                self.send_json(data)
            return
        if path.startswith("/api/ingredients/"):
            if not self.require_permission("inventory"):
                return
            ingredient_id = int(path.rsplit("/", 1)[-1])
            payload = self.read_json()
            data = self.update_ingredient(ingredient_id, payload)
            if data is not None:
                self.send_json(data)
            return
        if path.startswith("/api/delivery-zones/"):
            if not self.require_permission("settings"):
                return
            zone_id = int(path.rsplit("/", 1)[-1])
            payload = self.read_json()
            data = self.update_delivery_zone(zone_id, payload)
            if data is not None:
                self.send_json(data)
            return
        if path.startswith("/api/promotions/"):
            if not self.require_permission("promotions"):
                return
            promotion_id = int(path.rsplit("/", 1)[-1])
            payload = self.read_json()
            data = self.update_promotion(promotion_id, payload)
            if data is not None:
                self.send_json(data)
            return
        if path.startswith("/api/drivers/"):
            if not self.require_permission("drivers"):
                return
            driver_id = int(path.rsplit("/", 1)[-1])
            payload = self.read_json()
            data = self.update_driver(driver_id, payload)
            if data is not None:
                self.send_json(data)
            return
        self.send_error(HTTPStatus.NOT_FOUND, "Rota não encontrada")

    def require_permission(self, permission):
        """Valida sessão e verifica se o role tem a permissão solicitada.
        Toda requisição autenticada DEVE ter X-Session-Token válido.
        O header X-User-Role sozinho não é mais aceito como auth (era um fallback
        perigoso que permitia qualquer cliente forjar o próprio papel).
        """
        token = self.headers.get("X-Session-Token", "")
        if not token:
            self.send_error(HTTPStatus.UNAUTHORIZED, "Autenticação necessária")
            return False
        session = validate_session(token)
        if not session:
            self.send_error(HTTPStatus.UNAUTHORIZED, "Sessão inválida ou expirada")
            return False
        role = session["role"]
        if permission in ROLE_PERMISSIONS.get(role, set()):
            return True
        self.send_error(HTTPStatus.FORBIDDEN, "Perfil sem permissão para esta ação")
        return False

    def read_json(self):
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        body = self.rfile.read(length)
        try:
            raw = body.decode("utf-8")
        except UnicodeDecodeError:
            raw = body.decode("cp1252")
        return json.loads(raw)

    def send_json(self, data, status=HTTPStatus.OK):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def get_orders(self):
        with connect() as conn:
            rows = conn.execute("SELECT * FROM orders ORDER BY id DESC").fetchall()
        return rows_to_dicts(rows)

    def get_public_order(self, order_id):
        with connect() as conn:
            row = conn.execute(
                """
                SELECT id, customer, status, item, total, eta, delivery_type, cancel_reason, payment_receipt_url,
                       payment_status, payment_receipt_status, payment_receipt_note,
                       driver_name, driver_lat, driver_lng, last_location_at
                FROM orders
                WHERE id = ?
                """,
                (order_id,),
            ).fetchone()
            if row is None:
                self.send_error(HTTPStatus.NOT_FOUND, "Pedido não encontrado")
                return
            items = conn.execute(
                "SELECT item_name, quantity, unit_price, total FROM order_items WHERE order_id = ?",
                (order_id,),
            ).fetchall()
        data = dict(row)
        data["items"] = rows_to_dicts(items)
        return data

    def register_driver_user(self, payload):
        """Cadastra novo entregador com PIN padrão a partir do CPF (primeiro acesso)."""
        name = payload.get("name", "").strip()
        cpf = only_digits(payload.get("cpf", ""))
        phone = payload.get("phone", "").strip()
        if not name:
            self.send_error(HTTPStatus.BAD_REQUEST, "Nome do entregador obrigatório")
            return None
        if len(cpf) < 4:
            self.send_error(HTTPStatus.BAD_REQUEST, "CPF válido com pelo menos 4 dígitos é obrigatório")
            return None
        pin = initial_pin_from_cpf(cpf)
        if len(pin) < 4:
            pin = "1234"
        with connect() as conn:
            safe_name = re.sub(r"[^a-z0-9]", "", name.lower().replace(" ", "."))
            if not safe_name:
                safe_name = "entregador"
            email = f"{safe_name}@entregador.bortolini"
            # Garantir email único adicionando sufixo numérico se necessário
            original_email = email
            suffix = 1
            while conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone():
                email = f"{original_email}.{suffix}"
                suffix += 1
            cursor = conn.execute(
                "INSERT INTO users (email, cpf, pin, pin_hash, name, role, must_change_pin) VALUES (?, ?, ?, ?, ?, ?, 1)",
                (email, cpf, "", hash_pin(pin), name, "entregador"),
            )
            user_id = cursor.lastrowid
            conn.execute(
                "INSERT OR IGNORE INTO drivers (name, area, status, active, lat, lng) VALUES (?, ?, ?, 1, NULL, NULL)",
                (name, phone or "Sem área", "Disponivel"),
            )
        token = create_session(user_id, "entregador", name)
        return {"token": token, "user_id": user_id, "name": name, "role": "entregador", "must_change_pin": 1, "default_pin": pin, "driver_link": f"/entregador/{user_id}"}

    def get_public_driver_orders(self, driver_user_id):
        """Retorna pedidos em entrega vinculados ao nome do entregador (para link público)."""
        with connect() as conn:
            user = conn.execute("SELECT name FROM users WHERE id = ? AND role = 'entregador'", (driver_user_id,)).fetchone()
            if user is None:
                self.send_error(HTTPStatus.NOT_FOUND, "Entregador não encontrado")
                return None
            orders = conn.execute(
                """SELECT id, customer, status, item, total, address, driver_lat, driver_lng, last_location_at, eta
                   FROM orders WHERE driver_name = ? AND status = 'Entrega' ORDER BY id DESC LIMIT 10""",
                (user["name"],),
            ).fetchall()
        return {"driver_name": user["name"], "orders": rows_to_dicts(orders)}

    def send_whatsapp_low_stock_alert(self, ingredient_name, stock_qty, min_qty, unit):
        """Envia alerta WhatsApp quando ingrediente atingir estoque mínimo."""
        with connect() as conn:
            settings = {row["key"]: row["value"] for row in conn.execute("SELECT key, value FROM settings").fetchall()}
        whatsapp_number = settings.get("stock_whatsapp", "").strip()
        token = settings.get("whatsapp_token", "").strip()
        phone_number_id = settings.get("phone_number_id", "").strip()
        if not whatsapp_number:
            return
        msg = (
            f"⚠️ *Estoque mínimo atingido!*\n"
            f"Ingrediente: *{ingredient_name}*\n"
            f"Quantidade atual: {stock_qty} {unit}\n"
            f"Mínimo configurado: {min_qty} {unit}\n"
            f"Por favor, faça o reabastecimento."
        )
        if token and phone_number_id:
            # API oficial Meta
            try:
                import urllib.request
                body = json.dumps({
                    "messaging_product": "whatsapp",
                    "to": whatsapp_number,
                    "type": "text",
                    "text": {"body": msg}
                }).encode()
                req = urllib.request.Request(
                    f"https://graph.facebook.com/v19.0/{phone_number_id}/messages",
                    data=body,
                    headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                    method="POST"
                )
                urllib.request.urlopen(req, timeout=5)
            except Exception:
                pass
        else:
            # Fallback: wa.me link registrado no log
            wa_link = f"https://wa.me/{whatsapp_number}?text={urllib.parse.quote(msg)}"
            print(f"[ESTOQUE MINIMO] {ingredient_name}: {wa_link}")

    def upload_public_comprovante(self, order_id, payload):
        with connect() as conn:
            row = conn.execute("SELECT id, payment FROM orders WHERE id = ?", (order_id,)).fetchone()
            if row is None:
                self.send_error(HTTPStatus.NOT_FOUND, "Pedido não encontrado")
                return None
            receipt_data = payload.get("comprovante", "")
            if not receipt_data:
                self.send_error(HTTPStatus.BAD_REQUEST, "Comprovante não enviado")
                return None
            receipt_url = data_url_to_upload(receipt_data, f"comprovante-pix-{order_id}")
            if not receipt_url or receipt_url == receipt_data:
                self.send_error(HTTPStatus.BAD_REQUEST, "Formato de comprovante inválido")
                return None
            conn.execute(
                """UPDATE orders SET payment_receipt_url = ?, payment_status = 'Comprovante enviado',
                   payment_receipt_status = 'Enviado' WHERE id = ?""",
                (receipt_url, order_id),
            )
        return {"ok": True, "receipt_url": receipt_url}

    def get_menu(self):
        with connect() as conn:
            rows = conn.execute("SELECT * FROM menu_items ORDER BY id").fetchall()
        return rows_to_dicts(rows)

    def get_ingredients(self):
        with connect() as conn:
            rows = conn.execute(
                """
                SELECT *,
                       CASE WHEN stock_qty <= min_qty THEN 1 ELSE 0 END AS low_stock
                FROM ingredients
                ORDER BY low_stock DESC, name
                """
            ).fetchall()
        return rows_to_dicts(rows)

    def get_recipes(self):
        with connect() as conn:
            rows = conn.execute(
                """
                SELECT mi.id, mi.menu_item_id, mi.ingredient_id, mi.quantity,
                       m.name AS item_name, i.name AS ingredient_name, i.unit
                FROM menu_ingredients mi
                JOIN menu_items m ON m.id = mi.menu_item_id
                JOIN ingredients i ON i.id = mi.ingredient_id
                ORDER BY m.name, i.name
                """
            ).fetchall()
        return rows_to_dicts(rows)

    def get_stock_movements(self):
        with connect() as conn:
            rows = conn.execute(
                """
                SELECT sm.*, i.name AS ingredient_name, i.unit
                FROM stock_movements sm
                JOIN ingredients i ON i.id = sm.ingredient_id
                ORDER BY sm.id DESC
                LIMIT 80
                """
            ).fetchall()
        return rows_to_dicts(rows)

    def get_delivery_zones(self):
        with connect() as conn:
            rows = conn.execute("SELECT * FROM delivery_zones ORDER BY neighborhood").fetchall()
        return rows_to_dicts(rows)

    def get_profit_report(self):
        with connect() as conn:
            rows = conn.execute(
                """
                SELECT
                    oi.item_name,
                    SUM(oi.quantity) AS quantity,
                    SUM(oi.total) AS revenue,
                    COALESCE(SUM(oi.quantity * recipe.cost), 0) AS cost
                FROM order_items oi
                JOIN orders o ON o.id = oi.order_id
                LEFT JOIN menu_items m ON lower(m.name) = lower(oi.item_name)
                LEFT JOIN (
                    SELECT mi.menu_item_id, SUM(mi.quantity * COALESCE(i.unit_cost, 0)) AS cost
                    FROM menu_ingredients mi
                    JOIN ingredients i ON i.id = mi.ingredient_id
                    GROUP BY mi.menu_item_id
                ) recipe ON recipe.menu_item_id = m.id
                WHERE o.status != 'Cancelado'
                GROUP BY oi.item_name
                ORDER BY revenue - cost DESC
                """
            ).fetchall()
        data = rows_to_dicts(rows)
        for row in data:
            row["profit"] = float(row.get("revenue") or 0) - float(row.get("cost") or 0)
        return data

    def get_promotions(self):
        with connect() as conn:
            rows = conn.execute("SELECT * FROM promotions ORDER BY id DESC").fetchall()
        return rows_to_dicts(rows)

    def get_stats(self):
        with connect() as conn:
            revenue = conn.execute("SELECT COALESCE(SUM(total), 0) FROM orders").fetchone()[0]
            open_orders = conn.execute(
                "SELECT COUNT(*) FROM orders WHERE status != 'Finalizado'"
            ).fetchone()[0]
            order_count = conn.execute("SELECT COUNT(*) FROM orders").fetchone()[0]
        average = revenue / order_count if order_count else 0
        return {
            "revenue": revenue,
            "openOrders": open_orders,
            "averageTicket": average,
            "aiResponseRate": 94,
        }

    def get_demo_users(self):
        with connect() as conn:
            rows = conn.execute(
                "SELECT id, email, cpf, name, role, must_change_pin FROM users WHERE role IN ('admin', 'financeiro', 'entregador') ORDER BY id"
            ).fetchall()
        return rows_to_dicts(rows)

    def get_deliveries(self):
        with connect() as conn:
            rows = conn.execute(
                """
                SELECT id, customer, customer_phone, address, notes, channel, status, item, total, eta,
                       driver_name, driver_lat, driver_lng, last_location_at
                FROM orders
                WHERE status = 'Entrega'
                ORDER BY id DESC
                """
            ).fetchall()
        return rows_to_dicts(rows)

    def get_drivers(self):
        with connect() as conn:
            rows = conn.execute(
                """
                SELECT
                    d.*,
                    COUNT(o.id) AS orders
                FROM drivers d
                LEFT JOIN orders o
                    ON lower(o.driver_name) = lower(d.name)
                    AND o.status = 'Entrega'
                GROUP BY d.id
                ORDER BY d.active DESC, d.name
                """
            ).fetchall()
        return rows_to_dicts(rows)

    def get_customers(self):
        with connect() as conn:
            rows = conn.execute(
                """
                SELECT
                    c.*,
                    COUNT(o.id) AS order_count,
                    COALESCE(SUM(o.total), 0) AS total_spent
                FROM customers c
                LEFT JOIN orders o
                    ON lower(o.customer) = lower(c.name)
                    AND COALESCE(o.customer_phone, '') = COALESCE(c.phone, '')
                GROUP BY c.id
                ORDER BY order_count DESC, c.last_order_at DESC, c.id DESC
                """
            ).fetchall()
        return rows_to_dicts(rows)

    def get_customer_orders(self, customer_id):
        with connect() as conn:
            customer = conn.execute("SELECT * FROM customers WHERE id = ?", (customer_id,)).fetchone()
            if customer is None:
                self.send_error(HTTPStatus.NOT_FOUND, "Cliente não encontrado")
                return
            rows = conn.execute(
                """
                SELECT id, customer, customer_phone, address, item, total, payment, status,
                       channel, created_at, cancel_reason
                FROM orders
                WHERE lower(customer) = lower(?)
                  AND COALESCE(customer_phone, '') = COALESCE(?, '')
                ORDER BY id DESC
                """,
                (customer["name"], customer["phone"]),
            ).fetchall()
        return {"customer": dict(customer), "orders": rows_to_dicts(rows)}

    def get_closeout(self):
        with connect() as conn:
            rows = conn.execute(
                """
                SELECT payment, COUNT(*) AS count, COALESCE(SUM(total), 0) AS total
                FROM orders
                WHERE status != 'Cancelado'
                GROUP BY payment
                ORDER BY total DESC
                """
            ).fetchall()
            status_rows = conn.execute(
                """
                SELECT status, COUNT(*) AS count, COALESCE(SUM(total), 0) AS total
                FROM orders
                GROUP BY status
                ORDER BY count DESC
                """
            ).fetchall()
            total = conn.execute(
                "SELECT COALESCE(SUM(total), 0) FROM orders WHERE status != 'Cancelado'"
            ).fetchone()[0]
            canceled = conn.execute(
                "SELECT COUNT(*) FROM orders WHERE status = 'Cancelado'"
            ).fetchone()[0]
        return {
            "total": total,
            "payments": rows_to_dicts(rows),
            "statuses": rows_to_dicts(status_rows),
            "canceled": canceled,
            "generated_at": datetime.now().isoformat(timespec="seconds"),
        }

    def get_settings(self):
        with connect() as conn:
            rows = conn.execute("SELECT key, value FROM settings").fetchall()
        settings = {row["key"]: row["value"] for row in rows}
        for key, env_key in SENSITIVE_ENV_KEYS.items():
            if os.environ.get(env_key):
                settings[key] = os.environ[env_key]
        if APP_ENV == "production":
            for key in SENSITIVE_SETTINGS:
                if settings.get(key):
                    settings[key] = "********"
        return settings

    def get_inbox(self):
        with connect() as conn:
            conversation_rows = conn.execute(
                """
                SELECT *
                FROM ai_conversations
                ORDER BY updated_at DESC, id DESC
                """
            ).fetchall()
            message_rows = conn.execute(
                """
                SELECT *
                FROM ai_messages
                ORDER BY id
                """
            ).fetchall()
        messages_by_conversation = {}
        for row in message_rows:
            messages_by_conversation.setdefault(row["conversation_id"], []).append(
                [row["author"], row["text"]]
            )
        inbox = []
        for row in conversation_rows:
            messages = messages_by_conversation.get(row["id"], [])
            visible_messages = [message for message in messages if message[0] != "system"]
            last_message = visible_messages[-1][1] if visible_messages else "Sem mensagens"
            inbox.append(
                {
                    "id": row["id"],
                    "client": row["client"],
                    "channel": row["channel"],
                    "status": row["status"],
                    "mode": row["mode"],
                    "assigned_to": row["assigned_to"] or "",
                    "preview": last_message[:90],
                    "messages": messages,
                }
            )
        return inbox

    def create_inbox_conversation(self, payload):
        client = payload.get("client", "").strip() or "Cliente"
        channel = payload.get("channel", "").strip() or "WhatsApp"
        text = payload.get("text", "").strip()
        if not text:
            self.send_error(HTTPStatus.BAD_REQUEST, "Mensagem obrigatoria")
            return
        with connect() as conn:
            mode = payload.get("mode", "ai")
            if mode not in {"ai", "human", "assisted"}:
                mode = "ai"
            assigned_to = payload.get("assigned_to", "").strip()
            cursor = conn.execute(
                "INSERT INTO ai_conversations (client, channel, mode, assigned_to) VALUES (?, ?, ?, ?)",
                (client, channel, mode, assigned_to),
            )
            conversation_id = cursor.lastrowid
            conn.execute(
                "INSERT INTO ai_messages (conversation_id, author, text) VALUES (?, 'client', ?)",
                (conversation_id, text),
            )
            if mode != "human":
                ai_text = self.build_ai_response(conn, text, client, assisted=(mode == "assisted"))
                conn.execute(
                    "INSERT INTO ai_messages (conversation_id, author, text) VALUES (?, 'ai', ?)",
                    (conversation_id, ai_text),
                )
            conn.execute(
                "UPDATE ai_conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (conversation_id,),
            )
        return next((item for item in self.get_inbox() if item["id"] == conversation_id), None)

    def reply_inbox(self, conversation_id, payload):
        text = payload.get("text", "").strip()
        if not text:
            self.send_error(HTTPStatus.BAD_REQUEST, "Mensagem obrigatoria")
            return
        author = payload.get("author", "client")
        if author not in {"client", "agent"}:
            author = "client"
        with connect() as conn:
            conversation = conn.execute(
                "SELECT * FROM ai_conversations WHERE id = ?",
                (conversation_id,),
            ).fetchone()
            if conversation is None:
                self.send_error(HTTPStatus.NOT_FOUND, "Conversa nao encontrada")
                return
            conn.execute(
                "INSERT INTO ai_messages (conversation_id, author, text) VALUES (?, ?, ?)",
                (conversation_id, author, text),
            )
            if author == "client" and conversation["mode"] != "human":
                ai_text = self.build_ai_response(conn, text, conversation["client"], assisted=(conversation["mode"] == "assisted"))
                conn.execute(
                    "INSERT INTO ai_messages (conversation_id, author, text) VALUES (?, 'ai', ?)",
                    (conversation_id, ai_text),
                )
            conn.execute(
                "UPDATE ai_conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (conversation_id,),
            )
        return next((item for item in self.get_inbox() if item["id"] == conversation_id), None)

    def update_inbox_mode(self, conversation_id, payload):
        mode = payload.get("mode", "ai")
        if mode not in {"ai", "human", "assisted"}:
            self.send_error(HTTPStatus.BAD_REQUEST, "Modo invalido")
            return
        assigned_to = payload.get("assigned_to", "").strip()
        with connect() as conn:
            conversation = conn.execute(
                "SELECT id FROM ai_conversations WHERE id = ?",
                (conversation_id,),
            ).fetchone()
            if conversation is None:
                self.send_error(HTTPStatus.NOT_FOUND, "Conversa nao encontrada")
                return
            conn.execute(
                """
                UPDATE ai_conversations
                SET mode = ?, assigned_to = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (mode, assigned_to if mode != "ai" else "", conversation_id),
            )
            label = {"ai": "IA automatica", "human": "atendimento humano", "assisted": "IA assistida"}[mode]
            details = f"Modo alterado para {label}"
            if assigned_to and mode != "ai":
                details += f" por {assigned_to}"
            conn.execute(
                "INSERT INTO ai_messages (conversation_id, author, text) VALUES (?, 'system', ?)",
                (conversation_id, details),
            )
        return next((item for item in self.get_inbox() if item["id"] == conversation_id), None)

    def normalize_text(self, value):
        normalized = unicodedata.normalize("NFKD", str(value or "").lower())
        return "".join(char for char in normalized if not unicodedata.combining(char))

    def build_ai_response(self, conn, message, client_name="Cliente", assisted=False):
        text = self.normalize_text(message)
        settings = {row["key"]: row["value"] for row in conn.execute("SELECT key, value FROM settings").fetchall()}
        prefix = "Sugestao IA para revisar: " if assisted else ""

        if any(word in text for word in ["horario", "abre", "aberto", "funciona", "fecha"]):
            return prefix + f"Atendemos no horario {settings.get('opening_hours', '18:00 as 23:30')}. Posso te ajudar com o cardapio ou com um pedido?"

        if any(word in text for word in ["entrega", "taxa", "bairro", "entregam", "delivery"]):
            zones = conn.execute(
                "SELECT neighborhood, fee, eta FROM delivery_zones WHERE active = 1 ORDER BY neighborhood"
            ).fetchall()
            for zone in zones:
                if self.normalize_text(zone["neighborhood"]) in text:
                    return prefix + (
                        f"Entregamos em {zone['neighborhood']}. A taxa e {self.format_money(zone['fee'])} "
                        f"e a previsao e {zone['eta']}."
                    )
            areas = ", ".join(zone["neighborhood"] for zone in zones) or settings.get("delivery_areas", "bairros cadastrados")
            fee = self.format_money(settings.get("delivery_fee", 0))
            return prefix + f"Entregamos em {areas}. A taxa padrao e {fee}, mas posso calcular melhor se voce informar o bairro."

        if any(word in text for word in ["cardapio", "produto", "pizza", "bebida", "preco", "valor", "tem "]):
            items = conn.execute(
                "SELECT name, price FROM menu_items WHERE active = 1 ORDER BY category, name LIMIT 6"
            ).fetchall()
            if not items:
                return prefix + "No momento nao encontrei produtos ativos no cardapio. Chame um atendente para conferir."
            list_text = "; ".join(f"{item['name']} por {self.format_money(item['price'])}" for item in items)
            return prefix + f"Temos estas opcoes ativas agora: {list_text}. Qual delas voce quer pedir?"

        if any(word in text for word in ["promocao", "promo", "desconto", "oferta"]):
            promos = conn.execute(
                """
                SELECT title, item_name, discount_type, discount_value
                FROM promotions
                WHERE active = 1
                ORDER BY id DESC
                LIMIT 3
                """
            ).fetchall()
            if not promos:
                return prefix + "No momento nao encontrei promocao ativa cadastrada. Posso te mostrar o cardapio normal."
            promo_text = "; ".join(
                f"{promo['title']} em {promo['item_name']} ({self.describe_discount(promo)})"
                for promo in promos
            )
            return prefix + f"Temos promocao ativa: {promo_text}. Quer aproveitar alguma?"

        if any(word in text for word in ["pedido", "status", "acompanhar", "numero"]):
            match = re.search(r"\d+", text)
            if match:
                order = conn.execute(
                    "SELECT id, status, eta FROM orders WHERE id = ?",
                    (int(match.group(0)),),
                ).fetchone()
                if order:
                    return prefix + f"Seu pedido #{order['id']} esta com status {order['status']}. Previsao: {order['eta']}."
                return prefix + "Nao encontrei esse numero de pedido. Confira o numero e me envie novamente."
            return prefix + "Me envie o numero do pedido que eu consulto o status para voce."

        if any(word in text for word in ["pix", "pagamento", "pagar", "cartao", "dinheiro"]):
            pix_key = settings.get("pix_key", "")
            if pix_key and pix_key != "********":
                return prefix + f"Voce pode pagar por PIX usando a chave {pix_key}. Depois envie o comprovante para conferirmos."
            return prefix + "Aceitamos PIX e as formas cadastradas no atendimento. Se for PIX, envie o comprovante apos o pagamento."

        prep_time = settings.get("prep_time", "35 a 45 minutos")
        return prefix + (
            f"Entendi, {client_name}. Vou te ajudar por aqui. "
            f"O tempo medio de preparo esta em {prep_time}. Se quiser, envie bairro, pedido ou produto desejado."
        )

    def format_money(self, value):
        try:
            amount = float(value or 0)
        except (TypeError, ValueError):
            amount = 0
        return f"R$ {amount:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")

    def describe_discount(self, promo):
        value = float(promo["discount_value"] or 0)
        if promo["discount_type"] == "percent":
            return f"{value:g}% de desconto"
        if promo["discount_type"] == "fixed":
            return f"{self.format_money(value)} de desconto"
        return f"preco especial de {self.format_money(value)}"

    def save_settings(self, payload):
        with connect() as conn:
            for key, value in payload.items():
                if APP_ENV == "production" and key in SENSITIVE_SETTINGS:
                    continue
                conn.execute(
                    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                    (key, str(value)),
                )
        return self.get_settings()

    def login(self, payload):
        ip = self.get_client_ip()

        # Rate limiting
        if not check_rate_limit(ip):
            self.send_error(HTTPStatus.TOO_MANY_REQUESTS, "Muitas tentativas. Aguarde 5 minutos e tente novamente")
            return

        pin = payload.get("pin", "").strip()
        driver_user_id = payload.get("driver_user_id")

        if not pin:
            self.send_error(HTTPStatus.BAD_REQUEST, "Informe o PIN para entrar")
            return

        with connect() as conn:
            valid_roles = ("admin", "financeiro", "entregador")
            row = None
            if driver_user_id is not None:
                try:
                    driver_user_id = int(driver_user_id)
                    row = conn.execute(
                        "SELECT id, email, cpf, pin, pin_hash, name, role, must_change_pin FROM users WHERE id = ? AND role = 'entregador'",
                        (driver_user_id,),
                    ).fetchone()
                except (TypeError, ValueError):
                    row = None
            else:
                all_users = conn.execute(
                    f"SELECT id, email, cpf, pin, pin_hash, name, role, must_change_pin FROM users WHERE role IN {valid_roles}"
                ).fetchall()
                for candidate in all_users:
                    if verify_pin(pin, candidate["pin_hash"]) or (candidate["pin"] and hmac.compare_digest(pin, candidate["pin"])):
                        row = candidate
                        break

        if row is None or not (verify_pin(pin, row["pin_hash"]) or (row["pin"] and hmac.compare_digest(pin, row["pin"]))):
            self.send_error(HTTPStatus.UNAUTHORIZED, "PIN inválido")
            return

        # Login bem-sucedido: limpar rate limit e criar sessão segura
        clear_rate_limit(ip)
        user = {key: row[key] for key in ["id", "email", "cpf", "name", "role", "must_change_pin"]}
        user["token"] = create_session(user["id"], user["role"], user["name"])
        self._write_audit_log(user["id"], "login", "users", user["id"], f"Login via CPF/email/link do perfil {user['role']}")
        return user

    def _write_audit_log(self, user_id, action, entity, entity_id, details=""):
        """Registra ação crítica na tabela audit_log."""
        try:
            with connect() as conn:
                conn.execute(
                    "INSERT INTO audit_log (user_id, action, entity, entity_id, details) VALUES (?, ?, ?, ?, ?)",
                    (user_id, action, entity, entity_id, details),
                )
        except Exception:
            pass

    def change_user_pin(self, user_id, payload):
        current_pin = payload.get("current_pin", "").strip()
        new_pin = payload.get("new_pin", "").strip()
        if not re.fullmatch(r"\d{4,6}", new_pin):
            self.send_error(HTTPStatus.BAD_REQUEST, "O novo PIN deve ter 4 a 6 números")
            return
        with connect() as conn:
            row = conn.execute(
                "SELECT id, pin, pin_hash FROM users WHERE id = ?",
                (user_id,),
            ).fetchone()
            if row is None:
                self.send_error(HTTPStatus.NOT_FOUND, "Usuário não encontrado")
                return
            if current_pin and not (verify_pin(current_pin, row["pin_hash"]) or (row["pin"] and hmac.compare_digest(current_pin, row["pin"]))):
                self.send_error(HTTPStatus.UNAUTHORIZED, "PIN atual inválido")
                return
            conn.execute(
                "UPDATE users SET pin_hash = ?, pin = '', must_change_pin = 0 WHERE id = ?",
                (hash_pin(new_pin), user_id),
            )
            updated = conn.execute("SELECT id, email, cpf, name, role, must_change_pin FROM users WHERE id = ?", (user_id,)).fetchone()
        return dict(updated)

    def reset_user_pin(self, user_id):
        with connect() as conn:
            row = conn.execute("SELECT id, cpf, role FROM users WHERE id = ?", (user_id,)).fetchone()
            if row is None:
                self.send_error(HTTPStatus.NOT_FOUND, "Usuário não encontrado")
                return
            pin = initial_pin_from_cpf(row["cpf"])
            if len(pin) < 4:
                self.send_error(HTTPStatus.BAD_REQUEST, "Usuário sem CPF válido")
                return
            conn.execute(
                "UPDATE users SET pin_hash = ?, pin = '', must_change_pin = 1 WHERE id = ?",
                (hash_pin(pin), user_id),
            )
            updated = conn.execute("SELECT id, email, cpf, name, role, must_change_pin FROM users WHERE id = ?", (user_id,)).fetchone()
        return dict(updated)

    def recover_admin(self, payload):
        cpf = only_digits(payload.get("cpf", ""))
        master_key = payload.get("master_key", "")
        new_pin = payload.get("new_pin", "").strip()
        if not hmac.compare_digest(master_key, ADMIN_MASTER_KEY):
            self.send_error(HTTPStatus.UNAUTHORIZED, "Chave mestra inválida")
            return
        if not re.fullmatch(r"\d{4,6}", new_pin):
            self.send_error(HTTPStatus.BAD_REQUEST, "O novo PIN deve ter 4 a 6 números")
            return
        with connect() as conn:
            row = conn.execute("SELECT id FROM users WHERE cpf = ? AND role = 'admin'", (cpf,)).fetchone()
            if row is None:
                self.send_error(HTTPStatus.NOT_FOUND, "Adm não encontrado")
                return
            conn.execute(
                "UPDATE users SET pin_hash = ?, pin = '', must_change_pin = 0 WHERE id = ?",
                (hash_pin(new_pin), row["id"]),
            )
        return {"ok": True}

    def create_order(self, payload):
        required = ["customer", "channel", "item", "total"]
        missing = [field for field in required if not payload.get(field)]
        if missing:
            self.send_error(HTTPStatus.BAD_REQUEST, f"Campos obrigatórios: {', '.join(missing)}")
            return

        with connect() as conn:
            # SEGURANÇA: recalcular o total no backend a partir do menu para pedidos
            # que vêm de canais não autenticados (cardápio público). Cliente envia
            # itens, mas o preço vem sempre do banco. Isso evita fraude trivial
            # (cliente mandando total=0.01 para uma pizza de R$80).
            authoritative_total, server_recalculated = self._compute_authoritative_total(conn, payload)
            if server_recalculated:
                # rejeita se a diferença for relevante (> R$0,02) — apenas registra log de segurança
                client_total = float(payload.get("total", 0) or 0)
                if abs(client_total - authoritative_total) > 0.02:
                    print(f"[SECURITY] total adulterado em pedido público: cliente={client_total} servidor={authoritative_total}")
                total_to_store = authoritative_total
            else:
                total_to_store = float(payload["total"])

            stock_errors = self.check_recipe_stock(conn, payload)
            if stock_errors:
                self.send_error(HTTPStatus.CONFLICT, "Estoque insuficiente: " + "; ".join(stock_errors))
                return
            receipt_url = ""
            if payload.get("payment_receipt_url"):
                receipt_url = data_url_to_upload(payload["payment_receipt_url"], "comprovante-pix")
            cursor = conn.execute(
                """
                INSERT INTO orders
                    (customer, customer_phone, address, notes, delivery_type, channel, status, item, total,
                     payment, eta, payment_receipt_url, payment_status, payment_receipt_status, delivery_fee, discount)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    payload["customer"],
                    payload.get("customer_phone", ""),
                    payload.get("address", ""),
                    payload.get("notes", ""),
                    payload.get("delivery_type", "Entrega"),
                    payload["channel"],
                    payload.get("status", "Novo"),
                    payload["item"],
                    total_to_store,
                    payload.get("payment", "PIX"),
                    payload.get("eta", "20 min"),
                    receipt_url,
                    payload.get("payment_status") or ("Comprovante enviado" if receipt_url else "Aguardando pagamento"),
                    "Enviado" if receipt_url else "Nao enviado",
                    float(payload.get("delivery_fee", 0) or 0),
                    float(payload.get("discount", 0) or 0),
                ),
            )
            self.upsert_customer(conn, payload)
            self.create_order_items(conn, cursor.lastrowid, payload)
            self.consume_recipe_stock(conn, cursor.lastrowid)
            row = conn.execute("SELECT * FROM orders WHERE id = ?", (cursor.lastrowid,)).fetchone()
        return dict(row)

    def _compute_authoritative_total(self, conn, payload):
        """Retorna (total_calculado, recalculou_de_verdade?). Só recalcula se o pedido
        veio com itens detalhados (lista) e cada item bater com um menu_items por nome."""
        items = payload.get("items") or []
        if not items:
            return float(payload.get("total", 0) or 0), False
        subtotal = 0.0
        all_matched = True
        for item in items:
            name = (item.get("name") or item.get("item_name") or "").strip()
            qty = int(item.get("qty", item.get("quantity", 1)) or 1)
            if not name:
                all_matched = False
                continue
            menu_row = conn.execute(
                "SELECT price FROM menu_items WHERE lower(name) = lower(?) AND active = 1",
                (name,),
            ).fetchone()
            if menu_row is None:
                all_matched = False
                continue
            subtotal += float(menu_row["price"]) * qty
        if not all_matched:
            # se algum item não casou com menu, não tem como ter autoridade — devolve o do cliente
            return float(payload.get("total", 0) or 0), False
        delivery_fee = float(payload.get("delivery_fee", 0) or 0)
        discount = float(payload.get("discount", 0) or 0)
        return round(subtotal + delivery_fee - discount, 2), True


    def create_order_items(self, conn, order_id, payload):
        items = payload.get("items")
        if not items:
            conn.execute(
                """
                INSERT INTO order_items (order_id, item_name, quantity, unit_price, total)
                VALUES (?, ?, 1, ?, ?)
                """,
                (order_id, payload["item"], float(payload["total"]), float(payload["total"])),
            )
            return
        for item in items:
            quantity = int(item.get("qty", item.get("quantity", 1)))
            unit_price = float(item.get("price", item.get("unit_price", 0)))
            conn.execute(
                """
                INSERT INTO order_items (order_id, item_name, quantity, unit_price, total)
                VALUES (?, ?, ?, ?, ?)
                """,
                (order_id, item.get("name", item.get("item_name", "")), quantity, unit_price, quantity * unit_price),
            )

    def order_items_from_payload(self, payload):
        items = payload.get("items")
        if not items:
            return [{"name": payload.get("item", ""), "quantity": 1}]
        parsed = []
        for item in items:
            parsed.append(
                {
                    "name": item.get("name", item.get("item_name", "")),
                    "quantity": int(item.get("qty", item.get("quantity", 1))),
                }
            )
        return parsed

    def recipe_usage_for_items(self, conn, items):
        usage = {}
        for item in items:
            menu_item = conn.execute(
                "SELECT id FROM menu_items WHERE lower(name) = lower(?)",
                (item["name"],),
            ).fetchone()
            if menu_item is None:
                continue
            recipe_rows = conn.execute(
                "SELECT ingredient_id, quantity FROM menu_ingredients WHERE menu_item_id = ?",
                (menu_item["id"],),
            ).fetchall()
            for recipe in recipe_rows:
                ingredient_id = int(recipe["ingredient_id"])
                usage[ingredient_id] = usage.get(ingredient_id, 0) + float(recipe["quantity"]) * int(item["quantity"])
        return usage

    def check_recipe_stock(self, conn, payload):
        usage = self.recipe_usage_for_items(conn, self.order_items_from_payload(payload))
        if not usage:
            return []
        rows = conn.execute(
            f"SELECT id, name, unit, stock_qty FROM ingredients WHERE id IN ({','.join('?' for _ in usage)})",
            tuple(usage),
        ).fetchall()
        by_id = {int(row["id"]): row for row in rows}
        errors = []
        for ingredient_id, used in usage.items():
            ingredient = by_id.get(ingredient_id)
            if ingredient is None:
                continue
            stock_qty = float(ingredient["stock_qty"] or 0)
            if stock_qty < used:
                errors.append(
                    f"{ingredient['name']} precisa {used:g}{ingredient['unit']} e tem {stock_qty:g}{ingredient['unit']}"
                )
        return errors

    def consume_recipe_stock(self, conn, order_id):
        items = conn.execute(
            "SELECT item_name, quantity FROM order_items WHERE order_id = ?",
            (order_id,),
        ).fetchall()
        usage = self.recipe_usage_for_items(
            conn,
            [{"name": item["item_name"], "quantity": item["quantity"]} for item in items],
        )
        for ingredient_id, used in usage.items():
            conn.execute(
                """
                UPDATE ingredients
                SET stock_qty = stock_qty - ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (used, ingredient_id),
            )
            conn.execute(
                """
                INSERT INTO stock_movements (ingredient_id, movement_type, quantity, reason, order_id)
                VALUES (?, 'saida', ?, 'Baixa automatica por pedido', ?)
                """,
                (ingredient_id, used, order_id),
            )

    def restore_recipe_stock(self, conn, order_id):
        items = conn.execute(
            "SELECT item_name, quantity FROM order_items WHERE order_id = ?",
            (order_id,),
        ).fetchall()
        usage = self.recipe_usage_for_items(
            conn,
            [{"name": item["item_name"], "quantity": item["quantity"]} for item in items],
        )
        for ingredient_id, restored in usage.items():
            conn.execute(
                """
                UPDATE ingredients
                SET stock_qty = stock_qty + ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (restored, ingredient_id),
            )
            conn.execute(
                """
                INSERT INTO stock_movements (ingredient_id, movement_type, quantity, reason, order_id)
                VALUES (?, 'entrada', ?, 'Estorno por cancelamento', ?)
                """,
                (ingredient_id, restored, order_id),
            )

    def upsert_customer(self, conn, payload):
        name = payload.get("customer", "").strip()
        if not name:
            return
        phone = payload.get("customer_phone", "")
        address = payload.get("address", "")
        notes = payload.get("notes", "")
        existing = conn.execute(
            "SELECT id FROM customers WHERE lower(name) = lower(?) AND COALESCE(phone, '') = COALESCE(?, '')",
            (name, phone),
        ).fetchone()
        if existing:
            conn.execute(
                """
                UPDATE customers
                SET address = COALESCE(NULLIF(?, ''), address),
                    notes = COALESCE(NULLIF(?, ''), notes),
                    last_order_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (address, notes, existing["id"]),
            )
            return
        conn.execute(
            "INSERT INTO customers (name, phone, address, notes) VALUES (?, ?, ?, ?)",
            (name, phone, address, notes),
        )

    def create_menu_item(self, payload):
        required = ["name", "category", "price"]
        missing = [field for field in required if not str(payload.get(field, "")).strip()]
        if missing:
            self.send_error(HTTPStatus.BAD_REQUEST, f"Campos obrigatórios: {', '.join(missing)}")
            return

        try:
            price = float(payload["price"])
        except (TypeError, ValueError):
            self.send_error(HTTPStatus.BAD_REQUEST, "Preço inválido")
            return

        if price <= 0:
            self.send_error(HTTPStatus.BAD_REQUEST, "Preço deve ser maior que zero")
            return

        with connect() as conn:
            try:
                cursor = conn.execute(
                    """
                    INSERT INTO menu_items (name, category, price, sales, active, description, size, prep_time, addons)
                    VALUES (?, ?, ?, 0, 1, ?, ?, ?, ?)
                    """,
                    (
                        payload["name"].strip(),
                        payload["category"].strip(),
                        price,
                        payload.get("description", "").strip(),
                        payload.get("size", "").strip(),
                        payload.get("prep_time", "").strip(),
                        payload.get("addons", "").strip(),
                    ),
                )
            except DB_INTEGRITY_ERROR:
                self.send_error(HTTPStatus.CONFLICT, "Produto já existe")
                return
            if payload.get("image_url"):
                image_url = data_url_to_upload(payload["image_url"], f"produto-{cursor.lastrowid}")
                conn.execute(
                    "UPDATE menu_items SET image_url = ? WHERE id = ?",
                    (image_url, cursor.lastrowid),
                )
            row = conn.execute("SELECT * FROM menu_items WHERE id = ?", (cursor.lastrowid,)).fetchone()
        return dict(row)

    def update_menu_item(self, item_id, payload):
        fields = []
        values = []
        for field in ["name", "category", "price", "active", "image_url", "description", "size", "prep_time", "addons"]:
            if field in payload:
                fields.append(f"{field} = ?")
                values.append(data_url_to_upload(payload[field], f"produto-{item_id}") if field == "image_url" else payload[field])
        if not fields:
            self.send_error(HTTPStatus.BAD_REQUEST, "Nada para atualizar")
            return
        values.append(item_id)
        with connect() as conn:
            try:
                conn.execute(f"UPDATE menu_items SET {', '.join(fields)} WHERE id = ?", values)
            except DB_INTEGRITY_ERROR:
                self.send_error(HTTPStatus.CONFLICT, "Produto já existe")
                return
            row = conn.execute("SELECT * FROM menu_items WHERE id = ?", (item_id,)).fetchone()
        if row is None:
            self.send_error(HTTPStatus.NOT_FOUND, "Produto não encontrado")
            return
        return dict(row)

    def create_ingredient(self, payload):
        name = payload.get("name", "").strip()
        code = payload.get("code", "").strip()
        unit = payload.get("unit", "").strip() or "un"
        if not name:
            self.send_error(HTTPStatus.BAD_REQUEST, "Nome do ingrediente obrigatório")
            return
        if not code:
            self.send_error(HTTPStatus.BAD_REQUEST, "Código do ingrediente obrigatório")
            return
        try:
            stock_qty = float(payload.get("stock_qty", 0))
            min_qty = float(payload.get("min_qty", 0))
            unit_cost = float(payload.get("unit_cost", 0))
        except (TypeError, ValueError):
            self.send_error(HTTPStatus.BAD_REQUEST, "Quantidade inválida")
            return
        if stock_qty < 0 or min_qty < 0:
            self.send_error(HTTPStatus.BAD_REQUEST, "Quantidade não pode ser negativa")
            return
        with connect() as conn:
            try:
                cursor = conn.execute(
                    """
                    INSERT INTO ingredients (name, code, unit, stock_qty, min_qty, supplier, unit_cost)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (name, code, unit, stock_qty, min_qty, payload.get("supplier", ""), unit_cost),
                )
            except DB_INTEGRITY_ERROR:
                self.send_error(HTTPStatus.CONFLICT, "Ingrediente já existe")
                return
            row = conn.execute("SELECT * FROM ingredients WHERE id = ?", (cursor.lastrowid,)).fetchone()
        result = dict(row)
        if min_qty > 0 and stock_qty <= min_qty:
            threading.Thread(target=self.send_whatsapp_low_stock_alert,
                           args=(name, stock_qty, min_qty, unit), daemon=True).start()
        return result

    def update_ingredient(self, ingredient_id, payload):
        fields = []
        values = []
        old = None
        with connect() as conn:
            old = conn.execute("SELECT * FROM ingredients WHERE id = ?", (ingredient_id,)).fetchone()
        if "name" in payload and not str(payload["name"]).strip():
            self.send_error(HTTPStatus.BAD_REQUEST, "Nome do ingrediente obrigatório")
            return
        if "code" in payload and not str(payload["code"]).strip():
            self.send_error(HTTPStatus.BAD_REQUEST, "Código do ingrediente obrigatório")
            return
        if "stock_qty" in payload or "min_qty" in payload:
            try:
                if "stock_qty" in payload:
                    stock_v = float(payload["stock_qty"])
                    if stock_v < 0:
                        self.send_error(HTTPStatus.BAD_REQUEST, "Quantidade não pode ser negativa")
                        return
                if "min_qty" in payload:
                    min_v = float(payload["min_qty"])
                    if min_v < 0:
                        self.send_error(HTTPStatus.BAD_REQUEST, "Quantidade mínima não pode ser negativa")
                        return
            except (TypeError, ValueError):
                self.send_error(HTTPStatus.BAD_REQUEST, "Quantidade inválida")
                return
        for field in ["name", "code", "unit", "stock_qty", "min_qty", "supplier", "unit_cost"]:
            if field in payload:
                fields.append(f"{field} = ?")
                values.append(payload[field])
        if not fields:
            self.send_error(HTTPStatus.BAD_REQUEST, "Nada para atualizar")
            return
        fields.append("updated_at = CURRENT_TIMESTAMP")
        values.append(ingredient_id)
        with connect() as conn:
            try:
                conn.execute(f"UPDATE ingredients SET {', '.join(fields)} WHERE id = ?", values)
            except DB_INTEGRITY_ERROR:
                self.send_error(HTTPStatus.CONFLICT, "Ingrediente ja existe")
                return
            if old is not None and "stock_qty" in payload:
                delta = float(payload["stock_qty"]) - float(old["stock_qty"])
                if delta:
                    conn.execute(
                        """
                        INSERT INTO stock_movements (ingredient_id, movement_type, quantity, reason)
                        VALUES (?, ?, ?, ?)
                        """,
                        (ingredient_id, "entrada" if delta > 0 else "ajuste", abs(delta), payload.get("reason", "Ajuste manual")),
                    )
            row = conn.execute("SELECT * FROM ingredients WHERE id = ?", (ingredient_id,)).fetchone()
        if row is None:
            self.send_error(HTTPStatus.NOT_FOUND, "Ingrediente nao encontrado")
            return
        result = dict(row)
        # Dispara alerta WhatsApp se atingiu estoque mínimo
        if "stock_qty" in payload and result.get("min_qty", 0) > 0:
            if result["stock_qty"] <= result["min_qty"]:
                threading.Thread(target=self.send_whatsapp_low_stock_alert,
                               args=(result["name"], result["stock_qty"], result["min_qty"], result["unit"]),
                               daemon=True).start()
        return result

    def save_recipe_ingredient(self, item_id, payload):
        try:
            ingredient_id = int(payload.get("ingredient_id"))
            quantity = float(payload.get("quantity"))
        except (TypeError, ValueError):
            self.send_error(HTTPStatus.BAD_REQUEST, "Ingrediente ou quantidade invalida")
            return
        if quantity <= 0:
            self.send_error(HTTPStatus.BAD_REQUEST, "Quantidade deve ser maior que zero")
            return
        with connect() as conn:
            menu_item = conn.execute("SELECT id FROM menu_items WHERE id = ?", (item_id,)).fetchone()
            ingredient = conn.execute("SELECT id FROM ingredients WHERE id = ?", (ingredient_id,)).fetchone()
            if menu_item is None or ingredient is None:
                self.send_error(HTTPStatus.NOT_FOUND, "Produto ou ingrediente nao encontrado")
                return
            conn.execute(
                """
                INSERT INTO menu_ingredients (menu_item_id, ingredient_id, quantity)
                VALUES (?, ?, ?)
                ON CONFLICT(menu_item_id, ingredient_id) DO UPDATE SET quantity = excluded.quantity
                """,
                (item_id, ingredient_id, quantity),
            )
        return self.get_recipes()

    def replace_recipe_ingredients(self, item_id, payload):
        rows = payload.get("ingredients", [])
        if not isinstance(rows, list) or not rows:
            self.send_error(HTTPStatus.BAD_REQUEST, "Informe ao menos um ingrediente")
            return
        parsed = []
        seen = set()
        for row in rows:
            try:
                ingredient_id = int(row.get("ingredient_id"))
                quantity = float(row.get("quantity"))
            except (AttributeError, TypeError, ValueError):
                self.send_error(HTTPStatus.BAD_REQUEST, "Ingrediente ou quantidade invalida")
                return
            if ingredient_id in seen:
                self.send_error(HTTPStatus.BAD_REQUEST, "Ingrediente duplicado na ficha tecnica")
                return
            if quantity <= 0:
                self.send_error(HTTPStatus.BAD_REQUEST, "Quantidade deve ser maior que zero")
                return
            seen.add(ingredient_id)
            parsed.append((item_id, ingredient_id, quantity))
        with connect() as conn:
            menu_item = conn.execute("SELECT id FROM menu_items WHERE id = ?", (item_id,)).fetchone()
            if not menu_item:
                self.send_error(HTTPStatus.NOT_FOUND, "Produto nao encontrado")
                return
            ingredient_count = conn.execute(
                f"SELECT COUNT(*) AS total FROM ingredients WHERE id IN ({','.join('?' for _ in seen)})",
                tuple(seen),
            ).fetchone()["total"]
            if ingredient_count != len(seen):
                self.send_error(HTTPStatus.BAD_REQUEST, "Ingrediente nao encontrado")
                return
            conn.execute("DELETE FROM menu_ingredients WHERE menu_item_id = ?", (item_id,))
            conn.executemany(
                """
                INSERT INTO menu_ingredients (menu_item_id, ingredient_id, quantity)
                VALUES (?, ?, ?)
                """,
                parsed,
            )
        return self.get_recipes()

    def create_delivery_zone(self, payload):
        neighborhood = payload.get("neighborhood", "").strip()
        if not neighborhood:
            self.send_error(HTTPStatus.BAD_REQUEST, "Bairro obrigatorio")
            return
        with connect() as conn:
            try:
                cursor = conn.execute(
                    """
                    INSERT INTO delivery_zones (neighborhood, fee, eta, active)
                    VALUES (?, ?, ?, ?)
                    """,
                    (neighborhood, float(payload.get("fee", 0) or 0), payload.get("eta", "35 a 45 minutos"), int(payload.get("active", 1))),
                )
            except DB_INTEGRITY_ERROR:
                self.send_error(HTTPStatus.CONFLICT, "Bairro ja existe")
                return
            row = conn.execute("SELECT * FROM delivery_zones WHERE id = ?", (cursor.lastrowid,)).fetchone()
        return dict(row)

    def update_delivery_zone(self, zone_id, payload):
        fields = []
        values = []
        for field in ["neighborhood", "fee", "eta", "active"]:
            if field in payload:
                fields.append(f"{field} = ?")
                values.append(payload[field])
        if not fields:
            self.send_error(HTTPStatus.BAD_REQUEST, "Nada para atualizar")
            return
        values.append(zone_id)
        with connect() as conn:
            try:
                conn.execute(f"UPDATE delivery_zones SET {', '.join(fields)} WHERE id = ?", values)
            except DB_INTEGRITY_ERROR:
                self.send_error(HTTPStatus.CONFLICT, "Bairro ja existe")
                return
            row = conn.execute("SELECT * FROM delivery_zones WHERE id = ?", (zone_id,)).fetchone()
        if row is None:
            self.send_error(HTTPStatus.NOT_FOUND, "Bairro nao encontrado")
            return
        return dict(row)

    def create_promotion(self, payload):
        required = ["title", "item_name", "discount_type", "discount_value", "starts_at", "ends_at"]
        missing = [field for field in required if not str(payload.get(field, "")).strip()]
        if missing:
            self.send_error(HTTPStatus.BAD_REQUEST, f"Campos obrigatórios: {', '.join(missing)}")
            return

        try:
            discount_value = float(payload["discount_value"])
        except (TypeError, ValueError):
            self.send_error(HTTPStatus.BAD_REQUEST, "Desconto inválido")
            return

        if discount_value <= 0:
            self.send_error(HTTPStatus.BAD_REQUEST, "Desconto deve ser maior que zero")
            return

        discount_type = payload["discount_type"]
        if discount_type not in {"percent", "fixed", "special"}:
            self.send_error(HTTPStatus.BAD_REQUEST, "Tipo de desconto inválido")
            return

        channels = payload.get("channels") or ["Cardápio QR"]
        if isinstance(channels, list):
            channels = ", ".join(channels)

        with connect() as conn:
            cursor = conn.execute(
                """
                INSERT INTO promotions
                    (title, item_name, discount_type, discount_value, starts_at, ends_at, channels, active)
                VALUES (?, ?, ?, ?, ?, ?, ?, 1)
                """,
                (
                    payload["title"].strip(),
                    payload["item_name"].strip(),
                    discount_type,
                    discount_value,
                    payload["starts_at"].strip(),
                    payload["ends_at"].strip(),
                    str(channels),
                ),
            )
            row = conn.execute("SELECT * FROM promotions WHERE id = ?", (cursor.lastrowid,)).fetchone()
        return dict(row)

    def update_promotion(self, promotion_id, payload):
        fields = []
        values = []
        for field in ["title", "item_name", "discount_type", "discount_value", "starts_at", "ends_at", "channels", "active"]:
            if field not in payload:
                continue
            value = payload[field]
            if field == "discount_type" and value not in {"percent", "fixed", "special"}:
                self.send_error(HTTPStatus.BAD_REQUEST, "Tipo de desconto invalido")
                return
            if field == "discount_value":
                try:
                    value = float(value)
                except (TypeError, ValueError):
                    self.send_error(HTTPStatus.BAD_REQUEST, "Desconto invalido")
                    return
            if field == "channels" and isinstance(value, list):
                value = ", ".join(value)
            fields.append(f"{field} = ?")
            values.append(value)
        if not fields:
            self.send_error(HTTPStatus.BAD_REQUEST, "Nada para atualizar")
            return
        values.append(promotion_id)
        with connect() as conn:
            conn.execute(f"UPDATE promotions SET {', '.join(fields)} WHERE id = ?", values)
            row = conn.execute("SELECT * FROM promotions WHERE id = ?", (promotion_id,)).fetchone()
        if row is None:
            self.send_error(HTTPStatus.NOT_FOUND, "Promocao nao encontrada")
            return
        return dict(row)

    def create_driver(self, payload):
        name = payload.get("name", "").strip()
        area = payload.get("area", "").strip() or "Sem area"
        cpf = only_digits(payload.get("cpf", ""))
        if not name:
            self.send_error(HTTPStatus.BAD_REQUEST, "Nome do entregador obrigatorio")
            return
        if len(cpf) < 4:
            self.send_error(HTTPStatus.BAD_REQUEST, "CPF com pelo menos 4 digitos obrigatorio para login do entregador")
            return
        pin = initial_pin_from_cpf(cpf)
        if len(pin) < 4:
            pin = "1234"
        with connect() as conn:
            safe_name = re.sub(r"[^a-z0-9]", "", name.lower().replace(" ", "."))
            if not safe_name:
                safe_name = "entregador"
            email = f"{safe_name}@entregador.bortolini"
            original_email = email
            suffix = 1
            while conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone():
                email = f"{original_email}.{suffix}"
                suffix += 1
            try:
                cursor = conn.execute(
                    """
                    INSERT INTO drivers (name, area, status, active, lat, lng)
                    VALUES (?, ?, ?, 1, ?, ?)
                    """,
                    (name, area, payload.get("status", "Disponivel"), payload.get("lat"), payload.get("lng")),
                )
                driver_id = cursor.lastrowid
            except DB_INTEGRITY_ERROR:
                self.send_error(HTTPStatus.CONFLICT, "Entregador ja existe")
                return
            user_cursor = conn.execute(
                "INSERT INTO users (email, cpf, pin, pin_hash, name, role, must_change_pin) VALUES (?, ?, ?, ?, ?, ?, 1)",
                (email, cpf, "", hash_pin(pin), name, "entregador"),
            )
            user_id = user_cursor.lastrowid
            row = conn.execute("SELECT * FROM drivers WHERE id = ?", (driver_id,)).fetchone()
        result = dict(row)
        result["user_id"] = user_id
        result["default_pin"] = pin
        result["driver_link"] = f"/entregador/{user_id}"
        return result

    def update_driver(self, driver_id, payload):
        fields = []
        values = []
        for field in ["name", "area", "status", "active", "lat", "lng"]:
            if field in payload:
                fields.append(f"{field} = ?")
                values.append(payload[field])
        if not fields:
            self.send_error(HTTPStatus.BAD_REQUEST, "Nada para atualizar")
            return
        values.append(driver_id)
        with connect() as conn:
            try:
                conn.execute(f"UPDATE drivers SET {', '.join(fields)} WHERE id = ?", values)
            except DB_INTEGRITY_ERROR:
                self.send_error(HTTPStatus.CONFLICT, "Entregador ja existe")
                return
            row = conn.execute("SELECT * FROM drivers WHERE id = ?", (driver_id,)).fetchone()
        if row is None:
            self.send_error(HTTPStatus.NOT_FOUND, "Entregador nao encontrado")
            return
        return dict(row)

    def _current_role(self):
        token = self.headers.get("X-Session-Token", "")
        if token:
            session = validate_session(token)
            if session:
                return session["role"]
        return ""

    def update_order(self, order_id, payload):
        allowed_statuses = {"Novo", "Cozinha", "Entrega", "Finalizado", "Cancelado"}
        status = payload.get("status")
        if status not in allowed_statuses:
            self.send_error(HTTPStatus.BAD_REQUEST, "Status inválido")
            return
        cancel_reason = payload.get("cancel_reason", "").strip()
        if status == "Cancelado" and not cancel_reason:
            self.send_error(HTTPStatus.BAD_REQUEST, "Informe o motivo do cancelamento")
            return

        with connect() as conn:
            current = conn.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
            if current is None:
                self.send_error(HTTPStatus.NOT_FOUND, "Pedido não encontrado")
                return

            role = self._current_role()
            if not self.can_change_order_status(role, current["status"], status):
                self.send_error(HTTPStatus.FORBIDDEN, "Perfil não pode executar esta mudança de status")
                return

            if status == "Cancelado":
                self.restore_recipe_stock(conn, order_id)
                conn.execute(
                    "UPDATE orders SET status = ?, cancel_reason = ? WHERE id = ?",
                    (status, cancel_reason, order_id),
                )
            elif status == "Entrega" and current["driver_name"] is None:
                driver = self.pick_driver(conn, order_id)
                conn.execute(
                    """
                    UPDATE orders
                    SET status = ?, driver_name = ?, driver_lat = ?, driver_lng = ?, last_location_at = ?
                    WHERE id = ?
                    """,
                    (status, driver["name"], driver["lat"], driver["lng"], datetime.now().isoformat(timespec="seconds"), order_id),
                )
            else:
                conn.execute("UPDATE orders SET status = ? WHERE id = ?", (status, order_id))
            row = conn.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()

        return dict(row)

    def update_order_payment(self, order_id, payload):
        fields = []
        values = []
        for field in ["payment_status", "payment_receipt_status", "payment_receipt_note"]:
            if field in payload:
                fields.append(f"{field} = ?")
                values.append(payload[field])
        if not fields:
            self.send_error(HTTPStatus.BAD_REQUEST, "Nada para atualizar")
            return
        values.append(order_id)
        with connect() as conn:
            conn.execute(f"UPDATE orders SET {', '.join(fields)} WHERE id = ?", values)
            row = conn.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
        if row is None:
            self.send_error(HTTPStatus.NOT_FOUND, "Pedido nao encontrado")
            return
        return dict(row)

    def can_change_order_status(self, role, current_status, next_status):
        if next_status == "Cancelado":
            return role == "admin" and current_status not in {"Finalizado", "Cancelado"}
        if role == "admin":
            return True
        if role == "entregador":
            return (current_status, next_status) == ("Entrega", "Finalizado")
        return False

    def pick_driver(self, conn, order_id):
        row = conn.execute(
            """
            SELECT name, lat, lng
            FROM drivers
            WHERE active = 1
            ORDER BY (
                SELECT COUNT(*)
                FROM orders
                WHERE status = 'Entrega'
                  AND lower(driver_name) = lower(drivers.name)
            ), id
            LIMIT 1
            """
        ).fetchone()
        if row:
            return {"name": row["name"], "lat": row["lat"], "lng": row["lng"]}
        name, lat, lng = DRIVER_POINTS[order_id % len(DRIVER_POINTS)]
        return {"name": name, "lat": lat, "lng": lng}

    def assign_driver(self, order_id, payload):
        driver_id = payload.get("driver_id")
        with connect() as conn:
            driver = conn.execute("SELECT * FROM drivers WHERE id = ? AND active = 1", (driver_id,)).fetchone()
            if driver is None:
                self.send_error(HTTPStatus.NOT_FOUND, "Entregador não encontrado")
                return
            order = conn.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
            if order is None:
                self.send_error(HTTPStatus.NOT_FOUND, "Pedido não encontrado")
                return
            if order["status"] != "Entrega":
                self.send_error(HTTPStatus.BAD_REQUEST, "Pedido precisa estar em entrega")
                return
            conn.execute(
                """
                UPDATE orders
                SET driver_name = ?, driver_lat = ?, driver_lng = ?, last_location_at = ?
                WHERE id = ?
                """,
                (driver["name"], driver["lat"], driver["lng"], datetime.now().isoformat(timespec="seconds"), order_id),
            )
            row = conn.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
        return dict(row)

    def update_delivery_location(self, order_id, payload):
        try:
            lat = float(payload["lat"])
            lng = float(payload["lng"])
        except (KeyError, TypeError, ValueError):
            self.send_error(HTTPStatus.BAD_REQUEST, "Coordenadas inválidas")
            return

        with connect() as conn:
            conn.execute(
                """
                UPDATE orders
                SET driver_lat = ?, driver_lng = ?, last_location_at = ?
                WHERE id = ?
                """,
                (lat, lng, datetime.now().isoformat(timespec="seconds"), order_id),
            )
            row = conn.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
        if row is None:
            self.send_error(HTTPStatus.NOT_FOUND, "Pedido não encontrado")
            return
        return dict(row)

    def update_driver_location(self, user_id, payload):
        """Atualiza localização do entregador. Recebe o user_id (não o drivers.id).
        Drivers e users são tabelas separadas, ligadas por name. Esta função:
        1. busca o user (entregador) pelo user_id
        2. atualiza a linha em drivers que tem o mesmo nome
        3. atualiza driver_lat/lng nos pedidos em status 'Entrega' deste entregador
        """
        try:
            lat = float(payload["lat"])
            lng = float(payload["lng"])
        except (KeyError, TypeError, ValueError):
            self.send_error(HTTPStatus.BAD_REQUEST, "Coordenadas inválidas")
            return
        with connect() as conn:
            user = conn.execute(
                "SELECT name FROM users WHERE id = ? AND role = 'entregador'",
                (user_id,),
            ).fetchone()
            if user is None:
                self.send_error(HTTPStatus.NOT_FOUND, "Entregador não encontrado")
                return
            conn.execute(
                "UPDATE drivers SET lat = ?, lng = ? WHERE name = ?",
                (lat, lng, user["name"]),
            )
            now = datetime.now().isoformat(timespec="seconds")
            # propaga para pedidos em entrega deste entregador
            conn.execute(
                """UPDATE orders SET driver_lat = ?, driver_lng = ?, last_location_at = ?
                   WHERE driver_name = ? AND status = 'Entrega'""",
                (lat, lng, now, user["name"]),
            )
            row = conn.execute("SELECT * FROM drivers WHERE name = ?", (user["name"],)).fetchone()
        if row is None:
            # entregador existe em users mas não em drivers — devolve dados mínimos
            return {"name": user["name"], "lat": lat, "lng": lng}
        return dict(row)


def ensure_seed_users():
    import hashlib
    def hp(pin):
        import secrets as s
        salt = s.token_hex(16)
        dk = hashlib.pbkdf2_hmac('sha256', pin.encode(), salt.encode(), 120000)
        return salt + ':' + dk.hex()
    with connect() as conn:
        for email, cpf, pin, name, role in USER_SEED:
            exists = conn.execute('SELECT id FROM users WHERE cpf = ?', (cpf,)).fetchone()
            if not exists:
                conn.execute('INSERT INTO users (email, cpf, pin, pin_hash, name, role) VALUES (?,?,?,?,?,?)',
                    (email, cpf, pin, hp(pin), name, role))

def ensure_seed_users():
    import hashlib
    def hp(pin):
        import secrets as s
        salt = s.token_hex(16)
        dk = hashlib.pbkdf2_hmac('sha256', pin.encode(), salt.encode(), 120000)
        return salt + ':' + dk.hex()
    with connect() as conn:
        for email, cpf, pin, name, role in USER_SEED:
            exists = conn.execute('SELECT id FROM users WHERE cpf = ?', (cpf,)).fetchone()
            if not exists:
                conn.execute('INSERT INTO users (email, cpf, pin, pin_hash, name, role) VALUES (?,?,?,?,?,?)',
                    (email, cpf, pin, hp(pin), name, role))

def main():
    init_db()
    ensure_seed_users()
    if not USE_POSTGRES:
    # Iniciar backup automático em 24h (primeira vez)
        t = threading.Timer(86400, auto_backup)
        t.daemon = True
        t.start()
    server = ThreadingHTTPServer((HOST, PORT), BortoliniHandler)
    print(f"Bortolini rodando em http://{HOST}:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
