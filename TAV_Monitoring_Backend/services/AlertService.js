const logger = require("../classes/Logger");

const COLLECTIONS = [
  "controller", "inputSlots", "outputSlots", "screens", "systemHealth",
  "mvrCards", "usbPorts", "fans", "powerSupplies", "receivingCards", "kiloview"
];

class AlertService {
  constructor(options) {
    this.config = options.config;
    this.notifier = options.notifier;
    this.states = new Map();
    this.queue = Promise.resolve();
  }

  status() {
    return {
      enabled: this.config.enabled === true,
      provider: this.config.provider,
      configured: this.notifier.isConfigured(),
      topicConfigured: !!this.config.topic,
      failure_threshold: this.config.failure_threshold,
      recovery_threshold: this.config.recovery_threshold,
      notify_recovery: this.config.notify_recovery !== false
    };
  }

  handleRecord(machine, record) {
    this.queue = this.queue.then(() => this.process(machine, record)).catch((error) => {
      logger.error("Alert processing failed", { machineId: machine && machine.id, error: error.message });
    });
    return this.queue;
  }

  async sendTest() {
    const response = await this.notifier.send({
      title: "TAV Monitoring - Test",
      message: "Notification ntfy de test. Le backend peut joindre le service.",
      priority: 3,
      tags: ["test_tube", "white_check_mark"]
    });
    logger.info("ntfy test notification sent");
    return response;
  }

  async process(machine, record) {
    if (!this.notifier.isConfigured() || !machine || !record || !record.view) return;
    const machineId = String(machine.id);
    const issues = collectIssues(record.view);
    const signature = JSON.stringify(issues.map((issue) => [issue.key, issue.state]));
    const previous = this.states.get(machineId) || {
      candidate: "", candidateCount: 0, active: "", activeIssues: []
    };

    if (signature === previous.candidate) previous.candidateCount += 1;
    else { previous.candidate = signature; previous.candidateCount = 1; }

    const threshold = issues.length ? this.config.failure_threshold : this.config.recovery_threshold;
    if (previous.candidateCount >= threshold && signature !== previous.active) {
      if (issues.length) {
        await this.sendProblem(machine, issues);
      } else if (previous.active && this.config.notify_recovery !== false) {
        await this.sendRecovery(machine, previous.activeIssues);
      }
      previous.active = signature;
      previous.activeIssues = issues;
    }
    this.states.set(machineId, previous);
  }

  async sendProblem(machine, issues) {
    const severity = issues.some((issue) => issue.state === "error" || issue.state === "offline") ? "error" : "warning";
    const shown = issues.slice(0, 6).map((issue) => `- ${issue.label}: ${stateLabel(issue.state)}`);
    if (issues.length > shown.length) shown.push(`- +${issues.length - shown.length} autre(s) probleme(s)`);
    const machineName = machine.name || machine.host || machine.id;
    await this.notifier.send({
      title: `${severity === "error" ? "ALERTE" : "WARNING"} - ${machineName}`,
      message: [`Machine : ${machineName}`, ...shown].join("\n"),
      priority: severity === "error" ? 5 : 4,
      tags: severity === "error" ? ["rotating_light", "red_circle"] : ["warning", "yellow_circle"]
    });
    logger.info("ntfy problem notification sent", { machineId: machine.id, severity, issues: issues.length });
  }

  async sendRecovery(machine, previousIssues) {
    await this.notifier.send({
      title: `RETABLI - ${machine.name || machine.host}`,
      message: `Retour a la normale apres ${previousIssues.length} probleme(s).`,
      priority: 3,
      tags: ["white_check_mark", "green_circle"]
    });
    logger.info("ntfy recovery notification sent", { machineId: machine.id });
  }
}

function collectIssues(view) {
  if (view.connected === false) return [{ key: "machine:offline", label: "Machine", state: "offline" }];
  const found = new Map();
  const collections = Object.assign({}, view, {
    kiloview: (view.kiloviewGroups || []).flatMap((group) => (group.items || []).map((item) => Object.assign({ groupTitle: group.title }, item)))
  });
  COLLECTIONS.forEach((name) => {
    (collections[name] || []).forEach((item) => {
      // Les alertes suivent la comparaison avec la reference, pas l'etat brut.
      // Un warning deja present dans la reference ne doit pas etre notifie.
      if (!item || item.changed !== true || !["warning", "error"].includes(item.state)) return;
      const key = item.referenceKey || `${name}:${item.label}`;
      found.set(key, { key, label: itemLabel(name, item), state: item.state });
    });
  });
  return Array.from(found.values()).sort((a, b) => a.key.localeCompare(b.key));
}

function itemLabel(collection, item) {
  if (collection === "kiloview") return `Kiloview ${item.groupTitle || ""} - ${item.label}`.trim();
  const coordinates = String(item.referenceKey || "").split(":");
  if (collection === "inputSlots" && coordinates[0] === "input") {
    const card = coordinates[1] || item.label;
    const input = coordinates[2];
    const type = interfaceType(item.icon);
    return input && input !== "-"
      ? `Carte d'entree ${card}, entree ${input}${type ? ` (${type})` : ""}`
      : `Carte d'entree ${card}`;
  }
  if (collection === "outputSlots" && coordinates[0] === "output") {
    const card = coordinates[1] || item.label;
    const output = coordinates[2];
    return output && output !== "-" ? `Carte de sortie ${card}, sortie ${output}` : `Carte de sortie ${card}`;
  }
  if (collection === "receivingCards" && coordinates[0] === "receiving") {
    return `Carte de reception ${coordinates.slice(1).join(".") || item.label}`;
  }
  const names = {
    controller: "Controleur", inputSlots: "Entree", outputSlots: "Sortie", screens: "Ecran",
    systemHealth: "Systeme", mvrCards: "MVR", usbPorts: "USB", fans: "Ventilateur",
    powerSupplies: "Alimentation", receivingCards: "Carte de reception"
  };
  return `${names[collection] || collection} ${item.label || ""}`.trim();
}

function interfaceType(icon) {
  const types = { hdmi: "HDMI", bnc: "SDI/BNC", sdi: "SDI", dvi: "DVI", dp: "DisplayPort", vga: "VGA", rj45: "RJ45" };
  return types[String(icon || "").toLowerCase()] || "";
}

function stateLabel(state) {
  return state === "offline" ? "Hors ligne" : state === "error" ? "Erreur" : "Avertissement";
}

AlertService.collectIssues = collectIssues;
module.exports = AlertService;
