if (window.top === window) {
  offmicSignalOut = (msg) => apiSend({ cmd: "signalOut", msg });
  offmicMediaReady = (peerId) => apiSend({ cmd: "mediaReady", peerId });

  api.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.target !== "media") return;
    if (msg.cmd === "ping") return Promise.resolve({ ok: true });
    offmicMediaHandle(msg);
  });

  window.addEventListener("pagehide", () => {
    offmicMediaHandle({ cmd: "disconnect" });
  });
}
