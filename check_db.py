import sqlite3

conn = sqlite3.connect('backend/adm-tool.db')
cur = conn.cursor()

print("=== Таблицы ===")
cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
for row in cur.fetchall():
    print(f"  {row[0]}")

print("\n=== Колонки таблицы servers ===")
cur.execute("PRAGMA table_info(servers)")
for row in cur.fetchall():
    print(f"  {row[1]} ({row[2]})")

print("\n=== Пользователи ===")
cur.execute("SELECT id, login, role, is_owner FROM users")
for row in cur.fetchall():
    print(f"  {row}")

conn.close()