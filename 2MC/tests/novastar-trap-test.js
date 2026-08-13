"use strict";

const snmp = require("net-snmp");

const NOVASTAR_IP = process.env.NOVASTAR_IP || "192.168.69.86";
const LISTEN_PORT = Number(process.env.TRAP_PORT || 1162);
const WAIT_SECONDS = Number(process.env.TRAP_WAIT_SECONDS || 0);

function printableValue(value) {
  if (Buffer.isBuffer(value)) {
    const text = value.toString("utf8");
    return /^[\x20-\x7e]*$/.test(text) ? text : `0x${value.toString("hex")}`;
  }
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function formatNotification(notification) {
  const source = notification.rinfo && notification.rinfo.address || "inconnue";
  const pdu = notification.pdu || {};
  const lines = [
    `[${new Date().toISOString()}] Trap reçu de ${source}`,
    `  Type : ${snmp.PduType[pdu.type] || pdu.type || "inconnu"}`
  ];

  if (pdu.enterprise) lines.push(`  Enterprise : ${pdu.enterprise}`);
  (pdu.varbinds || []).forEach((varbind) => {
    lines.push(`  ${varbind.oid} = ${printableValue(varbind.value)}`);
  });
  return lines.join("\n");
}

function startTrapReceiver(options = {}) {
  const port = Number(options.port || LISTEN_PORT);
  const expectedIp = options.expectedIp === undefined ? NOVASTAR_IP : options.expectedIp;
  const onNotification = options.onNotification || (() => {});

  const receiver = snmp.createReceiver({
    port,
    address: options.address || "0.0.0.0",
    transport: "udp4",
    disableAuthorization: true,
    includeAuthentication: true
  }, (error, notification) => {
    if (error) {
      if (options.onError) options.onError(error);
      else console.error(`Erreur de réception SNMP : ${error.message}`);
      return;
    }

    const source = notification.rinfo && notification.rinfo.address;
    const expected = !expectedIp || source === expectedIp;
    console.log(formatNotification(notification));
    if (!expected) {
      console.log(`  Attention : source différente du NovaStar attendu (${expectedIp})`);
    }
    onNotification(notification, expected);
  });

  return receiver;
}

function runCli() {
  console.log(`Écoute des traps SNMP sur UDP ${LISTEN_PORT}`);
  console.log(`NovaStar attendu : ${NOVASTAR_IP}`);
  console.log(`Configurer le H avec la destination <IP_DE_CE_PC>:${LISTEN_PORT}`);
  console.log("Appuyez sur Ctrl+C pour arrêter.\n");

  let receiver;
  try {
    receiver = startTrapReceiver();
  } catch (error) {
    console.error(`Impossible d'ouvrir le port UDP ${LISTEN_PORT} : ${error.message}`);
    process.exitCode = 1;
    return;
  }

  if (WAIT_SECONDS > 0) {
    setTimeout(() => {
      console.error(`Aucun test supplémentaire : fin de l'écoute après ${WAIT_SECONDS} s.`);
      receiver.close();
    }, WAIT_SECONDS * 1000);
  }
}

if (require.main === module) runCli();

module.exports = { formatNotification, printableValue, startTrapReceiver };
