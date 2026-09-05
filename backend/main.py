from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
import uvicorn
import paramiko

app = FastAPI()

# === СПИСОК УСТРОЙСТВ ===
DEVICES = [
    {
        "id": "host1",
        "name": "Сервер 1 (159.194.225.160)",
        "host": "159.194.225.160",
        "port": 22,
        "username": "root"
    },
    {
        "id": "host2",
        "name": "Сервер 2 (81.177.165.20)",
        "host": "81.177.165.20",
        "port": 22,
        "username": "root"
    }
]

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

@app.get("/")
def root():
    with open("templates/index.html", "r", encoding="utf-8") as f:
        return HTMLResponse(f.read())

@app.get("/api/devices")
def get_devices():
    return DEVICES

@app.websocket("/ws")
async def ws(websocket: WebSocket):
    await websocket.accept()
    device_id = websocket.query_params.get('device', DEVICES[0]['id'])
    device = next((d for d in DEVICES if d["id"] == device_id), DEVICES[0])
    try:
        password = await websocket.receive_text()
    except:
        await websocket.close()
        return
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
    print(f"✅ {device['name']}")
    try:
        while True:
            cmd = await websocket.receive_text()
            output = execute_ssh_command(cmd, device, password)
            await websocket.send_text(output)
    except WebSocketDisconnect:
        print(f"❌ {device['name']}")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)