const { server } = require("../server");
const NovaStarOpenApiConnector = require("../../TAV_Monitoring_Backend/classes/NovaStarApiLib");
const NovaStarLegacyApiConnector = require("../../TAV_Monitoring_Backend/classes/NovaStarApiLib-backup");

let baseUrl;
run().then(async () => {
  console.log("Integration API + NovaStarApiLib: OK");
  await new Promise((resolve) => server.close(resolve));
}).catch(async (error) => {
  if (server.listening) await new Promise((resolve) => server.close(resolve));
  console.error(error.stack);
  process.exitCode = 1;
});

async function run() {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const initial = await request("/simulator/api/state");
  assert(initial.config.model === "H9", "Le profil H9 doit etre charge");

  await request("/simulator/api/component", {
    method: "PATCH", body: { id: "input-0-0", status: "warning" }
  });
  await request("/simulator/api/component", {
    method: "PATCH", body: { id: "output-0-0", status: "error" }
  });
  await request("/simulator/api/component", {
    method: "PATCH", body: { id: "fan-0", status: "error" }
  });

  const connector = new NovaStarOpenApiConnector({ baseUrl, projectId: "simulator", deviceId: 0, timeout: 2000 });
  const monitor = await connector.monitor({ model: "H9" });
  assert(monitor.inputSlots.count === 2, "Deux cartes Input attendues");
  assert(monitor.outputSlots.count === 1, "Une carte Output attendue");
  assert(monitor.outputPorts.length === 16, "Seize sorties attendues");
  assert(monitor.inputSlots.slots[0].inputSources[0].fields.status.ok === false, "Le warning Input doit remonter");
  assert(monitor.outputPorts[0].fields.workingStatus.ok === false, "L'erreur Output doit remonter");
  assert(monitor.fans[0].status.ok === false, "L'erreur ventilateur doit remonter");
  const legacy = new NovaStarLegacyApiConnector({ baseUrl, username: "admin", password: "admin", timeout: 2000 });
  const legacyMonitor = await legacy.monitor({ model: "H9" });
  assert(legacyMonitor.inputSlots.count === monitor.inputSlots.count, "Le fallback legacy doit rester compatible");
  await request("/simulator/api/reset", { method: "POST", body: {} });
}

async function request(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: options.method || "GET",
    headers: { "Content-Type": "application/json" },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} sur ${pathname}`);
  return response.json();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
