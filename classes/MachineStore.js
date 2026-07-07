const fs = require("fs");
const path = require("path");
const config = require("./Config");
const logger = require("./Logger");

function ensureDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function normalizeMachines(value) {
  return Array.isArray(value) ? value : [];
}

function loadMachines() {
  try {
    if (!fs.existsSync(config.machinesFile)) {
      saveMachines([]);
      return [];
    }

    return normalizeMachines(JSON.parse(fs.readFileSync(config.machinesFile, "utf8")));
  } catch (error) {
    logger.error("Unable to load SNMP machines file", {
      file: config.machinesFile,
      error: error.message
    });
    return [];
  }
}

function saveMachines(machines) {
  ensureDirectory(config.machinesFile);
  fs.writeFileSync(config.machinesFile, JSON.stringify(normalizeMachines(machines), null, 2) + "\n", "utf8");
  logger.info("SNMP machines saved", {
    file: config.machinesFile,
    count: normalizeMachines(machines).length
  });
}

module.exports = {
  loadMachines,
  saveMachines
};
