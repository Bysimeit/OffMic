import { WebSocketServer } from "ws";

const PORT = Number(process.env.PORT) || 48085;
const HOST = process.env.HOST || "";
const options = { port: PORT };
if (HOST) options.host = HOST;
const wss = new WebSocketServer(options);
const rooms = new Map();

function roomSet(room) {
  if (!rooms.has(room)) rooms.set(room, new Map());
  return rooms.get(room);
}

function safeSend(ws, payload) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function onJoin(ws, msg) {
  if (!msg.room || !msg.peerId) return;
  ws.meta.room = msg.room;
  ws.meta.peerId = msg.peerId;
  ws.meta.name = msg.name || "";

  const set = roomSet(msg.room);
  const existing = [];
  for (const [id, peer] of set) {
    existing.push({ peerId: id, name: peer.meta.name });
  }

  set.set(msg.peerId, ws);
  safeSend(ws, { type: "peers", peers: existing });

  for (const [id, peer] of set) {
    if (id === msg.peerId) continue;
    safeSend(peer, { type: "peer-joined", peerId: msg.peerId, name: ws.meta.name });
  }
}

function onRelay(ws, msg) {
  const set = rooms.get(ws.meta.room);
  if (!set || !msg.to) return;
  const target = set.get(msg.to);
  if (!target) return;
  safeSend(target, {
    type: "signal",
    from: ws.meta.peerId,
    to: msg.to,
    name: ws.meta.name,
    data: msg.data
  });
}

function onLeave(ws) {
  const { room, peerId } = ws.meta;
  if (!room || !rooms.has(room)) return;
  const set = rooms.get(room);
  set.delete(peerId);
  for (const [, peer] of set) {
    safeSend(peer, { type: "peer-left", peerId });
  }
  if (set.size === 0) rooms.delete(room);
}

wss.on("connection", (ws) => {
  ws.meta = { room: null, peerId: null, name: null };

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      return;
    }
    if (msg.type === "join") onJoin(ws, msg);
    else if (msg.type === "signal") onRelay(ws, msg);
  });

  ws.on("close", () => onLeave(ws));
  ws.on("error", () => onLeave(ws));
});

console.log(`OffMic signaling server listening on port ${PORT}`);
