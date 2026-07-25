const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());
app.use(express.static(__dirname));

const USERS_FILE = path.join(__dirname, 'users.json');
const HISTORY_FILE = path.join(__dirname, 'history.json');

let users = {};
let chatHistory = [];
let connectedUsers = {};

function loadUsers() {
    try { users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch { users = {}; }
}

function saveUsers() {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function loadHistory() {
    try { chatHistory = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } catch { chatHistory = []; }
}

function saveHistory() {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(chatHistory.slice(-500)));
}

function hashPw(pw, salt) {
    if (!salt) salt = crypto.randomBytes(16).toString('hex');
    const h = crypto.createHash('sha256').update(pw + salt).digest('hex');
    return { hash: h, salt };
}

function genToken() {
    return crypto.randomBytes(32).toString('hex');
}

loadUsers();
loadHistory();

app.post('/api/register', (req, res) => {
    const { username, password, color } = req.body;
    if (!username || !password) return res.json({ error: '이름과 비밀번호를 입력하세요' });
    if (username.length < 2 || username.length > 12) return res.json({ error: '이름은 2~12자로 입력하세요' });
    if (password.length < 4) return res.json({ error: '비밀번호는 4자 이상으로 입력하세요' });
    if (users[username]) return res.json({ error: '이미 사용 중인 이름입니다' });

    const { hash, salt } = hashPw(password);
    const token = genToken();
    users[username] = { hash, salt, color: color || '#6366f1', token };
    saveUsers();
    res.json({ success: true, token, username, color: users[username].color });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.json({ error: '이름과 비밀번호를 입력하세요' });
    const user = users[username];
    if (!user) return res.json({ error: '존재하지 않는 계정입니다' });
    const { hash } = hashPw(password, user.salt);
    if (hash !== user.hash) return res.json({ error: '비밀번호가 틀렸습니다' });
    user.token = genToken();
    saveUsers();
    res.json({ success: true, token: user.token, username, color: user.color });
});

app.post('/api/token-login', (req, res) => {
    const { username, token } = req.body;
    const user = users[username];
    if (user && user.token === token) {
        return res.json({ success: true, username, color: user.color });
    }
    res.json({ error: 'invalid' });
});

wss.on('connection', (ws) => {
    let myUsername = null;

    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data);

            if (msg.type === 'join') {
                const user = users[msg.username];
                if (!user || user.token !== msg.token) {
                    ws.send(JSON.stringify({ type: 'auth_error' }));
                    return;
                }
                myUsername = msg.username;
                connectedUsers[myUsername] = { color: user.color, ws };

                broadcast({ type: 'user_joined', username: myUsername, users: getUserList() });
                ws.send(JSON.stringify({ type: 'history', messages: chatHistory.slice(-50) }));
            }

            else if (msg.type === 'message' && myUsername) {
                const entry = {
                    type: 'message',
                    username: myUsername,
                    text: msg.text,
                    time: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
                    color: connectedUsers[myUsername]?.color || '#6366f1'
                };
                chatHistory.push(entry);
                saveHistory();
                broadcast(entry);
            }

            else if (msg.type === 'typing' && myUsername) {
                broadcast({ type: 'typing', username: myUsername }, ws);
            }
        } catch (e) {}
    });

    ws.on('close', () => {
        if (myUsername) {
            delete connectedUsers[myUsername];
            broadcast({ type: 'user_left', username: myUsername, users: getUserList() });
        }
    });
});

function broadcast(msg, exclude) {
    const data = JSON.stringify(msg);
    for (const u of Object.values(connectedUsers)) {
        if (u.ws !== exclude && u.ws.readyState === 1) {
            u.ws.send(data);
        }
    }
}

function getUserList() {
    return Object.entries(connectedUsers).map(([name, info]) => ({ username: name, color: info.color }));
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
