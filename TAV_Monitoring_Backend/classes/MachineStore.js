const fs = require("fs");
const path = require("path");

class MachineStore {
  constructor(filePath) {
    this.filePath = filePath;
  }

  load() {
    try {
      if (!fs.existsSync(this.filePath)) {
        this.save([]);
        return [];
      }
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      return Array.isArray(parsed) ? parsed.map(normalizeMachine) : [];
    } catch (error) {
      error.message = "Unable to load machines: " + error.message;
      throw error;
    }
  }

  save(machines) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const normalized = (Array.isArray(machines) ? machines : []).map(normalizeMachine);
    const temporaryPath = this.filePath + "." + process.pid + ".tmp";
    const backupPath = this.filePath + ".bak";
    const content = JSON.stringify(normalized, null, 2) + "\n";
    let descriptor;
    try {
      descriptor = fs.openSync(temporaryPath, "w", 0o600);
      fs.writeFileSync(descriptor, content, "utf8");
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      if (fs.existsSync(this.filePath)) fs.copyFileSync(this.filePath, backupPath);
      fs.renameSync(temporaryPath, this.filePath);
    } catch (error) {
      if (descriptor !== undefined) fs.closeSync(descriptor);
      try { if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath); } catch (_) {}
      throw error;
    }
    return normalized;
  }

  create(input) {
    const machines = this.load();
    const machine = normalizeMachine(Object.assign({}, input, { id: String(input.id || Date.now()) }));
    validateMachine(machine);
    if (machines.some((item) => item.id === machine.id)) throw conflict("Machine id already exists");
    machines.push(machine);
    this.save(machines);
    return machine;
  }

  update(id, patch) {
    const machines = this.load();
    const index = machines.findIndex((item) => item.id === String(id));
    if (index < 0) throw notFound();
    const current = machines[index];
    const merged = preserveSecrets(current, patch || {});
    merged.id = current.id;
    machines[index] = normalizeMachine(merged);
    validateMachine(machines[index]);
    this.save(machines);
    return machines[index];
  }

  remove(id) {
    const machines = this.load();
    const index = machines.findIndex((item) => item.id === String(id));
    if (index < 0) throw notFound();
    const removed = machines.splice(index, 1)[0];
    this.save(machines);
    return removed;
  }

  find(id) {
    return this.load().find((item) => item.id === String(id)) || null;
  }
}

function normalizeMachine(value) {
  const machine = Object.assign({}, value || {});
  machine.id = String(machine.id || Date.now());
  machine.type = normalizeMachineType(machine.type);
  machine.name = String(machine.name || "").trim();
  machine.host = String(machine.host || "").trim();
  if (machine.type === "kiloview") {
    const threshold = Number(machine.kiloviewBitrateThresholdMbps);
    machine.kiloviewBitrateThresholdMbps = Number.isFinite(threshold) && threshold >= 0 && threshold <= 1000 ? threshold : 1;
  } else {
    delete machine.kiloviewBitrateThresholdMbps;
  }
  if (machine.apiProtocol !== undefined) {
    machine.apiProtocol = String(machine.apiProtocol).toLowerCase() === "legacy" ? "legacy" : "openapi";
  }
  if (machine.apiProjectId !== undefined) machine.apiProjectId = String(machine.apiProjectId || "").trim();
  if (machine.apiEncryption !== undefined) machine.apiEncryption = machine.apiEncryption === true;
  delete machine.model;
  return machine;
}

function normalizeMachineType(value) {
  const type = String(value || "novastar-h").toLowerCase();
  return ["novastar-h", "kiloview", "netgear-m4300", "other"].includes(type) ? type : "novastar-h";
}

function sanitizeMachine(machine) {
  const safe = Object.assign({}, machine);
  ["apiPassword", "apiSecretKey", "readCommunity", "writeCommunity"].forEach((key) => {
    safe[key + "Configured"] = !!safe[key];
    delete safe[key];
  });
  if (safe.monitoringReference) {
    safe.monitoringReference = {
      version: safe.monitoringReference.version,
      setAt: safe.monitoringReference.setAt
    };
  }
  return safe;
}

function preserveSecrets(current, patch) {
  const merged = Object.assign({}, current, patch);
  ["apiPassword", "apiSecretKey", "readCommunity", "writeCommunity"].forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(patch, key) || patch[key] === "") merged[key] = current[key];
  });
  return merged;
}

function validateMachine(machine) {
  if (!machine.name || !machine.host) {
    const error = new Error("name and host are required");
    error.status = 400;
    throw error;
  }
}

function notFound() { const error = new Error("Machine not found"); error.status = 404; return error; }
function conflict(message) { const error = new Error(message); error.status = 409; return error; }

module.exports = { MachineStore, normalizeMachine, sanitizeMachine, normalizeMachineType };
