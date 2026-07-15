const LEVELS = { debug: 10, info: 20, warning: 30, error: 40 };
let currentLevel = "info";

function setLevel(level) {
  currentLevel = LEVELS[level] ? level : "info";
}

function log(level, message, metadata) {
  if (LEVELS[level] < LEVELS[currentLevel]) return;
  const details = metadata ? " " + JSON.stringify(redact(metadata)) : "";
  console.log("[" + new Date().toISOString() + "] [" + level + "] " + message + details);
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).reduce((result, key) => {
    result[key] = /password|community|secret|token|key/i.test(key) ? "[redacted]" : redact(value[key]);
    return result;
  }, {});
}

module.exports = {
  setLevel,
  debug: (message, metadata) => log("debug", message, metadata),
  info: (message, metadata) => log("info", message, metadata),
  warning: (message, metadata) => log("warning", message, metadata),
  error: (message, metadata) => log("error", message, metadata)
};
