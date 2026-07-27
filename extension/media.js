var offmicSignalOut = null;
var offmicMediaReady = null;

const state = {
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
  lastError: null,
  audio: { micDevice: "", speakerDevice: "", micVolume: 100, teamVolume: 100 },
  audioCtx: null,
  micSource: null,
  micGain: null,
  micDestination: null
};

function toLevel(percent) {
  const value = Number(percent);
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, value / 100));
}

function send(msg) {
  if (typeof offmicSignalOut === "function") {
    offmicSignalOut(JSON.parse(JSON.stringify(msg)));
  }
}

function report() {
  const status = {
    connected: state.connected,
    error: state.lastError,
    room: state.room,
    teamsMuted: state.teamsMuted,
    listenWhileUnmuted: state.listenWhileUnmuted,
    transmitting: !!(state.outgoingTrack && state.outgoingTrack.enabled),
    peers: Array.from(state.peers.entries()).map(([id, entry]) => ({
      id,
      name: entry.name,
      state: entry.pc.connectionState,
      muted: entry.muted,
      volume: entry.volume
    }))
  };
  apiSend({ cmd: "status", status });
}

function applyOutgoing() {
  if (state.outgoingTrack) {
    state.outgoingTrack.enabled = state.connected && state.teamsMuted;
  }
}

function applyPlayback() {
  const allow = state.connected && (state.teamsMuted || state.listenWhileUnmuted);
  const master = toLevel(state.audio.teamVolume);
  for (const entry of state.peers.values()) {
    if (!entry.audio) continue;
    const audible = allow && !entry.muted;
    entry.audio.muted = !audible;
    entry.audio.volume = master * toLevel(entry.volume);
    if (audible) {
      entry.audio.play().catch(() => {});
    }
  }
}

function applySink(audio) {
  if (typeof audio.setSinkId !== "function") return;
  audio.setSinkId(state.audio.speakerDevice || "").catch(() => {});
}

function applyMicVolume() {
  if (state.micGain) {
    state.micGain.gain.value = toLevel(state.audio.micVolume);
  }
}

function buildMicChain(stream) {
  if (!state.audioCtx) {
    state.audioCtx = new AudioContext();
    state.micGain = state.audioCtx.createGain();
    state.micDestination = state.audioCtx.createMediaStreamDestination();
    state.micGain.connect(state.micDestination);
  }
  if (state.micSource) {
    state.micSource.disconnect();
  }
  state.micSource = state.audioCtx.createMediaStreamSource(stream);
  state.micSource.connect(state.micGain);
  applyMicVolume();
  if (state.audioCtx.state === "suspended") {
    state.audioCtx.resume().catch(() => {});
  }
}

function micErrorCode(error) {
  const name = error && error.name;
  if (name === "NotAllowedError" || name === "SecurityError") return "micPermission";
  if (name === "NotFoundError" || name === "DevicesNotFoundError") return "micMissing";
  return "micFailed";
}

function captureMic(deviceId) {
  const constraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  if (deviceId) {
    constraints.deviceId = { exact: deviceId };
  }
  return navigator.mediaDevices.getUserMedia({ audio: constraints });
}

async function openMic() {
  const requested = state.audio.micDevice;
  let stream;

  try {
    stream = await captureMic(requested);
  } catch (e) {
    const code = micErrorCode(e);
    if (!requested || code === "micPermission") {
      state.lastError = code;
      report();
      return false;
    }
    try {
      stream = await captureMic("");
    } catch (fallbackError) {
      state.lastError = micErrorCode(fallbackError);
      report();
      return false;
    }
  }

  state.lastError = null;
  state.localStream = stream;
  buildMicChain(stream);
  state.outgoingTrack = state.micDestination.stream.getAudioTracks()[0];
  applyOutgoing();
  return true;
}

async function switchMic() {
  const previous = state.localStream;
  const ok = await openMic();
  if (ok && previous && previous !== state.localStream) {
    previous.getTracks().forEach((t) => t.stop());
  }
}

async function prepare(payload) {
  if (state.localStream) return;
  state.room = payload.room;
  state.name = payload.name;
  state.serverUrl = payload.serverUrl;
  if (Array.isArray(payload.iceServers) && payload.iceServers.length) {
    state.iceServers = payload.iceServers;
  }
  if (payload.audio) {
    Object.assign(state.audio, payload.audio);
  }
  state.peerId = crypto.randomUUID();
  state.lastError = null;

  const ready = await openMic();
  if (!ready) return;

  report();
  if (typeof offmicMediaReady === "function") {
    offmicMediaReady(state.peerId, payload);
  }
}

function setLink(connected) {
  state.connected = connected;
  if (connected) {
    state.lastError = null;
    applyOutgoing();
    report();
    return;
  }
  teardown();
}

function fail(code) {
  state.lastError = code;
  teardown();
}

async function signalIn(msg) {
  if (!msg) return;

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
  audio.volume = toLevel(state.audio.teamVolume);
  applySink(audio);
  const entry = { pc, name: name || "", audio, muted: false, volume: 100 };
  state.peers.set(peerId, entry);

  if (state.outgoingTrack) {
    pc.addTrack(state.outgoingTrack, state.micDestination.stream);
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

function setAudio(audio) {
  if (!audio) return;
  const previous = state.audio;
  state.audio = Object.assign({}, previous, audio);
  applyMicVolume();
  if (state.audio.speakerDevice !== previous.speakerDevice) {
    for (const entry of state.peers.values()) {
      if (entry.audio) applySink(entry.audio);
    }
  }
  if (state.audio.micDevice !== previous.micDevice && state.localStream) {
    switchMic();
  }
  applyPlayback();
}

function setPeerAudio(peerId, patch) {
  const entry = state.peers.get(peerId);
  if (!entry || !patch) return;
  if (typeof patch.muted === "boolean") {
    entry.muted = patch.muted;
  }
  if (patch.volume !== undefined) {
    entry.volume = patch.volume;
  }
  applyPlayback();
  report();
}

function teardown() {
  for (const id of Array.from(state.peers.keys())) {
    removePeer(id);
  }
  if (state.micSource) {
    state.micSource.disconnect();
    state.micSource = null;
  }
  if (state.localStream) {
    state.localStream.getTracks().forEach((t) => t.stop());
  }
  state.localStream = null;
  state.outgoingTrack = null;
  state.connected = false;
  report();
}

function offmicMediaHandle(msg) {
  if (!msg) return;
  if (msg.cmd === "prepare") prepare(msg.payload);
  else if (msg.cmd === "link") setLink(msg.connected);
  else if (msg.cmd === "signalIn") signalIn(msg.msg);
  else if (msg.cmd === "fail") fail(msg.code);
  else if (msg.cmd === "disconnect") {
    state.lastError = null;
    teardown();
  }
  else if (msg.cmd === "muteState") setMute(msg.muted);
  else if (msg.cmd === "setListen") setListen(msg.listen);
  else if (msg.cmd === "setAudio") setAudio(msg.audio);
  else if (msg.cmd === "setPeerAudio") setPeerAudio(msg.peerId, msg.patch);
  else if (msg.cmd === "getStatus") report();
}
