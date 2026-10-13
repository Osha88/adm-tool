# ============================================================
# === БЛОК 1: ИМПОРТЫ ===
# ============================================================
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, HTTPException, Depends
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import uvicorn
import asyncio
import json
import secrets
import os
import sys
from dotenv import load_dotenv

# === Шифрование (AES-256) ===
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives import padding
from cryptography.hazmat.backends import default_backend
import base64


# ============================================================
# === БЛОК 2: ЗАГРУЗКА ПЕРЕМЕННЫХ ОКРУЖЕНИЯ ===
# ============================================================
load_dotenv()

ENCRYPTION_KEY = os.getenv("ENCRYPTION_KEY", "")
if len(ENCRYPTION_KEY) != 32:
    raise RuntimeError("ENCRYPTION_KEY must be exactly 32 chars in .env")


# ============================================================
# === БЛОК 3: ПОДКЛЮЧЕНИЕ БАЗЫ ДАННЫХ ===
# ============================================================
sys.path.append(os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend"))
import database as db
import ssh_async


# ============================================================
# === БЛОК 4: ПРИЛОЖЕНИЕ, CORS, СТАТИКА ===
# ============================================================
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory="templates/static"), name="static")

db.init_db()


# ============================================================
# === БЛОК 5: ШИФРОВАНИЕ (AES-256) ===
# ============================================================
def encrypt_text(plain_text: str) -> str:
    """Encrypts text with AES-256 (CBC). Returns base64 string."""
    if not plain_text:
        return ""
    try:
        key = ENCRYPTION_KEY.encode("utf-8")
        iv = os.urandom(16)

        padder = padding.PKCS7(128).padder()
        padded_data = padder.update(plain_text.encode("utf-8")) + padder.finalize()

        cipher = Cipher(algorithms.AES(key), modes.CBC(iv), backend=default_backend())
        encryptor = cipher.encryptor()
        encrypted = encryptor.update(padded_data) + encryptor.finalize()

        return base64.b64encode(iv + encrypted).decode("utf-8")
    except Exception as e:
        print(f"encrypt error: {e}")
        return ""


def decrypt_text(encrypted_text: str) -> str:
    """Decrypts base64 AES-256 (CBC) string."""
    if not encrypted_text:
        return ""
    try:
        key = ENCRYPTION_KEY.encode("utf-8")
        data = base64.b64decode(encrypted_text)

        iv = data[:16]
        encrypted = data[16:]

        cipher = Cipher(algorithms.AES(key), modes.CBC(iv), backend=default_backend())
        decryptor = cipher.decryptor()
        padded_data = decryptor.update(encrypted) + decryptor.finalize()

        unpadder = padding.PKCS7(128).unpadder()
        plain_text = unpadder.update(padded_data) + unpadder.finalize()

        return plain_text.decode("utf-8")
    except Exception as e:
        print(f"decrypt error: {e}")
        return ""


# ============================================================
# === БЛОК 6: ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ===
# ============================================================
def get_client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def get_current_user(request: Request):
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="No token")

    token = auth_header.replace("Bearer ", "").strip()
    session = db.get_session_by_token(token)
    if not session:
        raise HTTPException(status_code=401, detail="Session not found or closed")

    user = db.get_user_by_id(session["user_id"])
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    return user


def is_admin(user: dict) -> bool:
    return user.get("role") == "admin"


# ============================================================
# === БЛОК 7: СТРАНИЦЫ (HTML) ===
# ============================================================
@app.get("/", response_class=HTMLResponse)
def root():
    with open("templates/login.html", "r", encoding="utf-8") as f:
        return HTMLResponse(f.read())


@app.get("/index", response_class=HTMLResponse)
def index_page():
    with open("templates/index.html", "r", encoding="utf-8") as f:
        return HTMLResponse(f.read())


@app.get("/admin", response_class=HTMLResponse)
def admin_page():
    with open("templates/admin.html", "r", encoding="utf-8") as f:
        return HTMLResponse(f.read())


# ============================================================
# === БЛОК 8: API — АВТОРИЗАЦИЯ ===
# ============================================================
@app.post("/api/login")
async def login(request: Request):
    data = await request.json()
    login_value = data.get("login", "").strip()
    password = data.get("password", "").strip()

    if not login_value or not password:
        raise HTTPException(status_code=400, detail="Login and password required")

    user = db.get_user_by_login(login_value)
    if not user or user["password"] != password:
        raise HTTPException(status_code=401, detail="Invalid login or password")

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
    user = get_current_user(request)
    auth_header = request.headers.get("Authorization", "")
    token = auth_header.replace("Bearer ", "").strip()
    ip = get_client_ip(request)

    db.close_session(token)
    db.log_action(user["id"], "logout", ip=ip)

    return {"status": "ok", "message": "Logged out"}


@app.get("/api/me")
def me(user: dict = Depends(get_current_user)):
    return {
        "id": user["id"],
        "login": user["login"],
        "name": user["name"],
        "role": user["role"],
        "is_owner": user["is_owner"],
        "is_senior": user["is_senior"],
    }


# ============================================================
# === БЛОК 9: API — ПОЛЬЗОВАТЕЛИ (ТОЛЬКО АДМИН) ===
# ============================================================
@app.get("/api/users")
def get_users(user: dict = Depends(get_current_user)):
    if not is_admin(user):
        raise HTTPException(status_code=403, detail="Admin only")
    return db.get_all_users()


@app.post("/api/users")
async def create_user(request: Request, user: dict = Depends(get_current_user)):
    if not is_admin(user):
        raise HTTPException(status_code=403, detail="Admin only")

    data = await request.json()
    login_value = data.get("login", "").strip()
    password = data.get("password", "").strip()
    name = data.get("name", "").strip()
    role = data.get("role", "user").strip()

    if not login_value or not password or not name:
        raise HTTPException(status_code=400, detail="All fields required")

    new_id = db.create_user(login_value, password, name, role, created_by=user["id"])
    if not new_id:
        raise HTTPException(status_code=400, detail="Login already taken")

    ip = get_client_ip(request)
    db.log_action(user["id"], "create_user", target=login_value, ip=ip)

    return {"status": "ok", "user_id": new_id}


@app.delete("/api/users/{user_id}")
def delete_user(user_id: int, request: Request, user: dict = Depends(get_current_user)):
    if not is_admin(user):
        raise HTTPException(status_code=403, detail="Admin only")

    if user_id == user["id"]:
        raise HTTPException(status_code=400, detail="Cannot delete self")

    target = db.get_user_by_id(user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    if not user["is_owner"] and target["is_owner"]:
        raise HTTPException(status_code=403, detail="Cannot delete owner")

    db.delete_user(user_id)
    ip = get_client_ip(request)
    db.log_action(user["id"], "delete_user", target=target["login"], ip=ip)

    return {"status": "ok"}


@app.post("/api/users/{user_id}/password")
async def change_password(user_id: int, request: Request, user: dict = Depends(get_current_user)):
    if not is_admin(user):
        raise HTTPException(status_code=403, detail="Admin only")

    data = await request.json()
    new_password = data.get("password", "").strip()

    if not new_password:
        raise HTTPException(status_code=400, detail="Password required")

    target = db.get_user_by_id(user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    if not user["is_owner"] and target["is_owner"]:
        raise HTTPException(status_code=403, detail="Cannot change owner password")

    db.update_password(user_id, new_password)
    ip = get_client_ip(request)
    db.log_action(user["id"], "change_password", target=target["login"], ip=ip)

    return {"status": "ok"}


# ============================================================
# === БЛОК 10: API — СЕССИИ (ТОЛЬКО АДМИН) ===
# ============================================================
@app.get("/api/sessions")
def get_sessions(user: dict = Depends(get_current_user)):
    if not is_admin(user):
        raise HTTPException(status_code=403, detail="Admin only")
    return db.get_active_sessions()


@app.delete("/api/sessions/{session_id}")
def kill_session(session_id: int, request: Request, user: dict = Depends(get_current_user)):
    if not is_admin(user):
        raise HTTPException(status_code=403, detail="Admin only")

    ip = get_client_ip(request)
    db.log_action(user["id"], "kill_session", target=str(session_id), ip=ip)

    return {"status": "ok"}


# ============================================================
# === БЛОК 11: API — ИСТОРИЯ (ТОЛЬКО АДМИН) ===
# ============================================================
@app.get("/api/audit")
def get_audit(user: dict = Depends(get_current_user)):
    if not is_admin(user):
        raise HTTPException(status_code=403, detail="Admin only")
    return db.get_audit_log(limit=100)


# ============================================================
# === БЛОК 12: API — СЕРВЕРЫ (ЛИЧНЫЕ, С ПОДДЕРЖКОЙ КЛЮЧЕЙ) ===
# ============================================================
@app.get("/api/servers")
def get_servers(user: dict = Depends(get_current_user)):
    servers = db.get_servers_by_user(user["id"])
    for s in servers:
        s.pop("password_enc", None)
        s.pop("private_key_enc", None)
        s.pop("passphrase_enc", None)
    return servers


@app.post("/api/servers")
async def add_server(request: Request, user: dict = Depends(get_current_user)):
    data = await request.json()

    name = data.get("name", "").strip()
    host = data.get("host", "").strip()
    port = data.get("port", 22)
    username = data.get("username", "").strip()
    auth_type = data.get("auth_type", "password").strip()
    region = data.get("region", "").strip() or None
    city = data.get("city", "").strip() or None

    if not name or not host or not username:
        raise HTTPException(status_code=400, detail="Name, host and username required")

    password_enc = None
    private_key_enc = None
    passphrase_enc = None

    if auth_type == "password":
        password = data.get("password", "").strip()
        if not password:
            raise HTTPException(status_code=400, detail="Password required")
        password_enc = encrypt_text(password)
    elif auth_type == "key":
        private_key = data.get("private_key", "").strip()
        if not private_key:
            raise HTTPException(status_code=400, detail="Private key required")
        private_key_enc = encrypt_text(private_key)

        passphrase = data.get("passphrase", "").strip()
        if passphrase:
            passphrase_enc = encrypt_text(passphrase)
    else:
        raise HTTPException(status_code=400, detail="Invalid auth type")

    server_id = db.add_server(
        user_id=user["id"],
        name=name,
        host=host,
        port=int(port),
        username=username,
        auth_type=auth_type,
        password_enc=password_enc,
        private_key_enc=private_key_enc,
        passphrase_enc=passphrase_enc,
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
        raise HTTPException(status_code=404, detail="Server not found or not yours")

    db.delete_server(server_id, user["id"])
    ip = get_client_ip(request)
    db.log_action(user["id"], "delete_server", target=server["name"], ip=ip)

    return {"status": "ok"}


# ============================================================
# === БЛОК 14: WEBSOCKET — SSH-КОНСОЛЬ (AsyncSSH + PTY) ===
# ============================================================
async def ws_to_ssh(websocket: WebSocket, session, user: dict, device: dict):
    """Reads from WebSocket, writes to PTY."""
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue

            msg_type = msg.get("type")

            if msg_type == "data":
                payload = msg.get("payload", "")
                await session.send(payload.encode("utf-8"))
                db.log_action(user["id"], "ssh_command",
                              target=device["name"], details=payload)

            elif msg_type == "resize":
                cols = int(msg.get("cols", 80))
                rows = int(msg.get("rows", 24))
                await session.resize(cols, rows)

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"ws_to_ssh error: {e}")


async def ssh_to_ws(websocket: WebSocket, session):
    """Reads from PTY, writes to WebSocket."""
    try:
        while True:
            data = await session.read(4096)
            if not data:
                break
            text = data.decode("utf-8", errors="replace")
            await websocket.send_text(json.dumps({
                "type": "data",
                "payload": text
            }))
    except Exception as e:
        print(f"ssh_to_ws error: {e}")


@app.websocket("/ws")
async def ws(websocket: WebSocket):
    await websocket.accept()

    device_id = websocket.query_params.get("device")
    token = websocket.query_params.get("token")

    if not token:
        await websocket.send_text(json.dumps({"type": "error", "message": "no token"}))
        await websocket.close()
        return

    session_row = db.get_session_by_token(token)
    if not session_row:
        await websocket.send_text(json.dumps({"type": "error", "message": "auth failed"}))
        await websocket.close()
        return

    user = db.get_user_by_id(session_row["user_id"])
    if not user:
        await websocket.send_text(json.dumps({"type": "error", "message": "user not found"}))
        await websocket.close()
        return

    device = db.get_server_by_id(int(device_id), user["id"]) if device_id else None
    if not device:
        await websocket.send_text(json.dumps({"type": "error", "message": "server not found"}))
        await websocket.close()
        return

    # --- Decrypt SSH credentials ---
    password = None
    key_text = None
    passphrase = None

    if device["auth_type"] == "password":
        password = decrypt_text(device.get("password_enc", ""))
        if not password:
            await websocket.send_text(json.dumps({"type": "error", "message": "decrypt password failed"}))
            await websocket.close()
            return
    elif device["auth_type"] == "key":
        key_text = decrypt_text(device.get("private_key_enc", ""))
        if not key_text:
            await websocket.send_text(json.dumps({"type": "error", "message": "decrypt key failed"}))
            await websocket.close()
            return
        passphrase = decrypt_text(device.get("passphrase_enc", "")) or None

    # --- Create SSH session ---
    ssh = ssh_async.SSHSession(
        device=device,
        password=password,
        key_text=key_text,
        passphrase=passphrase,
    )

    try:
        await ssh.connect()
        await ssh.open_pty(cols=80, rows=24)
    except ssh_async.SSHError as e:
        await websocket.send_text(json.dumps({"type": "error", "message": str(e)}))
        await websocket.close()
        return

    db.log_action(user["id"], "connect_server", target=device["name"], ip=None)
    print(f"OK {user['name']} -> {device['name']}")

    try:
        await asyncio.gather(
            ws_to_ssh(websocket, ssh, user, device),
            ssh_to_ws(websocket, ssh),
        )
    except Exception as e:
        print(f"ws error: {e}")
    finally:
        await ssh.close()
        db.log_action(user["id"], "disconnect_server", target=device["name"])
        print(f"BYE {user['name']} -> {device['name']}")


# ============================================================
# === БЛОК 15: ЗАПУСК ===
# ============================================================
if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)