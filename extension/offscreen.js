offmicSignalOut = signalSend;
offmicMediaReady = (peerId, payload) => signalOpen(payload, peerId);

offmicSignalHooks.message = (msg) => offmicMediaHandle({ cmd: "signalIn", msg });
offmicSignalHooks.link = (connected) => offmicMediaHandle({ cmd: "link", connected });
offmicSignalHooks.error = (code) => offmicMediaHandle({ cmd: "fail", code });

api.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.target !== "media") return;
  if (msg.cmd === "disconnect") signalClose();
  offmicMediaHandle(msg);
});
