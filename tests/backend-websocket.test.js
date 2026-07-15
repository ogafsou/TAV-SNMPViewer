const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const { WebSocketServer } = require("../TAV_Monitoring_Backend/lib/WebSocketServer");
const { listen, close, readWebSocketMessage } = require("./helpers");

test("WebSocket sends a complete initial snapshot larger than 64 KiB", async (t) => {
  const payload = "x".repeat(70000);
  const server = http.createServer();
  const webSocket = new WebSocketServer({ path: "/ws", snapshot: () => ({ revision: 1, machines: [], payload }) }).attach(server);
  const port = await listen(server);
  t.after(async () => { webSocket.close(); await close(server); });
  const message = await readWebSocketMessage(port, "/ws");
  assert.equal(message.type, "monitoring.snapshot");
  assert.equal(message.payload.length, 70000);
});
