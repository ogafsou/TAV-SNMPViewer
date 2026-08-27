const http = require("http");
const { createFrontend } = require("./app");
const { attachWebSocketProxy } = require("./proxy");
const logger = require("./Logger");
const serverLogger = logger.child("UIServer");

const frontend = createFrontend();
const server = http.createServer(frontend.app);
attachWebSocketProxy(server, frontend.config.backend_ws_url, "/ws");
server.listen(frontend.config.port, () => {
  serverLogger.info("TAV Monitoring UI listening", { port: server.address().port });
});

let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  server.close(() => { logger.close(); process.exit(0); });
  setTimeout(() => { logger.close(); process.exit(1); }, 5000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

module.exports = { server, frontend };
