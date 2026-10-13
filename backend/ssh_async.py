# ============================================================
# === backend/ssh_async.py ===
# === Обёртка над AsyncSSH: подключение, PTY, чтение/запись ===
# ============================================================
import asyncssh
from typing import Optional


# ============================================================
# === БЛОК 1: ИСКЛЮЧЕНИЕ ДЛЯ МЯГКИХ ОШИБОК ===
# ============================================================
class SSHError(Exception):
    """Мягкая ошибка SSH — то, что можно показать пользователю."""
    pass


# ============================================================
# === БЛОК 2: ИМПОРТ КЛЮЧА ===
# ============================================================
def import_key(key_text: str, passphrase: Optional[str] = None):
    """
    Импортирует приватный ключ в формате OpenSSH / PEM / PuTTY.
    Если формат не распознан — кидает SSHError с инструкцией.
    """
    try:
        return asyncssh.import_private_key(key_text, passphrase)
    except asyncssh.KeyImportError as e:
        raise SSHError(
            "Не удалось распознать формат ключа.\n"
            "Поддерживаются: OpenSSH, PEM, PuTTY (.ppk).\n"
            "Проверьте, что ключ скопирован полностью (включая строки BEGIN/END).\n"
            f"Детали: {e}"
        )
    except Exception as e:
        raise SSHError(f"Ошибка при импорте ключа: {e}")


# ============================================================
# === БЛОК 3: КЛАСС SSHSession ===
# ============================================================
class SSHSession:
    """
    Одна SSH-сессия: одно соединение, один PTY-процесс.
    Живёт, пока жив WebSocket.
    """

    def __init__(self, device: dict, password: str = None,
                 key_text: str = None, passphrase: str = None):
        """
        device — словарь из БД: host, port, username, auth_type.
        password — расшифрованный пароль (если auth_type='password').
        key_text — расшифрованный ключ (если auth_type='key').
        passphrase — passphrase от ключа (может быть None).
        """
        self.device = device
        self.password = password
        self.key_text = key_text
        self.passphrase = passphrase
        self.conn: Optional[asyncssh.SSHClientConnection] = None
        self.process: Optional[asyncssh.SSHClientProcess] = None

    # --------------------------------------------------------
    # === ПОДКЛЮЧЕНИЕ ===
    # --------------------------------------------------------
    async def connect(self):
        """Подключается к серверу. Кидает SSHError при неудаче."""
        try:
            auth_type = self.device.get("auth_type", "password")

            if auth_type == "password":
                if not self.password:
                    raise SSHError("Пароль SSH не передан или не расшифрован")
                self.conn = await asyncssh.connect(
                    host=self.device["host"],
                    port=self.device["port"],
                    username=self.device["username"],
                    password=self.password,
                    known_hosts=None,  # как в Paramiko AutoAddPolicy
                )
            elif auth_type == "key":
                if not self.key_text:
                    raise SSHError("Приватный ключ не передан или не расшифрован")
                key = import_key(self.key_text, self.passphrase)
                self.conn = await asyncssh.connect(
                    host=self.device["host"],
                    port=self.device["port"],
                    username=self.device["username"],
                    client_keys=[key],
                    known_hosts=None,
                )
            else:
                raise SSHError(f"Неверный тип аутентификации: {auth_type}")

        except SSHError:
            raise
        except asyncssh.PermissionDenied as e:
            raise SSHError(f"Доступ запрещён: неверный логин, пароль или ключ.\n{e}")
        except asyncssh.HostKeyNotVerifiable as e:
            raise SSHError(f"Ошибка проверки ключа хоста: {e}")
        except Exception as e:
            raise SSHError(f"Ошибка подключения: {e}")

    # --------------------------------------------------------
    # === ОТКРЫТИЕ PTY ===
    # --------------------------------------------------------
    async def open_pty(self, cols: int = 80, rows: int = 24):
        """Открывает интерактивный shell с PTY."""
        if not self.conn:
            raise SSHError("Сначала вызовите connect()")
        try:
            self.process = await self.conn.create_process(
                term_type="xterm-256color",
                term_size=(cols, rows),
                encoding=None,  # работаем с байтами
            )
        except Exception as e:
            raise SSHError(f"Ошибка открытия PTY: {e}")

    # --------------------------------------------------------
    # === ОТПРАВКА ДАННЫХ ===
    # --------------------------------------------------------
    async def send(self, data: bytes):
        """Отправляет байты в PTY (то, что набрал пользователь)."""
        if not self.process:
            raise SSHError("PTY не открыт")
        try:
            self.process.stdin.write(data)
        except Exception as e:
            raise SSHError(f"Ошибка отправки данных: {e}")

    # --------------------------------------------------------
    # === ЧТЕНИЕ ДАННЫХ ===
    # --------------------------------------------------------
    async def read(self, size: int = 4096) -> bytes:
        """
        Читает порцию данных из PTY.
        Возвращает b'' при закрытии потока.
        """
        if not self.process:
            raise SSHError("PTY не открыт")
        try:
            return await self.process.stdout.read(size)
        except Exception as e:
            raise SSHError(f"Ошибка чтения данных: {e}")

    # --------------------------------------------------------
    # === ИЗМЕНЕНИЕ РАЗМЕРА ===
    # --------------------------------------------------------
    async def resize(self, cols: int, rows: int):
        """Меняет размер PTY (при изменении окна браузера)."""
        if not self.process:
            return
        try:
            self.process.change_terminal_size(cols, rows)
        except Exception as e:
            print(f"⚠️ Ошибка resize PTY: {e}")

    # --------------------------------------------------------
    # === ЗАКРЫТИЕ ===
    # --------------------------------------------------------
    async def close(self):
        """Закрывает PTY и соединение."""
        try:
            if self.process:
                self.process.close()
                self.process = None
        except Exception:
            pass
        try:
            if self.conn:
                self.conn.close()
                await self.conn.wait_closed()
                self.conn = None
        except Exception:
            pass