const els = {
  serverUrl: document.getElementById("serverUrl"),
  room: document.getElementById("room"),
  name: document.getElementById("name"),
  listen: document.getElementById("listen"),
  language: document.getElementById("language"),
  theme: document.getElementById("theme"),
  settings: document.getElementById("settings"),
  settingsBtn: document.getElementById("settingsBtn"),
  connectBtn: document.getElementById("connectBtn"),
  disconnectBtn: document.getElementById("disconnectBtn"),
  dot: document.getElementById("dot"),
  stateLine: document.getElementById("stateLine"),
  errorLine: document.getElementById("errorLine"),
  grantBtn: document.getElementById("grantBtn"),
  talkLine: document.getElementById("talkLine"),
  peers: document.getElementById("peers")
};

const ERROR_KEYS = {
  micPermission: "errMicPermission",
  micMissing: "errMicMissing",
  micFailed: "errMicFailed",
  badServerUrl: "errBadServerUrl",
  serverUnreachable: "errServerUnreachable",
  offscreenFailed: "errOffscreenFailed"
};

const REPLY_TIMEOUT = 8000;

const DEFAULTS = {
  serverUrl: typeof OFFMIC_CONFIG === "undefined" ? "" : OFFMIC_CONFIG.serverUrl,
  room: "",
  name: "",
  listen: true,
  language: "auto",
  theme: "auto"
};

const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

let dict = {};
let lastStatus = null;
let localError = "";
let replyTimer = null;

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
  const data = await chrome.storage.local.get("settings");
  const s = Object.assign({}, DEFAULTS, data.settings || {});
  els.serverUrl.value = s.serverUrl;
  els.room.value = s.room;
  els.name.value = s.name;
  els.listen.checked = s.listen;
  els.language.value = s.language;
  els.theme.value = s.theme;
  return s;
}

function saveSettings() {
  const settings = {
    serverUrl: els.serverUrl.value.trim(),
    room: els.room.value.trim(),
    name: els.name.value.trim(),
    listen: els.listen.checked,
    language: els.language.value,
    theme: els.theme.value
  };
  chrome.storage.local.set({ settings });
  return settings;
}

async function applyLanguage(preference) {
  const locale = i18nResolve(preference);
  dict = await i18nLoad(locale);
  document.documentElement.lang = locale;
  i18nApply(document, dict);
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
  chrome.runtime.sendMessage({
    cmd: "connect",
    payload: {
      serverUrl: s.serverUrl,
      room: s.room,
      name: s.name,
      iceServers: ICE_SERVERS
    }
  });
}

function disconnect() {
  localError = "";
  clearReplyTimer();
  chrome.runtime.sendMessage({ cmd: "disconnect" });
}

function showError(text, offerGrant) {
  els.errorLine.textContent = text;
  els.errorLine.hidden = !text;
  els.grantBtn.hidden = !offerGrant;
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
    els.peers.innerHTML = "";
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

  els.peers.innerHTML = "";
  const peers = status.peers || [];
  if (peers.length === 0) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = t("noPeers");
    els.peers.appendChild(li);
  } else {
    for (const p of peers) {
      const li = document.createElement("li");
      li.textContent =
        (p.name || t("peerAnonymous")) + " (" + (p.state || t("peerStateUnknown")) + ")";
      els.peers.appendChild(li);
    }
  }
}

els.connectBtn.addEventListener("click", connect);
els.disconnectBtn.addEventListener("click", disconnect);

els.grantBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("permission.html") });
});

els.settingsBtn.addEventListener("click", () => {
  els.settings.hidden = !els.settings.hidden;
});

els.listen.addEventListener("change", () => {
  saveSettings();
  chrome.runtime.sendMessage({ cmd: "setListen", listen: els.listen.checked });
});

els.language.addEventListener("change", () => {
  const s = saveSettings();
  applyLanguage(s.language);
});

els.theme.addEventListener("change", () => {
  const s = saveSettings();
  themeApply(s.theme);
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.cmd === "status") {
    clearReplyTimer();
    render(msg.status);
  }
});

async function init() {
  const s = await loadSettings();
  themeApply(s.theme);
  await applyLanguage(s.language);
  chrome.runtime.sendMessage({ cmd: "getStatus" }, (status) => {
    if (chrome.runtime.lastError) return;
    if (status) render(status);
  });
}

init();
