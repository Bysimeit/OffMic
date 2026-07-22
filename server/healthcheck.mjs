import { WebSocket } from "ws";

const port = Number(process.env.PORT) || 48085;
const socket = new WebSocket(`ws://127.0.0.1:${port}`);

const timer = setTimeout(() => {
  socket.terminate();
  process.exit(1);
}, 4000);

socket.on("open", () => {
  clearTimeout(timer);
  socket.close();
  process.exit(0);
});

socket.on("error", () => {
  clearTimeout(timer);
  process.exit(1);
});
