const http = require("http");
const fs = require("fs");
const path = require("path");
const snmp = require("net-snmp");

const ROOT = __dirname;
const settings = readJson("config.json", { host: "0.0.0.0", httpPort: 8091, snmpHost: "0.0.0.0", snmpPort: 1161, community: "public" });
const STATE_FILE = path.join(ROOT, "state.json");
let state = normalize(readJson("state.json", defaults()));

const agent = createSnmpAgent();
const mib = agent.getMib();
registerProviders(mib);
syncMib();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "GET" && url.pathname === "/") return file(res, "public/index.html", "text/html; charset=utf-8");
    if (req.method === "GET" && url.pathname === "/app.js") return file(res, "public/app.js", "text/javascript; charset=utf-8");
    if (req.method === "GET" && url.pathname === "/style.css") return file(res, "public/style.css", "text/css; charset=utf-8");
    if (req.method === "GET" && url.pathname === "/simulator/api/state") return json(res, 200, publicState());
    if (req.method === "PUT" && url.pathname === "/simulator/api/config") {
      state.config = Object.assign({}, state.config, await body(req));
      commit(); return json(res, 200, publicState());
    }
    if (req.method === "PUT" && url.pathname.startsWith("/simulator/api/ports/")) {
      const index = Number(url.pathname.split("/").pop());
      const port = state.ports.find((item) => item.index === index);
      if (!port) return json(res, 404, { error: "Port inconnu" });
      Object.assign(port, await body(req), { index });
      commit(); return json(res, 200, publicState());
    }
    if (req.method === "POST" && url.pathname === "/simulator/api/ports") {
      const input = await body(req);
      const index = Math.max(0, ...state.ports.map((item) => item.index)) + 1;
      state.ports.push(normalizePort(Object.assign({}, input, { index })));
      commit(); return json(res, 201, publicState());
    }
    if (req.method === "DELETE" && url.pathname.startsWith("/simulator/api/ports/")) {
      const index = Number(url.pathname.split("/").pop());
      state.ports = state.ports.filter((item) => item.index !== index);
      commit(); return json(res, 200, publicState());
    }
    if (req.method === "POST" && url.pathname === "/simulator/api/reset") {
      state = defaults(); commit(); return json(res, 200, publicState());
    }
    json(res, 404, { error: "Route inconnue" });
  } catch (error) { json(res, 500, { error: error.message }); }
});

function createSnmpAgent() {
  const instance = snmp.createAgent({
    address: process.env.SNMP_HOST || settings.snmpHost,
    port: Number(process.env.SNMP_PORT || settings.snmpPort),
    transport: "udp4",
    accessControlModelType: snmp.AccessControlModelType.Simple
  }, (error) => { if (error) console.error("SNMP:", error.message); });
  const community = process.env.SNMP_COMMUNITY || settings.community;
  instance.getAuthorizer().addCommunity(community);
  instance.getAuthorizer().getAccessControlModel().setCommunityAccess(community, snmp.AccessLevel.ReadOnly);
  return instance;
}

function registerProviders(target) {
  const scalar = (name, oid, scalarType) => ({ name, oid, type: snmp.MibProviderType.Scalar, scalarType, maxAccess: snmp.MaxAccess["read-only"] });
  target.registerProviders([
    scalar("sysDescr", "1.3.6.1.2.1.1.1", snmp.ObjectType.OctetString),
    scalar("sysObjectID", "1.3.6.1.2.1.1.2", snmp.ObjectType.OID),
    scalar("sysUpTime", "1.3.6.1.2.1.1.3", snmp.ObjectType.TimeTicks),
    scalar("sysName", "1.3.6.1.2.1.1.5", snmp.ObjectType.OctetString),
    scalar("sysLocation", "1.3.6.1.2.1.1.6", snmp.ObjectType.OctetString),
    {
      name: "ifEntry", oid: "1.3.6.1.2.1.2.2.1", type: snmp.MibProviderType.Table,
      maxAccess: snmp.MaxAccess["not-accessible"], tableIndex: [{ columnName: "ifIndex" }],
      tableColumns: [
        column(1, "ifIndex", snmp.ObjectType.Integer), column(2, "ifDescr", snmp.ObjectType.OctetString),
        column(3, "ifType", snmp.ObjectType.Integer), column(4, "ifMtu", snmp.ObjectType.Integer),
        column(5, "ifSpeed", snmp.ObjectType.Gauge32), column(6, "ifPhysAddress", snmp.ObjectType.OctetString),
        column(7, "ifAdminStatus", snmp.ObjectType.Integer), column(8, "ifOperStatus", snmp.ObjectType.Integer)
      ]
    },
    {
      name: "ifXEntry", oid: "1.3.6.1.2.1.31.1.1.1", type: snmp.MibProviderType.Table,
      maxAccess: snmp.MaxAccess["not-accessible"], tableIndex: [{ columnName: "ifIndex", foreign: "ifEntry" }],
      tableColumns: [column(1, "ifName", snmp.ObjectType.OctetString), column(15, "ifHighSpeed", snmp.ObjectType.Gauge32)]
    },
    {
      name: "pethPsePortEntry", oid: "1.3.6.1.2.1.105.1.1.1", type: snmp.MibProviderType.Table,
      maxAccess: snmp.MaxAccess["not-accessible"], tableIndex: [{ columnName: "pethPsePortGroupIndex" }, { columnName: "pethPsePortIndex" }],
      tableColumns: [
        column(1, "pethPsePortGroupIndex", snmp.ObjectType.Integer), column(2, "pethPsePortIndex", snmp.ObjectType.Integer),
        column(3, "pethPsePortAdminEnable", snmp.ObjectType.Integer), column(6, "pethPsePortDetectionStatus", snmp.ObjectType.Integer)
      ]
    }
  ]);
}

function column(number, name, type) { return { number, name, type, maxAccess: snmp.MaxAccess["read-only"] }; }

function syncMib() {
  mib.setScalarValue("sysDescr", state.config.model);
  mib.setScalarValue("sysObjectID", "1.3.6.1.4.1.4526.100.16.1");
  mib.setScalarValue("sysUpTime", Number(state.config.uptimeTicks));
  mib.setScalarValue("sysName", state.config.systemName);
  mib.setScalarValue("sysLocation", state.config.location);
  clearTable("ifEntry"); clearTable("ifXEntry"); clearTable("pethPsePortEntry");
  state.ports.forEach((port) => {
    mib.addTableRow("ifEntry", [port.index, port.description, 6, 1500, Math.min(port.speedMbps * 1000000, 4294967295), "", port.adminUp ? 1 : 2, port.linkUp ? 1 : 2]);
    mib.addTableRow("ifXEntry", [port.index, port.name, port.speedMbps]);
    if (port.poeSupported) mib.addTableRow("pethPsePortEntry", [1, port.index, port.poeEnabled ? 1 : 2, port.poeDelivering ? 3 : port.poeEnabled ? 2 : 1]);
  });
}

function clearTable(name) {
  let rows;
  try { rows = mib.getTableCells(name, true, true) || []; } catch (_) { return; }
  rows.forEach((row) => mib.deleteTableRow(name, row[0]));
}

function commit() { state = normalize(state); save(); syncMib(); }
function publicState() { return Object.assign({}, state, { connection: { host: "127.0.0.1", port: Number(process.env.SNMP_PORT || settings.snmpPort), community: process.env.SNMP_COMMUNITY || settings.community } }); }
function defaults() { return normalize({ config: { systemName: "M4300-SIM", model: "NETGEAR M4300 Simulator", location: "Regie", uptimeTicks: 8640000 }, ports: [
  { index: 1, name: "1/0/1", description: "Gigabit Ethernet 1/0/1", media: "copper", speedMbps: 1000, adminUp: true, linkUp: true, poeSupported: true, poeEnabled: true, poeDelivering: true },
  { index: 25, name: "SFP+ 1/0/25", description: "10G SFP+ optical 1/0/25", media: "fiber", speedMbps: 10000, adminUp: true, linkUp: true }
] }); }
function normalize(value) { const input = value && typeof value === "object" ? value : {}; return { config: Object.assign({ systemName: "M4300-SIM", model: "NETGEAR M4300 Simulator", location: "", uptimeTicks: 8640000 }, input.config || {}), ports: (Array.isArray(input.ports) ? input.ports : []).map(normalizePort) }; }
function normalizePort(port) { return { index: Number(port.index), name: String(port.name || "Port " + port.index), description: String(port.description || port.name || "Ethernet port"), media: port.media === "fiber" ? "fiber" : "copper", speedMbps: Math.max(0, Number(port.speedMbps || 0)), adminUp: port.adminUp !== false, linkUp: port.linkUp === true, poeSupported: port.poeSupported === true, poeEnabled: port.poeEnabled === true, poeDelivering: port.poeDelivering === true }; }
function readJson(name, fallback) { try { return JSON.parse(fs.readFileSync(path.join(ROOT, name), "utf8")); } catch (_) { return fallback; } }
function save() { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n", "utf8"); }
function json(res, status, value) { const data = JSON.stringify(value); res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(data) }); res.end(data); }
function file(res, name, type) { const data = fs.readFileSync(path.join(ROOT, name)); res.writeHead(200, { "content-type": type, "content-length": data.length }); res.end(data); }
function body(req) { return new Promise((resolve, reject) => { let data = ""; req.on("data", (chunk) => { data += chunk; }); req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch (_) { reject(new Error("JSON invalide")); } }); req.on("error", reject); }); }

const httpHost = process.env.HOST || settings.host;
const httpPort = Number(process.env.PORT || settings.httpPort);
if (require.main === module) server.listen(httpPort, httpHost, () => console.log(`NETGEAR Simulator UI: http://localhost:${httpPort} | SNMP v2c: 127.0.0.1:${process.env.SNMP_PORT || settings.snmpPort}`));
module.exports = { server, agent, defaults, syncMib };
