const http = require("http");
const { createBackend } = require("./app");
const { WebSocketServer } = require("./lib/WebSocketServer");
const logger = require("./classes/Logger");
const serverLogger = logger.child("BackendServer");

const backend = createBackend();
const server = http.createServer(backend.app);
const webSocket = new WebSocketServer({
  path: "/ws",
  snapshot: () => backend.monitoring.snapshot(),
  authorize: (request) => !backend.auth || backend.auth.authenticateRequest(request)
}).attach(server);
backend.monitoring.on("message", (message) => webSocket.broadcast(message));

server.listen(backend.config.port, () => {
  serverLogger.info("TAV Monitoring Backend listening", { port: server.address().port });
  backend.trapReceiver.start();
  backend.monitoring.start();
});

let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  backend.monitoring.stop();
  backend.trapReceiver.stop();
  webSocket.close();
  server.close(() => { logger.close(); process.exit(0); });
  setTimeout(() => { logger.close(); process.exit(1); }, 5000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

module.exports = { server, backend, webSocket };
