const api = globalThis.browser || globalThis.chrome;

function apiSend(msg) {
  try {
    const result = api.runtime.sendMessage(msg);
    if (result && typeof result.catch === "function") {
      result.catch(() => {});
    }
  } catch (e) {}
}

function apiSendTab(tabId, msg, options) {
  try {
    const result = options
      ? api.tabs.sendMessage(tabId, msg, options)
      : api.tabs.sendMessage(tabId, msg);
    if (result && typeof result.catch === "function") {
      result.catch(() => {});
    }
  } catch (e) {}
}
