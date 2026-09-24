from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, HTTPException, Depends
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import uvicorn
import paramiko
import secrets
import os
import sys


# === Подключаем базу данных ===
sys.path.append(os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend"))
import database as db

app = FastAPI()

# === CORS (чтобы фронтенд мог обращаться) ===
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# === Статика (картинки, CSS, JS) ===
app.mount("/static", StaticFiles(directory="templates/static"), name="static")

# === Инициализация базы при запуске ===
db.init_db()


# =========================================================
# === ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ===
# =========================================================

def get_client_ip(request: Request) -> str:
    """Возвращает IP клиента."""
    return request.client.host if request.client else "unknown"


def get_current_user(request: Request):
    """Проверяет токен из заголовка Authorization и возвращает пользователя."""
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Токен не передан")

    token = auth_header.replace("Bearer ", "").strip()
    session = db.get_session_by_token(token)
    if not session:
        raise HTTPException(status_code=401, detail="Сессия не найдена или закрыта")

    user = db.get_user_by_id(session["user_id"])
    if not user:
        raise HTTPException(status_code=401, detail="Пользователь не найден")

    return user


def is_admin(user: dict) -> bool:
    """Проверяет, является ли пользователь админом."""
    return user.get("role") == "admin"


# =========================================================
# === СТРАНИЦЫ (HTML) ===
# =========================================================

@app.get("/", response_class=HTMLResponse)
def root():
    """Страница входа."""
    with open("templates/login.html", "r", encoding="utf-8") as f:
        return HTMLResponse(f.read())


@app.get("/index", response_class=HTMLResponse)
def index_page():
    """Рабочая панель (консоль)."""
    with open("templates/index.html", "r", encoding="utf-8") as f:
        return HTMLResponse(f.read())


@app.get("/admin", response_class=HTMLResponse)
def admin_page():
    """Админ-панель."""
    with open("templates/admin.html", "r", encoding="utf-8") as f:
        return HTMLResponse(f.read())


# =========================================================
# === API: АВТОРИЗАЦИЯ ===
# =========================================================

@app.post("/api/login")
async def login(request: Request):
    """Проверка логина/пароля, создание сессии."""
    data = await request.json()
    login_value = data.get("login", "").strip()
    password = data.get("password", "").strip()

    if not login_value or not password:
        raise HTTPException(status_code=400, detail="Логин и пароль обязательны")

    user = db.get_user_by_login(login_value)
    if not user or user["password"] != password:
        raise HTTPException(status_code=401, detail="Неверный логин или пароль")

    # Создаём токен
    token = secrets.token_urlsafe(32)
    ip = get_client_ip(request)

    db.create_session(token, user["id"], ip)
    db.log_action(user["id"], "login", target=login_value, ip=ip)

    return {
        "token": token,
        "user": {
            "id": user["id"],
            "login": user["login"],
            "name": user["name"],
            "role": user["role"],
            "is_owner": user["is_owner"],
            "is_senior": user["is_senior"],
        }
    }


@app.post("/api/logout")
async def logout(request: Request):
    """Завершение сессии."""
    user = get_current_user(request)
    auth_header = request.headers.get("Authorization", "")
    token = auth_header.replace("Bearer ", "").strip()
    ip = get_client_ip(request)

    db.close_session(token)
    db.log_action(user["id"], "logout", ip=ip)

    return {"status": "ok", "message": "Вы вышли из системы"}


@app.get("/api/me")
def me(user: dict = Depends(get_current_user)):
    """Возвращает данные текущего пользователя."""
    return {
        "id": user["id"],
        "login": user["login"],
        "name": user["name"],
        "role": user["role"],
        "is_owner": user["is_owner"],
        "is_senior": user["is_senior"],
    }


# =========================================================
# === API: ПОЛЬЗОВАТЕЛИ (только админ) ===
# =========================================================

@app.get("/api/users")
def get_users(user: dict = Depends(get_current_user)):
    if not is_admin(user):
        raise HTTPException(status_code=403, detail="Доступ только для админа")
    return db.get_all_users()


@app.post("/api/users")
async def create_user(request: Request, user: dict = Depends(get_current_user)):
    if not is_admin(user):
        raise HTTPException(status_code=403, detail="Доступ только для админа")

    data = await request.json()
    login_value = data.get("login", "").strip()
    password = data.get("password", "").strip()
    name = data.get("name", "").strip()
    role = data.get("role", "user").strip()

    if not login_value or not password or not name:
        raise HTTPException(status_code=400, detail="Все поля обязательны")

    new_id = db.create_user(login_value, password, name, role, created_by=user["id"])
    if not new_id:
        raise HTTPException(status_code=400, detail="Логин уже занят")

    ip = get_client_ip(request)
    db.log_action(user["id"], "create_user", target=login_value, ip=ip)

    return {"status": "ok", "user_id": new_id}


@app.delete("/api/users/{user_id}")
def delete_user(user_id: int, request: Request, user: dict = Depends(get_current_user)):
    if not is_admin(user):
        raise HTTPException(status_code=403, detail="Доступ только для админа")

    # Нельзя удалить самого себя
    if user_id == user["id"]:
        raise HTTPException(status_code=400, detail="Нельзя удалить себя")

    target = db.get_user_by_id(user_id)
    if not target:
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    # Senior Admin не может удалить Owner
    if not user["is_owner"] and target["is_owner"]:
        raise HTTPException(status_code=403, detail="Нельзя удалить владельца")

    db.delete_user(user_id)
    ip = get_client_ip(request)
    db.log_action(user["id"], "delete_user", target=target["login"], ip=ip)

    return {"status": "ok"}


@app.post("/api/users/{user_id}/password")
async def change_password(user_id: int, request: Request, user: dict = Depends(get_current_user)):
    if not is_admin(user):
        raise HTTPException(status_code=403, detail="Доступ только для админа")

    data = await request.json()
    new_password = data.get("password", "").strip()

    if not new_password:
        raise HTTPException(status_code=400, detail="Пароль обязателен")

    target = db.get_user_by_id(user_id)
    if not target:
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    # Senior Admin не может менять пароль Owner
    if not user["is_owner"] and target["is_owner"]:
        raise HTTPException(status_code=403, detail="Нельзя менять пароль владельца")

    db.update_password(user_id, new_password)
    ip = get_client_ip(request)
    db.log_action(user["id"], "change_password", target=target["login"], ip=ip)

    return {"status": "ok"}


# =========================================================
# === API: СЕССИИ (только админ) ===
# =========================================================

@app.get("/api/sessions")
def get_sessions(user: dict = Depends(get_current_user)):
    if not is_admin(user):
        raise HTTPException(status_code=403, detail="Доступ только для админа")
    return db.get_active_sessions()


@app.delete("/api/sessions/{session_id}")
def kill_session(session_id: int, request: Request, user: dict = Depends(get_current_user)):
    if not is_admin(user):
        raise HTTPException(status_code=403, detail="Доступ только для админа")

    ip = get_client_ip(request)
    db.log_action(user["id"], "kill_session", target=str(session_id), ip=ip)

    return {"status": "ok"}


# =========================================================
# === API: ИСТОРИЯ (только админ) ===
# =========================================================

@app.get("/api/audit")
def get_audit(user: dict = Depends(get_current_user)):
    if not is_admin(user):
        raise HTTPException(status_code=403, detail="Доступ только для админа")
    return db.get_audit_log(limit=100)


# =========================================================
# === API: СЕРВЕРЫ (личные для каждого) ===
# =========================================================

@app.get("/api/servers")
def get_servers(user: dict = Depends(get_current_user)):
    """Возвращает только серверы текущего пользователя."""
    return db.get_servers_by_user(user["id"])


@app.post("/api/servers")
async def add_server(request: Request, user: dict = Depends(get_current_user)):
    data = await request.json()
    name = data.get("name", "").strip()
    host = data.get("host", "").strip()
    port = data.get("port", 22)
    username = data.get("username", "").strip()
    password = data.get("password", "").strip()
    region = data.get("region", "").strip() or None
    city = data.get("city", "").strip() or None

    if not name or not host or not username or not password:
        raise HTTPException(status_code=400, detail="Все обязательные поля должны быть заполнены")

    server_id = db.add_server(
        user_id=user["id"],
        name=name,
        host=host,
        port=int(port),
        username=username,
        password=password,
        region=region,
        city=city,
    )

    ip = get_client_ip(request)
    db.log_action(user["id"], "add_server", target=name, ip=ip)

    return {"status": "ok", "server_id": server_id}


@app.delete("/api/servers/{server_id}")
def delete_server(server_id: int, request: Request, user: dict = Depends(get_current_user)):
    server = db.get_server_by_id(server_id, user["id"])
    if not server:
        raise HTTPException(status_code=404, detail="Сервер не найден или не принадлежит вам")

    db.delete_server(server_id, user["id"])
    ip = get_client_ip(request)
    db.log_action(user["id"], "delete_server", target=server["name"], ip=ip)

    return {"status": "ok"}


# =========================================================
# === WEBSOCKET: SSH-КОНСОЛЬ ===
# =========================================================

def execute_ssh_command(command: str, device: dict, password: str) -> str:
    try:
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(
            hostname=device["host"],
            port=device["port"],
            username=device["username"],
            password=password,
            timeout=5
        )
        stdin, stdout, stderr = client.exec_command(command)
        output = stdout.read().decode('utf-8', errors='replace').strip()
        error = stderr.read().decode('utf-8', errors='replace').strip()
        client.close()
        if error:
            return f"[stderr]\n{error}"
        if not output:
            return "[OK]"
        return output
    except Exception as e:
        return f"❌ {str(e)}"


@app.websocket("/ws")
async def ws(websocket: WebSocket):
    await websocket.accept()
    device_id = websocket.query_params.get('device')
    token = websocket.query_params.get('token')

    if not token:
        await websocket.send_text("__AUTH_FAILED__")
        await websocket.close()
        return

    session = db.get_session_by_token(token)
    if not session:
        await websocket.send_text("__AUTH_FAILED__")
        await websocket.close()
        return

    user = db.get_user_by_id(session["user_id"])
    if not user:
        await websocket.send_text("__AUTH_FAILED__")
        await websocket.close()
        return

    # Получаем сервер, только если он принадлежит пользователю
    device = db.get_server_by_id(int(device_id), user["id"]) if device_id else None
    if not device:
        await websocket.send_text("❌ Сервер не найден или не принадлежит вам")
        await websocket.close()
        return

    try:
        password = await websocket.receive_text()
    except:
        await websocket.close()
        return

    # Проверка SSH
    try:
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(
            hostname=device["host"],
            port=device["port"],
            username=device["username"],
            password=password,
            timeout=5
        )
        client.close()
    except Exception:
        await websocket.send_text("__AUTH_FAILED__")
        await websocket.close()
        return

    print(f"✅ {user['name']} → {device['name']}")
    try:
        while True:
            cmd = await websocket.receive_text()
            output = execute_ssh_command(cmd, device, password)
            await websocket.send_text(output)
    except WebSocketDisconnect:
        print(f"❌ {user['name']} отключился от {device['name']}")


# =========================================================
# === ЗАПУСК ===
# =========================================================

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)