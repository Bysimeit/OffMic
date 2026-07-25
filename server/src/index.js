import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.PORT) || 48085;
const HOST = process.env.HOST || "";
const SITE = process.env.SITE_URL || "https://offmic.xeron.be";
const rooms = new Map();

const pages = dirname(fileURLToPath(import.meta.url));
const landing = readFileSync(join(pages, "landing.html"));
const privacy = readFileSync(join(pages, "privacy.html"));

const robots = `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`;

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${SITE}/</loc></url>
  <url><loc>${SITE}/privacy</loc></url>
</urlset>
`;

const server = createServer((req, res) => {
  const path = (req.url || "/").split("?")[0].replace(/\/+$/, "") || "/";
  const readable = req.method === "GET" || req.method === "HEAD";

  if (!readable) {
    res.writeHead(405, { "content-type": "text/plain; charset=utf-8", allow: "GET, HEAD" });
    res.end("Method not allowed\n");
    return;
  }

  if (path === "/robots.txt") {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end(robots);
    return;
  }

  if (path === "/sitemap.xml") {
    res.writeHead(200, { "content-type": "application/xml; charset=utf-8" });
    res.end(sitemap);
    return;
  }

  if (path === "/privacy") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(privacy);
    return;
  }

  if (path === "/health") {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end("OffMic signaling OK\n");
    return;
  }

  if (path === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(landing);
    return;
  }

  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("Not found\n");
});

const wss = new WebSocketServer({ server });

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

if (HOST) server.listen(PORT, HOST);
else server.listen(PORT);

server.on("listening", () => {
  console.log(`OffMic signaling server listening on port ${PORT}`);
});
