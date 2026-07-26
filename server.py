import asyncio
import json
import hashlib
import os
import sys
import secrets
import webbrowser
from datetime import datetime
from pathlib import Path

from aiohttp import web

try:
    import websockets
except ImportError:
    websockets = None

BASE_DIR = Path(sys.executable).parent if getattr(sys, 'frozen', False) else Path(__file__).parent

if getattr(sys, 'frozen', False):
    BUNDLE_DIR = Path(sys._MEIPASS)
else:
    BUNDLE_DIR = BASE_DIR

USERS_FILE = BASE_DIR / 'users.json'
HISTORY_FILE = BASE_DIR / 'history.json'

users = {}
chat_history = []
connected_users = {}


def load_users():
    global users
    try:
        users = json.loads(USERS_FILE.read_text(encoding='utf-8'))
    except Exception:
        users = {}


def save_users():
    USERS_FILE.write_text(json.dumps(users, indent=2, ensure_ascii=False), encoding='utf-8')


def load_history():
    global chat_history
    try:
        chat_history = json.loads(HISTORY_FILE.read_text(encoding='utf-8'))
    except Exception:
        chat_history = []


def save_history():
    HISTORY_FILE.write_text(json.dumps(chat_history[-500:], ensure_ascii=False), encoding='utf-8')


def hash_pw(pw, salt=None):
    if not salt:
        salt = secrets.token_hex(16)
    h = hashlib.sha256((pw + salt).encode()).hexdigest()
    return h, salt


def gen_token():
    return secrets.token_hex(32)


def user_list():
    return [{"username": name, "color": info["color"]} for name, info in connected_users.items()]


async def handle_register(request):
    data = await request.json()
    username = data.get('username', '').strip()
    password = data.get('password', '')
    color = data.get('color', '#6366f1')
    if not username or not password:
        return web.json_response({'error': '이름과 비밀번호를 입력하세요'})
    if len(username) < 2 or len(username) > 12:
        return web.json_response({'error': '이름은 2~12자로 입력하세요'})
    if len(password) < 4:
        return web.json_response({'error': '비밀번호는 4자 이상으로 입력하세요'})
    if username in users:
        return web.json_response({'error': '이미 사용 중인 이름입니다'})
    h, salt = hash_pw(password)
    token = gen_token()
    users[username] = {'hash': h, 'salt': salt, 'color': color, 'token': token}
    save_users()
    return web.json_response({'success': True, 'token': token, 'username': username, 'color': color})


async def handle_login(request):
    data = await request.json()
    username = data.get('username', '').strip()
    password = data.get('password', '')
    if not username or not password:
        return web.json_response({'error': '이름과 비밀번호를 입력하세요'})
    user = users.get(username)
    if not user:
        return web.json_response({'error': '존재하지 않는 계정입니다'})
    h, _ = hash_pw(password, user['salt'])
    if h != user['hash']:
        return web.json_response({'error': '비밀번호가 틀렸습니다'})
    token = gen_token()
    user['token'] = token
    save_users()
    return web.json_response({'success': True, 'token': token, 'username': username, 'color': user['color']})


async def handle_token_login(request):
    data = await request.json()
    username = data.get('username', '')
    token = data.get('token', '')
    user = users.get(username)
    if user and user['token'] == token:
        return web.json_response({'success': True, 'username': username, 'color': user['color']})
    return web.json_response({'error': 'invalid'})


async def websocket_handler(request):
    ws = web.WebSocketResponse()
    await ws.prepare(request)

    my_username = None

    try:
        async for msg_str in ws:
            if msg_str.type == web.WSMsgType.TEXT:
                try:
                    msg = json.loads(msg_str.data)
                except Exception:
                    continue

                if msg.get('type') == 'join':
                    username = msg.get('username', '')
                    token = msg.get('token', '')
                    user = users.get(username)
                    if not user or user['token'] != token:
                        await ws.send_json({'type': 'auth_error'})
                        continue
                    my_username = username
                    connected_users[my_username] = {'color': user['color'], 'ws': ws}
                    await broadcast({'type': 'user_joined', 'username': my_username, 'users': user_list()})
                    await ws.send_json({'type': 'history', 'messages': chat_history[-50:]})

                elif msg.get('type') == 'message' and my_username:
                    now = datetime.now()
                    time_str = now.strftime('%p %I:%M').replace('AM', '오전').replace('PM', '오후')
                    entry = {
                        'type': 'message',
                        'username': my_username,
                        'text': msg.get('text', ''),
                        'time': time_str,
                        'color': connected_users.get(my_username, {}).get('color', '#6366f1')
                    }
                    chat_history.append(entry)
                    save_history()
                    await broadcast(entry)

                elif msg.get('type') == 'typing' and my_username:
                    await broadcast({'type': 'typing', 'username': my_username}, exclude=ws)

                elif msg.get('type') == 'call_offer' and my_username:
                    print(f"[SIGNAL] {my_username} -> {msg.get('to')}: call_offer")
                    target = connected_users.get(msg.get('to'))
                    print(f"[SIGNAL] Target {msg.get('to')} online: {target is not None}")
                    await send_to(msg.get('to'), {'type': 'call_offer', 'from': my_username, 'offer': msg.get('offer'), 'isVideo': msg.get('isVideo')})

                elif msg.get('type') == 'call_answer' and my_username:
                    print(f"[SIGNAL] {my_username} -> {msg.get('to')}: call_answer")
                    await send_to(msg.get('to'), {'type': 'call_answer', 'from': my_username, 'answer': msg.get('answer')})

                elif msg.get('type') == 'call_reject' and my_username:
                    print(f"[SIGNAL] {my_username} -> {msg.get('to')}: call_reject")
                    await send_to(msg.get('to'), {'type': 'call_reject', 'from': my_username})

                elif msg.get('type') == 'call_end' and my_username:
                    print(f"[SIGNAL] {my_username} -> {msg.get('to')}: call_end")
                    await send_to(msg.get('to'), {'type': 'call_end', 'from': my_username})

                elif msg.get('type') == 'ice_candidate' and my_username:
                    await send_to(msg.get('to'), {'type': 'ice_candidate', 'from': my_username, 'candidate': msg.get('candidate')})

    except Exception as e:
        print(f"WebSocket error: {e}")
    finally:
        if my_username and my_username in connected_users:
            del connected_users[my_username]
            await broadcast({'type': 'user_left', 'username': my_username, 'users': user_list()})

    return ws


async def send_to(username, msg):
    info = connected_users.get(username)
    if info:
        try:
            await info['ws'].send_json(msg)
        except Exception:
            pass


async def broadcast(msg, exclude=None):
    data = json.dumps(msg, ensure_ascii=False)
    for info in list(connected_users.values()):
        if info['ws'] != exclude:
            try:
                await info['ws'].send_str(data)
            except Exception:
                pass


def get_local_ip():
    import socket
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return '127.0.0.1'


async def static_handler(request):
    filename = request.match_info.get('filename', '')
    if not filename or filename == 'index.html':
        fp = BUNDLE_DIR / 'index.html' if (BUNDLE_DIR / 'index.html').exists() else BASE_DIR / 'index.html'
    else:
        fp = BUNDLE_DIR / filename if (BUNDLE_DIR / filename).exists() else BASE_DIR / filename
    if fp.exists():
        ct = 'text/html'
        if filename.endswith('.css'): ct = 'text/css'
        elif filename.endswith('.js'): ct = 'application/javascript'
        return web.Response(text=fp.read_text(encoding='utf-8'), content_type=ct)
    return web.Response(status=404)


def main():
    load_users()
    load_history()

    app = web.Application()
    app.router.add_post('/api/register', handle_register)
    app.router.add_post('/api/login', handle_login)
    app.router.add_post('/api/token-login', handle_token_login)

    for f in ['index.html', 'style.css', 'script.js']:
        bundle_path = BUNDLE_DIR / f
        local_path = BASE_DIR / f
        if bundle_path.exists() and not local_path.exists():
            import shutil
            shutil.copy2(bundle_path, local_path)

    app.router.add_get('/ws', websocket_handler)
    app.router.add_get('/', lambda r: web.FileResponse(BUNDLE_DIR / 'index.html' if (BUNDLE_DIR / 'index.html').exists() else BASE_DIR / 'index.html'))
    app.router.add_get('/{filename}', static_handler)

    port = int(os.environ.get('PORT', 3000))
    local_ip = get_local_ip()

    print("=" * 50)
    print("  Connect Chat 서버")
    print("=" * 50)
    print(f"  로컬 접속: http://localhost:{port}")
    print(f"  같은 네트워크: http://{local_ip}:{port}")
    print(f"  인터넷 접속: 라우터에서 포트 {port} 포워딩 후")
    print(f"               http://<공인IP>:{port}")
    print("=" * 50)
    print("  종료: Ctrl+C")
    print("=" * 50)

    web.run_app(app, host='0.0.0.0', port=port, print=None)


if __name__ == '__main__':
    main()
