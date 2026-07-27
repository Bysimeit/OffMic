if (typeof importScripts === "function") {
  importScripts("compat.js", "i18n.js");
}

const HAS_OFFSCREEN = !!(api.offscreen && api.offscreen.createDocument);
const KEEP_ALIVE_INTERVAL = 20000;

let creating = null;
let keepAliveTimer = null;
let mediaTabId = null;
let pendingPayload = null;
let lastStatus = { connected: false, teamsMuted: false, transmitting: false, peers: [] };

const MARK_COLOR = "#4f6bed";
const LIVE_COLOR = "#2f9e44";
const ICON_SIZES = [16, 32, 48, 128];

const TUNING = {
  default: { outer: 15.2, inner: 11.7, mic: 0.8 },
  16: { outer: 15.7, inner: 12.6, mic: 0.88 }
};

function drawMark(size, connected) {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d");
  const tuning = TUNING[size] || TUNING.default;

  ctx.clearRect(0, 0, size, size);
  ctx.scale(size / 32, size / 32);

  ctx.fillStyle = connected ? LIVE_COLOR : MARK_COLOR;
  ctx.beginPath();
  ctx.arc(16, 16, tuning.outer, 0, Math.PI * 2);
  ctx.arc(16, 16, tuning.inner, 0, Math.PI * 2);
  ctx.fill("evenodd");

  ctx.fillStyle = MARK_COLOR;
  ctx.translate(16, 15.75);
  ctx.scale(tuning.mic, tuning.mic);
  ctx.translate(-16, -15.75);

  ctx.beginPath();
  ctx.roundRect(12.2, 3, 7.6, 15, 3.8);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(16, 14, 9.6, 0, Math.PI);
  ctx.arc(16, 14, 6.6, Math.PI, 0, true);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.roundRect(14.4, 21.5, 3.2, 7, 1.6);
  ctx.fill();

  return ctx.getImageData(0, 0, size, size);
}

async function updateIcon(status) {
  const connected = !!(status && status.connected);
  const imageData = {};
  for (const size of ICON_SIZES) {
    imageData[size] = drawMark(size, connected);
  }
  api.action.setIcon({ imageData });
  api.action.setBadgeText({ text: "" });

  const { dict } = await i18nLoadPreferred();
  api.action.setTitle({
    title: i18nText(dict, connected ? "actionTitleConnected" : "actionTitle")
  });
}

function setKeepAlive(on) {
  if (HAS_OFFSCREEN) return;
  if (on && !keepAliveTimer) {
    keepAliveTimer = setInterval(() => {
      const pending = api.runtime.getPlatformInfo();
      if (pending && typeof pending.catch === "function") {
        pending.catch(() => {});
      }
    }, KEEP_ALIVE_INTERVAL);
  } else if (!on && keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}

function applyStatus(status) {
  lastStatus = status;
  updateIcon(status);
  setKeepAlive(!!(status && status.connected));
}

api.runtime.onStartup.addListener(() => updateIcon(null));
api.runtime.onInstalled.addListener(() => updateIcon(null));

api.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.settings) {
    updateIcon(lastStatus);
  }
});

const TEAMS_URLS = [
  "https://teams.microsoft.com/*",
  "https://teams.live.com/*",
  "https://teams.cloud.microsoft/*"
];

async function findTeamsTab() {
  const active = await api.tabs.query({ url: TEAMS_URLS, active: true, currentWindow: true });
  if (active && active.length) return active[0].id;
  const any = await api.tabs.query({ url: TEAMS_URLS });
  if (any && any.length) return any[0].id;
  return null;
}

async function ensureMediaHost() {
  if (HAS_OFFSCREEN) {
    const has = await api.offscreen.hasDocument();
    if (has) return;
    if (!creating) {
      creating = api.offscreen.createDocument({
        url: "offscreen.html",
        reasons: ["USER_MEDIA", "AUDIO_PLAYBACK"],
        justification: "Microphone capture and WebRTC connections for the team voice channel."
      });
    }
    try {
      await creating;
    } finally {
      creating = null;
    }
    return;
  }

  const tabId = await findTeamsTab();
  if (tabId === null) throw new Error("noTeamsTab");
  await api.tabs.sendMessage(tabId, { target: "media", cmd: "ping" }, { frameId: 0 });
  mediaTabId = tabId;
}

function pushError(code) {
  lastStatus = Object.assign({}, lastStatus, { connected: false, error: code });
  apiSend({ cmd: "status", status: lastStatus });
  updateIcon(lastStatus);
}

async function toMedia(cmd, extra) {
  const msg = Object.assign({ target: "media", cmd }, extra || {});
  if (HAS_OFFSCREEN) {
    apiSend(msg);
    return;
  }
  if (mediaTabId === null) {
    try {
      mediaTabId = await findTeamsTab();
    } catch (e) {
      return;
    }
  }
  if (mediaTabId !== null) {
    apiSendTab(mediaTabId, msg, { frameId: 0 });
  }
}

function dropMediaHost() {
  mediaTabId = null;
  applyStatus({ connected: false, teamsMuted: false, transmitting: false, peers: [], error: "noTeamsTab" });
  apiSend({ cmd: "status", status: lastStatus });
}

function syncMuteState() {
  api.tabs
    .query({ url: TEAMS_URLS })
    .then((tabs) => {
      for (const tab of tabs || []) {
        apiSendTab(tab.id, { cmd: "requestMuteState" });
      }
    })
    .catch(() => {});
}

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.cmd) return;

  if (msg.cmd === "connect") {
    pendingPayload = msg.payload;
    ensureMediaHost()
      .then(() => {
        toMedia("prepare", { payload: msg.payload });
        syncMuteState();
      })
      .catch((e) => {
        console.error("OffMic: media context unavailable", e);
        pushError(e && e.message === "noTeamsTab" ? "noTeamsTab" : "offscreenFailed");
      });
    sendResponse({ ok: true });
    return true;
  }

  if (msg.cmd === "disconnect") {
    pendingPayload = null;
    if (!HAS_OFFSCREEN) signalClose();
    toMedia("disconnect");
    sendResponse({ ok: true });
    return true;
  }

  if (msg.cmd === "mediaReady") {
    if (!HAS_OFFSCREEN && pendingPayload) signalOpen(pendingPayload, msg.peerId);
    return;
  }

  if (msg.cmd === "signalOut") {
    if (!HAS_OFFSCREEN) signalSend(msg.msg);
    return;
  }

  if (msg.cmd === "muteState") {
    toMedia("muteState", { muted: msg.muted });
    return;
  }

  if (msg.cmd === "setListen") {
    toMedia("setListen", { listen: msg.listen });
    return;
  }

  if (msg.cmd === "setAudio") {
    toMedia("setAudio", { audio: msg.audio });
    return;
  }

  if (msg.cmd === "setPeerAudio") {
    toMedia("setPeerAudio", { peerId: msg.peerId, patch: msg.patch });
    return;
  }

  if (msg.cmd === "getStatus") {
    toMedia("getStatus");
    syncMuteState();
    sendResponse(lastStatus);
    return true;
  }

  if (msg.cmd === "status") {
    applyStatus(msg.status);
    return;
  }
});

if (!HAS_OFFSCREEN) {
  offmicSignalHooks.message = (msg) => toMedia("signalIn", { msg });
  offmicSignalHooks.link = (connected) => toMedia("link", { connected });
  offmicSignalHooks.error = (code) => toMedia("fail", { code });

  api.tabs.onRemoved.addListener((tabId) => {
    if (tabId === mediaTabId && lastStatus && lastStatus.connected) dropMediaHost();
    else if (tabId === mediaTabId) mediaTabId = null;
  });

  api.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (tabId !== mediaTabId || changeInfo.status !== "loading") return;
    if (lastStatus && lastStatus.connected) dropMediaHost();
    else mediaTabId = null;
  });
}
