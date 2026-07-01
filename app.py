import os
import sqlite3
from flask import Flask, send_from_directory, request
from flask_socketio import SocketIO, emit
from werkzeug.security import generate_password_hash, check_password_hash

app = Flask(__name__, static_folder='public', static_url_path='')
app.config['SECRET_KEY'] = 'secret-key-for-vibechat'
socketio = SocketIO(app, cors_allowed_origins="*", ping_timeout=60, ping_interval=25)

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
    c.execute('''
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sender TEXT NOT NULL,
            target TEXT,
            text TEXT NOT NULL,
            status TEXT DEFAULT 'sent',
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    # Safely handle database schema upgrades for existing installations
    try:
        c.execute("ALTER TABLE messages ADD COLUMN status TEXT DEFAULT 'sent'")
    except sqlite3.OperationalError:
        pass
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

def save_message(sender, target, text, status='sent'):
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute('INSERT INTO messages (sender, target, text, status) VALUES (?, ?, ?, ?)', (sender, target, text, status))
    conn.commit()
    msg_id = c.lastrowid
    conn.close()
    return msg_id

def update_message_status(msg_id, status):
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute('UPDATE messages SET status = ? WHERE id = ?', (status, msg_id))
    conn.commit()
    conn.close()

def mark_incoming_messages_delivered(username):
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("UPDATE messages SET status = 'delivered' WHERE target = ? AND status = 'sent'", (username,))
    conn.commit()
    conn.close()

def get_user_chat_history(username):
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute('''
        SELECT id, sender, target, text, status, timestamp 
        FROM messages 
        WHERE target IS NULL 
           OR sender = ? 
           OR target = ?
        ORDER BY timestamp ASC
    ''', (username, username))
    rows = c.fetchall()
    conn.close()
    
    history = []
    for row in rows:
        history.append({
            'id': row[0],
            'sender': row[1],
            'target': row[2],
            'text': row[3],
            'status': row[4],
            'timestamp': row[5]
        })
    return history

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
    
    # Mark incoming messages to this user as 'delivered'
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("SELECT DISTINCT sender FROM messages WHERE target = ? AND status = 'sent'", (username,))
    pending_senders = [row[0] for row in c.fetchall()]
    conn.close()
    
    mark_incoming_messages_delivered(username)
    
    # Notify active senders that their messages were delivered
    for ps in pending_senders:
        ps_sid = users.get(ps)
        if ps_sid:
            emit('msg_status_update_bulk', {'partner': username, 'status': 'delivered'}, room=ps_sid)
            
    # Get user's chat history (global and private DMs)
    history = get_user_chat_history(username)
    
    # Send join success back to user
    emit('join_success', {'username': username, 'history': history})
    
    # Broadcast the updated users list to everyone
    broadcast_user_list()

@socketio.on('send_msg')
def handle_message(data):
    sender = sid_to_username.get(request.sid)
    text = data.get('text')
    target = data.get('target')  # Username or None for global
    offline_id = data.get('offlineId')
    print(f"DEBUG [send_msg]: sid={request.sid}, sender={sender}, target={target}, text={text}, offlineId={offline_id}")
    
    if not sender:
        print(f"WARNING [send_msg]: Ignored message from unauthenticated SID {request.sid}. Current active sessions: {sid_to_username}")
        return
        
    # Check if target is online to determine initial status
    status = 'sent'
    if target:
        if target in users:
            status = 'delivered'
    else:
        status = 'delivered' # Global messages are always immediately delivered to room
        
    # Save message to database for persistence and get generated row ID
    msg_id = save_message(sender, target, text, status)
    
    msg_payload = {
        'id': msg_id,
        'sender': sender,
        'text': text,
        'target': target,
        'status': status,
        'offlineId': offline_id
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

@socketio.on('mark_read')
def handle_mark_read(data):
    reader = sid_to_username.get(request.sid)
    partner = data.get('partner')
    print(f"DEBUG [mark_read]: reader={reader}, partner={partner}")
    if not reader or not partner:
        return
        
    # Update messages in db to 'read'
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("UPDATE messages SET status = 'read' WHERE sender = ? AND target = ? AND status != 'read'", (partner, reader))
    conn.commit()
    conn.close()
    
    # Notify partner (sender) that their messages have been read
    partner_sid = users.get(partner)
    if partner_sid:
        emit('msg_status_update_bulk', {'partner': reader, 'status': 'read'}, room=partner_sid)

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
