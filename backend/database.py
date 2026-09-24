import sqlite3
import os
from datetime import datetime

# === Путь к файлу базы (рядом с database.py) ===
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "adm-tool.db")


def get_connection():
    """Возвращает соединение с базой данных."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """Создаёт таблицы и начальные записи, если их ещё нет."""
    conn = get_connection()
    cursor = conn.cursor()

    # === Таблица settings ===
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )
    """)

    # === Таблица users ===
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            login TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            name TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user',
            is_owner INTEGER DEFAULT 0,
            is_senior INTEGER DEFAULT 0,
            created_by INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # === Таблица sessions ===
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            token TEXT UNIQUE NOT NULL,
            user_id INTEGER NOT NULL,
            ip TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            status TEXT DEFAULT 'active',
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    """)

    # === Таблица servers (с привязкой к пользователю) ===
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS servers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            host TEXT NOT NULL,
            port INTEGER DEFAULT 22,
            username TEXT NOT NULL,
            password TEXT NOT NULL,
            region TEXT,
            city TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    """)

    # === Таблица audit_log ===
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            action TEXT NOT NULL,
            target TEXT,
            ip TEXT,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    """)

    # === Начальные записи ===

    # 1. Рабочий пароль (пустой)
    cursor.execute("""
        INSERT OR IGNORE INTO settings (key, value) VALUES ('work_password', '')
    """)

    # 2. Owner (если ещё нет ни одного пользователя)
    cursor.execute("SELECT COUNT(*) FROM users")
    if cursor.fetchone()[0] == 0:
        cursor.execute("""
            INSERT INTO users (login, password, name, role, is_owner, is_senior)
            VALUES ('admin', 'admin', 'Owner', 'admin', 1, 0)
        """)

    conn.commit()
    conn.close()


# === Утилиты для работы с пользователями ===

def get_user_by_login(login: str):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE login = ?", (login,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None


def get_user_by_id(user_id: int):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None


def get_all_users():
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users ORDER BY id")
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]


def create_user(login: str, password: str, name: str, role: str, created_by: int = None):
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            INSERT INTO users (login, password, name, role, created_by)
            VALUES (?, ?, ?, ?, ?)
        """, (login, password, name, role, created_by))
        conn.commit()
        user_id = cursor.lastrowid
        conn.close()
        return user_id
    except sqlite3.IntegrityError:
        conn.close()
        return None


def delete_user(user_id: int):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM users WHERE id = ?", (user_id,))
    conn.commit()
    conn.close()


def update_password(user_id: int, new_password: str):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("UPDATE users SET password = ? WHERE id = ?", (new_password, user_id))
    conn.commit()
    conn.close()


# === Утилиты для работы с настройками ===

def get_setting(key: str):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT value FROM settings WHERE key = ?", (key,))
    row = cursor.fetchone()
    conn.close()
    return row["value"] if row else None


def set_setting(key: str, value: str):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO settings (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
    """, (key, value))
    conn.commit()
    conn.close()


# === Утилиты для работы с сессиями ===

def create_session(token: str, user_id: int, ip: str):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO sessions (token, user_id, ip)
        VALUES (?, ?, ?)
    """, (token, user_id, ip))
    conn.commit()
    conn.close()


def get_session_by_token(token: str):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM sessions WHERE token = ? AND status = 'active'", (token,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None


def close_session(token: str):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("UPDATE sessions SET status = 'closed' WHERE token = ?", (token,))
    conn.commit()
    conn.close()


def get_active_sessions():
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT s.*, u.name, u.role
        FROM sessions s
        JOIN users u ON s.user_id = u.id
        WHERE s.status = 'active'
        ORDER BY s.last_seen_at DESC
    """)
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]


# === Утилиты для работы с серверами (ЛИЧНЫЕ) ===

def get_servers_by_user(user_id: int):
    """Возвращает только серверы конкретного пользователя."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM servers WHERE user_id = ? ORDER BY name", (user_id,))
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_server_by_id(server_id: int, user_id: int):
    """Возвращает сервер, только если он принадлежит этому пользователю."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM servers WHERE id = ? AND user_id = ?", (server_id, user_id))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None


def add_server(user_id: int, name: str, host: str, port: int, username: str, password: str, region: str = None, city: str = None):
    """Добавляет сервер, привязанный к пользователю."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO servers (user_id, name, host, port, username, password, region, city)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (user_id, name, host, port, username, password, region, city))
    conn.commit()
    server_id = cursor.lastrowid
    conn.close()
    return server_id


def delete_server(server_id: int, user_id: int):
    """Удаляет сервер, только если он принадлежит этому пользователю."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM servers WHERE id = ? AND user_id = ?", (server_id, user_id))
    conn.commit()
    conn.close()


# === Утилиты для аудита ===

def log_action(user_id: int, action: str, target: str = None, ip: str = None):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO audit_log (user_id, action, target, ip)
        VALUES (?, ?, ?, ?)
    """, (user_id, action, target, ip))
    conn.commit()
    conn.close()


def get_audit_log(limit: int = 100):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT a.*, u.name
        FROM audit_log a
        LEFT JOIN users u ON a.user_id = u.id
        ORDER BY a.timestamp DESC
        LIMIT ?
    """, (limit,))
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]


# === Очистка старой истории (90 дней) ===

def clean_old_audit_log():
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        DELETE FROM audit_log
        WHERE timestamp < datetime('now', '-90 days')
    """)
    conn.commit()
    conn.close()


# === Инициализация при импорте ===
if __name__ == "__main__":
    init_db()
    print("✅ База данных инициализирована")