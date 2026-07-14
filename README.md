# VibeChat - Real-Time Chat & Video Call Platform 💬🎥

VibeChat is a modern, low-latency web application designed for real-time messaging and peer-to-peer video calling. 

The application utilizes **WebSockets** for instant chat and connection negotiation, and **WebRTC** to stream audio and video directly between users' browsers without heavy server overhead.

----

## 🛠️ Tech Stack
*   **Backend:** Python (Flask, Flask-SocketIO, SQLite)
*   **Frontend:** HTML5, CSS3, JavaScript (WebRTC APIs, Socket.io Client)
*   **Database:** SQLite3 (WAL mode enabled for high-concurrency read/write operations)

----

## 💡 How WebSockets & WebRTC Work Together in this Codebase

Real-time audio/video streaming cannot happen without both technologies working in tandem. Here is a breakdown of their roles in VibeChat:


### 1. WebSockets (The Signaling & Messaging Channel)
WebSockets provide a persistent, bi-directional communication channel between the client and the Flask server using **Flask-SocketIO**. In VibeChat, WebSockets serve two purposes:

*   **Instant Text Messaging:** When a user sends a text message, it is emitted via a WebSocket event (`message`). The server instantly writes the message to the SQLite database and broadcasts it to the recipient in real-time, bypassing HTTP polling.
*   **WebRTC Signaling:** WebRTC peers cannot connect directly out of the blue; they need to exchange metadata first. The WebSocket server acts as the **Signaling Channel** to pass connection details, including:
    *   **SDP Offers and Answers:** Descriptions of media format, codecs, and connection capabilities.
    *   **ICE Candidates:** Network routing paths (IP addresses and ports) discovered by the browser.

### 2. WebRTC (The Peer-to-Peer Media Channel)
Once the signaling process is complete via WebSockets, **WebRTC** takes over the media communication.

*   **P2P Streaming:** WebRTC establishes a direct **Peer-to-Peer (P2P)** connection between the two browsers (`RTCPeerConnection`).
*   **No Server Load:** Audio and video data streams directly from User A's webcam/microphone to User B's screen. The Flask server is completely bypassed during the call, saving bandwidth and keeping latency to a absolute minimum.

---

## 📂 Project Structure
*   `app.py`: The entry point. Hosts the Flask app, handles REST login/registration, configures Flask-SocketIO events, and interacts with the SQLite database.
*   `public/`: Client-side files containing index pages, call rooms, UI styling, and client-side JavaScript that instantiates `RTCPeerConnection` and handles video streaming.
*   `requirements.txt`: List of Python packages (Flask, Flask-SocketIO, gevent-websocket, etc.).

---

## 🚀 Installation & Setup

### Prerequisites
*   Python 3.8+ installed.

### 1. Clone & Set Up Environment
```bash
# Navigate to project directory
cd vibe-chat

# Create a virtual environment
python -m venv venv

# Activate virtual environment
# On Windows:
venv\Scripts\activate
# On macOS/Linux:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
