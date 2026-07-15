const http = require("http");
const { createFrontend } = require("./app");
const { attachWebSocketProxy } = require("./proxy");

const frontend = createFrontend();
const server = http.createServer(frontend.app);
attachWebSocketProxy(server, frontend.config.backend_ws_url, "/ws");
server.listen(frontend.config.port, () => {
  console.log("TAV Monitoring UI listening on port " + server.address().port);
});

module.exports = { server, frontend };
