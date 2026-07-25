import asyncio
import json
import os
import hashlib
import secrets
from datetime import datetime
from aiohttp import web
import aiohttp

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
USERS_FILE = os.path.join(BASE_DIR, 'users.json')
CHAT_HISTORY_FILE = os.path.join(BASE_DIR, 'chat_history.json')

connected_users = {}
active_sessions = {}

def load_users():
    if os.path.exists(USERS_FILE):
        with open(USERS_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {}

def save_users(users):
    with open(USERS_FILE, 'w', encoding='utf-8') as f:
        json.dump(users, f, ensure_ascii=False, indent=2)

def load_chat_history():
    if os.path.exists(CHAT_HISTORY_FILE):
        with open(CHAT_HISTORY_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    return []

def save_chat_history(history):
    with open(CHAT_HISTORY_FILE, 'w', encoding='utf-8') as f:
        json.dump(history[-200:], f, ensure_ascii=False, indent=2)

def hash_password(password, salt=None):
    if salt is None:
        salt = secrets.token_hex(16)
    hashed = hashlib.sha256((password + salt).encode()).hexdigest()
    return hashed, salt

def verify_password(password, hashed, salt):
    new_hash, _ = hash_password(password, salt)
    return new_hash == hashed

chat_history = load_chat_history()

async def register_handler(request):
    try:
        data = await request.json()
        username = data.get('username', '').strip()
        password = data.get('password', '')
        color = data.get('color', '#6366f1')

        if not username or not password:
            return web.json_response({'error': '이름과 비밀번호를 입력하세요'}, status=400)
        
        if len(username) < 2 or len(username) > 12:
            return web.json_response({'error': '이름은 2~12자로 입력하세요'}, status=400)
        
        if len(password) < 4:
            return web.json_response({'error': '비밀번호는 4자 이상으로 입력하세요'}, status=400)

        users = load_users()
        if username in users:
            return web.json_response({'error': '이미 사용 중인 이름입니다'}, status=400)

        hashed, salt = hash_password(password)
        token = secrets.token_hex(32)

        users[username] = {
            'password_hash': hashed,
            'salt': salt,
            'color': color,
            'token': token,
            'created_at': datetime.now().isoformat()
        }
        save_users(users)

        return web.json_response({
            'success': True,
            'token': token,
            'username': username,
            'color': color
        })
    except Exception as e:
        return web.json_response({'error': str(e)}, status=500)

async def login_handler(request):
    try:
        data = await request.json()
        username = data.get('username', '').strip()
        password = data.get('password', '')

        if not username or not password:
            return web.json_response({'error': '이름과 비밀번호를 입력하세요'}, status=400)

        users = load_users()
        if username not in users:
            return web.json_response({'error': '존재하지 않는 계정입니다'}, status=401)

        user = users[username]
        if not verify_password(password, user['password_hash'], user['salt']):
            return web.json_response({'error': '비밀번호가 틀렸습니다'}, status=401)

        token = secrets.token_hex(32)
        users[username]['token'] = token
        save_users(users)

        return web.json_response({
            'success': True,
            'token': token,
            'username': username,
            'color': user['color']
        })
    except Exception as e:
        return web.json_response({'error': str(e)}, status=500)

async def token_login_handler(request):
    try:
        data = await request.json()
        username = data.get('username', '')
        token = data.get('token', '')

        users = load_users()
        if username in users and users[username]['token'] == token:
            return web.json_response({
                'success': True,
                'username': username,
                'color': users[username]['color']
            })
        return web.json_response({'error': 'invalid'}, status=401)
    except:
        return web.json_response({'error': 'invalid'}, status=401)

async def change_color_handler(request):
    try:
        data = await request.json()
        username = data.get('username', '')
        token = data.get('token', '')
        color = data.get('color', '#6366f1')

        users = load_users()
        if username in users and users[username]['token'] == token:
            users[username]['color'] = color
            save_users(users)
            
            if username in [u['username'] for u in connected_users.values()]:
                for ws, info in connected_users.items():
                    if info['username'] == username:
                        info['color'] = color
                        break
                await broadcast({
                    'type': 'user_color_changed',
                    'username': username,
                    'color': color,
                    'users': [
                        {'username': u['username'], 'color': u['color']}
                        for u in connected_users.values()
                    ]
                })
            
            return web.json_response({'success': True})
        return web.json_response({'error': 'invalid'}, status=401)
    except:
        return web.json_response({'error': 'invalid'}, status=401)

async def websocket_handler(request):
    ws = web.WebSocketResponse()
    await ws.prepare(request)

    print(f"WebSocket connected from {request.remote}")

    try:
        async for msg in ws:
            if msg.type == aiohttp.WSMsgType.TEXT:
                data = json.loads(msg.data)

                if data['type'] == 'join':
                    username = data['username']
                    token = data.get('token', '')
                    
                    users = load_users()
                    if username not in users or users[username]['token'] != token:
                        await ws.send_json({'type': 'auth_error'})
                        continue
                    
                    color = users[username]['color']

                    for existing_ws, info in list(connected_users.items()):
                        if info['username'] == username:
                            del connected_users[existing_ws]

                    connected_users[ws] = {
                        'username': username,
                        'color': color,
                        'joined_at': datetime.now().isoformat()
                    }
                    print(f"{username} joined")

                    await broadcast({
                        'type': 'user_joined',
                        'username': username,
                        'users': [
                            {'username': u['username'], 'color': u['color']}
                            for u in connected_users.values()
                        ]
                    })

                    await ws.send_json({
                        'type': 'history',
                        'messages': chat_history[-50:]
                    })

                elif data['type'] == 'message':
                    if ws not in connected_users:
                        continue
                    username = connected_users[ws]['username']
                    msg_data = {
                        'type': 'message',
                        'username': username,
                        'text': data['text'],
                        'time': datetime.now().strftime('%H:%M'),
                        'color': connected_users[ws]['color']
                    }
                    chat_history.append(msg_data)
                    save_chat_history(chat_history)
                    await broadcast(msg_data)

                elif data['type'] == 'typing':
                    if ws not in connected_users:
                        continue
                    username = connected_users[ws]['username']
                    await broadcast({
                        'type': 'typing',
                        'username': username
                    }, ws)

            elif msg.type == aiohttp.WSMsgType.ERROR:
                print(f'WebSocket error: {ws.exception()}')

    finally:
        if ws in connected_users:
            username = connected_users[ws]['username']
            del connected_users[ws]
            print(f"{username} left")
            await broadcast({
                'type': 'user_left',
                'username': username,
                'users': [
                    {'username': u['username'], 'color': u['color']}
                    for u in connected_users.values()
                ]
            })

    return ws

async def broadcast(message, sender=None):
    for ws in list(connected_users.keys()):
        try:
            await ws.send_json(message)
        except:
            pass

async def index_handler(request):
    return web.FileResponse(os.path.join(BASE_DIR, 'index.html'))

async def static_handler(request):
    filename = request.match_info['filename']
    filepath = os.path.join(BASE_DIR, filename)
    if os.path.exists(filepath):
        return web.FileResponse(filepath)
    return web.Response(status=404)

def create_app():
    app = web.Application()
    app.router.add_get('/', index_handler)
    app.router.add_get('/ws', websocket_handler)
    app.router.add_post('/api/register', register_handler)
    app.router.add_post('/api/login', login_handler)
    app.router.add_post('/api/token-login', token_login_handler)
    app.router.add_post('/api/change-color', change_color_handler)
    app.router.add_get('/{filename}', static_handler)
    return app

if __name__ == '__main__':
    app = create_app()
    port = int(os.environ.get('PORT', 8080))
    print(f"Server running on http://0.0.0.0:{port}")
    web.run_app(app, host='0.0.0.0', port=port)
