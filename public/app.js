// Client State Variables
let socket;
let myUsername = '';
let loginMode = 'login'; // 'login' or 'register'
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

// --- INIT APP ---
function initSocket() {
  socket = io();

  // Socket Receivers
  socket.on('join_success', (data) => {
    myUsername = data.username;
    myUsernameLabel.textContent = `@${myUsername}`;
    myAvatar.textContent = myUsername.substring(0, 2).toUpperCase();
    
    loginScreen.classList.remove('active');
    mainScreen.classList.add('active');
    
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
    // Save to memory
    const roomKey = data.target ? (data.target === myUsername ? data.sender : data.target) : 'global';
    if (!chatHistory[roomKey]) {
      chatHistory[roomKey] = [];
    }
    chatHistory[roomKey].push(data);
    
    // Re-render conversation item list to show last message
    updateConversationLastMessage(roomKey, data);
    
    // If currently looking at this chat, render the bubble
    if (currentChatTarget === roomKey && conversationView.classList.contains('active')) {
      appendMessageBubble(data);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
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
  
  socket.emit('join', { 
    username: username,
    password: password,
    mode: loginMode
  });
}

logoutBtn.addEventListener('click', () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  mainScreen.classList.remove('active');
  conversationView.classList.remove('active');
  loginScreen.classList.add('active');
  usernameInput.value = '';
  passwordInput.value = '';
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
  conversationList.innerHTML = '';
  conversationList.appendChild(globalItem);
  
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
    
    item.innerHTML = `
      <div class="chat-item-avatar user-avatar-placeholder">${initials}</div>
      <div class="chat-item-details">
        <div class="chat-item-header">
          <h4>@${user}</h4>
          <span class="chat-item-time">${lastTime}</span>
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
  }
}

// Open Conversation Panel
function openConversation(target) {
  currentChatTarget = target;
  
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
  
  msgWrapper.innerHTML = `
    <span class="msg-sender-label">${isOutgoing ? 'You' : '@' + msg.sender}</span>
    <div class="msg-bubble">${escapeHtml(msg.text)}</div>
  `;
  
  messagesContainer.appendChild(msgWrapper);
}

// Send Message
chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  
  const target = currentChatTarget === 'global' ? null : currentChatTarget;
  
  socket.emit('send_msg', {
    text: text,
    target: target
  });
  
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
