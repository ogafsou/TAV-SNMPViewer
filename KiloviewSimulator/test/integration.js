const assert = require("node:assert/strict");
const { server } = require("../server");
const KiloviewApiConnector = require("../../TAV_Monitoring_Backend/classes/KiloviewApiLib");

(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fetch(`${base}/simulator/api/reset`, { method: "POST" });
    const encoder = await new KiloviewApiConnector({ host: base, username: "admin", password: "admin" }).monitor();
    assert.equal(encoder.type, "kiloview");
    assert.equal(encoder.kiloviewMode, "encoder");
    assert.equal(encoder.kiloviewProtocol, "v2");
    assert.equal(encoder.source, "kiloview-api-v2");
    assert.equal(encoder.controller.videoSignal.ok, true);
    assert.equal(encoder.controller.softwareVersion.value, "2.02.0246");
    assert.equal(encoder.controller.serialNumber.value, "3103103002067");

    await fetch(`${base}/simulator/api/config`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ apiProtocol: "v1" })
    });
    const fallback = await new KiloviewApiConnector({ host: base, username: "admin", password: "admin" }).monitor();
    assert.equal(fallback.kiloviewProtocol, "v1");

    await fetch(`${base}/simulator/api/config`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "decoder", apiProtocol: "v2" })
    });
    await fetch(`${base}/simulator/api/component`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "video", status: "error" })
    });
    const decoder = await new KiloviewApiConnector({ host: base }).monitor();
    assert.equal(decoder.kiloviewMode, "decoder");
    assert.equal(decoder.controller.decoderProtocolStatus.value, "En attente du HAR decodeur");
    console.log("Kiloview simulator integration: OK");
  } finally {
    await fetch(`${base}/simulator/api/reset`, { method: "POST" }).catch(() => {});
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
