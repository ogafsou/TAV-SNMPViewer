const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "..", "config.json");

const DEFAULT_CONFIG = {
  port: 80,
  "snmp-machines": "./snmp-machines.json",
  loglevel: "info",
  autorefresh_s: 30,
  monitoring_reference_mode: false
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
  const autorefreshS = Number(merged.autorefresh_s);

  return {
    port: Number.isFinite(port) && port >= 0 ? port : DEFAULT_CONFIG.port,
    machinesFile: resolveFromProjectRoot(merged["snmp-machines"] || DEFAULT_CONFIG["snmp-machines"]),
    loglevel: VALID_LOG_LEVELS.indexOf(loglevel) !== -1 ? loglevel : DEFAULT_CONFIG.loglevel,
    autorefresh_s: Number.isFinite(autorefreshS) && autorefreshS >= 0
      ? Math.floor(autorefreshS)
      : DEFAULT_CONFIG.autorefresh_s,
    monitoring_reference_mode: merged.monitoring_reference_mode === true
  };
}

function saveMonitoringReferenceMode(enabled) {
  let storedConfig = {};

  try {
    storedConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch (error) {
    console.warn("[warning] Unable to read config.json before saving, using defaults:", error.message);
  }

  storedConfig = Object.assign({}, DEFAULT_CONFIG, storedConfig, {
    monitoring_reference_mode: enabled === true
  });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(storedConfig, null, 2) + "\n", "utf8");
  exportedConfig.monitoring_reference_mode = storedConfig.monitoring_reference_mode;
  return exportedConfig.monitoring_reference_mode;
}

function resolveFromProjectRoot(value) {
  if (path.isAbsolute(value)) {
    return value;
  }

  return path.resolve(__dirname, "..", value);
}

const exportedConfig = readConfig();
exportedConfig.saveMonitoringReferenceMode = saveMonitoringReferenceMode;

module.exports = exportedConfig;
