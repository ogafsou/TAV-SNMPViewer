const assert = require("node:assert/strict");
const http = require("http");
const NetgearConnector = require("../../TAV_Monitoring_Backend/classes/NetgearM4300SnmpLib");
const { server, agent } = require("../server");

async function run() {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const httpPort = server.address().port;
  try {
    const state = await request(httpPort, "/simulator/api/state");
    assert.equal(state.connection.port, 1161);

    const result = await new NetgearConnector({ host: "127.0.0.1", port: 1161, readCommunity: "public", timeout: 1000, retries: 0 })
      .monitor({ includePoe: true });
    assert.match(result.controller.model.value, /NETGEAR M4300/i);
    assert.ok(result.netgearPorts.length >= 2);
    assert.ok(result.netgearPorts.some((port) => port.media === "fiber" && port.speedMbps === 10000));
    assert.ok(result.netgearPorts.some((port) => port.poe && port.poe.supported));

    await request(httpPort, "/simulator/api/ports/1", "PUT", { linkUp: false, speedMbps: 1000 });
    const updated = await new NetgearConnector({ host: "127.0.0.1", port: 1161, readCommunity: "public", timeout: 1000, retries: 0 })
      .monitor({ includePoe: true });
    assert.equal(updated.netgearPorts.find((port) => port.index === 1).linkUp, false);
    await request(httpPort, "/simulator/api/reset", "POST");
    console.log("NETGEAR simulator integration: OK");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    agent.close();
  }
}

function request(port, pathname, method = "GET", body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: pathname, method, headers: body ? { "content-type": "application/json" } : {} }, (response) => {
      let data = "";
      response.on("data", (chunk) => { data += chunk; });
      response.on("end", () => { try { resolve(JSON.parse(data)); } catch (error) { reject(error); } });
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
