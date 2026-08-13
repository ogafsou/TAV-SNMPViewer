"use strict";

const assert = require("assert");
const snmp = require("net-snmp");
const { startTrapReceiver } = require("./novastar-trap-test");

const TEST_PORT = 21162;

async function run() {
  let receiver;
  let session;

  try {
    const received = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Aucun trap reçu pendant l'auto-test")), 3000);
      receiver = startTrapReceiver({
        port: TEST_PORT,
        expectedIp: null,
        onError: reject,
        onNotification(notification) {
          clearTimeout(timer);
          resolve(notification);
        }
      });
    });

    session = snmp.createSession("127.0.0.1", "public", {
      version: snmp.Version2c,
      trapPort: TEST_PORT,
      timeout: 1000,
      retries: 0
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    await new Promise((resolve, reject) => {
      session.trap("1.3.6.1.4.1.319.10.100.6", [{
        oid: "1.3.6.1.4.1.319.10.100.6",
        type: snmp.ObjectType.OctetString,
        value: "AUTO-TEST NOVASTAR"
      }], (error) => error ? reject(error) : resolve());
    });

    const notification = await received;
    assert(notification.pdu.varbinds.some((item) =>
      item.oid === "1.3.6.1.4.1.319.10.100.6" &&
      item.value.toString() === "AUTO-TEST NOVASTAR"
    ));
    console.log("Récepteur de traps NovaStar : OK");
  } finally {
    if (session) session.close();
    if (receiver) receiver.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
