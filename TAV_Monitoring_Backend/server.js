const http = require("http");
const { createBackend } = require("./app");
const { WebSocketServer } = require("./lib/WebSocketServer");
const logger = require("./classes/Logger");

const backend = createBackend();
const server = http.createServer(backend.app);
const webSocket = new WebSocketServer({
  path: "/ws",
  snapshot: () => backend.monitoring.snapshot(),
  authorize: (request) => !backend.auth || backend.auth.authenticateRequest(request)
}).attach(server);
backend.monitoring.on("message", (message) => webSocket.broadcast(message));

server.listen(backend.config.port, () => {
  logger.info("TAV Monitoring Backend listening", { port: server.address().port });
  backend.monitoring.start();
});

function shutdown() {
  backend.monitoring.stop();
  webSocket.close();
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

module.exports = { server, backend, webSocket };
