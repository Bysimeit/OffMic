importScripts("i18n.js");

let creating = null;
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
  chrome.action.setIcon({ imageData });
  chrome.action.setBadgeText({ text: "" });

  const { dict } = await i18nLoadPreferred();
  chrome.action.setTitle({
    title: i18nText(dict, connected ? "actionTitleConnected" : "actionTitle")
  });
}

chrome.runtime.onStartup.addListener(() => updateIcon(null));
chrome.runtime.onInstalled.addListener(() => updateIcon(null));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.settings) {
    updateIcon(lastStatus);
  }
});

async function ensureOffscreen() {
  const has = await chrome.offscreen.hasDocument();
  if (has) return;
  if (!creating) {
    creating = chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["USER_MEDIA"],
      justification: "Microphone capture and WebRTC connections for the team voice channel."
    });
  }
  try {
    await creating;
  } finally {
    creating = null;
  }
}

function pushError(code) {
  lastStatus = Object.assign({}, lastStatus, { connected: false, error: code });
  chrome.runtime.sendMessage({ cmd: "status", status: lastStatus }, () => chrome.runtime.lastError);
  updateIcon(lastStatus);
}

function toOffscreen(cmd, extra) {
  chrome.runtime.sendMessage(Object.assign({ target: "offscreen", cmd }, extra || {}));
}

const TEAMS_URLS = [
  "https://teams.microsoft.com/*",
  "https://teams.live.com/*",
  "https://teams.cloud.microsoft/*"
];

function syncMuteState() {
  chrome.tabs.query({ url: TEAMS_URLS }, (tabs) => {
    if (chrome.runtime.lastError || !tabs) return;
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { cmd: "requestMuteState" }, () => chrome.runtime.lastError);
    }
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.cmd) return;

  if (msg.cmd === "connect") {
    ensureOffscreen()
      .then(() => {
        toOffscreen("connect", { payload: msg.payload });
        syncMuteState();
      })
      .catch((e) => {
        console.error("OffMic: offscreen document unavailable", e);
        pushError("offscreenFailed");
      });
    sendResponse({ ok: true });
    return true;
  }

  if (msg.cmd === "disconnect") {
    toOffscreen("disconnect");
    sendResponse({ ok: true });
    return true;
  }

  if (msg.cmd === "muteState") {
    toOffscreen("muteState", { muted: msg.muted });
    return;
  }

  if (msg.cmd === "setListen") {
    toOffscreen("setListen", { listen: msg.listen });
    return;
  }

  if (msg.cmd === "getStatus") {
    toOffscreen("getStatus");
    syncMuteState();
    sendResponse(lastStatus);
    return true;
  }

  if (msg.cmd === "status") {
    lastStatus = msg.status;
    updateIcon(msg.status);
    return;
  }
});
