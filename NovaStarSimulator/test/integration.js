const { spawn } = require("child_process");
const path = require("path");
const NovaStarApiConnector = require("../../classes/NovaStarApiLib");

const port = 18080 + Math.floor(Math.random() * 1000);
const baseUrl = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"]
});

let stderr = "";
child.stderr.on("data", (chunk) => { stderr += chunk; });

run().then(() => {
  console.log("Integration API + NovaStarApiLib: OK");
  child.kill();
}).catch((error) => {
  child.kill();
  console.error(stderr || error.stack);
  process.exitCode = 1;
});

async function run() {
  await waitForServer();
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

  const connector = new NovaStarApiConnector({ baseUrl, username: "admin", password: "admin", timeout: 2000 });
  await connector.init();
  const monitor = await connector.monitor({ model: "H9" });
  assert(monitor.inputSlots.count === 2, "Deux cartes Input attendues");
  assert(monitor.outputSlots.count === 1, "Une carte Output attendue");
  assert(monitor.outputPorts.length === 16, "Seize sorties attendues");
  assert(monitor.inputSlots.slots[0].inputSources[0].fields.status.ok === false, "Le warning Input doit remonter");
  assert(monitor.outputPorts[0].fields.workingStatus.ok === false, "L'erreur Output doit remonter");
  assert(monitor.fans[0].status.ok === false, "L'erreur ventilateur doit remonter");
  await request("/simulator/api/reset", { method: "POST", body: {} });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 30; attempt++) {
    try { await request("/simulator/api/state"); return; }
    catch (_) { await new Promise((resolve) => setTimeout(resolve, 100)); }
  }
  throw new Error("Le simulateur n'a pas demarre");
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
