var offmicSignalHooks = { message: null, link: null, error: null };

let signalSocket = null;
let signalOpened = false;

function signalSend(msg) {
  if (signalSocket && signalSocket.readyState === WebSocket.OPEN) {
    signalSocket.send(JSON.stringify(msg));
  }
}

function signalClose() {
  const socket = signalSocket;
  signalSocket = null;
  signalOpened = false;
  if (socket) {
    try {
      socket.close();
    } catch (e) {}
  }
}

function signalOpen(payload, peerId) {
  signalClose();

  let socket;
  try {
    socket = new WebSocket(payload.serverUrl);
  } catch (e) {
    if (offmicSignalHooks.error) offmicSignalHooks.error("badServerUrl");
    return;
  }

  signalSocket = socket;
  signalOpened = false;

  socket.addEventListener("open", () => {
    if (signalSocket !== socket) return;
    signalOpened = true;
    signalSend({ type: "join", room: payload.room, peerId, name: payload.name });
    if (offmicSignalHooks.link) offmicSignalHooks.link(true);
  });

  socket.addEventListener("message", (event) => {
    if (signalSocket !== socket) return;
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch (e) {
      return;
    }
    if (offmicSignalHooks.message) offmicSignalHooks.message(msg);
  });

  socket.addEventListener("close", () => {
    if (signalSocket !== socket) return;
    const wasOpen = signalOpened;
    signalSocket = null;
    signalOpened = false;
    if (!wasOpen && offmicSignalHooks.error) offmicSignalHooks.error("serverUnreachable");
    if (offmicSignalHooks.link) offmicSignalHooks.link(false);
  });

  socket.addEventListener("error", () => {
    if (signalSocket !== socket) return;
    if (!signalOpened && offmicSignalHooks.error) offmicSignalHooks.error("serverUnreachable");
  });
}
