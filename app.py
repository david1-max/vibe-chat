import os
import sqlite3
from flask import Flask, send_from_directory, request
from flask_socketio import SocketIO, emit
from werkzeug.security import generate_password_hash, check_password_hash

app = Flask(__name__, static_folder='public', static_url_path='')
app.config['SECRET_KEY'] = 'secret-key-for-vibechat'
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='gevent', ping_timeout=60, ping_interval=25)

DB_FILE = 'database.db'

def init_db():
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute('PRAGMA journal_mode=WAL;')
    c.execute('''
        CREATE TABLE IF NOT EXISTS users (
            username TEXT PRIMARY KEY,
            password_hash TEXT NOT NULL
        )
    ''')
    conn.commit()
    conn.close()

# Initialize database at module load time
init_db()

def register_user(username, password):
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    try:
        password_hash = generate_password_hash(password)
        c.execute('INSERT INTO users (username, password_hash) VALUES (?, ?)', (username, password_hash))
        conn.commit()
        return True
    except sqlite3.IntegrityError:
        return False
    finally:
        conn.close()

def verify_user(username, password):
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute('SELECT password_hash FROM users WHERE username = ?', (username,))
    row = c.fetchone()
    conn.close()
    if row:
        return check_password_hash(row[0], password)
    return False

def user_exists(username):
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute('SELECT 1 FROM users WHERE username = ?', (username,))
    row = c.fetchone()
    conn.close()
    return row is not None

def get_all_users():
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute('SELECT username FROM users')
    rows = c.fetchall()
    conn.close()
    return [row[0] for row in rows]

def broadcast_user_list():
    all_registered = get_all_users()
    presence_list = []
    for username in all_registered:
        presence_list.append({
            'username': username,
            'online': username in users
        })
    emit('user_list', presence_list, broadcast=True)

# Serve the index.html for the root route
@app.route('/')
def index():
    return send_from_directory(app.static_folder, 'index.html')

# Store connected users: username -> socket.id
# socket.id is request.sid in flask-socketio
users = {}
sid_to_username = {}

@socketio.on('connect')
def handle_connect():
    print(f"DEBUG [connect]: New client session connected. SID: {request.sid}")

@socketio.on('join')
def handle_join(data):
    username = data.get('username')
    password = data.get('password')
    mode = data.get('mode') # 'login' or 'register'
    print(f"DEBUG [join]: Request received. username={username}, mode={mode}, sid={request.sid}")
    
    if not username or not password:
        emit('join_error', {'message': 'Username and password are required.'})
        return
        
    username = username.strip().lower()
    
    # Handle authentication modes
    if mode == 'register':
        if len(password) < 4:
            emit('join_error', {'message': 'Password must be at least 4 characters.'})
            return
        if user_exists(username):
            emit('join_error', {'message': 'Username is already taken.'})
            return
        if not register_user(username, password):
            emit('join_error', {'message': 'Registration failed. Try again.'})
            return
    elif mode == 'login':
        if not user_exists(username):
            emit('join_error', {'message': 'Username does not exist. Register first.'})
            return
        if not verify_user(username, password):
            emit('join_error', {'message': 'Incorrect password.'})
            return
    else:
        emit('join_error', {'message': 'Invalid authentication mode.'})
        return
    
    # Handle duplicate socket sessions for the same logged in user
    if username in users:
        old_sid = users[username]
        print(f"Username {username} re-registered from {old_sid} to {request.sid}")
        if old_sid in sid_to_username:
            del sid_to_username[old_sid]

    users[username] = request.sid
    sid_to_username[request.sid] = username
    print(f"User joined: {username} with SID {request.sid}")
    
    # Send join success back to user
    emit('join_success', {'username': username})
    
    # Broadcast the updated users list to everyone
    broadcast_user_list()

@socketio.on('send_msg')
def handle_message(data):
    sender = sid_to_username.get(request.sid)
    text = data.get('text')
    target = data.get('target')  # Username or None for global
    print(f"DEBUG [send_msg]: sid={request.sid}, sender={sender}, target={target}, text={text}")
    
    if not sender:
        print(f"WARNING [send_msg]: Ignored message from unauthenticated SID {request.sid}. Current active sessions: {sid_to_username}")
        return
    
    msg_payload = {
        'sender': sender,
        'text': text,
        'target': target
    }
    
    if target:
        # Private message: send to target and sender
        target_sid = users.get(target)
        if target_sid:
            emit('receive_msg', msg_payload, room=target_sid)
        emit('receive_msg', msg_payload, room=request.sid)
    else:
        # Global message: broadcast to all
        emit('receive_msg', msg_payload, broadcast=True)

@socketio.on('signal')
def handle_signal(data):
    sender = sid_to_username.get(request.sid)
    if not sender:
        return
        
    target = data.get('target')
    signal_type = data.get('type')  # 'offer', 'answer', 'candidate', 'hangup'
    signal_data = data.get('signalData')
    
    target_sid = users.get(target)
    if target_sid:
        emit('signal', {
            'sender': sender,
            'type': signal_type,
            'signalData': signal_data
        }, room=target_sid)

@socketio.on('disconnect')
def handle_disconnect():
    sid = request.sid
    username = sid_to_username.get(sid)
    if username:
        if users.get(username) == sid:
            del users[username]
        del sid_to_username[sid]
        print(f"DEBUG [disconnect]: Authenticated user disconnected: {username} (SID: {sid})")
        # Broadcast updated user list
        broadcast_user_list()
    else:
        print(f"Unregistered client disconnected: {sid}")

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5000, debug=True, allow_unsafe_werkzeug=True)
