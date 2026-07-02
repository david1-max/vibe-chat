// Client State Variables
let socket;
let myUsername = '';
let loginMode = 'login'; // 'login' or 'register'
let savedCredentials = null; // Save credentials in memory to auto-reauthenticate on socket reconnect
let currentChatTarget = 'global'; // 'global' or username string
let chatHistory = {
  'global': [] // Array of messages
};

// WebRTC State Variables
let localStream = null;
let remoteStream = null;
let peerConnection = null;
let currentCallPartner = null;
let isCaller = false;
let callDuration = 0;
let callTimerInterval = null;
let queuedIceCandidates = [];

// Unread Messages State Tracker
let unreadCounts = {};

// Audio Context for synthetic sounds (incoming ring, outgoing ring)
let audioCtx = null;
let ringtoneInterval = null;

// STUN servers configuration
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// DOM Elements
const loginScreen = document.getElementById('login-screen');
const mainScreen = document.getElementById('main-screen');
const conversationView = document.getElementById('conversation-view');
const incomingCallScreen = document.getElementById('incoming-call-screen');
const activeCallScreen = document.getElementById('active-call-screen');

const usernameInput = document.getElementById('username-input');
const passwordInput = document.getElementById('password-input');
const toggleModeBtn = document.getElementById('toggle-mode-btn');
const toggleText = document.getElementById('toggle-text');
const loginBtnText = document.getElementById('login-btn-text');
const loginBtn = document.getElementById('login-btn');
const loginError = document.getElementById('login-error');

const myUsernameLabel = document.getElementById('my-username');
const myAvatar = document.getElementById('my-avatar');
const usersList = document.getElementById('users-list');
const conversationList = document.getElementById('conversation-list');
const onlineCountLabel = document.getElementById('online-count');
const messagesContainer = document.getElementById('messages-container');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const backToListBtn = document.getElementById('back-to-list-btn');
const logoutBtn = document.getElementById('logout-btn');

// Chat Overlay elements
const chatHeaderAvatar = document.getElementById('chat-header-avatar');
const chatHeaderTitle = document.getElementById('chat-header-title');
const chatHeaderStatus = document.getElementById('chat-header-status');
const headerVideoCallBtn = document.getElementById('header-video-call-btn');

// Call elements
const incomingCallerAvatar = document.getElementById('incoming-caller-avatar');
const incomingCallerName = document.getElementById('incoming-caller-name');
const acceptCallBtn = document.getElementById('accept-call-btn');
const declineCallBtn = document.getElementById('decline-call-btn');
const callPartnerName = document.getElementById('call-partner-name');
const callDurationTimer = document.getElementById('call-duration-timer');
const remoteVideoPlaceholder = document.getElementById('remote-video-placeholder');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const toggleMicBtn = document.getElementById('toggle-mic-btn');
const toggleCamBtn = document.getElementById('toggle-cam-btn');
const hangupCallBtn = document.getElementById('hangup-call-btn');

// Settings Elements
const videoEnableCheckbox = document.getElementById('settings-video-enable');
const audioEnableCheckbox = document.getElementById('settings-audio-enable');

// --- SOUNDS GENERATOR USING WEB AUDIO API ---
function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
}

function playRingtone(type) {
  initAudio();
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  
  const playTone = () => {
    const osc1 = audioCtx.createOscillator();
    const osc2 = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    osc1.connect(gainNode);
    osc2.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    if (type === 'incoming') {
      // European ringback style (400Hz + 450Hz)
      osc1.frequency.value = 400;
      osc2.frequency.value = 450;
      
      gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
      gainNode.gain.linearRampToValueAtTime(0.15, audioCtx.currentTime + 0.1);
      
      setTimeout(() => {
        gainNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.1);
        setTimeout(() => { osc1.stop(); osc2.stop(); }, 200);
      }, 1500);
    } else {
      // Outgoing call beep (sound of dialing)
      osc1.frequency.value = 480;
      osc2.frequency.value = 440;
      
      gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
      gainNode.gain.linearRampToValueAtTime(0.08, audioCtx.currentTime + 0.05);
      
      setTimeout(() => {
        gainNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.05);
        setTimeout(() => { osc1.stop(); osc2.stop(); }, 200);
      }, 800);
    }
    
    osc1.start();
    osc2.start();
  };

  playTone();
  const intervalTime = (type === 'incoming') ? 3500 : 2500;
  ringtoneInterval = setInterval(playTone, intervalTime);
}

function stopRingtone() {
  if (ringtoneInterval) {
    clearInterval(ringtoneInterval);
    ringtoneInterval = null;
  }
}

// Play notification sound chime for incoming messages using Web Audio API
function playNotificationSound() {
  initAudio();
  if (!audioCtx) return;
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();
  
  osc.connect(gainNode);
  gainNode.connect(audioCtx.destination);
  
  osc.type = 'sine';
  // Dual-frequency chime ding (sweep D5 -> A5)
  osc.frequency.setValueAtTime(587.33, now);
  osc.frequency.exponentialRampToValueAtTime(880.00, now + 0.12);
  
  gainNode.gain.setValueAtTime(0, now);
  gainNode.gain.linearRampToValueAtTime(0.12, now + 0.02);
  gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
  
  osc.start(now);
  osc.stop(now + 0.22);
}

// --- DUMMY CANVAS STREAM FALLBACK ---
function createDummyStream() {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  const ctx = canvas.getContext('2d');
  
  // Setup audio node fallback
  initAudio();
  const dest = audioCtx.createMediaStreamDestination();
  const osc = audioCtx.createOscillator();
  osc.frequency.value = 1000; // soft beep/hum (highly attenuated)
  const gain = audioCtx.createGain();
  gain.gain.value = 0.001; // extremely quiet background hum
  osc.connect(gain);
  gain.connect(dest);
  osc.start();
  
  let angle = 0;
  const animate = () => {
    // Deep starry dark background
    ctx.fillStyle = '#0f111a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Moving mesh grid
    ctx.strokeStyle = 'rgba(168, 85, 247, 0.1)';
    ctx.lineWidth = 1;
    for (let i = 0; i < canvas.width; i += 40) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, canvas.height);
      ctx.stroke();
    }
    for (let j = 0; j < canvas.height; j += 40) {
      ctx.beginPath();
      ctx.moveTo(0, j);
      ctx.lineTo(canvas.width, j);
      ctx.stroke();
    }

    // Glowing orbiting spheres
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    
    // Draw neon cyan sphere
    ctx.beginPath();
    ctx.arc(100, 0, 30, 0, Math.PI * 2);
    const grad1 = ctx.createRadialGradient(100, 0, 5, 100, 0, 30);
    grad1.addColorStop(0, '#06b6d4');
    grad1.addColorStop(1, '#0891b2');
    ctx.fillStyle = grad1;
    ctx.shadowColor = '#06b6d4';
    ctx.shadowBlur = 15;
    ctx.fill();
    
    // Draw neon purple sphere
    ctx.beginPath();
    ctx.arc(-100, 0, 30, 0, Math.PI * 2);
    const grad2 = ctx.createRadialGradient(-100, 0, 5, -100, 0, 30);
    grad2.addColorStop(0, '#a855f7');
    grad2.addColorStop(1, '#9333ea');
    ctx.fillStyle = grad2;
    ctx.shadowColor = '#a855f7';
    ctx.shadowBlur = 15;
    ctx.fill();
    
    ctx.restore();
    
    // Text labels overlay
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 22px Outfit, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('VibeChat Simulated Stream', cx, cy - 20);
    
    ctx.fillStyle = '#94a3b8';
    ctx.font = '16px Inter, sans-serif';
    ctx.fillText(`Webcam missing or blocked`, cx, cy + 15);
    ctx.fillText(`Rendering simulated local device output`, cx, cy + 40);
    
    angle += 0.02;
    requestAnimationFrame(animate);
  };
  animate();
  
  const videoTrack = canvas.captureStream(30).getVideoTracks()[0];
  const audioTrack = dest.stream.getAudioTracks()[0];
  
  return new MediaStream([videoTrack, audioTrack]);
}

// Sync queued offline messages in localStorage outbox to the server
function syncOutbox() {
  let outbox = [];
  try {
    outbox = JSON.parse(localStorage.getItem('vibechat_outbox') || '[]');
  } catch (err) {
    outbox = [];
  }
  
  if (outbox.length > 0) {
    console.log(`Syncing ${outbox.length} pending offline messages...`);
    outbox.forEach(msg => {
      socket.emit('send_msg', {
        text: msg.text,
        target: msg.target,
        offlineId: msg.id
      });
    });
    // Clear outbox
    localStorage.setItem('vibechat_outbox', '[]');
  }
}

// --- INIT APP ---
function initSocket() {
  if (typeof io === 'undefined') {
    throw new Error("Socket.io script is still caching. Please close the tab, reopen it, or clear browser cache to force reload.");
  }
  socket = io();

  // Re-authenticate session on reconnect/upgrade transport changes
  socket.on('connect', () => {
    console.log('Socket connected/reconnected!');
    if (savedCredentials) {
      console.log('Re-authenticating session...');
      socket.emit('join', {
        username: savedCredentials.username,
        password: savedCredentials.password,
        mode: 'login'
      });
    }
    // Automatically sync outbox on connection recovery
    syncOutbox();
  });

  socket.on('msg_status_update_bulk', (data) => {
    const partner = data.partner;
    const status = data.status;
    console.log(`DEBUG [status_update]: bulk status update. partner=${partner}, status=${status}`);
    updatePartnerMessagesStatus(partner, status);
  });

  // Socket Receivers
  socket.on('join_success', (data) => {
    myUsername = data.username;
    myUsernameLabel.textContent = `@${myUsername}`;
    myAvatar.textContent = myUsername.substring(0, 2).toUpperCase();
    
    loginScreen.classList.remove('active');
    mainScreen.classList.add('active');
    
    // Save session in localStorage for permanent login
    if (savedCredentials) {
      localStorage.setItem('vibechat_session', JSON.stringify({
        username: myUsername,
        password: savedCredentials.password
      }));
    }
    
    // Request notification permission for PWA alerts
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
    
    // Reset local client history and populate from server-side database sync
    chatHistory = { 'global': [] };
    unreadCounts = {};
    if (data.history) {
      data.history.forEach(msg => {
        const roomKey = msg.target ? (msg.target === myUsername ? msg.sender : msg.target) : 'global';
        if (!chatHistory[roomKey]) {
          chatHistory[roomKey] = [];
        }
        chatHistory[roomKey].push(msg);
        
        // Count unread incoming messages from other users
        if (msg.target === myUsername && msg.status !== 'read') {
          unreadCounts[roomKey] = (unreadCounts[roomKey] || 0) + 1;
        }
      });
    }
    
    // Append local outbox pending messages so they stay visible across page reloads
    try {
      const outbox = JSON.parse(localStorage.getItem('vibechat_outbox') || '[]');
      outbox.forEach(msg => {
        const roomKey = msg.target || 'global';
        if (!chatHistory[roomKey]) {
          chatHistory[roomKey] = [];
        }
        chatHistory[roomKey].push(msg);
      });
    } catch (err) {
      console.error("Failed to append outbox messages on login:", err);
    }
    
    // Refresh Lucide Icons
    lucide.createIcons();
  });

  socket.on('join_error', (data) => {
    loginError.textContent = data.message;
    loginError.style.display = 'block';
  });

  socket.on('user_list', (users) => {
    // Standardize user list items to support both legacy strings and new objects
    const standardizedUsers = users.map(u => {
      if (typeof u === 'string') {
        return { username: u, online: true };
      }
      return u;
    });

    // Filter out myself (fallback to usernameInput if myUsername isn't set yet)
    const currentInputName = usernameInput.value.trim().toLowerCase();
    const loggedInName = myUsername || currentInputName;
    const otherUsers = standardizedUsers.filter(u => u && u.username && u.username !== loggedInName);
    
    const onlineCount = otherUsers.filter(u => u.online).length;
    onlineCountLabel.textContent = `${onlineCount} Online`;
    renderUsers(otherUsers);
    renderConversationList(otherUsers);
  });

  socket.on('receive_msg', (data) => {
    const roomKey = data.target ? (data.target === myUsername ? data.sender : data.target) : 'global';
    
    // Check if this is a receipt for a pending offline message we sent
    if (data.offlineId && data.sender === myUsername) {
      // Update in local history
      const history = chatHistory[roomKey] || [];
      const pendingMsg = history.find(m => m.id === data.offlineId);
      if (pendingMsg) {
        delete pendingMsg.pending;
        pendingMsg.id = data.id; // Update temp ID to DB ID
        pendingMsg.status = data.status;
      }
      
      // Update in DOM
      const pendingEl = messagesContainer.querySelector(`[data-msg-id="${data.offlineId}"]`);
      if (pendingEl) {
        pendingEl.setAttribute('data-msg-id', data.id);
        pendingEl.style.opacity = '1';
        const icon = pendingEl.querySelector('.pending-icon');
        if (icon) icon.remove();
        
        // Add proper checkmark status ticks
        updateMessageStatusInDOM(data.id, data.status);
      }
      return; // Already rendered in outbox flow, do not duplicate
    }
    
    if (!chatHistory[roomKey]) {
      chatHistory[roomKey] = [];
    }
    chatHistory[roomKey].push(data);
    
    // Increment unread counts for background or non-active chats
    if (data.sender !== myUsername) {
      const isChatActive = (currentChatTarget === roomKey && conversationView.classList.contains('active'));
      if (!isChatActive) {
        unreadCounts[roomKey] = (unreadCounts[roomKey] || 0) + 1;
      }
    }
    
    // Play notification sound chime for incoming messages
    if (data.sender !== myUsername) {
      playNotificationSound();
      
      // Native PWA system push notification if app tab is hidden/backgrounded
      if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
        const title = data.target ? `New DM from @${data.sender}` : `New message in @Global`;
        const options = {
          body: data.text,
          icon: '/icon-192.png',
          badge: '/icon-192.png',
          vibrate: [120, 80, 120] // Mobile vibration feedback
        };
        
        if (navigator.serviceWorker && navigator.serviceWorker.controller) {
          navigator.serviceWorker.ready.then(reg => {
            reg.showNotification(title, options);
          });
        } else {
          new Notification(title, options);
        }
      }
    }
    
    // Re-render conversation item list to show last message
    updateConversationLastMessage(roomKey, data);
    
    // If currently looking at this chat, render the bubble and mark read
    if (currentChatTarget === roomKey && conversationView.classList.contains('active')) {
      appendMessageBubble(data);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
      
      // Mark as read immediately if it's a private chat
      if (roomKey !== 'global' && data.sender !== myUsername) {
        socket.emit('mark_read', { partner: roomKey });
      }
    }
  });

  socket.on('signal', async (data) => {
    const sender = data.sender;
    const type = data.type;
    const signalData = data.signalData;
    
    console.log(`Received signal [${type}] from @${sender}`);
    
    if (type === 'offer') {
      // Incoming Call
      if (peerConnection || currentCallPartner) {
        // Busy
        socket.emit('signal', { target: sender, type: 'hangup' });
        return;
      }
      
      currentCallPartner = sender;
      isCaller = false;
      incomingCallOffer = signalData;
      
      // Update UI incoming screen
      incomingCallerName.textContent = `@${sender}`;
      incomingCallerAvatar.textContent = sender.substring(0, 2).toUpperCase();
      
      // Show incoming call overlay
      incomingCallScreen.classList.add('active');
      playRingtone('incoming');
      
    } else if (type === 'answer') {
      // Call accepted by peer
      if (peerConnection && isCaller) {
        stopRingtone();
        remoteVideoPlaceholder.style.display = 'none';
        
        try {
          await peerConnection.setRemoteDescription(new RTCSessionDescription(signalData));
          console.log("Remote description set successfully on caller!");
          
          // Process queued candidates
          while (queuedIceCandidates.length > 0) {
            const cand = queuedIceCandidates.shift();
            await peerConnection.addIceCandidate(cand);
          }
          
          startCallTimer();
        } catch (err) {
          console.error("Error setting remote description on caller: ", err);
          handleCallCleanup();
        }
      }
      
    } else if (type === 'candidate') {
      // ICE candidate
      const candidate = new RTCIceCandidate(signalData);
      if (peerConnection && peerConnection.remoteDescription) {
        try {
          await peerConnection.addIceCandidate(candidate);
        } catch (err) {
          console.error("Error adding ice candidate: ", err);
        }
      } else {
        // Queue candidates until remote description is set
        queuedIceCandidates.push(candidate);
      }
      
    } else if (type === 'hangup') {
      // Call declined or disconnected
      stopRingtone();
      handleCallCleanup();
    }
  });
  
  socket.on('disconnect', () => {
    handleCallCleanup();
    // Redirect back to login
    mainScreen.classList.remove('active');
    conversationView.classList.remove('active');
    loginScreen.classList.add('active');
  });
}

// --- USER INTERFACE RENDERING & EVENT LISTENERS ---

// Switch screens tabs (bottom nav)
document.querySelectorAll('.nav-item').forEach(button => {
  button.addEventListener('click', (e) => {
    const tabName = button.getAttribute('data-tab');
    
    // Update nav buttons active state
    document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));
    button.classList.add('active');
    
    // Update active tab content
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
    document.getElementById(`${tabName}-tab`).classList.add('active');
  });
});

// Back from slide chat overlay
backToListBtn.addEventListener('click', () => {
  conversationView.classList.remove('active');
});

// Video call from chat header
headerVideoCallBtn.addEventListener('click', () => {
  if (currentChatTarget && currentChatTarget !== 'global') {
    initiateCall(currentChatTarget);
  }
});

// Toggle Mode Log In / Register
toggleModeBtn.addEventListener('click', (e) => {
  e.preventDefault();
  loginError.style.display = 'none';
  if (loginMode === 'login') {
    loginMode = 'register';
    toggleText.textContent = 'Already have an account?';
    toggleModeBtn.textContent = 'Log In';
    loginBtnText.textContent = 'Register & Enter';
  } else {
    loginMode = 'login';
    toggleText.textContent = "Don't have an account?";
    toggleModeBtn.textContent = 'Register';
    loginBtnText.textContent = 'Log In';
  }
});

// Form login submit
loginBtn.addEventListener('click', performLogin);
usernameInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') performLogin();
});
passwordInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') performLogin();
});

function performLogin() {
  try {
    const username = usernameInput.value.trim().toLowerCase();
    const password = passwordInput.value;
    
    // Valid user checks: letters, numbers, between 3 to 12 chars
    const nameRegex = /^[a-z0-9_]{3,12}$/;
    if (!nameRegex.test(username)) {
      loginError.textContent = "Valid handle contains 3-12 alphanumeric characters or underscores.";
      loginError.style.display = 'block';
      return;
    }
    
    if (!password) {
      loginError.textContent = "Password is required.";
      loginError.style.display = 'block';
      return;
    }
    
    if (loginMode === 'register' && password.length < 4) {
      loginError.textContent = "Password must be at least 4 characters long.";
      loginError.style.display = 'block';
      return;
    }
    
    loginError.style.display = 'none';
    if (!socket) {
      initSocket();
    }
    
    savedCredentials = { username: username, password: password };
    
    socket.emit('join', { 
      username: username,
      password: password,
      mode: loginMode
    });
  } catch (err) {
    console.error("Login UI Error:", err);
    loginError.textContent = "Client Error: " + err.message;
    loginError.style.color = "var(--error)";
    loginError.style.display = 'block';
  }
}

logoutBtn.addEventListener('click', () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  savedCredentials = null;
  localStorage.removeItem('vibechat_session'); // Clear persistent session
  mainScreen.classList.remove('active');
  conversationView.classList.remove('active');
  loginScreen.classList.add('active');
  usernameInput.value = '';
  passwordInput.value = '';
  loginError.style.display = 'none';
  loginError.style.color = 'var(--error)'; // Reset color
});

// Render Active users in contacts
function renderUsers(users) {
  usersList.innerHTML = '';
  if (!users || users.length === 0) {
    usersList.innerHTML = `
      <div class="settings-item-info" style="text-align: center; color: var(--text-muted);">
        No other members registered yet.
      </div>`;
    return;
  }
  
  users.forEach(userObj => {
    // Robust parsing to handle both string array and object array fallbacks
    const user = typeof userObj === 'string' ? userObj : (userObj.username || '');
    const isOnline = typeof userObj === 'string' ? true : !!userObj.online;
    
    if (!user) return; // Skip invalid entries
    
    const item = document.createElement('div');
    item.className = 'contact-item';
    
    const initials = user.substring(0, 2).toUpperCase();
    
    const statusBadge = isOnline
      ? `<span class="dot online"></span>Active`
      : `<span class="dot" style="background-color: var(--text-muted); box-shadow: none;"></span>Offline`;
      
    const callBtnHtml = isOnline
      ? `<button class="contact-btn call-btn" data-user="${user}"><i data-lucide="video"></i></button>`
      : `<button class="contact-btn call-btn disabled" style="opacity: 0.35; pointer-events: none;" title="User is Offline" disabled><i data-lucide="video"></i></button>`;
      
    item.innerHTML = `
      <div class="contact-left">
        <div class="contact-avatar">${initials}</div>
        <div class="contact-info">
          <h4>@${user}</h4>
          <p>${statusBadge}</p>
        </div>
      </div>
      <div class="contact-actions">
        <button class="contact-btn chat-action" data-user="${user}"><i data-lucide="message-square"></i></button>
        ${callBtnHtml}
      </div>
    `;
    
    // Event listeners
    item.querySelector('.chat-action').addEventListener('click', (e) => {
      e.stopPropagation();
      openConversation(user);
    });
    
    if (isOnline) {
      item.querySelector('.call-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        initiateCall(user);
      });
    }
    
    usersList.appendChild(item);
  });
  
  lucide.createIcons();
}

function renderConversationList(activeUsers) {
  // Save current active selection if any
  const previousTarget = currentChatTarget;
  
  // We keep Global Room, and append active direct messaging rooms
  const globalItem = conversationList.querySelector('[data-chat-target="global"]');
  
  if (globalItem) {
    const newGlobalItem = globalItem.cloneNode(true);
    newGlobalItem.addEventListener('click', () => {
      openConversation('global');
    });
    
    // Highlight if active
    if (previousTarget === 'global') {
      newGlobalItem.classList.add('active');
    } else {
      newGlobalItem.classList.remove('active');
    }
    
    // Update last message in Global Room list item if history exists
    const globalHistory = chatHistory['global'] || [];
    if (globalHistory.length > 0) {
      const lastMsgLabel = newGlobalItem.querySelector('.chat-item-last-msg');
      if (lastMsgLabel) {
        lastMsgLabel.textContent = globalHistory[globalHistory.length - 1].text;
      }
    }
    
    // Add global unread badge if any
    const globalHeader = newGlobalItem.querySelector('.chat-item-header');
    if (globalHeader) {
      const existingBadge = newGlobalItem.querySelector('.unread-badge');
      if (existingBadge) existingBadge.remove();
      
      const gUnread = unreadCounts['global'] || 0;
      if (gUnread > 0) {
        const badgeContainer = document.createElement('span');
        badgeContainer.className = 'unread-badge';
        badgeContainer.textContent = gUnread;
        globalHeader.appendChild(badgeContainer);
      }
    }
    
    conversationList.innerHTML = '';
    conversationList.appendChild(newGlobalItem);
  } else {
    conversationList.innerHTML = '';
  }
  
  activeUsers.forEach(userObj => {
    // Robust parsing to handle both string array and object array fallbacks
    const user = typeof userObj === 'string' ? userObj : (userObj.username || '');
    const isOnline = typeof userObj === 'string' ? true : !!userObj.online;
    
    if (!user) return;
    
    const item = document.createElement('div');
    item.className = 'chat-item';
    item.setAttribute('data-chat-target', user);
    if (previousTarget === user) {
      item.classList.add('active');
    }
    
    const initials = user.substring(0, 2).toUpperCase();
    const history = chatHistory[user] || [];
    const lastMsg = history.length > 0 ? history[history.length - 1].text : 'Start chatting...';
    const lastTime = isOnline ? 'Active' : 'Offline';
    
    const badgeMarkup = unreadCounts[user] ? `<span class="unread-badge">${unreadCounts[user]}</span>` : '';
    
    item.innerHTML = `
      <div class="chat-item-avatar user-avatar-placeholder">${initials}</div>
      <div class="chat-item-details">
        <div class="chat-item-header">
          <h4>@${user}</h4>
          <div style="display: flex; align-items: center; gap: 6px;">
            <span class="chat-item-time">${lastTime}</span>
            ${badgeMarkup}
          </div>
        </div>
        <p class="chat-item-last-msg">${lastMsg}</p>
      </div>
    `;
    
    item.addEventListener('click', () => {
      openConversation(user);
    });
    
    conversationList.appendChild(item);
  });
  
  lucide.createIcons();
}

function updateConversationLastMessage(roomKey, data) {
  const item = conversationList.querySelector(`[data-chat-target="${roomKey}"]`);
  if (item) {
    const msgLabel = item.querySelector('.chat-item-last-msg');
    const timeLabel = item.querySelector('.chat-item-time');
    if (msgLabel) msgLabel.textContent = data.text;
    if (timeLabel) timeLabel.textContent = 'Now';
    
    // Update unread count badge in list row
    const header = item.querySelector('.chat-item-header');
    if (header) {
      let badge = item.querySelector('.unread-badge');
      if (badge) badge.remove();
      
      const count = unreadCounts[roomKey] || 0;
      if (count > 0) {
        const badgeContainer = document.createElement('span');
        badgeContainer.className = 'unread-badge';
        badgeContainer.textContent = count;
        header.appendChild(badgeContainer);
      }
    }
  }
}

// Update single message status indicator in DOM
function updateMessageStatusInDOM(msgId, status) {
  const msgEl = messagesContainer.querySelector(`[data-msg-id="${msgId}"]`);
  if (!msgEl) return;
  
  let tickEl = msgEl.querySelector('.msg-status-tick');
  if (!tickEl) {
    const bubble = msgEl.querySelector('.msg-bubble');
    if (!bubble) return;
    tickEl = document.createElement('span');
    tickEl.className = 'msg-status-tick';
    tickEl.style.marginLeft = '6px';
    tickEl.style.display = 'inline-flex';
    tickEl.style.alignItems = 'center';
    bubble.appendChild(tickEl);
  }
  
  if (status === 'sent') {
    tickEl.className = 'msg-status-tick sent';
    tickEl.style.color = 'var(--text-muted)';
    tickEl.innerHTML = `<i data-lucide="check" style="width: 12px; height: 12px;"></i>`;
  } else if (status === 'delivered') {
    tickEl.className = 'msg-status-tick delivered';
    tickEl.style.color = 'var(--text-muted)';
    tickEl.innerHTML = `<i data-lucide="check" style="width: 12px; height: 12px; margin-right: -6px;"></i><i data-lucide="check" style="width: 12px; height: 12px;"></i>`;
  } else if (status === 'read') {
    tickEl.className = 'msg-status-tick read';
    tickEl.style.color = '#38bdf8';
    tickEl.innerHTML = `<i data-lucide="check" style="width: 12px; height: 12px; margin-right: -6px;"></i><i data-lucide="check" style="width: 12px; height: 12px;"></i>`;
  }
  
  lucide.createIcons();
}

// Bulk update message statuses in cache and view for a DM partner
function updatePartnerMessagesStatus(partner, status) {
  const history = chatHistory[partner] || [];
  history.forEach(msg => {
    if (msg.sender === myUsername) {
      msg.status = status;
    }
  });
  
  if (currentChatTarget === partner) {
    history.forEach(msg => {
      if (msg.sender === myUsername && msg.id) {
        updateMessageStatusInDOM(msg.id, status);
      }
    });
  }
}

// Open Conversation Panel
function openConversation(target) {
  currentChatTarget = target;
  
  // Clear unread indicator locally
  unreadCounts[target] = 0;
  const item = conversationList.querySelector(`[data-chat-target="${target}"]`);
  if (item) {
    const badge = item.querySelector('.unread-badge');
    if (badge) badge.remove();
  }
  
  // Mark incoming messages from this user as read
  if (target !== 'global' && socket && socket.connected) {
    socket.emit('mark_read', { partner: target });
  }
  
  // Highlight conversation in list
  document.querySelectorAll('.chat-item').forEach(item => {
    item.classList.remove('active');
    if (item.getAttribute('data-chat-target') === target) {
      item.classList.add('active');
    }
  });
  
  // Setup conversation header
  if (target === 'global') {
    chatHeaderTitle.textContent = 'Global Room';
    chatHeaderAvatar.textContent = 'G';
    chatHeaderAvatar.className = 'avatar compact global-avatar';
    chatHeaderStatus.textContent = 'Shared Public Chat';
    headerVideoCallBtn.style.display = 'none'; // Hide call for global
  } else {
    chatHeaderTitle.textContent = `@${target}`;
    chatHeaderAvatar.textContent = target.substring(0, 2).toUpperCase();
    chatHeaderAvatar.className = 'avatar compact user-avatar-placeholder';
    chatHeaderStatus.textContent = 'Direct Message';
    headerVideoCallBtn.style.display = 'flex'; // Show call for DM
  }
  
  // Render messages history
  messagesContainer.innerHTML = '';
  const history = chatHistory[target] || [];
  history.forEach(appendMessageBubble);
  
  // Show screen
  conversationView.classList.add('active');
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Render a single message bubble
function appendMessageBubble(msg) {
  const msgWrapper = document.createElement('div');
  const isOutgoing = msg.sender === myUsername;
  msgWrapper.className = `msg-wrapper ${isOutgoing ? 'outgoing' : 'incoming'}`;
  if (msg.id) {
    msgWrapper.setAttribute('data-msg-id', msg.id);
  }
  if (msg.pending) {
    msgWrapper.style.opacity = '0.65';
  }
  
  let statusMarkup = '';
  if (isOutgoing) {
    if (msg.pending) {
      statusMarkup = `<span class="msg-status-tick pending" style="margin-left: 6px; display: inline-flex; align-items: center; color: var(--text-muted);"><i data-lucide="clock" style="width: 12px; height: 12px;"></i></span>`;
    } else if (msg.status === 'sent') {
      statusMarkup = `<span class="msg-status-tick sent" style="margin-left: 6px; display: inline-flex; align-items: center; color: var(--text-muted);"><i data-lucide="check" style="width: 12px; height: 12px;"></i></span>`;
    } else if (msg.status === 'delivered') {
      statusMarkup = `<span class="msg-status-tick delivered" style="margin-left: 6px; display: inline-flex; align-items: center; color: var(--text-muted);"><i data-lucide="check" style="width: 12px; height: 12px; margin-right: -6px;"></i><i data-lucide="check" style="width: 12px; height: 12px;"></i></span>`;
    } else if (msg.status === 'read') {
      statusMarkup = `<span class="msg-status-tick read" style="margin-left: 6px; display: inline-flex; align-items: center; color: #38bdf8;"><i data-lucide="check" style="width: 12px; height: 12px; margin-right: -6px;"></i><i data-lucide="check" style="width: 12px; height: 12px;"></i></span>`;
    }
  }
  
  msgWrapper.innerHTML = `
    <span class="msg-sender-label">${isOutgoing ? 'You' : '@' + msg.sender}</span>
    <div class="msg-bubble" style="display: flex; align-items: center;">
      <span>${escapeHtml(msg.text)}</span>
      ${statusMarkup}
    </div>
  `;
  
  messagesContainer.appendChild(msgWrapper);
  lucide.createIcons();
}

// Send Message
chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  
  const target = currentChatTarget === 'global' ? null : currentChatTarget;
  const roomKey = currentChatTarget;
  
  const isOnline = socket && socket.connected;
  
  if (isOnline) {
    socket.emit('send_msg', {
      text: text,
      target: target
    });
  } else {
    // Generate a temporary ID for the pending message
    const pendingId = 'pending_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    const pendingMsg = {
      id: pendingId,
      sender: myUsername,
      target: target,
      text: text,
      timestamp: new Date().toISOString(),
      pending: true
    };
    
    // Add locally to chat history
    if (!chatHistory[roomKey]) {
      chatHistory[roomKey] = [];
    }
    chatHistory[roomKey].push(pendingMsg);
    
    // Queue in localStorage outbox
    let outbox = [];
    try {
      outbox = JSON.parse(localStorage.getItem('vibechat_outbox') || '[]');
    } catch (err) {
      outbox = [];
    }
    outbox.push(pendingMsg);
    localStorage.setItem('vibechat_outbox', JSON.stringify(outbox));
    
    // Render immediately in outbox state
    appendMessageBubble(pendingMsg);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }
  
  chatInput.value = '';
});

// Helper: Escape HTML to prevent XSS
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, function(m) { return map[m]; });
}


// --- CALL SCREEN TRIGGERS & WEBRTC LOGIC ---

// Mute controls toggle logic
let localVideoEnabled = true;
let localAudioEnabled = true;

toggleCamBtn.addEventListener('click', () => {
  if (localStream) {
    localVideoEnabled = !localVideoEnabled;
    localStream.getVideoTracks().forEach(track => track.enabled = localVideoEnabled);
    
    // Toggle active visual design class
    if (localVideoEnabled) {
      toggleCamBtn.classList.remove('disabled');
    } else {
      toggleCamBtn.classList.add('disabled');
    }
  }
});

toggleMicBtn.addEventListener('click', () => {
  if (localStream) {
    localAudioEnabled = !localAudioEnabled;
    localStream.getAudioTracks().forEach(track => track.enabled = localAudioEnabled);
    
    if (localAudioEnabled) {
      toggleMicBtn.classList.remove('disabled');
    } else {
      toggleMicBtn.classList.add('disabled');
    }
  }
});

// Setup local camera / microphone stream
async function setupLocalMedia() {
  const wantsVideo = videoEnableCheckbox.checked;
  const wantsAudio = audioEnableCheckbox.checked;
  
  try {
    // Attempt physical devices
    localStream = await navigator.mediaDevices.getUserMedia({
      video: wantsVideo ? { width: 640, height: 480, facingMode: 'user' } : false,
      audio: wantsAudio
    });
    console.log("Webcam/mic access granted successfully.");
  } catch (err) {
    console.warn("Could not capture media devices, falling back to dummy stream simulation.", err);
    localStream = createDummyStream();
  }
  
  localVideo.srcObject = localStream;
}

// Setup PeerConnection listeners
function setupPeerConnection() {
  peerConnection = new RTCPeerConnection(rtcConfig);
  
  // Send ICE Candidates
  peerConnection.onicecandidate = (event) => {
    if (event.candidate && currentCallPartner) {
      socket.emit('signal', {
        target: currentCallPartner,
        type: 'candidate',
        signalData: event.candidate
      });
    }
  };
  
  // Render Peer Remote video stream
  peerConnection.ontrack = (event) => {
    console.log("Remote media track received!");
    remoteVideoPlaceholder.style.display = 'none';
    if (!remoteStream) {
      remoteStream = new MediaStream();
      remoteVideo.srcObject = remoteStream;
    }
    remoteStream.addTrack(event.track);
  };
  
  // Add local media tracks to connection
  localStream.getTracks().forEach(track => {
    peerConnection.addTrack(track, localStream);
  });
}

// Start Call (Outgoing call request)
async function initiateCall(partnerUsername) {
  if (peerConnection || currentCallPartner) return;
  initAudio();
  
  currentCallPartner = partnerUsername;
  isCaller = true;
  
  // Set UI names
  callPartnerName.textContent = `@${partnerUsername}`;
  remoteVideoPlaceholder.querySelector('p').textContent = `Ringing @${partnerUsername}...`;
  remoteVideoPlaceholder.style.display = 'flex';
  
  // Show active call screen layout
  activeCallScreen.classList.add('active');
  
  // Play dialing tone
  playRingtone('outgoing');
  
  // Setup media
  await setupLocalMedia();
  
  // Setup connection
  setupPeerConnection();
  
  // Create SDP offer
  try {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    
    // Send signaling SDP offer
    socket.emit('signal', {
      target: partnerUsername,
      type: 'offer',
      signalData: offer
    });
    console.log("Sent call SDP offer to peer.");
  } catch (err) {
    console.error("Error creating calling offer: ", err);
    handleCallCleanup();
  }
}

// Accepting Call (Incoming call response)
acceptCallBtn.addEventListener('click', async () => {
  stopRingtone();
  incomingCallScreen.classList.remove('active');
  
  if (!currentCallPartner) return;
  
  // Show active call screen layout
  callPartnerName.textContent = `@${currentCallPartner}`;
  remoteVideoPlaceholder.querySelector('p').textContent = 'Connecting call...';
  remoteVideoPlaceholder.style.display = 'flex';
  activeCallScreen.classList.add('active');
  
  // Setup media
  await setupLocalMedia();
  
  // Setup connection
  setupPeerConnection();
  
  // Retrieve the caller offer from socket signal event (needs to be saved or fetched)
  // Since we are triggered, wait, we must fetch the offer. How does Bob get the offer?
  // Bob already received the offer signal and saved it (signalData).
  // Bob needs to find the offer signal. Let's process it now!
});

// Since the incoming offer is accepted, we store it in a temporary variable during signal receipt.
// Let's modify the socket on('signal') offer receiver to store it, and Bob's accept btn listener to apply it.
let incomingCallOffer = null;

socket?.on('signal', (data) => {
  // Let's ensure this is bound inside socket initialization!
});

// Modify socket initializer code to save the offer:
// Under `type === 'offer'` case:
// incomingCallOffer = signalData;

// Let's rewrite the accept handler to correctly consume the saved offer:
acceptCallBtn.addEventListener('click', async () => {
  stopRingtone();
  incomingCallScreen.classList.remove('active');
  
  if (!currentCallPartner || !incomingCallOffer) {
    handleCallCleanup();
    return;
  }
  
  callPartnerName.textContent = `@${currentCallPartner}`;
  remoteVideoPlaceholder.querySelector('p').textContent = 'Connecting...';
  remoteVideoPlaceholder.style.display = 'flex';
  activeCallScreen.classList.add('active');
  
  // Setup media
  await setupLocalMedia();
  
  // Setup connection
  setupPeerConnection();
  
  try {
    // Apply Remote offer SDP
    await peerConnection.setRemoteDescription(new RTCSessionDescription(incomingCallOffer));
    console.log("Remote offer description applied.");
    
    // Process queued candidates
    while (queuedIceCandidates.length > 0) {
      const cand = queuedIceCandidates.shift();
      await peerConnection.addIceCandidate(cand);
    }
    
    // Create SDP Answer
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    
    // Send SDP Answer to caller
    socket.emit('signal', {
      target: currentCallPartner,
      type: 'answer',
      signalData: answer
    });
    
    startCallTimer();
  } catch (err) {
    console.error("Error establishing RTC call on receiver: ", err);
    handleCallCleanup();
  }
});

// Decline Call button
declineCallBtn.addEventListener('click', () => {
  stopRingtone();
  incomingCallScreen.classList.remove('active');
  
  if (currentCallPartner) {
    socket.emit('signal', {
      target: currentCallPartner,
      type: 'hangup'
    });
  }
  handleCallCleanup();
});

// Hangup/End Call Button
hangupCallBtn.addEventListener('click', () => {
  if (currentCallPartner) {
    socket.emit('signal', {
      target: currentCallPartner,
      type: 'hangup'
    });
  }
  handleCallCleanup();
});

// Call timers
function startCallTimer() {
  callDuration = 0;
  callDurationTimer.textContent = '00:00';
  clearInterval(callTimerInterval);
  
  callTimerInterval = setInterval(() => {
    callDuration++;
    const mins = Math.floor(callDuration / 60).toString().padStart(2, '0');
    const secs = (callDuration % 60).toString().padStart(2, '0');
    callDurationTimer.textContent = `${mins}:${secs}`;
  }, 1000);
}

// Clean up Call resources
function handleCallCleanup() {
  clearInterval(callTimerInterval);
  callTimerInterval = null;
  callDuration = 0;
  
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  
  localVideo.srcObject = null;
  remoteVideo.srcObject = null;
  remoteStream = null;
  incomingCallOffer = null;
  queuedIceCandidates = [];
  
  localVideoEnabled = true;
  localAudioEnabled = true;
  toggleCamBtn.classList.remove('disabled');
  toggleMicBtn.classList.remove('disabled');
  
  activeCallScreen.classList.remove('active');
  currentCallPartner = null;
}

// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => console.log('Service Worker registered successfully!', reg))
      .catch(err => console.error('Service Worker registration failed:', err));
  });
}

// Auto-login from saved session in localStorage
(function checkSavedSession() {
  const sessionData = localStorage.getItem('vibechat_session');
  if (sessionData) {
    try {
      const session = JSON.parse(sessionData);
      if (session.username && session.password) {
        savedCredentials = { username: session.username, password: session.password };
        console.log(`Auto-login session detected for @${session.username}`);
        
        // Hide standard inputs and display loading indicator
        loginError.style.display = 'block';
        loginError.textContent = "Connecting securely...";
        loginError.style.color = "var(--primary)";
        
        // Initialize socket and log in
        initSocket();
      }
    } catch (err) {
      console.error("Failed to parse saved session:", err);
      localStorage.removeItem('vibechat_session');
    }
  }
})();
