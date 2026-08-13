const snmp = require("net-snmp");

const OIDS = {
  system: "1.3.6.1.2.1.1",
  ifTable: "1.3.6.1.2.1.2.2.1",
  ifXTable: "1.3.6.1.2.1.31.1.1.1",
  poePortTable: "1.3.6.1.2.1.105.1.1.1"
};

class NetgearM4300SnmpConnector {
  constructor(options = {}) {
    this.host = options.host;
    this.readCommunity = options.readCommunity || "public";
    this.timeout = Number(options.timeout || 2000);
    this.retries = Number(options.retries || 1);
    this.port = Number(options.port || 161);
  }

  createSession() {
    const session = snmp.createSession(this.host, this.readCommunity, {
      version: snmp.Version2c,
      timeout: this.timeout,
      retries: this.retries,
      port: this.port
    });

    session.on("error", (error) => {
      console.error("SNMP session protocol error", {
        host: this.host,
        port: this.port,
        error: error.message
      });
    });

    return session;
  }

  get(oids) {
    return this.withSession((session, done) => session.get(oids, done));
  }

  subtree(oid) {
    return this.withSession((session, done) => {
      const rows = [];
      session.subtree(oid, 32, (varbinds) => rows.push(...varbinds), (error) => done(error, rows));
    });
  }

  withSession(operation) {
    return new Promise((resolve, reject) => {
      const session = this.createSession();
      operation(session, (error, result) => {
        session.close();
        if (error) reject(error);
        else resolve(result);
      });
    });
  }

  async monitor(options = {}) {
    const [system, interfaces, interfaceExtensions, poe] = await Promise.all([
      this.get([
        OIDS.system + ".1.0", OIDS.system + ".2.0", OIDS.system + ".3.0",
        OIDS.system + ".5.0", OIDS.system + ".6.0"
      ]),
      this.subtree(OIDS.ifTable),
      this.subtree(OIDS.ifXTable),
      options.includePoe ? this.subtree(OIDS.poePortTable).catch(() => []) : Promise.resolve([])
    ]);

    const systemValues = valuesByOid(system);
    const columns = tableColumns(interfaces, OIDS.ifTable);
    const extensionColumns = tableColumns(interfaceExtensions, OIDS.ifXTable);
    const poeColumns = tableColumns(poe, OIDS.poePortTable);
    const indexes = Object.keys(columns[2] || {}).sort(numericSort);
    const ports = indexes.filter((index) => isPhysicalPort(columns, extensionColumns, index)).map((index) => {
      const name = text(extensionColumns[1] && extensionColumns[1][index]) || text(columns[2][index]) || "Port " + index;
      const speedMbps = number(extensionColumns[15] && extensionColumns[15][index]) || Math.round(number(columns[5] && columns[5][index]) / 1000000);
      const operStatus = number(columns[8] && columns[8][index]);
      const adminStatus = number(columns[7] && columns[7][index]);
      const poeIndex = findPoeIndex(poeColumns, index);
      return {
        index: Number(index),
        name,
        description: text(columns[2][index]),
        media: inferMedia(name, text(columns[2][index]), speedMbps),
        speedMbps,
        adminUp: adminStatus === 1,
        linkUp: operStatus === 1,
        operStatus,
        poe: options.includePoe ? normalizePoe(poeColumns, poeIndex) : null
      };
    });

    return {
      type: "netgear-m4300",
      source: "snmp-v2c",
      host: this.host,
      timestamp: new Date().toISOString(),
      controller: {
        workingStatus: field("Online"),
        model: field(text(systemValues[OIDS.system + ".1.0"])),
        sysObjectId: field(text(systemValues[OIDS.system + ".2.0"])),
        workingTime: field(formatTicks(number(systemValues[OIDS.system + ".3.0"]))),
        systemName: field(text(systemValues[OIDS.system + ".5.0"])),
        location: field(text(systemValues[OIDS.system + ".6.0"]))
      },
      netgearPorts: ports,
      poeEnabled: options.includePoe === true,
      inputSlots: { count: 0, slots: [] },
      outputSlots: { count: 0, slots: [] },
      screens: { count: 0, screens: [] },
      receivingCards: []
    };
  }
}

function valuesByOid(varbinds) {
  return (varbinds || []).reduce((result, item) => {
    if (!snmp.isVarbindError(item)) result[item.oid] = item.value;
    return result;
  }, {});
}

function tableColumns(varbinds, root) {
  return (varbinds || []).reduce((result, item) => {
    if (snmp.isVarbindError(item)) return result;
    const suffix = item.oid.slice(root.length + 1).split(".");
    const column = Number(suffix.shift());
    const index = suffix.join(".");
    if (!result[column]) result[column] = {};
    result[column][index] = item.value;
    return result;
  }, {});
}

function isPhysicalPort(columns, extensions, index) {
  const type = number(columns[3] && columns[3][index]);
  const name = (text(extensions[1] && extensions[1][index]) + " " + text(columns[2] && columns[2][index])).toLowerCase();
  return type === 6 || type === 56 || /(^|\s)([gx]?[0-9]+\/|ethernet|sfp|port)/i.test(name);
}

function inferMedia(name, description, speedMbps) {
  const value = (name + " " + description).toLowerCase();
  if (/sfp|fiber|fibre|optical|qsfp/.test(value)) return "fiber";
  if (/lag|port-channel|loopback|vlan/.test(value)) return "logical";
  return speedMbps >= 10000 && /[xg]\d+\//.test(value) ? "fiber" : "copper";
}

function findPoeIndex(columns, interfaceIndex) {
  const indexes = Object.keys(columns[1] || {});
  return indexes.find((index) => index === String(interfaceIndex) || index.endsWith("." + interfaceIndex));
}

function normalizePoe(columns, index) {
  if (!index) return { supported: false, enabled: false, delivering: false };
  const enabled = number(columns[3] && columns[3][index]) === 1;
  const detection = number(columns[6] && columns[6][index]);
  return { supported: true, enabled, delivering: detection === 3, detectionStatus: detection };
}

function field(value, ok = true) { return { value: value || "-", ok }; }
function text(value) { return Buffer.isBuffer(value) ? value.toString("utf8").replace(/\0+$/, "") : value === undefined || value === null ? "" : String(value); }
function number(value) { const result = Number(value); return Number.isFinite(result) ? result : 0; }
function numericSort(a, b) { return Number(a) - Number(b); }
function formatTicks(ticks) {
  const seconds = Math.floor(ticks / 100);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  return (days ? days + " j " : "") + hours + " h";
}

NetgearM4300SnmpConnector.OIDS = OIDS;
module.exports = NetgearM4300SnmpConnector;
