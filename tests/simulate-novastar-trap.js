"use strict";

const snmp = require("net-snmp");

const host = process.env.TRAP_HOST || "127.0.0.1";
const port = Number(process.env.TRAP_PORT || 1162);
const kind = String(process.env.TRAP_KIND || "input").toLowerCase();
const slot = Number(process.env.TRAP_SLOT || 1);
const ioPort = Number(process.env.TRAP_IO_PORT || 1);
const durationMs = Number(process.env.TRAP_DURATION_MS || 250);
const oid = kind === "output" ? "1.3.6.1.4.1.319.10.100.7" : "1.3.6.1.4.1.319.10.100.6";
const session = snmp.createSession(host, "public", { version: snmp.Version2c, trapPort: port, retries: 0 });

function send(state) {
  const value = JSON.stringify({ kind, slot, port: ioPort, state });
  return new Promise((resolve, reject) => session.trap(oid, [{ oid, type: snmp.ObjectType.OctetString, value }],
    (error) => error ? reject(error) : resolve()));
}

(async () => {
  await send("loss");
  await new Promise((resolve) => setTimeout(resolve, durationMs));
  await send("recovery");
  console.log("Microcoupure simulée envoyée", { host, port, kind, slot, ioPort, durationMs });
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => session.close());
