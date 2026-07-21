const fs = require("fs");
const path = require("path");

const DEFAULTS = {
  port: 3001,
  monitor_interval_s: 30,
  machines_file: "./machines.json",
  users_file: "./users.json",
  monitoring_reference_mode: false,
  loglevel: "info",
  max_parallel_scans: 8,
  alerts: {
    enabled: false,
    provider: "ntfy",
    server_url: "https://ntfy.sh",
    topic: "",
    token: "",
    frontend_url: "",
    public_status_enabled: false,
    public_status_secret: "",
    public_status_ttl_s: 86400,
    failure_threshold: 2,
    recovery_threshold: 2,
    request_timeout_ms: 5000,
    notify_recovery: true
  }
};

function loadConfig(configPath) {
  const filePath = path.resolve(configPath || process.env.TAV_BACKEND_CONFIG || path.join(__dirname, "..", "config.json"));
  let stored = {};
  try {
    stored = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const merged = Object.assign({}, DEFAULTS, stored);
  const configuredMachinesFile = process.env.TAV_MACHINES_FILE || merged.machines_file || DEFAULTS.machines_file;
  const configuredUsersFile = process.env.TAV_USERS_FILE || merged.users_file || DEFAULTS.users_file;
  return {
    configPath: filePath,
    port: numberInRange(merged.port, 0, 65535, DEFAULTS.port),
    monitor_interval_s: numberInRange(merged.monitor_interval_s, 0, 86400, DEFAULTS.monitor_interval_s),
    machinesFile: path.resolve(path.dirname(filePath), String(configuredMachinesFile)),
    machines_file: String(configuredMachinesFile),
    usersFile: path.resolve(path.dirname(filePath), String(configuredUsersFile)),
    users_file: String(configuredUsersFile),
    monitoring_reference_mode: merged.monitoring_reference_mode === true,
    loglevel: ["debug", "info", "warning", "error"].includes(String(merged.loglevel).toLowerCase())
      ? String(merged.loglevel).toLowerCase() : DEFAULTS.loglevel,
    max_parallel_scans: numberInRange(merged.max_parallel_scans, 1, 32, DEFAULTS.max_parallel_scans),
    alerts: normalizeAlerts(merged.alerts)
  };
}

function saveConfig(config, patch) {
  let stored = {};
  try {
    stored = JSON.parse(fs.readFileSync(config.configPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const next = Object.assign({}, DEFAULTS, stored, patch || {});
  fs.writeFileSync(config.configPath, JSON.stringify(next, null, 2) + "\n", "utf8");
  Object.assign(config, loadConfig(config.configPath));
  return config;
}

function numberInRange(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? Math.floor(number) : fallback;
}

function normalizeAlerts(value) {
  const stored = value && typeof value === "object" ? value : {};
  const merged = Object.assign({}, DEFAULTS.alerts, stored);
  return {
    enabled: merged.enabled === true,
    provider: String(merged.provider || "ntfy").toLowerCase(),
    server_url: String(merged.server_url || DEFAULTS.alerts.server_url).replace(/\/+$/, ""),
    topic: String(merged.topic || "").trim(),
    token: String(merged.token || "").trim(),
    frontend_url: String(merged.frontend_url || "").trim(),
    public_status_enabled: merged.public_status_enabled === true,
    public_status_secret: String(process.env.TAV_PUBLIC_STATUS_SECRET || merged.public_status_secret || ""),
    public_status_ttl_s: numberInRange(merged.public_status_ttl_s, 60, 604800, DEFAULTS.alerts.public_status_ttl_s),
    failure_threshold: numberInRange(merged.failure_threshold, 1, 20, DEFAULTS.alerts.failure_threshold),
    recovery_threshold: numberInRange(merged.recovery_threshold, 1, 20, DEFAULTS.alerts.recovery_threshold),
    request_timeout_ms: numberInRange(merged.request_timeout_ms, 500, 30000, DEFAULTS.alerts.request_timeout_ms),
    notify_recovery: merged.notify_recovery !== false
  };
}

module.exports = { loadConfig, saveConfig, DEFAULTS };
