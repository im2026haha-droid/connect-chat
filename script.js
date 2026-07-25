let ws;
let myUsername = '';
let myColor = '#6366f1';
let authToken = '';

document.addEventListener('DOMContentLoaded', function() {
    const loginScreen = document.getElementById('loginScreen');
    const appContainer = document.getElementById('appContainer');
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const showRegister = document.getElementById('showRegister');
    const showLogin = document.getElementById('showLogin');
    const loginBtn = document.getElementById('loginBtn');
    const loginError = document.getElementById('loginError');
    const registerBtn = document.getElementById('registerBtn');
    const registerError = document.getElementById('registerError');
    const messageInput = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendBtn');
    const chatMessages = document.getElementById('chatMessages');
    const emojiBtn = document.getElementById('emojiBtn');
    const emojiPicker = document.getElementById('emojiPicker');
    const menuBtn = document.getElementById('menuBtn');
    const sidebar = document.querySelector('.sidebar');
    const logoutBtn = document.getElementById('logoutBtn');
    let selectedColor = '#FF6B6B';
    let typingTimeout;

    const saved = localStorage.getItem('chat_session');
    if (saved) {
        try { const s = JSON.parse(saved); autoLogin(s.username, s.token); } catch(e) { localStorage.removeItem('chat_session'); }
    }

    document.querySelectorAll('.color-option').forEach(opt => {
        opt.addEventListener('click', function() {
            document.querySelectorAll('.color-option').forEach(o => o.classList.remove('selected'));
            this.classList.add('selected');
            selectedColor = this.dataset.color;
        });
    });

    showRegister.addEventListener('click', () => { loginForm.style.display = 'none'; registerForm.style.display = 'block'; loginError.textContent = ''; });
    showLogin.addEventListener('click', () => { registerForm.style.display = 'none'; loginForm.style.display = 'block'; registerError.textContent = ''; });

    async function api(url, data) {
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        return await res.json();
    }

    loginBtn.addEventListener('click', async () => {
        const u = document.getElementById('loginUsername').value.trim();
        const p = document.getElementById('loginPassword').value;
        if (!u || !p) { loginError.textContent = '이름과 비밀번호를 입력하세요'; return; }
        loginBtn.disabled = true; loginBtn.textContent = '로그인 중...';
        const r = await api('/api/login', { username: u, password: p });
        if (r.success) { myUsername = r.username; myColor = r.color; authToken = r.token; localStorage.setItem('chat_session', JSON.stringify({ username: u, token: authToken })); enterChat(); }
        else { loginError.textContent = r.error; }
        loginBtn.disabled = false; loginBtn.textContent = '로그인';
    });
    document.getElementById('loginPassword').addEventListener('keypress', e => { if (e.key === 'Enter') loginBtn.click(); });

    registerBtn.addEventListener('click', async () => {
        const u = document.getElementById('regUsername').value.trim();
        const p = document.getElementById('regPassword').value;
        if (!u || !p) { registerError.textContent = '이름과 비밀번호를 입력하세요'; return; }
        registerBtn.disabled = true; registerBtn.textContent = '가입 중...';
        const r = await api('/api/register', { username: u, password: p, color: selectedColor });
        if (r.success) { myUsername = r.username; myColor = r.color; authToken = r.token; localStorage.setItem('chat_session', JSON.stringify({ username: u, token: authToken })); enterChat(); }
        else { registerError.textContent = r.error; }
        registerBtn.disabled = false; registerBtn.textContent = '회원가입';
    });

    async function autoLogin(username, token) {
        try {
            const r = await api('/api/token-login', { username, token });
            if (r.success) { myUsername = r.username; myColor = r.color; authToken = token; enterChat(); }
            else { localStorage.removeItem('chat_session'); }
        } catch(e) { localStorage.removeItem('chat_session'); }
    }

    function enterChat() {
        loginScreen.style.display = 'none';
        appContainer.style.display = 'flex';
        document.getElementById('myName').textContent = myUsername;
        document.getElementById('myAvatar').textContent = myUsername[0];
        document.getElementById('myAvatar').style.background = myColor;
        connectWS();
    }

    logoutBtn.addEventListener('click', () => {
        localStorage.removeItem('chat_session');
        if (ws) ws.close();
        appContainer.style.display = 'none';
        loginScreen.style.display = 'flex';
        loginForm.style.display = 'block';
        registerForm.style.display = 'none';
        chatMessages.innerHTML = '';
        document.getElementById('onlineUsers').innerHTML = '';
    });

    function connectWS() {
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        ws = new WebSocket(`${proto}//${location.host}`);

        ws.onopen = () => {
            ws.send(JSON.stringify({ type: 'join', username: myUsername, token: authToken }));
        };

        ws.onmessage = (e) => {
            const data = JSON.parse(e.data);
            if (data.type === 'auth_error') { localStorage.removeItem('chat_session'); location.reload(); return; }
            handleMessage(data);
        };

        ws.onclose = () => {
            showSystem('연결 끊어짐. 3초 후 재연결...');
            setTimeout(connectWS, 3000);
        };
    }

    function handleMessage(data) {
        switch(data.type) {
            case 'message': addMessage(data.username, data.text, data.time, data.color); break;
            case 'user_joined': updateUsers(data.users); showSystem(`${data.username}님이 입장했습니다.`); break;
            case 'user_left': updateUsers(data.users); showSystem(`${data.username}님이 퇴장했습니다.`); break;
            case 'typing': showTyping(data.username); break;
            case 'history': data.messages.forEach(m => addMessage(m.username, m.text, m.time, m.color, true)); scrollToBottom(); break;
        }
    }

    function addMessage(username, text, time, color, isHistory = false) {
        const isSent = username === myUsername;
        chatMessages.insertAdjacentHTML('beforeend', `
            <div class="message ${isSent ? 'sent' : 'received'}">
                ${!isSent ? `<div class="avatar" style="background:${color};">${username[0]}</div>` : ''}
                <div class="message-content">
                    ${!isSent ? `<span class="message-sender">${username}</span>` : ''}
                    <div class="message-bubble">${escapeHtml(text)}</div>
                    <span class="message-time">${time}</span>
                </div>
            </div>`);
        if (!isHistory) scrollToBottom();
    }

    function showSystem(text) {
        chatMessages.insertAdjacentHTML('beforeend', `<div class="system-message">${text}</div>`);
        scrollToBottom();
    }

    function updateUsers(users) {
        document.getElementById('memberCount').textContent = `${users.length}명 접속중`;
        document.getElementById('onlineUsers').innerHTML = users.map(u =>
            `<li class="online-user-item"><div class="avatar small" style="background:${u.color};">${u.username[0]}</div><span class="username">${u.username}</span><span class="status-dot online"></span></li>`
        ).join('');
    }

    function showTyping(username) {
        const indicator = document.getElementById('typingIndicator');
        if (!indicator) return;
        document.getElementById('typingUser').textContent = username;
        indicator.style.display = 'flex';
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => { indicator.style.display = 'none'; }, 2000);
    }

    function sendMessage() {
        const text = messageInput.value.trim();
        if (!text || !ws || ws.readyState !== 1) return;
        ws.send(JSON.stringify({ type: 'message', text }));
        messageInput.value = '';
    }

    sendBtn.addEventListener('click', sendMessage);
    messageInput.addEventListener('keypress', e => { if (e.key === 'Enter') sendMessage(); });

    emojiBtn.addEventListener('click', e => { e.stopPropagation(); emojiPicker.classList.toggle('show'); });
    document.querySelectorAll('.emoji').forEach(em => {
        em.addEventListener('click', () => { messageInput.value += em.dataset.emoji; messageInput.focus(); });
    });
    document.addEventListener('click', e => {
        if (!emojiPicker.contains(e.target) && e.target !== emojiBtn) emojiPicker.classList.remove('show');
    });
    menuBtn.addEventListener('click', () => sidebar.classList.toggle('open'));

    document.addEventListener('click', e => {
        if (window.innerWidth <= 900 && sidebar.classList.contains('open') && !sidebar.contains(e.target) && e.target !== menuBtn) {
            sidebar.classList.remove('open');
        }
    });

    sendBtn.addEventListener('click', () => {
        if (window.innerWidth <= 900) sidebar.classList.remove('open');
    });

    messageInput.addEventListener('keypress', e => {
        if (e.key === 'Enter' && window.innerWidth <= 900) sidebar.classList.remove('open');
    });

    function scrollToBottom() { chatMessages.scrollTop = chatMessages.scrollHeight; }
    function escapeHtml(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }
});
