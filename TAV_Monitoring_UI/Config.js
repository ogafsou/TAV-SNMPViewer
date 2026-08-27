const fs = require("fs");
const path = require("path");

function loadConfig(configPath) {
  const filePath = path.resolve(configPath || process.env.TAV_UI_CONFIG || path.join(__dirname, "config.json"));
  const stored = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const port = Number(stored.port);
  const refresh = Number(stored.rest_refresh_s);
  const transparencyMatch = String(stored.bkgnd_transparency || "0%").trim().match(/^(\d+(?:\.\d+)?)%$/);
  const transparency = transparencyMatch ? Math.min(100, Math.max(0, Number(transparencyMatch[1]))) : 0;
  const logging = normalizeLogging(stored.logging, filePath);
  return {
    configPath: filePath,
    port: Number.isFinite(port) && port >= 0 && port <= 65535 ? Math.floor(port) : 3000,
    backend_rest_url: String(stored.backend_rest_url || "http://127.0.0.1:3001").replace(/\/$/, ""),
    backend_ws_url: String(stored.backend_ws_url || "ws://127.0.0.1:3001/ws"),
    rest_refresh_s: Number.isFinite(refresh) && refresh >= 0 ? Math.floor(refresh) : 60,
    bkgnd_transparency: transparency + "%",
    bkgnd_opacity: (100 - transparency) / 100,
    monitoring_problem_sound: String(stored.monitoring_problem_sound || "").trim(),
    monitoring_recovery_sound: String(stored.monitoring_recovery_sound || "").trim(),
    logging
  };
}

function normalizeLogging(value, configPath) {
  const stored = value && typeof value === "object" ? value : {};
  const level = String(stored.level || "info").toLowerCase();
  return {
    level: ["debug", "info", "warning", "error"].includes(level) ? level : "info",
    file_enabled: stored.file_enabled !== false,
    file: path.resolve(path.dirname(configPath), String(stored.file || "./logs/ui.log")),
    max_file_bytes: numberInRange(stored.max_file_bytes, 1024, 1073741824, 10485760),
    flush_interval_ms: numberInRange(stored.flush_interval_ms, 1000, 3600000, 30000),
    console_enabled: stored.console_enabled !== false,
    browser_logs_enabled: stored.browser_logs_enabled !== false,
    browser_batch_interval_ms: numberInRange(stored.browser_batch_interval_ms, 1000, 60000, 5000),
    browser_max_events_per_minute: numberInRange(stored.browser_max_events_per_minute, 10, 10000, 300)
  };
}

function numberInRange(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? Math.floor(number) : fallback;
}

module.exports = { loadConfig };
