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
    const loginUsername = document.getElementById('loginUsername');
    const loginPassword = document.getElementById('loginPassword');
    const loginBtn = document.getElementById('loginBtn');
    const loginError = document.getElementById('loginError');
    const regUsername = document.getElementById('regUsername');
    const regPassword = document.getElementById('regPassword');
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
    const colorOptions = document.querySelectorAll('.color-option');

    let typingTimeout;
    let selectedColor = '#FF6B6B';

    // Check for saved session
    const saved = localStorage.getItem('chat_session');
    if (saved) {
        try {
            const session = JSON.parse(saved);
            autoLogin(session.username, session.token);
        } catch(e) {
            localStorage.removeItem('chat_session');
        }
    }

    // Color picker
    colorOptions.forEach(option => {
        option.addEventListener('click', function() {
            colorOptions.forEach(o => o.classList.remove('selected'));
            this.classList.add('selected');
            selectedColor = this.dataset.color;
        });
    });

    // Switch forms
    showRegister.addEventListener('click', () => {
        loginForm.style.display = 'none';
        registerForm.style.display = 'block';
        loginError.textContent = '';
    });

    showLogin.addEventListener('click', () => {
        registerForm.style.display = 'none';
        loginForm.style.display = 'block';
        registerError.textContent = '';
    });

    // Login
    async function login(username, password) {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        return await res.json();
    }

    loginBtn.addEventListener('click', async () => {
        const username = loginUsername.value.trim();
        const password = loginPassword.value;
        
        if (!username || !password) {
            loginError.textContent = '이름과 비밀번호를 입력하세요';
            return;
        }

        loginBtn.disabled = true;
        loginBtn.textContent = '로그인 중...';

        const result = await login(username, password);
        
        if (result.success) {
            myUsername = result.username;
            myColor = result.color;
            authToken = result.token;
            
            localStorage.setItem('chat_session', JSON.stringify({
                username: myUsername,
                token: authToken
            }));
            
            enterChat();
        } else {
            loginError.textContent = result.error || '로그인 실패';
        }
        
        loginBtn.disabled = false;
        loginBtn.textContent = '로그인';
    });

    loginPassword.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') loginBtn.click();
    });

    // Register
    async function register(username, password, color) {
        const res = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, color })
        });
        return await res.json();
    }

    registerBtn.addEventListener('click', async () => {
        const username = regUsername.value.trim();
        const password = regPassword.value;
        
        if (!username || !password) {
            registerError.textContent = '이름과 비밀번호를 입력하세요';
            return;
        }

        registerBtn.disabled = true;
        registerBtn.textContent = '가입 중...';

        const result = await register(username, password, selectedColor);
        
        if (result.success) {
            myUsername = result.username;
            myColor = result.color;
            authToken = result.token;
            
            localStorage.setItem('chat_session', JSON.stringify({
                username: myUsername,
                token: authToken
            }));
            
            enterChat();
        } else {
            registerError.textContent = result.error || '가입 실패';
        }
        
        registerBtn.disabled = false;
        registerBtn.textContent = '회원가입';
    });

    // Auto login with saved token
    async function autoLogin(username, token) {
        try {
            const res = await fetch('/api/token-login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, token })
            });
            const result = await res.json();
            
            if (result.success) {
                myUsername = result.username;
                myColor = result.color;
                authToken = token;
                enterChat();
            } else {
                localStorage.removeItem('chat_session');
            }
        } catch(e) {
            localStorage.removeItem('chat_session');
        }
    }

    function enterChat() {
        loginScreen.style.display = 'none';
        appContainer.style.display = 'flex';

        document.getElementById('myName').textContent = myUsername;
        document.getElementById('myAvatar').textContent = myUsername[0];
        document.getElementById('myAvatar').style.background = myColor;

        connectWebSocket();
    }

    // Logout
    logoutBtn.addEventListener('click', () => {
        localStorage.removeItem('chat_session');
        if (ws) ws.close();
        appContainer.style.display = 'none';
        loginScreen.style.display = 'flex';
        loginForm.style.display = 'block';
        registerForm.style.display = 'none';
        chatMessages.innerHTML = '';
        document.getElementById('onlineUsers').innerHTML = '';
        loginUsername.value = '';
        loginPassword.value = '';
    });

    // WebSocket
    function connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        ws = new WebSocket(`${protocol}//${host}/ws`);

        ws.onopen = function() {
            console.log('Connected');
            ws.send(JSON.stringify({
                type: 'join',
                username: myUsername,
                token: authToken
            }));
        };

        ws.onmessage = function(event) {
            const data = JSON.parse(event.data);
            if (data.type === 'auth_error') {
                localStorage.removeItem('chat_session');
                location.reload();
                return;
            }
            handleMessage(data);
        };

        ws.onclose = function() {
            console.log('Disconnected');
            showSystemMessage('서버와 연결이 끊어졌습니다. 3초 후 재연결합니다...');
            setTimeout(connectWebSocket, 3000);
        };

        ws.onerror = function(error) {
            console.error('WebSocket error:', error);
        };
    }

    function handleMessage(data) {
        switch(data.type) {
            case 'message':
                addMessage(data.username, data.text, data.time, data.color);
                break;
            case 'user_joined':
                updateOnlineUsers(data.users);
                showSystemMessage(`${data.username}님이 입장했습니다.`);
                break;
            case 'user_left':
                updateOnlineUsers(data.users);
                showSystemMessage(`${data.username}님이 퇴장했습니다.`);
                break;
            case 'user_color_changed':
                updateOnlineUsers(data.users);
                break;
            case 'typing':
                showTyping(data.username);
                break;
            case 'history':
                chatMessages.innerHTML = '';
                data.messages.forEach(msg => {
                    addMessage(msg.username, msg.text, msg.time, msg.color, true);
                });
                scrollToBottom();
                break;
        }
    }

    function addMessage(username, text, time, color, isHistory = false) {
        const isSent = username === myUsername;
        const initial = username[0];

        const messageHTML = `
            <div class="message ${isSent ? 'sent' : 'received'}">
                ${!isSent ? `<div class="avatar" style="background: ${color};">${initial}</div>` : ''}
                <div class="message-content">
                    ${!isSent ? `<span class="message-sender">${username}</span>` : ''}
                    <div class="message-bubble">${escapeHtml(text)}</div>
                    <span class="message-time">${time}</span>
                </div>
            </div>
        `;

        chatMessages.insertAdjacentHTML('beforeend', messageHTML);
        if (!isHistory) scrollToBottom();
    }

    function showSystemMessage(text) {
        const msgHTML = `<div class="system-message">${text}</div>`;
        chatMessages.insertAdjacentHTML('beforeend', msgHTML);
        scrollToBottom();
    }

    function updateOnlineUsers(users) {
        const userList = document.getElementById('onlineUsers');
        const count = users.length;
        document.getElementById('memberCount').textContent = `${count}명 접속중`;

        userList.innerHTML = users.map(user => `
            <li class="online-user-item">
                <div class="avatar small" style="background: ${user.color};">${user.username[0]}</div>
                <span class="username">${user.username}</span>
                <span class="status-dot online"></span>
            </li>
        `).join('');
    }

    function showTyping(username) {
        const indicator = document.getElementById('typingIndicator');
        const userSpan = document.getElementById('typingUser');
        userSpan.textContent = username;
        indicator.style.display = 'flex';
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
            indicator.style.display = 'none';
        }, 2000);
    }

    // Send message
    function sendMessage() {
        const text = messageInput.value.trim();
        if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;

        ws.send(JSON.stringify({
            type: 'message',
            text: text
        }));

        messageInput.value = '';
    }

    sendBtn.addEventListener('click', sendMessage);
    messageInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') sendMessage();
    });

    // Typing indicator
    let lastTypingSend = 0;
    messageInput.addEventListener('input', function() {
        const now = Date.now();
        if (ws && ws.readyState === WebSocket.OPEN && now - lastTypingSend > 1000) {
            ws.send(JSON.stringify({ type: 'typing' }));
            lastTypingSend = now;
        }
    });

    // Emoji picker
    emojiBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        emojiPicker.classList.toggle('show');
    });

    document.querySelectorAll('.emoji').forEach(emoji => {
        emoji.addEventListener('click', function() {
            messageInput.value += this.dataset.emoji;
            messageInput.focus();
        });
    });

    document.addEventListener('click', function(e) {
        if (!emojiPicker.contains(e.target) && e.target !== emojiBtn) {
            emojiPicker.classList.remove('show');
        }
    });

    // Mobile menu
    menuBtn.addEventListener('click', function() {
        sidebar.classList.toggle('open');
    });

    // Helpers
    function scrollToBottom() {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
});
