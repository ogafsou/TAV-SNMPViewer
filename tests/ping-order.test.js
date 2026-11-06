const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../TAV_Monitoring_UI/public/javascripts/application.js"), "utf8");

function session(storage) {
  const handlers = {};
  const container = {
    addEventListener: (name, callback) => { handlers[name] = callback; },
    querySelectorAll: () => []
  };
  const context = vm.createContext({
    localStorage: { getItem: () => storage.value, setItem: (key, value) => { storage.value = value; } },
    monitoringCards: container, monitoringCardDialogContent: { ...container, addEventListener() {} },
    monitoringCardDialog: { open: false },
    machines: ["a", "b", "c", "d"].map(id => ({ id, type: "other" })),
    renderMonitoringCards() {}, setStatus() {}
  });
  vm.runInContext(source.slice(source.indexOf('var draggedPingMachineId'), source.indexOf('function loadMinimizedMonitoringCards')), context);
  vm.runInContext(source.slice(source.indexOf('[monitoringCards, monitoringCardDialogContent].forEach'), source.indexOf('monitoringCards.addEventListener("click"')), context);
  return { context, handlers };
}

test("ping drag preserves hidden rows and restores order in a new session", () => {
  const storage = { value: "[]" };
  const { context, handlers } = session(storage);
  context.draggedPingMachineId = "d";
  const row = { dataset: { pingMachineId: "b" }, getBoundingClientRect: () => ({ top: 0, height: 20 }) };
  handlers.drop({ target: { closest: () => row }, clientY: 1, preventDefault() {} });
  assert.deepEqual(JSON.parse(storage.value), ["a", "d", "b", "c"]);
  assert.equal(context.draggedPingMachineId, "");
  const restored = session(storage).context;
  assert.equal(vm.runInContext('orderedPingMachines(machines).map(m => m.id).join(",")', restored), "a,d,b,c");
  assert.equal(vm.runInContext('orderedPingMachines(machines.filter(m => m.id === "b" || m.id === "d")).map(m => m.id).join(",")', restored), "d,b");
});

test("ping order tolerates invalid storage, removed machines and duplicates", () => {
  const invalid = session({ value: "invalid" }).context;
  assert.equal(vm.runInContext('orderedPingMachines(machines).map(m => m.id).join(",")', invalid), "a,b,c,d");
  const stale = session({ value: '["c","removed","c","a"]' }).context;
  assert.equal(vm.runInContext('orderedPingMachines(machines).map(m => m.id).join(",")', stale), "c,a,b,d");
});
