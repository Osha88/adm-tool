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

// === БЛОК 17.4: ГОРОДА ПО СТРАНАМ ===
const CITIES_BY_COUNTRY = {
    'Россия': {
        'Центральный': ['Москва', 'Воронеж', 'Ярославль', 'Рязань', 'Тула', 'Курск', 'Липецк', 'Тверь', 'Смоленск', 'Брянск', 'Владимир', 'Иваново'],
        'Северо-Западный': ['Санкт-Петербург', 'Калининград', 'Мурманск', 'Архангельск', 'Череповец', 'Псков', 'Великий Новгород', 'Вологда', 'Петрозаводск', 'Сыктывкар'],
        'Южный': ['Краснодар', 'Ростов-на-Дону', 'Волгоград', 'Сочи', 'Новороссийск', 'Астрахань', 'Таганрог', 'Майкоп', 'Элиста'],
        'Северо-Кавказский': ['Ставрополь', 'Владикавказ', 'Махачкала', 'Пятигорск', 'Нальчик', 'Черкесск', 'Магас', 'Грозный'],
        'Приволжский': ['Казань', 'Нижний Новгород', 'Самара', 'Уфа', 'Пермь', 'Ижевск', 'Оренбург', 'Пенза', 'Киров', 'Чебоксары', 'Саранск', 'Йошкар-Ола', 'Ульяновск', 'Саратов', 'Тольятти'],
        'Уральский': ['Екатеринбург', 'Челябинск', 'Тюмень', 'Курган', 'Сургут', 'Магнитогорск', 'Нижний Тагил', 'Новый Уренгой', 'Ноябрьск'],
        'Сибирский': ['Новосибирск', 'Красноярск', 'Омск', 'Барнаул', 'Иркутск', 'Кемерово', 'Новокузнецк', 'Томск', 'Абакан', 'Горно-Алтайск'],
        'Дальневосточный': ['Хабаровск', 'Владивосток', 'Якутск', 'Улан-Удэ', 'Чита', 'Комсомольск-на-Амуре', 'Находка', 'Благовещенск', 'Южно-Сахалинск', 'Магадан', 'Петропавловск-Камчатский']
    },
    'Литва': ['Вильнюс', 'Каунас'],
    'Латвия': ['Рига', 'Даугавпилс'],
    'Эстония': ['Таллин', 'Тарту'],
    'Беларусь': ['Минск', 'Гомель'],
    'Украина': ['Киев', 'Харьков'],
    'Казахстан': ['Астана', 'Алматы'],
    'Грузия': ['Тбилиси', 'Батуми'],
    'Армения': ['Ереван', 'Гюмри'],
    'Азербайджан': ['Баку', 'Гянджа'],
    'Узбекистан': ['Ташкент', 'Самарканд'],
    'Германия': ['Берлин', 'Франкфурт', 'Мюнхен'],
    'Нидерланды': ['Амстердам', 'Роттердам'],
    'Великобритания': ['Лондон', 'Манчестер'],
    'Франция': ['Париж', 'Марсель'],
    'США': ['Нью-Йорк', 'Лос-Анджелес', 'Чикаго', 'Даллас'],
    'Китай': ['Пекин', 'Шанхай'],
    'Япония': ['Токио', 'Осака']
};

// === БЛОК 17.5: КООРДИНАТЫ ГОРОДОВ ===
const CITY_COORDS = {
    // === РОССИЯ: ЦЕНТРАЛЬНЫЙ ===
    'Москва': { x: 17, y: 42 },
    'Воронеж': { x: 20, y: 48 },
    'Ярославль': { x: 19, y: 37 },
    'Рязань': { x: 20, y: 43 },
    'Тула': { x: 18, y: 44 },
    'Курск': { x: 20, y: 47 },
    'Липецк': { x: 21, y: 46 },
    'Тверь': { x: 17, y: 38 },
    'Смоленск': { x: 14, y: 40 },
    'Брянск': { x: 17, y: 47 },
    'Владимир': { x: 21, y: 40 },
    'Иваново': { x: 22, y: 39 },

    // === РОССИЯ: СЕВЕРО-ЗАПАДНЫЙ ===
    'Санкт-Петербург': { x: 14, y: 30 },
    'Калининград': { x: 6, y: 32 },
    'Мурманск': { x: 20, y: 15 },
    'Архангельск': { x: 23, y: 22 },
    'Череповец': { x: 19, y: 33 },
    'Псков': { x: 13, y: 35 },
    'Великий Новгород': { x: 15, y: 32 },
    'Вологда': { x: 21, y: 33 },
    'Петрозаводск': { x: 17, y: 24 },
    'Сыктывкар': { x: 27, y: 25 },

    // === РОССИЯ: ЮЖНЫЙ ===
    'Краснодар': { x: 17, y: 55 },
    'Ростов-на-Дону': { x: 19, y: 52 },
    'Волгоград': { x: 23, y: 50 },
    'Сочи': { x: 17, y: 57 },
    'Новороссийск': { x: 16, y: 56 },
    'Астрахань': { x: 28, y: 51 },
    'Таганрог': { x: 20, y: 53 },
    'Майкоп': { x: 18, y: 55 },
    'Элиста': { x: 24, y: 52 },

    // === РОССИЯ: СЕВЕРО-КАВКАЗСКИЙ ===
    'Ставрополь': { x: 21, y: 53 },
    'Владикавказ': { x: 24, y: 55 },
    'Махачкала': { x: 26, y: 57 },
    'Пятигорск': { x: 22, y: 54 },
    'Нальчик': { x: 23, y: 55 },
    'Черкесск': { x: 21, y: 55 },
    'Магас': { x: 25, y: 56 },
    'Грозный': { x: 25, y: 57 },

    // === РОССИЯ: ПРИВОЛЖСКИЙ ===
    'Казань': { x: 24, y: 44 },
    'Нижний Новгород': { x: 22, y: 40 },
    'Самара': { x: 27, y: 47 },
    'Уфа': { x: 29, y: 43 },
    'Пермь': { x: 28, y: 39 },
    'Ижевск': { x: 27, y: 41 },
    'Оренбург': { x: 31, y: 48 },
    'Пенза': { x: 24, y: 47 },
    'Киров': { x: 26, y: 36 },
    'Чебоксары': { x: 24, y: 42 },
    'Саранск': { x: 24, y: 46 },
    'Йошкар-Ола': { x: 25, y: 41 },
    'Ульяновск': { x: 25, y: 45 },
    'Саратов': { x: 25, y: 49 },
    'Тольятти': { x: 26, y: 47 },

    // === РОССИЯ: УРАЛЬСКИЙ ===
    'Екатеринбург': { x: 33, y: 40 },
    'Челябинск': { x: 33, y: 44 },
    'Тюмень': { x: 35, y: 38 },
    'Курган': { x: 35, y: 42 },
    'Сургут': { x: 42, y: 32 },
    'Магнитогорск': { x: 32, y: 45 },
    'Нижний Тагил': { x: 31, y: 38 },
    'Новый Уренгой': { x: 46, y: 22 },
    'Ноябрьск': { x: 45, y: 27 },

    // === РОССИЯ: СИБИРСКИЙ ===
    'Новосибирск': { x: 44, y: 42 },
    'Красноярск': { x: 53, y: 42 },
    'Омск': { x: 41, y: 42 },
    'Барнаул': { x: 45, y: 45 },
    'Иркутск': { x: 60, y: 45 },
    'Кемерово': { x: 47, y: 42 },
    'Новокузнецк': { x: 47, y: 44 },
    'Томск': { x: 46, y: 39 },
    'Абакан': { x: 50, y: 47 },
    'Горно-Алтайск': { x: 46, y: 48 },

    // === РОССИЯ: ДАЛЬНЕВОСТОЧНЫЙ ===
    'Хабаровск': { x: 80, y: 48 },
    'Владивосток': { x: 84, y: 55 },
    'Якутск': { x: 75, y: 30 },
    'Улан-Удэ': { x: 65, y: 47 },
    'Чита': { x: 70, y: 45 },
    'Комсомольск-на-Амуре': { x: 82, y: 44 },
    'Находка': { x: 85, y: 56 },
    'Благовещенск': { x: 79, y: 42 },
    'Южно-Сахалинск': { x: 88, y: 42 },
    'Магадан': { x: 90, y: 22 },
    'Петропавловск-Камчатский': { x: 95, y: 30 },

    // === ЗАРУБЕЖЬЕ: ПРИБАЛТИКА ===
    'Вильнюс': { x: 12, y: 32 },
    'Каунас': { x: 12, y: 33 },
    'Рига': { x: 12, y: 29 },
    'Даугавпилс': { x: 13, y: 30 },
    'Таллин': { x: 12, y: 26 },
    'Тарту': { x: 13, y: 27 },

    // === ЗАРУБЕЖЬЕ: СНГ ===
    'Минск': { x: 11, y: 35 },
    'Гомель': { x: 12, y: 38 },
    'Киев': { x: 13, y: 42 },
    'Харьков': { x: 15, y: 42 },
    'Астана': { x: 36, y: 38 },
    'Алматы': { x: 42, y: 48 },
    'Тбилиси': { x: 27, y: 50 },
    'Батуми': { x: 26, y: 52 },
    'Ереван': { x: 28, y: 52 },
    'Гюмри': { x: 27, y: 51 },
    'Баку': { x: 30, y: 50 },
    'Гянджа': { x: 29, y: 49 },
    'Ташкент': { x: 38, y: 48 },
    'Самарканд': { x: 38, y: 50 },

    // === ЗАРУБЕЖЬЕ: ЕВРОПА ===
    'Берлин': { x: 9, y: 28 },
    'Франкфурт': { x: 8, y: 30 },
    'Мюнхен': { x: 9, y: 32 },
    'Амстердам': { x: 7, y: 27 },
    'Роттердам': { x: 7, y: 28 },
    'Лондон': { x: 5, y: 28 },
    'Манчестер': { x: 5, y: 26 },
    'Париж': { x: 6, y: 30 },
    'Марсель': { x: 7, y: 33 },

    // === ЗАРУБЕЖЬЕ: США ===
    'Нью-Йорк': { x: -12, y: 33 },
    'Лос-Анджелес': { x: -22, y: 38 },
    'Чикаго': { x: -16, y: 33 },
    'Даллас': { x: -18, y: 40 },

    // === ЗАРУБЕЖЬЕ: АЗИЯ ===
    'Пекин': { x: 88, y: 38 },
    'Шанхай': { x: 90, y: 42 },
    'Токио': { x: 98, y: 38 },
    'Осака': { x: 97, y: 40 }
};

// === БЛОК 17.6: API-ХЕЛПЕР ===
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

// === БЛОК 17.7: ПЕРЕКЛЮЧЕНИЕ ВКЛАДОК ===
function showTab(name) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.getElementById('tab-' + name).classList.add('active');
    document.getElementById('panel-' + name).classList.add('active');
    if (name === 'map') loadMap();
    if (name === 'console' && fitAddon) setTimeout(() => fitAddon.fit(), 50);
}

// === БЛОК 17.8: ИНИЦИАЛИЗАЦИЯ ТЕРМИНАЛА ===
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

// === БЛОК 17.9: ОБРАБОТКА ВВОДА ===
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
    if (data === '\t') { handleTabCompletion(); return; }
    if (data === '\x1b[A') { handleHistoryUp(); return; }
    if (data === '\x1b[B') { handleHistoryDown(); return; }
    if (data.length === 1 && data >= ' ') currentLine += data;
    sendData(data);
}

// === БЛОК 17.10: ИСТОРИЯ ===
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

// === БЛОК 17.11: TAB ===
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

// === БЛОК 17.12: ОТПРАВКА ===
function sendData(data) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'data', payload: data }));
}
function sendResize() {
    if (!ws || ws.readyState !== WebSocket.OPEN || !term) return;
    ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
}

// === БЛОК 17.13: РЕЖИМ ===
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

// === БЛОК 17.14: ИНТЕРАКТИВ ===
function checkInteractiveSequences(text) {
    if (text.includes('\x1b[?1049h')) {
        if (!interactiveActive) {
            interactiveActive = true;
            if (termMode === 'mine') { termMode = 'native'; updateModeIndicator(); }
        }
    }
    if (text.includes('\x1b[?1049l')) {
        if (interactiveActive) {
            interactiveActive = false;
            if (termMode === 'native') { termMode = 'mine'; updateModeIndicator(); }
        }
    }
}

// === БЛОК 17.15: МАРШРУТ ===
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
}

// === БЛОК 17.16: ЗАГРУЗКА СЕРВЕРОВ ===
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

// === БЛОК 17.17: ПОДКЛЮЧЕНИЕ ===
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

// === БЛОК 17.18: МАКРОСЫ ===
function runMacro(command) { sendData(command); }

// === БЛОК 17.19: ФОРМА — СТРАНА / РЕГИОН / ГОРОД ===
function onCountryChange() {
    const country = document.getElementById('srvCountry').value;
    const regionGroup = document.getElementById('regionGroup');
    const regionSelect = document.getElementById('srvRegion');
    const citySelect = document.getElementById('srvCity');

    citySelect.innerHTML = '<option value="">— Не указан —</option>';

    if (country === 'Россия') {
        regionGroup.classList.remove('hidden');
        regionSelect.value = '';
        updateCityByRegion();
    } else {
        regionGroup.classList.add('hidden');
        const cities = CITIES_BY_COUNTRY[country] || [];
        cities.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c;
            opt.textContent = c;
            citySelect.appendChild(opt);
        });
    }
}

function updateCityByRegion() {
    const country = document.getElementById('srvCountry').value;
    const region = document.getElementById('srvRegion').value;
    const citySelect = document.getElementById('srvCity');
    citySelect.innerHTML = '<option value="">— Не указан —</option>';
    if (country === 'Россия' && region && CITIES_BY_COUNTRY['Россия'][region]) {
        CITIES_BY_COUNTRY['Россия'][region].forEach(c => {
            const opt = document.createElement('option');
            opt.value = c;
            opt.textContent = c;
            citySelect.appendChild(opt);
        });
    }
}

// === БЛОК 17.20: АУТЕНТИФИКАЦИЯ ===
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
    document.getElementById('srvCountry').value = 'Россия';
    document.getElementById('srvRegion').value = '';
    document.getElementById('srvCity').value = '';
    document.getElementById('serverError').textContent = '';
    setAuthType('password');
    onCountryChange();
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
        country: document.getElementById('srvCountry').value,
        region: document.getElementById('srvRegion').value.trim(),
        city: document.getElementById('srvCity').value.trim()
    };

    if (currentAuthType === 'password') {
        data.password = document.getElementById('srvPass').value.trim();
        if (!data.password) { document.getElementById('serverError').textContent = 'Пароль обязателен'; return; }
    } else {
        data.private_key = document.getElementById('srvKey').value.trim();
        data.passphrase = document.getElementById('srvPassphrase').value.trim();
        if (!data.private_key) { document.getElementById('serverError').textContent = 'Приватный ключ обязателен'; return; }
    }

    if (!data.name || !data.host || !data.username) {
        document.getElementById('serverError').textContent = 'Название, хост и логин обязательны';
        return;
    }

    const result = await api('/api/servers', { method: 'POST', body: JSON.stringify(data) });
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

// === БЛОК 17.21: КАРТА (ПАНЕЛЬ + ТОЧКИ) ===
async function loadMap() {
    const servers = await api('/api/servers');
    if (!servers) return;

    const panel = document.getElementById('serverPanel');
    const container = document.getElementById('mapContainer');
    panel.innerHTML = '';
    container.querySelectorAll('.map-point, .map-point-label, .map-point-tooltip').forEach(el => el.remove());

    if (servers.length === 0) {
        panel.innerHTML = '<div class="server-panel-empty">Серверов нет</div>';
        return;
    }

    // Группировка по странам
    const byCountry = {};
    servers.forEach(s => {
        const country = s.country || 'Россия';
        if (!byCountry[country]) byCountry[country] = [];
        byCountry[country].push(s);
    });

    let placed = 0;

    // Заполняем панель слева
    Object.keys(byCountry).sort().forEach(country => {
        const group = document.createElement('div');
        group.className = 'server-group';
        group.innerHTML = `<div class="server-group-title">${getFlag(country)} ${country}</div>`;
        panel.appendChild(group);

        byCountry[country].forEach(s => {
            const card = document.createElement('div');
            card.className = 'server-card';
            card.innerHTML = `
                <span class="dot green"></span>
                <div class="server-card-body">
                    <div class="server-card-name">${s.name}</div>
                    <div class="server-card-info">IP: ${s.host}</div>
                    <div class="server-card-info">PORT: ${s.port}</div>
                    <div class="server-card-info">CITY: ${s.city || '—'}</div>
                </div>
            `;
            panel.appendChild(card);
        });
    });

    // Точки на карте — только для российских городов
    servers.forEach(s => {
        if (s.country && s.country !== 'Россия') return;
        if (!s.city || !CITY_COORDS[s.city]) return;
        const coords = CITY_COORDS[s.city];
        if (coords.x < 0) return;

        const point = document.createElement('div');
        point.className = 'map-point green';
        point.style.left = coords.x + '%';
        point.style.top = coords.y + '%';

        const label = document.createElement('div');
        label.className = 'map-point-label';
        label.style.left = coords.x + '%';
        label.style.top = coords.y + '%';
        label.textContent = s.name;

        container.appendChild(point);
        container.appendChild(label);
        placed++;
    });

    document.getElementById('mapStatus').textContent =
        `На карте: ${placed} из ${servers.length} серверов • ${new Date().toLocaleTimeString()}`;
}

function getFlag(country) {
    const flags = {
        'Россия': '🇷🇺', 'Литва': '🇱🇹', 'Латвия': '🇱🇻', 'Эстония': '🇪🇪',
        'Беларусь': '🇧🇾', 'Украина': '🇺🇦', 'Казахстан': '🇰🇿', 'Грузия': '🇬🇪',
        'Армения': '🇦🇲', 'Азербайджан': '🇦🇿', 'Узбекистан': '🇺🇿',
        'Германия': '🇩🇪', 'Нидерланды': '🇳🇱', 'Великобритания': '🇬🇧',
        'Франция': '🇫🇷', 'США': '🇺🇸', 'Китай': '🇨🇳', 'Япония': '🇯🇵'
    };
    return flags[country] || '🌍';
}

// === БЛОК 17.22: КНОПКИ ШАПКИ ===
function goToAdmin() { window.location.href = '/admin'; }
async function doLogout() {
    await api('/api/logout', { method: 'POST' });
    localStorage.clear();
    window.location.href = '/';
}

// === БЛОК 17.23: СТАРТ ===
window.addEventListener('DOMContentLoaded', () => {
    initTerminal();
    updateModeIndicator();
    loadServers();
    onCountryChange();
});