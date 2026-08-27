"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const snmp = require("net-snmp");
const logger = require("../classes/Logger").child("TrapReceiverService");
const { decodeNovaStarTrap } = require("./NovaStarTrapDecoder");

class TrapReceiverService {
  constructor(options) {
    this.config = options.config || {};
    this.store = options.store;
    this.monitoring = options.monitoring;
    this.receiver = null;
    this.events = [];
    this.lastTrapAtByMachine = new Map();
    this.statusValue = { enabled: this.config.enabled === true, listening: false, error: "" };
  }

  start() {
    if (!this.config.enabled) return this.status();
    if (this.receiver) return this.status();
    if (!isLocalAddress(this.config.advertised_address)) {
      this.handleError(new Error("advertised_address is not assigned to this backend host: " + this.config.advertised_address));
      return this.status();
    }
    try {
      this.receiver = snmp.createReceiver({
        port: this.config.port,
        address: this.config.listen_address,
        transport: "udp4",
        disableAuthorization: true,
        includeAuthentication: true
      }, (error, notification) => error ? this.handleError(error) : this.handleNotification(notification));
      this.statusValue = { enabled: true, listening: true, error: "", listen: this.config.listen_address + ":" + this.config.port,
        advertised: this.config.advertised_address + ":" + this.config.port };
      logger.info("NovaStar trap receiver started", this.statusValue);
    } catch (error) { this.handleError(error); }
    return this.status();
  }

  stop() {
    if (this.receiver) this.receiver.close();
    this.receiver = null;
    this.statusValue.listening = false;
  }

  status() { return Object.assign({}, this.statusValue); }
  recentEvents(limit) { return this.events.slice(-Math.min(Math.max(Number(limit) || 100, 1), 1000)).reverse(); }
  lastTrapAt(machineId) { return this.lastTrapAtByMachine.get(String(machineId)) || null; }

  handleError(error) {
    this.statusValue = { enabled: this.config.enabled === true, listening: false, error: error.message };
    logger.error("NovaStar trap receiver failed", { error: error.message, port: this.config.port });
  }

  handleNotification(notification) {
    const source = notification && notification.rinfo && notification.rinfo.address || "";
    const machine = this.store.load().find((item) => item.type === "novastar-h" &&
      item.trapSnmpEnabled === true && hostOnly(item.host) === source);
    const event = decodeNovaStarTrap(notification, machine, new Date().toISOString());
    event.authorized = !!machine;
    this.appendEvent(event);
    if (!machine) {
      logger.warning("NovaStar trap ignored from unknown or disabled source", { source, trapOid: event.trapOid });
      return;
    }
    this.lastTrapAtByMachine.set(String(machine.id), event.receivedAt);
    logger.info("NovaStar trap received", { machineId: machine.id, trapOid: event.trapOid, entityId: event.entityId, transition: event.transition });
    const incident = this.monitoring.handleTrapEvent(event);
    if (incident) this.appendEvent({ schemaVersion: 1, recordType: "microInterruption", incident });
  }

  appendEvent(event) {
    this.events.push(event);
    if (this.events.length > 1000) this.events.shift();
    if (!this.config.event_log_file) return;
    try {
      fs.mkdirSync(path.dirname(this.config.event_log_file), { recursive: true });
      if (fs.existsSync(this.config.event_log_file) && fs.statSync(this.config.event_log_file).size >= this.config.max_log_bytes) {
        const rotated = this.config.event_log_file + ".1";
        if (fs.existsSync(rotated)) fs.unlinkSync(rotated);
        fs.renameSync(this.config.event_log_file, rotated);
      }
      fs.appendFileSync(this.config.event_log_file, JSON.stringify(event) + "\n", "utf8");
    } catch (error) { logger.error("NovaStar trap journal write failed", { error: error.message }); }
  }
}

function hostOnly(value) { return String(value || "").replace(/^https?:\/\//i, "").split(/[/:]/)[0]; }
function isLocalAddress(address) {
  if (!address || address === "0.0.0.0" || address === "127.0.0.1") return address === "127.0.0.1";
  return Object.values(os.networkInterfaces()).flat().some((item) => item && item.family === "IPv4" && item.address === address);
}

module.exports = TrapReceiverService;
