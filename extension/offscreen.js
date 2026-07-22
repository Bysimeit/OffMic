const state = {
  ws: null,
  serverUrl: null,
  room: null,
  name: null,
  peerId: null,
  localStream: null,
  outgoingTrack: null,
  connected: false,
  teamsMuted: false,
  listenWhileUnmuted: true,
  peers: new Map(),
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  lastError: null
};

function send(msg) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify(msg));
  }
}

function report() {
  chrome.runtime.sendMessage({
    cmd: "status",
    status: {
      connected: state.connected,
      error: state.lastError,
      room: state.room,
      teamsMuted: state.teamsMuted,
      listenWhileUnmuted: state.listenWhileUnmuted,
      transmitting: !!(state.outgoingTrack && state.outgoingTrack.enabled),
      peers: Array.from(state.peers.entries()).map(([id, entry]) => ({
        id,
        name: entry.name,
        state: entry.pc.connectionState
      }))
    }
  });
}

function applyOutgoing() {
  if (state.outgoingTrack) {
    state.outgoingTrack.enabled = state.connected && state.teamsMuted;
  }
}

function applyPlayback() {
  const allow = state.connected && (state.teamsMuted || state.listenWhileUnmuted);
  for (const entry of state.peers.values()) {
    if (!entry.audio) continue;
    entry.audio.muted = !allow;
    if (allow) {
      entry.audio.play().catch(() => {});
    }
  }
}

async function connect(payload) {
  if (state.connected || state.ws) return;
  state.room = payload.room;
  state.name = payload.name;
  state.serverUrl = payload.serverUrl;
  if (Array.isArray(payload.iceServers) && payload.iceServers.length) {
    state.iceServers = payload.iceServers;
  }
  state.peerId = crypto.randomUUID();
  state.lastError = null;

  try {
    state.localStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
  } catch (e) {
    const name = e && e.name;
    if (name === "NotAllowedError" || name === "SecurityError") {
      state.lastError = "micPermission";
    } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      state.lastError = "micMissing";
    } else {
      state.lastError = "micFailed";
    }
    report();
    return;
  }
  state.outgoingTrack = state.localStream.getAudioTracks()[0];
  state.outgoingTrack.enabled = false;

  let ws;
  try {
    ws = new WebSocket(state.serverUrl);
  } catch (e) {
    state.lastError = "badServerUrl";
    teardown();
    return;
  }
  state.ws = ws;

  ws.addEventListener("open", () => {
    if (state.ws !== ws) return;
    state.connected = true;
    state.lastError = null;
    send({ type: "join", room: state.room, peerId: state.peerId, name: state.name });
    applyOutgoing();
    report();
  });
  ws.addEventListener("message", onServerMessage);
  ws.addEventListener("close", () => {
    if (state.ws !== ws) return;
    if (!state.connected) state.lastError = "serverUnreachable";
    teardown();
  });
  ws.addEventListener("error", () => {
    if (state.ws !== ws) return;
    if (!state.connected) state.lastError = "serverUnreachable";
    report();
  });
}

async function onServerMessage(event) {
  let msg;
  try {
    msg = JSON.parse(event.data);
  } catch (e) {
    return;
  }

  if (msg.type === "peers") {
    for (const peer of msg.peers) {
      await createPeer(peer.peerId, peer.name, true);
    }
    report();
  } else if (msg.type === "peer-joined") {
    report();
  } else if (msg.type === "peer-left") {
    removePeer(msg.peerId);
    report();
  } else if (msg.type === "signal") {
    await onPeerSignal(msg);
  }
}

async function createPeer(peerId, name, initiator) {
  if (state.peers.has(peerId)) return state.peers.get(peerId);

  const pc = new RTCPeerConnection({ iceServers: state.iceServers });
  const audio = new Audio();
  audio.autoplay = true;
  const entry = { pc, name: name || "", audio };
  state.peers.set(peerId, entry);

  if (state.outgoingTrack) {
    pc.addTrack(state.outgoingTrack, state.localStream);
  }

  pc.addEventListener("icecandidate", (e) => {
    if (e.candidate) {
      send({ type: "signal", to: peerId, from: state.peerId, data: { ice: e.candidate } });
    }
  });

  pc.addEventListener("track", (e) => {
    entry.stream = e.streams[0];
    audio.srcObject = e.streams[0];
    applyPlayback();
  });

  pc.addEventListener("connectionstatechange", report);

  if (initiator) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    send({ type: "signal", to: peerId, from: state.peerId, data: { sdp: pc.localDescription } });
  }

  return entry;
}

async function onPeerSignal(msg) {
  const from = msg.from;
  const data = msg.data || {};
  let entry = state.peers.get(from);

  if (data.sdp) {
    if (!entry) {
      entry = await createPeer(from, msg.name || "", false);
    }
    await entry.pc.setRemoteDescription(data.sdp);
    if (data.sdp.type === "offer") {
      const answer = await entry.pc.createAnswer();
      await entry.pc.setLocalDescription(answer);
      send({ type: "signal", to: from, from: state.peerId, data: { sdp: entry.pc.localDescription } });
    }
  } else if (data.ice) {
    if (entry) {
      try {
        await entry.pc.addIceCandidate(data.ice);
      } catch (e) {}
    }
  }
}

function removePeer(peerId) {
  const entry = state.peers.get(peerId);
  if (!entry) return;
  try {
    entry.pc.close();
  } catch (e) {}
  if (entry.audio) {
    entry.audio.srcObject = null;
  }
  state.peers.delete(peerId);
}

function setMute(muted) {
  state.teamsMuted = muted;
  applyOutgoing();
  applyPlayback();
  report();
}

function setListen(listen) {
  state.listenWhileUnmuted = listen;
  applyPlayback();
  report();
}

function teardown() {
  for (const id of Array.from(state.peers.keys())) {
    removePeer(id);
  }
  if (state.ws) {
    try {
      state.ws.close();
    } catch (e) {}
  }
  state.ws = null;
  if (state.localStream) {
    state.localStream.getTracks().forEach((t) => t.stop());
  }
  state.localStream = null;
  state.outgoingTrack = null;
  state.connected = false;
  report();
}

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.target !== "offscreen") return;
  if (msg.cmd === "connect") connect(msg.payload);
  else if (msg.cmd === "disconnect") {
    state.lastError = null;
    teardown();
  }
  else if (msg.cmd === "muteState") setMute(msg.muted);
  else if (msg.cmd === "setListen") setListen(msg.listen);
  else if (msg.cmd === "getStatus") report();
});
