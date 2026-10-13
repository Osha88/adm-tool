// === БЛОК 17.1: АВТОРИЗАЦИЯ ===
const token = localStorage.getItem('token');
const user = JSON.parse(localStorage.getItem('user') || '{}');

if (!token) window.location.href = '/';
document.getElementById('userInfo').textContent = `${user.name} (${user.role})`;
if (user.role === 'admin') {
    document.getElementById('adminBtn').style.display = 'inline-block';
}

// === БЛОК 17.2: СОСТОЯНИЕ ===
let devices = [];
let ws = null;
let term = null;
let fitAddon = null;
let currentAuthType = 'password';

let termMode = 'mine';
let cmdHistory = JSON.parse(localStorage.getItem('cmdHistory') || '[]');
let historyIndex = -1;
let currentLine = '';
let interactiveActive = false;

let tracerouteCollecting = false;
let tracerouteBuffer = '';
let tracerouteTimer = null;

// === БЛОК 17.3: КОМАНДЫ ДЛЯ АВТОДОПОЛНЕНИЯ ===
const COMMANDS = [
    'ls', 'ls -la', 'ls -la /var/log',
    'cd', 'cd /', 'cd /root', 'cd /etc',
    'pwd', 'whoami', 'uptime', 'date',
    'df -h', 'free -m', 'ps aux', 'top',
    'ip addr', 'ip route', 'ping 8.8.8.8', 'traceroute google.com',
    'systemctl status apache2', 'systemctl restart apache2',
    'apt update', 'apt upgrade',
    'cat /etc/os-release', 'uname -a', 'hostname'
];

// === БЛОК 17.4: КООРДИНАТЫ ГОРОДОВ ===
const CITY_COORDS = {
    'Москва': { x: 17, y: 42 }, 'Воронеж': { x: 20, y: 48 },
    'Ярославль': { x: 19, y: 37 }, 'Рязань': { x: 20, y: 43 }, 'Тула': { x: 18, y: 44 },
    'Санкт-Петербург': { x: 14, y: 30 }, 'Калининград': { x: 6, y: 32 },
    'Мурманск': { x: 20, y: 15 }, 'Архангельск': { x: 23, y: 22 }, 'Череповец': { x: 19, y: 33 },
    'Краснодар': { x: 17, y: 55 }, 'Ростов-на-Дону': { x: 19, y: 52 },
    'Волгоград': { x: 23, y: 50 }, 'Сочи': { x: 17, y: 57 }, 'Новороссийск': { x: 16, y: 56 },
    'Ставрополь': { x: 21, y: 53 }, 'Владикавказ': { x: 24, y: 55 },
    'Махачкала': { x: 26, y: 57 }, 'Пятигорск': { x: 22, y: 54 }, 'Нальчик': { x: 23, y: 55 },
    'Казань': { x: 24, y: 44 }, 'Нижний Новгород': { x: 22, y: 40 },
    'Самара': { x: 27, y: 47 }, 'Уфа': { x: 29, y: 43 }, 'Пермь': { x: 28, y: 39 },
    'Екатеринбург': { x: 33, y: 40 }, 'Челябинск': { x: 33, y: 44 },
    'Тюмень': { x: 35, y: 38 }, 'Курган': { x: 35, y: 42 }, 'Сургут': { x: 42, y: 32 },
    'Новосибирск': { x: 44, y: 42 }, 'Красноярск': { x: 53, y: 42 },
    'Омск': { x: 41, y: 42 }, 'Барнаул': { x: 45, y: 45 }, 'Иркутск': { x: 60, y: 45 },
    'Хабаровск': { x: 80, y: 48 }, 'Владивосток': { x: 84, y: 55 },
    'Якутск': { x: 75, y: 30 }, 'Улан-Удэ': { x: 65, y: 47 }, 'Чита': { x: 70, y: 45 }
};

// === БЛОК 17.5: API-ХЕЛПЕР ===
async function api(path, options = {}) {
    const res = await fetch(path, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token,
            ...(options.headers || {})
        }
    });
    if (res.status === 401) {
        localStorage.clear();
        window.location.href = '/';
        return null;
    }
    return res.json();
}

// === БЛОК 17.6: ПЕРЕКЛЮЧЕНИЕ ВКЛАДОК ===
function showTab(name) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.getElementById('tab-' + name).classList.add('active');
    document.getElementById('panel-' + name).classList.add('active');
    if (name === 'map') loadMap();
    if (name === 'console' && fitAddon) setTimeout(() => fitAddon.fit(), 50);
}

// === БЛОК 17.7: ИНИЦИАЛИЗАЦИЯ ТЕРМИНАЛА ===
function initTerminal() {
    term = new Terminal({
        cursorBlink: true,
        fontFamily: "'Courier New', monospace",
        fontSize: 14,
        theme: {
            background: '#000000',
            foreground: '#00ff00',
            cursor: '#00ff00',
        },
        convertEol: false,
        scrollback: 5000,
    });
    fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(document.getElementById('terminal'));
    fitAddon.fit();

    term.onData(data => onTermData(data));

    window.addEventListener('resize', () => {
        if (fitAddon) {
            fitAddon.fit();
            sendResize();
        }
    });
}

// === БЛОК 17.8: ОБРАБОТКА ВВОДА В ТЕРМИНАЛЕ ===
function onTermData(data) {
    if (termMode === 'native') {
        sendData(data);
        return;
    }

    if (data === '\r') {
        sendData('\r');
        if (currentLine.trim()) {
            cmdHistory.push(currentLine);
            if (cmdHistory.length > 100) cmdHistory.shift();
            localStorage.setItem('cmdHistory', JSON.stringify(cmdHistory));
        }
        currentLine = '';
        historyIndex = -1;
        return;
    }

    if (data === '\x7f') {
        if (currentLine.length > 0) {
            currentLine = currentLine.slice(0, -1);
            sendData('\x7f');
        }
        return;
    }

    if (data === '\t') {
        handleTabCompletion();
        return;
    }

    if (data === '\x1b[A') { handleHistoryUp(); return; }
    if (data === '\x1b[B') { handleHistoryDown(); return; }

    if (data.length === 1 && data >= ' ') {
        currentLine += data;
    }
    sendData(data);
}

// === БЛОК 17.9: ИСТОРИЯ КОМАНД ===
function handleHistoryUp() {
    if (!cmdHistory.length) return;
    if (historyIndex === -1) historyIndex = cmdHistory.length - 1;
    else if (historyIndex > 0) historyIndex--;
    replaceCurrentLine(cmdHistory[historyIndex] || '');
}

function handleHistoryDown() {
    if (!cmdHistory.length) return;
    if (historyIndex < cmdHistory.length - 1) historyIndex++;
    else { historyIndex = -1; replaceCurrentLine(''); return; }
    replaceCurrentLine(cmdHistory[historyIndex] || '');
}

function replaceCurrentLine(newLine) {
    for (let i = 0; i < currentLine.length; i++) sendData('\x7f');
    currentLine = newLine;
    if (newLine) sendData(newLine);
}

// === БЛОК 17.10: АВТОДОПОЛНЕНИЕ (TAB) ===
function handleTabCompletion() {
    const current = currentLine;
    if (!current.trim()) {
        term.write('\r\n' + COMMANDS.join('  ') + '\r\n');
        return;
    }
    const matches = COMMANDS.filter(cmd => cmd.startsWith(current));
    if (matches.length === 1) {
        const suffix = matches[0].slice(current.length);
        currentLine = matches[0];
        sendData(suffix);
    } else if (matches.length > 1) {
        let prefix = matches[0];
        for (let i = 1; i < matches.length; i++) {
            let j = 0;
            while (j < prefix.length && j < matches[i].length && prefix[j] === matches[i][j]) j++;
            prefix = prefix.slice(0, j);
        }
        if (prefix.length > current.length) {
            const suffix = prefix.slice(current.length);
            currentLine = prefix;
            sendData(suffix);
        } else {
            term.write('\r\n' + matches.join('  ') + '\r\n');
        }
    }
}

// === БЛОК 17.11: ОТПРАВКА ДАННЫХ ===
function sendData(data) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'data', payload: data }));
}

function sendResize() {
    if (!ws || ws.readyState !== WebSocket.OPEN || !term) return;
    ws.send(JSON.stringify({
        type: 'resize',
        cols: term.cols,
        rows: term.rows
    }));
}

// === БЛОК 17.12: ПЕРЕКЛЮЧЕНИЕ РЕЖИМА ===
function toggleMode() {
    termMode = (termMode === 'mine') ? 'native' : 'mine';
    updateModeIndicator();
    currentLine = '';
    historyIndex = -1;
}

function updateModeIndicator() {
    const wrapper = document.getElementById('consoleWrapper');
    const indicator = document.getElementById('modeIndicator');
    if (termMode === 'mine') {
        wrapper.classList.remove('native-mode');
        indicator.textContent = 'Режим: мой терминал (↑↓ история, Tab дополнение)';
    } else {
        wrapper.classList.add('native-mode');
        indicator.textContent = 'Режим: нативный PTY (всё уходит в shell)';
    }
}

window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'T') {
        e.preventDefault();
        toggleMode();
    }
});

// === БЛОК 17.13: ОБРАБОТКА ИНТЕРАКТИВНЫХ ПОСЛЕДОВАТЕЛЬНОСТЕЙ ===
function checkInteractiveSequences(text) {
    if (text.includes('\x1b[?1049h')) {
        if (!interactiveActive) {
            interactiveActive = true;
            if (termMode === 'mine') {
                termMode = 'native';
                updateModeIndicator();
            }
        }
    }
    if (text.includes('\x1b[?1049l')) {
        if (interactiveActive) {
            interactiveActive = false;
            if (termMode === 'native') {
                termMode = 'mine';
                updateModeIndicator();
            }
        }
    }
}

// === БЛОК 17.14: ВИЗУАЛИЗАЦИЯ МАРШРУТА ===
function visualizeRoute() {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        term.write('\r\n\x1b[31m❌ Нет подключения к серверу\x1b[0m\r\n');
        return;
    }
    term.write('\r\n⏳ Запрос маршрута до 8.8.8.8...\r\n');
    tracerouteCollecting = true;
    tracerouteBuffer = '';
    sendData('traceroute -n 8.8.8.8\n');
}

function visualizeTraceroute(outputText) {
    const lines = outputText.split('\n').filter(line => line.trim());
    const hops = [];
    let maxTime = 0;

    lines.forEach(line => {
        const trimmed = line.trim();
        if (trimmed.startsWith('traceroute to')) return;
        if (trimmed.startsWith('traceroute -n')) return;
        const match = trimmed.match(/^(\d+)\s+(.+)/);
        if (!match) return;

        const num = parseInt(match[1]);
        const rest = match[2];
        const ipMatch = rest.match(/(\d+\.\d+\.\d+\.\d+)/);
        const ip = ipMatch ? ipMatch[1] : '*';
        const timeMatch = rest.match(/([\d.]+)\s*ms/);
        const time = (ip === '*') ? 0 : (timeMatch ? parseFloat(timeMatch[1]) : 0);

        if (time > maxTime) maxTime = time;
        hops.push({ num, ip, time });
    });

    if (hops.length === 0) {
        term.write('❌ Не удалось распарсить маршрут\r\n');
        term.write('Сырые данные:\r\n');
        term.write(outputText + '\r\n');
        return;
    }

    term.write('╔═══════════════════════════════════════════════════════════╗\r\n');
    term.write('║                   🗺️ МАРШРУТ ДО 8.8.8.8                 ║\r\n');
    term.write('╚═══════════════════════════════════════════════════════════╝\r\n');

    hops.forEach(hop => {
        const delay = hop.time > 0 ? hop.time.toFixed(1) : '❌';
        const barLength = Math.floor((hop.time / (maxTime || 1)) * 20);
        const bar = '█'.repeat(Math.min(barLength, 20));
                let color = '🟢';
        if (hop.ip === '*') color = '🔴';
        else if (hop.time > 500) color = '🔴';
        else if (hop.time > 100) color = '🟡';
        term.write(`${color} Хоп ${String(hop.num).padStart(2)}: ${hop.ip.padEnd(15)} → ${String(delay).padStart(6)} мс ${bar}\r\n`);
    });

    term.write('╔═══════════════════════════════════════════════════════════╗\r\n');
    term.write('🟢 < 100 мс  🟡 100-500 мс  🔴 > 500 мс или таймаут\r\n');
    term.write('╚═══════════════════════════════════════════════════════════╝\r\n');
}

// === БЛОК 17.15: ЗАГРУЗКА СПИСКА СЕРВЕРОВ ===
async function loadServers() {
    const servers = await api('/api/servers');
    if (!servers) return;
    devices = servers;
    const select = document.getElementById('deviceSelect');
    select.innerHTML = '<option value="">— Выберите сервер —</option>';
    devices.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.id;
        const lock = d.auth_type === 'key' ? '🗝️' : '🔑';
        opt.textContent = `${lock} ${d.name} (${d.host})`;
        select.appendChild(opt);
    });
}

// === БЛОК 17.16: ПОДКЛЮЧЕНИЕ К СЕРВЕРУ ===
function switchDevice() {
    const id = document.getElementById('deviceSelect').value;
    if (!id) { alert('Выберите сервер'); return; }
    const device = devices.find(d => d.id == id);
    if (!device) return;

    document.getElementById('sshStatus').textContent = '⏳ Подключение...';
    if (ws) ws.close();

    ws = new WebSocket(`ws://${location.host}/ws?device=${id}&token=${token}`);

    ws.onopen = () => {
        document.getElementById('sshStatus').textContent = '✅ ' + device.name;
        if (term) term.clear();
        sendResize();
    };

    ws.onmessage = (e) => {
        let msg;
        try { msg = JSON.parse(e.data); }
        catch { return; }

        if (msg.type === 'data') {
            if (tracerouteCollecting) {
                tracerouteBuffer += msg.payload;
                if (tracerouteTimer) clearTimeout(tracerouteTimer);
                tracerouteTimer = setTimeout(() => {
                    tracerouteCollecting = false;
                    visualizeTraceroute(tracerouteBuffer);
                    tracerouteBuffer = '';
                    tracerouteTimer = null;
                }, 500);
                return;
            }
            checkInteractiveSequences(msg.payload);
            if (term) term.write(msg.payload);
        } else if (msg.type === 'error') {
            document.getElementById('sshStatus').textContent = '❌ Ошибка';
            if (term) term.write('\r\n\x1b[31m' + msg.message + '\x1b[0m\r\n');
        } else if (msg.type === 'exit') {
            document.getElementById('sshStatus').textContent = '❌ Отключено';
        }
    };

    ws.onclose = () => {
        if (!document.getElementById('sshStatus').textContent.includes('Подключение')) {
            document.getElementById('sshStatus').textContent = '❌ Отключено';
        }
    };
}

// === БЛОК 17.17: МАКРОСЫ ===
function runMacro(command) {
    sendData(command);
}

// === БЛОК 17.18: МОДАЛЬНОЕ ОКНО «ДОБАВИТЬ СЕРВЕР» ===
function setAuthType(type) {
    currentAuthType = type;
    const passBtn = document.getElementById('authPasswordBtn');
    const keyBtn = document.getElementById('authKeyBtn');
    const passGroup = document.getElementById('passwordGroup');
    const keyGroup = document.getElementById('keyGroup');
    const passphraseGroup = document.getElementById('passphraseGroup');

    if (type === 'password') {
        passBtn.classList.add('active');
        keyBtn.classList.remove('active');
        passGroup.classList.remove('hidden');
        keyGroup.classList.add('hidden');
        passphraseGroup.classList.add('hidden');
    } else {
        passBtn.classList.remove('active');
        keyBtn.classList.add('active');
        passGroup.classList.add('hidden');
        keyGroup.classList.remove('hidden');
        passphraseGroup.classList.remove('hidden');
    }
}

function openServerModal() {
    document.getElementById('serverModal').classList.add('active');
    ['srvName', 'srvHost', 'srvPass', 'srvKey', 'srvPassphrase'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('srvPort').value = '22';
    document.getElementById('srvUser').value = 'root';
    document.getElementById('srvRegion').value = '';
    document.getElementById('srvCity').value = '';
    document.getElementById('serverError').textContent = '';
    setAuthType('password');
}

function closeServerModal() {
    document.getElementById('serverModal').classList.remove('active');
}

async function saveServer() {
    const data = {
        name: document.getElementById('srvName').value.trim(),
        host: document.getElementById('srvHost').value.trim(),
        port: parseInt(document.getElementById('srvPort').value) || 22,
        username: document.getElementById('srvUser').value.trim(),
        auth_type: currentAuthType,
        region: document.getElementById('srvRegion').value.trim(),
        city: document.getElementById('srvCity').value.trim()
    };

    if (currentAuthType === 'password') {
        data.password = document.getElementById('srvPass').value.trim();
        if (!data.password) {
            document.getElementById('serverError').textContent = 'Пароль обязателен';
            return;
        }
    } else {
        data.private_key = document.getElementById('srvKey').value.trim();
        data.passphrase = document.getElementById('srvPassphrase').value.trim();
        if (!data.private_key) {
            document.getElementById('serverError').textContent = 'Приватный ключ обязателен';
            return;
        }
    }

    if (!data.name || !data.host || !data.username) {
        document.getElementById('serverError').textContent = 'Название, хост и логин обязательны';
        return;
    }

    const result = await api('/api/servers', {
        method: 'POST',
        body: JSON.stringify(data)
    });

    if (result && result.status === 'ok') {
        closeServerModal();
        await loadServers();
    } else {
        document.getElementById('serverError').textContent = result?.detail || 'Ошибка';
    }
}

async function deleteCurrentServer() {
    const id = document.getElementById('deviceSelect').value;
    if (!id) { alert('Выберите сервер для удаления'); return; }
    const device = devices.find(d => d.id == id);
    if (!confirm(`Удалить сервер "${device.name}"?`)) return;

    const result = await api('/api/servers/' + id, { method: 'DELETE' });
    if (result && result.status === 'ok') {
        if (ws) ws.close();
        await loadServers();
    } else {
        alert(result?.detail || 'Ошибка удаления');
    }
}

// === БЛОК 17.19: КАРТА ===
async function loadMap() {
    const servers = await api('/api/servers');
    if (!servers) return;

    const container = document.getElementById('mapContainer');
    container.querySelectorAll('.map-point, .map-point-tooltip').forEach(el => el.remove());

    let placed = 0;
    servers.forEach(s => {
        if (!s.city || !CITY_COORDS[s.city]) return;
        const coords = CITY_COORDS[s.city];

        const point = document.createElement('div');
        point.className = 'map-point green';
        point.style.left = coords.x + '%';
        point.style.top = coords.y + '%';
        point.dataset.id = s.id;

        const tooltip = document.createElement('div');
        tooltip.className = 'map-point-tooltip';
        tooltip.style.left = coords.x + '%';
        tooltip.style.top = coords.y + '%';
        const lock = s.auth_type === 'key' ? '🗝️' : '🔑';
        tooltip.innerHTML = `
            <b>${s.name}</b><br>
            🌐 ${s.host}:${s.port}<br>
            ${lock} ${s.auth_type === 'key' ? 'SSH-ключ' : 'Пароль'}<br>
            📍 ${s.region || '—'}${s.city ? ', ' + s.city : ''}<br>
            🟢 Доступен
        `;

        point.addEventListener('click', () => {
            document.getElementById('deviceSelect').value = point.dataset.id;
            showTab('console');
        });

        container.appendChild(point);
        container.appendChild(tooltip);
        placed++;
    });

    document.getElementById('mapStatus').textContent =
        `На карте: ${placed} из ${servers.length} серверов • Обновлено: ${new Date().toLocaleTimeString()}`;
}

// === БЛОК 17.20: КНОПКИ ШАПКИ ===
function goToAdmin() { window.location.href = '/admin'; }

async function doLogout() {
    await api('/api/logout', { method: 'POST' });
    localStorage.clear();
    window.location.href = '/';
}

// === БЛОК 17.21: СТАРТ ===
window.addEventListener('DOMContentLoaded', () => {
    initTerminal();
    updateModeIndicator();
    loadServers();
});