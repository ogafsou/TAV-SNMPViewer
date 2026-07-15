const fs = require("fs");
const path = require("path");

function loadConfig(configPath) {
  const filePath = path.resolve(configPath || process.env.TAV_UI_CONFIG || path.join(__dirname, "config.json"));
  const stored = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const port = Number(stored.port);
  const refresh = Number(stored.rest_refresh_s);
  return {
    configPath: filePath,
    port: Number.isFinite(port) && port >= 0 && port <= 65535 ? Math.floor(port) : 3000,
    backend_rest_url: String(stored.backend_rest_url || "http://127.0.0.1:3001").replace(/\/$/, ""),
    backend_ws_url: String(stored.backend_ws_url || "ws://127.0.0.1:3001/ws"),
    rest_refresh_s: Number.isFinite(refresh) && refresh >= 0 ? Math.floor(refresh) : 60
  };
}

module.exports = { loadConfig };
