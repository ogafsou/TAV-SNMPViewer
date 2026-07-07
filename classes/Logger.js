const config = require("./Config");

const LEVELS = {
  debug: 10,
  info: 20,
  warning: 30,
  error: 40
};

const currentLevel = LEVELS[config.loglevel] || LEVELS.info;

function shouldLog(level) {
  return (LEVELS[level] || LEVELS.info) >= currentLevel;
}

function log(level, message, metadata) {
  if (!shouldLog(level)) {
    return;
  }

  const details = metadata ? " " + JSON.stringify(metadata) : "";
  console.log("[" + new Date().toISOString() + "] [" + level + "] " + message + details);
}

module.exports = {
  debug: (message, metadata) => log("debug", message, metadata),
  info: (message, metadata) => log("info", message, metadata),
  warning: (message, metadata) => log("warning", message, metadata),
  error: (message, metadata) => log("error", message, metadata),
  level: config.loglevel
};
