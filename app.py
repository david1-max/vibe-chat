import os
from flask import Flask, send_from_directory, request
from flask_socketio import SocketIO, emit

app = Flask(__name__, static_folder='public', static_url_path='')
app.config['SECRET_KEY'] = 'secret-key-for-vibechat'
socketio = SocketIO(app, cors_allowed_origins="*")

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
    print(f"Client connected: {request.sid}")

@socketio.on('join')
def handle_join(data):
    username = data.get('username')
    if not username:
        return
    
    # Handle duplicate usernames gracefully
    if username in users:
        # We can append a small number or just let them take over the username
        # Let's let them take over, but log it
        old_sid = users[username]
        print(f"Username {username} re-registered from {old_sid} to {request.sid}")
        # Remove old sid mapping
        if old_sid in sid_to_username:
            del sid_to_username[old_sid]

    users[username] = request.sid
    sid_to_username[request.sid] = username
    print(f"User joined: {username} with SID {request.sid}")
    
    # Broadcast the updated users list to everyone
    emit('user_list', list(users.keys()), broadcast=True)
    
    # Send join success back to user
    emit('join_success', {'username': username})

@socketio.on('send_msg')
def handle_message(data):
    sender = sid_to_username.get(request.sid)
    if not sender:
        return
        
    text = data.get('text')
    target = data.get('target')  # Username or None for global
    
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
        print(f"User disconnected: {username}")
        # Broadcast updated user list
        emit('user_list', list(users.keys()), broadcast=True)
    else:
        print(f"Unregistered client disconnected: {sid}")

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5000, debug=True, allow_unsafe_werkzeug=True)
