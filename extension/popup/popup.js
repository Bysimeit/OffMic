const els = {
  serverUrl: document.getElementById("serverUrl"),
  room: document.getElementById("room"),
  name: document.getElementById("name"),
  listen: document.getElementById("listen"),
  language: document.getElementById("language"),
  theme: document.getElementById("theme"),
  micDevice: document.getElementById("micDevice"),
  speakerDevice: document.getElementById("speakerDevice"),
  micVolume: document.getElementById("micVolume"),
  teamVolume: document.getElementById("teamVolume"),
  micVolumeValue: document.getElementById("micVolumeValue"),
  teamVolumeValue: document.getElementById("teamVolumeValue"),
  deviceHint: document.getElementById("deviceHint"),
  deviceGrantBtn: document.getElementById("deviceGrantBtn"),
  settings: document.getElementById("settings"),
  settingsBtn: document.getElementById("settingsBtn"),
  connectBtn: document.getElementById("connectBtn"),
  disconnectBtn: document.getElementById("disconnectBtn"),
  dot: document.getElementById("dot"),
  stateLine: document.getElementById("stateLine"),
  errorLine: document.getElementById("errorLine"),
  grantBtn: document.getElementById("grantBtn"),
  talkLine: document.getElementById("talkLine"),
  peers: document.getElementById("peers"),
  peersEmpty: document.getElementById("peersEmpty"),
  peerTemplate: document.getElementById("peerTemplate")
};

const ERROR_KEYS = {
  micPermission: "errMicPermission",
  micMissing: "errMicMissing",
  micFailed: "errMicFailed",
  badServerUrl: "errBadServerUrl",
  serverUnreachable: "errServerUnreachable",
  offscreenFailed: "errOffscreenFailed",
  noTeamsTab: "errNoTeamsTab"
};

const PEER_STATE_KEYS = {
  new: "peerStateNew",
  connecting: "peerStateConnecting",
  connected: "peerStateConnected",
  disconnected: "peerStateDisconnected",
  failed: "peerStateFailed",
  closed: "peerStateClosed"
};

const REPLY_TIMEOUT = 8000;

const DEFAULTS = {
  serverUrl: typeof OFFMIC_CONFIG === "undefined" ? "" : OFFMIC_CONFIG.serverUrl,
  room: "",
  name: "",
  listen: true,
  language: "auto",
  theme: "auto",
  micDevice: "",
  speakerDevice: "",
  micVolume: 100,
  teamVolume: 100
};

const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

let dict = {};
let lastStatus = null;
let localError = "";
let replyTimer = null;
let settings = Object.assign({}, DEFAULTS);
let inputDevices = [];
let outputDevices = [];
const peerRows = new Map();

function clearReplyTimer() {
  if (replyTimer) {
    clearTimeout(replyTimer);
    replyTimer = null;
  }
}

function t(key, vars) {
  return i18nText(dict, key, vars);
}

async function loadSettings() {
  const data = await api.storage.local.get("settings");
  const s = Object.assign({}, DEFAULTS, data.settings || {});
  if (!s.serverUrl) {
    s.serverUrl = DEFAULTS.serverUrl;
  }
  els.serverUrl.value = s.serverUrl;
  els.room.value = s.room;
  els.name.value = s.name;
  els.listen.checked = s.listen;
  els.language.value = s.language;
  els.theme.value = s.theme;
  els.micVolume.value = s.micVolume;
  els.teamVolume.value = s.teamVolume;
  renderVolumeValues();
  settings = s;
  return s;
}

function saveSettings() {
  settings = {
    serverUrl: els.serverUrl.value.trim(),
    room: els.room.value.trim(),
    name: els.name.value.trim(),
    listen: els.listen.checked,
    language: els.language.value,
    theme: els.theme.value,
    micDevice: settings.micDevice,
    speakerDevice: settings.speakerDevice,
    micVolume: Number(els.micVolume.value),
    teamVolume: Number(els.teamVolume.value)
  };
  api.storage.local.set({ settings });
  return settings;
}

function currentAudio() {
  return {
    micDevice: els.micDevice.value,
    speakerDevice: els.speakerDevice.value,
    micVolume: Number(els.micVolume.value),
    teamVolume: Number(els.teamVolume.value)
  };
}

function pushAudio() {
  apiSend({ cmd: "setAudio", audio: currentAudio() });
}

function renderVolumeValues() {
  els.micVolumeValue.textContent = els.micVolume.value + "%";
  els.teamVolumeValue.textContent = els.teamVolume.value + "%";
}

function fillDeviceSelect(select, devices, selected, fallbackKey) {
  select.textContent = "";
  const auto = document.createElement("option");
  auto.value = "";
  auto.textContent = t("deviceDefault");
  select.appendChild(auto);
  devices.forEach((device, index) => {
    const option = document.createElement("option");
    option.value = device.deviceId;
    option.textContent = device.label || t(fallbackKey, { index: index + 1 });
    select.appendChild(option);
  });
  select.value = devices.some((d) => d.deviceId === selected) ? selected : "";
}

function renderDevices() {
  fillDeviceSelect(els.micDevice, inputDevices, settings.micDevice, "deviceFallbackInput");
  fillDeviceSelect(els.speakerDevice, outputDevices, settings.speakerDevice, "deviceFallbackOutput");
  const unavailable = inputDevices.length === 0;
  els.deviceHint.hidden = !unavailable;
  els.deviceGrantBtn.hidden = !unavailable;
}

async function loadDevices() {
  let devices = [];
  try {
    devices = await navigator.mediaDevices.enumerateDevices();
  } catch (e) {
    devices = [];
  }
  inputDevices = devices.filter((d) => d.kind === "audioinput" && d.deviceId);
  outputDevices = devices.filter((d) => d.kind === "audiooutput" && d.deviceId);
  renderDevices();
}

async function applyLanguage(preference) {
  const locale = i18nResolve(preference);
  dict = await i18nLoad(locale);
  document.documentElement.lang = locale;
  i18nApply(document, dict);
  renderDevices();
  render(lastStatus);
}

function connect() {
  const s = saveSettings();
  if (!s.serverUrl || !s.room || !s.name) {
    localError = "errRequiredFields";
    showError(t("errRequiredFields"), false);
    return;
  }
  localError = "";
  showError("", false);
  els.stateLine.textContent = t("stateConnecting");
  clearReplyTimer();
  replyTimer = setTimeout(() => {
    replyTimer = null;
    localError = "errNoResponse";
    showError(t("errNoResponse"), false);
    els.stateLine.textContent = t("stateDisconnected");
  }, REPLY_TIMEOUT);
  apiSend({
    cmd: "connect",
    payload: {
      serverUrl: s.serverUrl,
      room: s.room,
      name: s.name,
      iceServers: ICE_SERVERS,
      audio: currentAudio()
    }
  });
}

function disconnect() {
  localError = "";
  clearReplyTimer();
  apiSend({ cmd: "disconnect" });
}

function showError(text, offerGrant) {
  els.errorLine.textContent = text;
  els.errorLine.hidden = !text;
  els.grantBtn.hidden = !offerGrant;
}

function sendPeerAudio(peerId, patch) {
  apiSend({ cmd: "setPeerAudio", peerId, patch });
}

function paintPeerMute(row) {
  const label = t(row.muted ? "peerUnmute" : "peerMute", { name: row.peerName });
  row.mute.classList.toggle("muted", row.muted);
  row.mute.title = label;
  row.mute.setAttribute("aria-label", label);
  row.mute.setAttribute("aria-pressed", String(row.muted));
}

function paintPeerVolume(row) {
  const open = !row.volumeRow.hidden;
  const label = t("peerVolume", { name: row.peerName });
  row.volumeToggle.classList.toggle("open", open);
  row.volumeToggle.title = label;
  row.volumeToggle.setAttribute("aria-label", label);
  row.volumeToggle.setAttribute("aria-expanded", String(open));
  row.volume.title = label;
}

function createPeerRow(peerId) {
  const li = els.peerTemplate.content.firstElementChild.cloneNode(true);
  const row = {
    li,
    label: li.querySelector(".peer-label"),
    mute: li.querySelector(".peer-mute"),
    volumeToggle: li.querySelector(".peer-volume-toggle"),
    volumeRow: li.querySelector(".peer-volume-row"),
    volume: li.querySelector(".peer-volume"),
    volumeValue: li.querySelector(".peer-volume-value"),
    muted: false,
    peerName: ""
  };

  row.mute.addEventListener("click", () => {
    row.muted = !row.muted;
    paintPeerMute(row);
    sendPeerAudio(peerId, { muted: row.muted });
  });

  row.volumeToggle.addEventListener("click", () => {
    row.volumeRow.hidden = !row.volumeRow.hidden;
    paintPeerVolume(row);
  });

  row.volume.addEventListener("input", () => {
    row.volumeValue.textContent = row.volume.value + "%";
    sendPeerAudio(peerId, { volume: Number(row.volume.value) });
  });

  return row;
}

function paintPeerLabel(row, text) {
  row.label.textContent = text;
  row.label.title = row.label.scrollWidth > row.label.clientWidth ? text : "";
}

function updatePeerRow(row, peer) {
  row.peerName = peer.name || t("peerAnonymous");
  paintPeerLabel(
    row,
    row.peerName + " (" + t(PEER_STATE_KEYS[peer.state] || "peerStateUnknown") + ")"
  );
  row.muted = !!peer.muted;
  paintPeerMute(row);
  paintPeerVolume(row);
  if (document.activeElement !== row.volume) {
    row.volume.value = peer.volume === undefined ? 100 : peer.volume;
  }
  row.volumeValue.textContent = row.volume.value + "%";
}

function renderPeers(peers) {
  const seen = new Set();
  for (const peer of peers) {
    seen.add(peer.id);
    let row = peerRows.get(peer.id);
    if (!row) {
      row = createPeerRow(peer.id);
      peerRows.set(peer.id, row);
      els.peers.appendChild(row.li);
    }
    updatePeerRow(row, peer);
  }
  for (const [id, row] of Array.from(peerRows)) {
    if (!seen.has(id)) {
      row.li.remove();
      peerRows.delete(id);
    }
  }
  els.peersEmpty.hidden = peers.length > 0;
}

function clearPeers() {
  renderPeers([]);
  els.peersEmpty.hidden = true;
}

function render(status) {
  lastStatus = status;
  const connected = !!(status && status.connected);
  const error = (status && status.error) || "";
  els.dot.classList.toggle("on", connected);
  els.connectBtn.hidden = connected;
  els.disconnectBtn.hidden = !connected;

  if (error) {
    showError(t(ERROR_KEYS[error] || error), error === "micPermission");
  } else if (localError) {
    showError(t(localError), false);
  } else {
    showError("", false);
  }

  if (!connected) {
    els.stateLine.textContent = t("stateDisconnected");
    els.talkLine.textContent = "";
    els.talkLine.className = "";
    clearPeers();
    return;
  }

  els.stateLine.textContent = t("stateConnected", { room: status.room || "" });

  if (status.teamsMuted) {
    els.talkLine.textContent = t("talkTeam");
    els.talkLine.className = "talk-team";
  } else {
    els.talkLine.textContent = t("talkClient");
    els.talkLine.className = "talk-client";
  }

  renderPeers(status.peers || []);
}

els.connectBtn.addEventListener("click", connect);
els.disconnectBtn.addEventListener("click", disconnect);

els.grantBtn.addEventListener("click", () => {
  api.tabs.create({ url: api.runtime.getURL("permission.html") });
});

els.settingsBtn.addEventListener("click", () => {
  els.settings.hidden = !els.settings.hidden;
});

els.listen.addEventListener("change", () => {
  saveSettings();
  apiSend({ cmd: "setListen", listen: els.listen.checked });
});

els.language.addEventListener("change", () => {
  const s = saveSettings();
  applyLanguage(s.language);
});

els.theme.addEventListener("change", () => {
  const s = saveSettings();
  themeApply(s.theme);
});

els.deviceGrantBtn.addEventListener("click", () => {
  api.tabs.create({ url: api.runtime.getURL("permission.html") });
});

for (const [el, key] of [
  [els.micDevice, "micDevice"],
  [els.speakerDevice, "speakerDevice"]
]) {
  el.addEventListener("change", () => {
    settings[key] = el.value;
    saveSettings();
    pushAudio();
  });
}

for (const el of [els.micVolume, els.teamVolume]) {
  el.addEventListener("input", () => {
    renderVolumeValues();
    pushAudio();
  });
  el.addEventListener("change", saveSettings);
}

navigator.mediaDevices.addEventListener("devicechange", loadDevices);

api.runtime.onMessage.addListener((msg) => {
  if (msg && msg.cmd === "status") {
    clearReplyTimer();
    render(msg.status);
  }
});

async function init() {
  const s = await loadSettings();
  themeApply(s.theme);
  await loadDevices();
  await applyLanguage(s.language);
  try {
    const status = await api.runtime.sendMessage({ cmd: "getStatus" });
    if (status) render(status);
  } catch (e) {}
}

init();
