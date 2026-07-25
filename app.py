import json
import os
import hashlib
import secrets
import threading
import time
from datetime import datetime
from flask import Flask, request, jsonify, send_from_directory, Response

app = Flask(__name__)

DATA_DIR = os.path.dirname(os.path.abspath(__file__))
USERS_FILE = os.path.join(DATA_DIR, 'users.json')
HISTORY_FILE = os.path.join(DATA_DIR, 'history.json')
lock = threading.Lock()

connected_users = {}
waiting_polls = []
chat_history = []

def load_users():
    try:
        with open(USERS_FILE, 'r') as f:
            return json.load(f)
    except:
        return {}

def save_users(users):
    with open(USERS_FILE, 'w') as f:
        json.dump(users, f, ensure_ascii=False)

def load_history():
    global chat_history
    try:
        with open(HISTORY_FILE, 'r') as f:
            chat_history = json.load(f)
    except:
        chat_history = []

def save_history():
    with open(HISTORY_FILE, 'w') as f:
        json.dump(chat_history[-500:], f, ensure_ascii=False)

def hash_pw(pw, salt=None):
    if salt is None:
        salt = secrets.token_hex(16)
    return hashlib.sha256((pw + salt).encode()).hexdigest(), salt

def notify_all(message):
    for poll in waiting_polls[:]:
        try:
            poll.append(message)
        except:
            pass

load_history()

@app.route('/')
def index():
    return send_from_directory(DATA_DIR, 'index.html')

@app.route('/<path:filename>')
def static_file(filename):
    return send_from_directory(DATA_DIR, filename)

@app.route('/api/register', methods=['POST'])
def register():
    data = request.json
    username = data.get('username', '').strip()
    password = data.get('password', '')
    color = data.get('color', '#6366f1')

    if not username or not password:
        return jsonify({'error': '이름과 비밀번호를 입력하세요'}), 400
    if len(username) < 2 or len(username) > 12:
        return jsonify({'error': '이름은 2~12자로 입력하세요'}), 400
    if len(password) < 4:
        return jsonify({'error': '비밀번호는 4자 이상으로 입력하세요'}), 400

    users = load_users()
    if username in users:
        return jsonify({'error': '이미 사용 중인 이름입니다'}), 400

    hashed, salt = hash_pw(password)
    token = secrets.token_hex(32)
    users[username] = {'pw': hashed, 'salt': salt, 'color': color, 'token': token}
    save_users(users)

    return jsonify({'success': True, 'token': token, 'username': username, 'color': color})

@app.route('/api/login', methods=['POST'])
def login():
    data = request.json
    username = data.get('username', '').strip()
    password = data.get('password', '')

    if not username or not password:
        return jsonify({'error': '이름과 비밀번호를 입력하세요'}), 400

    users = load_users()
    if username not in users:
        return jsonify({'error': '존재하지 않는 계정입니다'}), 401

    user = users[username]
    new_hash, _ = hash_pw(password, user['salt'])
    if new_hash != user['pw']:
        return jsonify({'error': '비밀번호가 틀렸습니다'}), 401

    token = secrets.token_hex(32)
    users[username]['token'] = token
    save_users(users)

    return jsonify({'success': True, 'token': token, 'username': username, 'color': user['color']})

@app.route('/api/token-login', methods=['POST'])
def token_login():
    data = request.json
    username = data.get('username', '')
    token = data.get('token', '')
    users = load_users()
    if username in users and users[username]['token'] == token:
        return jsonify({'success': True, 'username': username, 'color': users[username]['color']})
    return jsonify({'error': 'invalid'}), 401

@app.route('/api/join', methods=['POST'])
def join_chat():
    data = request.json
    username = data.get('username', '')
    token = data.get('token', '')
    users = load_users()
    if username not in users or users[username]['token'] != token:
        return jsonify({'error': 'auth'}), 401

    connected_users[username] = {
        'color': users[username]['color'],
        'time': datetime.now().strftime('%H:%M')
    }

    user_list = [{'username': u, 'color': info['color']} for u, info in connected_users.items()]
    notify_all({'type': 'users', 'users': user_list})
    notify_all({'type': 'system', 'text': f'{username}님이 입장했습니다.'})

    return jsonify({'success': True, 'users': user_list, 'history': chat_history[-50:]})

@app.route('/api/leave', methods=['POST'])
def leave_chat():
    data = request.json
    username = data.get('username', '')
    if username in connected_users:
        del connected_users[username]
        user_list = [{'username': u, 'color': info['color']} for u, info in connected_users.items()]
        notify_all({'type': 'users', 'users': user_list})
        notify_all({'type': 'system', 'text': f'{username}님이 퇴장했습니다.'})
    return jsonify({'success': True})

@app.route('/api/send', methods=['POST'])
def send_message():
    data = request.json
    username = data.get('username', '')
    token = data.get('token', '')
    text = data.get('text', '')

    users = load_users()
    if username not in users or users[username]['token'] != token:
        return jsonify({'error': 'auth'}), 401

    msg = {
        'type': 'message',
        'username': username,
        'text': text,
        'time': datetime.now().strftime('%H:%M'),
        'color': connected_users.get(username, {}).get('color', '#6366f1')
    }

    chat_history.append(msg)
    save_history()
    notify_all(msg)

    return jsonify({'success': True})

@app.route('/api/poll')
def poll():
    last_index = int(request.args.get('last', 0))
    result = []
    result_queue = []
    waiting_polls.append(result_queue)

    timeout = time.time() + 30
    while time.time() < timeout:
        if result_queue:
            result.extend(result_queue)
            result_queue.clear()
        if len(chat_history) > last_index:
            result.extend(chat_history[last_index:])
            break
        time.sleep(0.3)

    if result_queue in waiting_polls:
        waiting_polls.remove(result_queue)

    return jsonify({'messages': result, 'total': len(chat_history)})

@app.route('/api/users')
def get_users():
    user_list = [{'username': u, 'color': info['color']} for u, info in connected_users.items()]
    return jsonify({'users': user_list})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8080, debug=False)
