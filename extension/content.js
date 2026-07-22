const MUTED_HINTS = [
  "unmute",
  "reactiver",
  "réactiver",
  "activer le micro",
  "activer le microphone",
  "activa microfono",
  "stummschaltung aufheben"
];

const UNMUTED_HINTS = [
  "mute microphone",
  "mute mic",
  "couper le micro",
  "couper le microphone",
  "disattiva microfono",
  "mikrofon stummschalten"
];

const SELECTORS = [
  "#microphone-button",
  '[data-tid="toggle-mute"]',
  '[data-tid="microphone-button"]',
  'button[aria-label*="micro" i]',
  'button[title*="micro" i]'
];

function findMicButton() {
  for (const selector of SELECTORS) {
    const el = document.querySelector(selector);
    if (el) return el;
  }
  return null;
}

function readMuted() {
  const btn = findMicButton();
  if (!btn) return null;
  const label = (
    (btn.getAttribute("aria-label") || "") + " " + (btn.getAttribute("title") || "")
  ).toLowerCase();
  if (!label.trim()) return null;
  if (label.includes("unmute")) return true;
  for (const hint of MUTED_HINTS) {
    if (label.includes(hint)) return true;
  }
  for (const hint of UNMUTED_HINTS) {
    if (label.includes(hint)) return false;
  }
  if (label.includes("mute")) return false;
  return null;
}

let lastState = null;

function poll() {
  const muted = readMuted();
  if (muted === null) return;
  if (muted !== lastState) {
    lastState = muted;
    try {
      chrome.runtime.sendMessage({ cmd: "muteState", muted });
    } catch (e) {}
  }
}

const observer = new MutationObserver(() => poll());
observer.observe(document.documentElement, {
  subtree: true,
  childList: true,
  attributes: true,
  attributeFilter: ["aria-label", "title", "data-tid"]
});

setInterval(poll, 1500);
poll();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.cmd === "requestMuteState") {
    lastState = null;
    poll();
    sendResponse({ muted: lastState });
  }
});
