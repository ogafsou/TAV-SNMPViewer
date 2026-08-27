"use strict";

const TRAP_NAMES = {
  "1.3.6.1.4.1.319.10.100.1": "deviceAlarm",
  "1.3.6.1.4.1.319.10.100.2": "inputCardSourceCount",
  "1.3.6.1.4.1.319.10.100.3": "outputCardSourceCount",
  "1.3.6.1.4.1.319.10.100.4": "genlock",
  "1.3.6.1.4.1.319.10.100.5": "snmpStartTime",
  "1.3.6.1.4.1.319.10.100.6": "inputSlotAlarm",
  "1.3.6.1.4.1.319.10.100.7": "outputSlotAlarm"
};

function decodeNovaStarTrap(notification, machine, receivedAt) {
  const pdu = notification && notification.pdu || {};
  const varbinds = (pdu.varbinds || []).map(normalizeVarbind);
  const trapOid = notificationOid(pdu, varbinds);
  const payload = parsePayload(varbinds);
  const kind = normalizeKind(payload.kind || payload.type || inferredKind(trapOid));
  const slot = firstValue(payload, ["slot", "slotId", "card", "cardId"]);
  const port = firstValue(payload, ["port", "portId", "source", "sourceId", "output", "outputId"]);
  const transition = normalizeTransition(payload.transition || payload.event || payload.state || payload.status);
  const entityId = canonicalEntityId(kind, slot, port);
  return {
    schemaVersion: 1,
    receivedAt: receivedAt || new Date().toISOString(),
    sourceAddress: notification && notification.rinfo && notification.rinfo.address || "",
    machineId: machine && String(machine.id) || "",
    machineName: machine && String(machine.name || machine.id) || "",
    trapOid,
    trapName: TRAP_NAMES[trapOid] || "unknown",
    pduType: pdu.type,
    kind,
    slotId: slot === undefined ? "" : String(slot),
    portId: port === undefined ? "" : String(port),
    entityId,
    transition,
    decoded: !!entityId && transition !== "unknown",
    payload,
    varbinds
  };
}

function normalizeVarbind(item) {
  return { oid: String(item && item.oid || ""), type: item && item.type, value: printableValue(item && item.value) };
}

function printableValue(value) {
  if (Buffer.isBuffer(value)) {
    const text = value.toString("utf8");
    return /^[\x20-\x7e]*$/.test(text) ? text : "0x" + value.toString("hex");
  }
  if (value === null || value === undefined) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function notificationOid(pdu, varbinds) {
  const standard = varbinds.find((item) => item.oid === "1.3.6.1.6.3.1.1.4.1.0");
  if (standard && standard.value) return standard.value;
  const known = varbinds.find((item) => TRAP_NAMES[item.oid]);
  return String(known && known.oid || pdu.enterprise || "");
}

function parsePayload(varbinds) {
  const payload = {};
  varbinds.forEach((item) => {
    const value = item.value;
    if (!value) return;
    try {
      const json = JSON.parse(value);
      if (json && typeof json === "object" && !Array.isArray(json)) Object.assign(payload, json);
    } catch (_) {
      String(value).split(/[;,|]/).forEach((part) => {
        const match = part.match(/^\s*([\w.-]+)\s*[:=]\s*(.*?)\s*$/);
        if (match) payload[match[1]] = match[2];
      });
    }
  });
  return payload;
}

function inferredKind(oid) { return oid.endsWith(".6") ? "input" : oid.endsWith(".7") ? "output" : "equipment"; }
function normalizeKind(value) {
  const text = String(value || "").toLowerCase();
  if (text.includes("input") || text === "in") return "input";
  if (text.includes("output") || text === "out") return "output";
  if (text.includes("screen")) return "screen";
  return "equipment";
}
function normalizeTransition(value) {
  const text = String(value === undefined ? "" : value).trim().toLowerCase();
  if (["loss", "lost", "down", "disconnect", "disconnected", "error", "alarm", "0"].includes(text)) return "loss";
  if (["recovery", "recovered", "up", "connect", "connected", "normal", "ok", "1"].includes(text)) return "recovery";
  return "unknown";
}
function canonicalEntityId(kind, slot, port) {
  if ((kind === "input" || kind === "output") && slot !== undefined && port !== undefined) {
    const prefix = kind === "input" ? "I-" : "O-";
    return kind + ":" + prefix + cleanNumber(slot) + ":" + cleanNumber(port);
  }
  if (kind === "screen" && slot !== undefined) return "screen:" + cleanNumber(slot);
  return "";
}
function cleanNumber(value) { const match = String(value).match(/(\d+)$/); return match ? match[1] : String(value); }
function firstValue(object, keys) { for (const key of keys) if (object[key] !== undefined && object[key] !== "") return object[key]; }

module.exports = { decodeNovaStarTrap, printableValue, TRAP_NAMES };
