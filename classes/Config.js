const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "..", "config.json");

const DEFAULT_CONFIG = {
  port: 80,
  "snmp-machines": "./snmp-machines.json",
  loglevel: "info"
};

const VALID_LOG_LEVELS = ["debug", "info", "warning", "error"];

function readConfig() {
  let config = {};

  try {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch (error) {
    console.warn("[warning] Unable to read config.json, using defaults:", error.message);
  }

  const merged = Object.assign({}, DEFAULT_CONFIG, config);
  const port = Number(merged.port);
  const loglevel = String(merged.loglevel || DEFAULT_CONFIG.loglevel).toLowerCase();

  return {
    port: Number.isFinite(port) && port >= 0 ? port : DEFAULT_CONFIG.port,
    machinesFile: resolveFromProjectRoot(merged["snmp-machines"] || DEFAULT_CONFIG["snmp-machines"]),
    loglevel: VALID_LOG_LEVELS.indexOf(loglevel) !== -1 ? loglevel : DEFAULT_CONFIG.loglevel
  };
}

function resolveFromProjectRoot(value) {
  if (path.isAbsolute(value)) {
    return value;
  }

  return path.resolve(__dirname, "..", value);
}

module.exports = readConfig();
