const crypto = require("crypto");
const AlertService = require("./AlertService");

class PublicStatusService {
  constructor(options) {
    const settings = options || {};
    this.config = settings.config || {};
    this.monitoring = settings.monitoring;
    this.store = settings.store;
    this.now = settings.now || (() => Date.now());
  }

  isConfigured() {
    return this.config.public_status_enabled === true
      && Buffer.byteLength(String(this.config.public_status_secret || ""), "utf8") >= 32
      && /^https?:\/\//i.test(this.config.frontend_url || "");
  }

  createToken() {
    if (!this.isConfigured()) return "";
    const ttlSeconds = Number(this.config.public_status_ttl_s) || 86400;
    const payload = base64Url(JSON.stringify({
      v: 1,
      exp: Math.floor(this.now() / 1000) + ttlSeconds,
      nonce: crypto.randomBytes(8).toString("hex")
    }));
    return `${payload}.${this.sign(payload)}`;
  }

  createLink() {
    const token = this.createToken();
    if (!token) return "";
    const url = new URL(this.config.frontend_url);
    url.pathname = `${url.pathname.replace(/\/$/, "")}/status`;
    url.search = "";
    url.hash = token;
    return url.toString();
  }

  verify(token) {
    if (!this.isConfigured() || typeof token !== "string" || token.length > 2048) return false;
    const parts = token.split(".");
    if (parts.length !== 2) return false;
    const expected = Buffer.from(this.sign(parts[0]));
    const supplied = Buffer.from(parts[1]);
    if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) return false;
    try {
      const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
      return payload.v === 1 && Number.isInteger(payload.exp) && payload.exp > Math.floor(this.now() / 1000);
    } catch (_) {
      return false;
    }
  }

  snapshot(token) {
    if (!this.verify(token)) {
      const error = new Error("Lien de statut invalide ou expire");
      error.status = 401;
      throw error;
    }
    const snapshot = this.monitoring.snapshot();
    const machineNames = new Map(this.store.load().map((machine) => [String(machine.id), machine.name || `Equipement ${machine.id}`]));
    const machines = (snapshot.machines || []).map((record) => {
      const issues = AlertService.collectIssues(record.view || {});
      const state = publicState(record.view, issues);
      const anomalies = issues.slice(0, 12).map((issue) => ({
        label: issue.label,
        state: publicIssueState(issue.state),
        status: issueStateLabel(issue.state),
        expected: issue.referenceState === undefined ? "Absent de la reference" : issueStateLabel(issue.referenceState)
      }));
      return {
        name: machineNames.get(String(record.machineId)) || "Equipement",
        state,
        label: stateLabel(state),
        issues: Math.max(issues.length, ["warning", "error"].includes(state) ? 1 : 0),
        anomalies,
        hiddenIssues: Math.max(0, issues.length - anomalies.length),
        updatedAt: record.timestamp || null
      };
    });
    const counts = { ok: 0, warning: 0, error: 0, unknown: 0 };
    machines.forEach((machine) => { counts[machine.state] += 1; });
    const state = counts.error ? "error" : counts.warning ? "warning" : counts.unknown ? "unknown" : "ok";
    return {
      state,
      label: stateLabel(state),
      generatedAt: snapshot.generatedAt,
      counts,
      machines
    };
  }

  sign(payload) {
    return crypto.createHmac("sha256", this.config.public_status_secret).update(payload).digest("base64url");
  }
}

function publicState(view, issues) {
  if (!view || view.connected === false || ["error", "offline"].includes(view.state) || (issues || []).some((issue) => ["error", "offline"].includes(issue.state))) return "error";
  if ((issues || []).length || view.state === "warning") return "warning";
  return ["ok", "inactive"].includes(view.state) ? "ok" : "unknown";
}

function stateLabel(state) {
  return { ok: "Operationnel", warning: "Avertissement", error: "Incident", unknown: "En attente" }[state];
}

function publicIssueState(state) {
  return ["error", "offline"].includes(state) ? "error" : "warning";
}

function issueStateLabel(state) {
  if (state === "online") return "En ligne";
  if (state === "offline") return "Hors ligne";
  if (state === "error") return "Erreur";
  if (state === "warning") return "Avertissement";
  if (state === "ok") return "OK";
  if (state === "inactive") return "Inactif";
  return "Inconnu";
}

function base64Url(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

module.exports = PublicStatusService;
