let ws;
let myUsername = '';
let myColor = '#6366f1';
let authToken = '';

let localStream = null;
let remoteStream = null;
let peerConnection = null;
let callTarget = null;
let isVideoCall = false;
let isMuted = false;
let isVideoOff = false;
let connectionFailedTimer = null;

const ICE_SERVERS = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
        { urls: 'stun:stun.ekiga.net' },
        { urls: 'stun:stun.ideasip.com' },
        { urls: 'stun:stun.schlund.de' },
        { urls: 'stun:stun.voiparound.com' },
        { urls: 'stun:stun.voipstunt.com' },
        { urls: 'stun:stun.services.mozilla.com' },
    ],
    iceCandidatePoolSize: 10
};

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
        endCall();
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
            case 'call_offer': handleCallOffer(data); break;
            case 'call_answer': handleCallAnswer(data); break;
            case 'call_reject': handleCallReject(data); break;
            case 'call_end': handleCallEnd(data); break;
            case 'ice_candidate': handleIceCandidate(data); break;
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
        document.getElementById('onlineUsers').innerHTML = users.filter(u => u.username !== myUsername).map(u =>
            `<li class="online-user-item" data-user="${u.username}">
                <div class="avatar small" style="background:${u.color};">${u.username[0]}</div>
                <span class="username">${u.username}</span>
                <button class="call-user-btn" data-user="${u.username}" title="통화">📞</button>
            </li>`
        ).join('');

        document.querySelectorAll('.call-user-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                startCall(btn.dataset.user, false);
            });
        });

        document.querySelectorAll('.online-user-item').forEach(item => {
            item.addEventListener('dblclick', () => {
                startCall(item.dataset.user, true);
            });
        });
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

    // ========== WebRTC Call Logic ==========

    let callTimeout = null;
    let pendingCandidates = [];
    let offerData = null;

    function clearCallTimeout() {
        if (callTimeout) { clearTimeout(callTimeout); callTimeout = null; }
    }

    async function getMedia(video) {
        try {
            const constraints = { audio: true };
            if (video) constraints.video = { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' };
            localStream = await navigator.mediaDevices.getUserMedia(constraints);
            document.getElementById('localVideo').srcObject = localStream;
            return localStream;
        } catch (err) {
            console.error('Media error:', err);
            if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                showSystem('마이크 권한이 거부되었습니다. 브라우저 설정에서 마이크 권한을 허용해주세요.');
            } else if (err.name === 'NotFoundError') {
                showSystem('마이크를 찾을 수 없습니다.');
            } else {
                showSystem('카메라/마이크 접근 권한이 필요합니다: ' + err.message);
            }
            return null;
        }
    }

    function createPeerConnection() {
        const pc = new RTCPeerConnection(ICE_SERVERS);
        if (localStream) {
            localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
        }
        remoteStream = new MediaStream();
        document.getElementById('remoteVideo').srcObject = remoteStream;
        document.getElementById('remoteAudio').srcObject = remoteStream;

        pc.ontrack = (event) => {
            event.streams[0].getTracks().forEach(track => {
                remoteStream.addTrack(track);
                if (track.kind === 'audio') {
                    document.getElementById('remoteAudio').srcObject = remoteStream;
                    document.getElementById('remoteAudio').play().catch(() => {});
                }
                if (track.kind === 'video') {
                    document.getElementById('remoteVideo').srcObject = remoteStream;
                }
            });
        };

        pc.onicecandidate = (event) => {
            if (event.candidate && ws && ws.readyState === WebSocket.OPEN && callTarget) {
                ws.send(JSON.stringify({ type: 'ice_candidate', to: callTarget, candidate: event.candidate.toJSON() }));
            }
        };

        pc.onconnectionstatechange = () => {
            if (!pc) return;
            const state = pc.connectionState;
            const statusEl = document.getElementById('callStatus');
            if (state === 'connected') {
                statusEl.textContent = '통화 중...';
                if (connectionFailedTimer) { clearTimeout(connectionFailedTimer); connectionFailedTimer = null; }
            } else if (state === 'failed') {
                if (!connectionFailedTimer) {
                    connectionFailedTimer = setTimeout(() => {
                        endCall();
                        showSystem('통화 연결에 실패했습니다. 네트워크를 확인해주세요.');
                        connectionFailedTimer = null;
                    }, 3000);
                }
            } else if (state === 'disconnected') {
                statusEl.textContent = '연결 끊어짐...';
            } else {
                statusEl.textContent = '연결 중...';
            }
        };

        return pc;
    }

    async function drainPendingCandidates() {
        if (!peerConnection || !peerConnection.remoteDescription) return;
        while (pendingCandidates.length > 0) {
            const c = pendingCandidates.shift();
            try {
                await peerConnection.addIceCandidate(c);
            } catch (e) {
                console.error('ICE candidate error:', e);
            }
        }
    }

    async function startCall(username, video) {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            showSystem('서버 연결이 끊어져 있습니다.');
            return;
        }
        if (peerConnection) {
            showSystem('이미 통화 중입니다.');
            return;
        }

        callTarget = username;
        isVideoCall = video;
        pendingCandidates = [];

        document.getElementById('callAvatar').textContent = username[0];
        document.getElementById('callName').textContent = username;
        document.getElementById('callStatus').textContent = '연결 중...';
        document.getElementById('callModal').style.display = 'flex';
        document.getElementById('remoteVideo').style.display = video ? 'block' : 'none';
        document.getElementById('localVideo').style.display = video ? 'block' : 'none';

        const stream = await getMedia(video);
        if (!stream) { endCall(); return; }

        peerConnection = createPeerConnection();

        try {
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            ws.send(JSON.stringify({
                type: 'call_offer',
                to: callTarget,
                offer: peerConnection.localDescription.toJSON(),
                isVideo: video
            }));
        } catch (err) {
            console.error('Offer error:', err);
            showSystem('통화 연결에 실패했습니다.');
            endCall();
            return;
        }

        callTimeout = setTimeout(() => {
            if (peerConnection) {
                showSystem('상대가 응답하지 않습니다.');
                if (callTarget) ws.send(JSON.stringify({ type: 'call_end', to: callTarget }));
                endCall();
            }
        }, 30000);
    }

    async function handleCallOffer(data) {
        if (peerConnection) {
            ws.send(JSON.stringify({ type: 'call_reject', to: data.from }));
            return;
        }

        callTarget = data.from;
        isVideoCall = data.isVideo;
        offerData = data;
        pendingCandidates = [];

        document.getElementById('incomingAvatar').textContent = data.from[0];
        document.getElementById('incomingName').textContent = data.from;
        document.getElementById('incomingCallModal').style.display = 'flex';

        clearCallTimeout();
        callTimeout = setTimeout(() => {
            document.getElementById('incomingCallModal').style.display = 'none';
            showSystem('통화 요청 시간이 초과되었습니다.');
            callTarget = null;
            offerData = null;
        }, 20000);

        document.getElementById('callAccept').onclick = async () => {
            clearCallTimeout();
            document.getElementById('incomingCallModal').style.display = 'none';

            const stream = await getMedia(data.isVideo);
            if (!stream) { callTarget = null; offerData = null; return; }

            peerConnection = createPeerConnection();

            try {
                await peerConnection.setRemoteDescription(data.offer);
                const answer = await peerConnection.createAnswer();
                await peerConnection.setLocalDescription(answer);
                ws.send(JSON.stringify({
                    type: 'call_answer',
                    to: callTarget,
                    answer: peerConnection.localDescription.toJSON()
                }));
            } catch (err) {
                console.error('Answer error:', err);
                showSystem('통화 연결에 실패했습니다.');
                endCall();
                return;
            }

            await drainPendingCandidates();

            document.getElementById('callAvatar').textContent = data.from[0];
            document.getElementById('callName').textContent = data.from;
            document.getElementById('callStatus').textContent = '연결 중...';
            document.getElementById('callModal').style.display = 'flex';
            document.getElementById('remoteVideo').style.display = data.isVideo ? 'block' : 'none';
            document.getElementById('localVideo').style.display = data.isVideo ? 'block' : 'none';
            offerData = null;
        };

        document.getElementById('callReject').onclick = () => {
            clearCallTimeout();
            document.getElementById('incomingCallModal').style.display = 'none';
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'call_reject', to: callTarget }));
            }
            callTarget = null;
            offerData = null;
        };
    }

    async function handleCallAnswer(data) {
        if (peerConnection) {
            clearCallTimeout();
            try {
                await peerConnection.setRemoteDescription(data.answer);
                document.getElementById('callStatus').textContent = '연결 중...';
                await drainPendingCandidates();
            } catch (err) {
                console.error('setRemoteDescription error:', err);
                showSystem('통화 연결에 실패했습니다.');
                endCall();
            }
        }
    }

    function handleCallReject(data) {
        showSystem(`${data.from}님이 통화를 거절했습니다.`);
        endCall();
    }

    function handleCallEnd() {
        clearCallTimeout();
        endCall();
    }

    async function handleIceCandidate(data) {
        if (!data.candidate) return;
        const candidate = data.candidate;
        if (peerConnection && peerConnection.remoteDescription) {
            try {
                await peerConnection.addIceCandidate(candidate);
            } catch (e) {
                console.error('ICE add error:', e);
            }
        } else {
            pendingCandidates.push(candidate);
        }
    }

    function endCall() {
        clearCallTimeout();
        if (connectionFailedTimer) { clearTimeout(connectionFailedTimer); connectionFailedTimer = null; }
        pendingCandidates = [];
        offerData = null;
        if (peerConnection) {
            peerConnection.close();
            peerConnection = null;
        }
        if (localStream) {
            localStream.getTracks().forEach(t => t.stop());
            localStream = null;
        }
        if (remoteStream) {
            remoteStream.getTracks().forEach(t => t.stop());
            remoteStream = null;
        }
        document.getElementById('localVideo').srcObject = null;
        document.getElementById('remoteVideo').srcObject = null;
        document.getElementById('remoteAudio').srcObject = null;
        document.getElementById('callModal').style.display = 'none';
        document.getElementById('remoteVideo').style.display = 'block';
        isMuted = false;
        isVideoOff = false;
        callTarget = null;
    }

    document.getElementById('callEnd').addEventListener('click', () => {
        if (callTarget) {
            ws.send(JSON.stringify({ type: 'call_end', to: callTarget }));
        }
        endCall();
    });

    document.getElementById('callMute').addEventListener('click', function() {
        if (localStream) {
            const audioTrack = localStream.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.enabled = !audioTrack.enabled;
                isMuted = !audioTrack.enabled;
                this.classList.toggle('active', isMuted);
            }
        }
    });

    document.getElementById('callVideoToggle').addEventListener('click', function() {
        if (localStream) {
            const videoTrack = localStream.getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.enabled = !videoTrack.enabled;
                isVideoOff = !videoTrack.enabled;
                this.classList.toggle('active', isVideoOff);
            }
        }
    });

    function scrollToBottom() { chatMessages.scrollTop = chatMessages.scrollHeight; }
    function escapeHtml(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }
});
