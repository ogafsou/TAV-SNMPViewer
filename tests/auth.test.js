const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { AuthService } = require("../TAV_Monitoring_Backend/classes/AuthService");

test("authentication stores hashed passwords and enforces user-management safeguards", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tav-auth-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "users.json");
  const auth = new AuthService({ filePath, initialPassword: "initial-password" });

  const administrator = auth.login("administrator", "initial-password");
  assert.equal(administrator.user.role, "administrator");
  assert.equal(fs.readFileSync(filePath, "utf8").includes("initial-password"), false);

  const created = auth.createUser({ login: "operator", password: "operator-password", role: "editor" });
  assert.equal(created.role, "editor");
  assert.equal(auth.login("operator", "wrong-password"), null);
  assert.equal(auth.login("operator", "operator-password").user.login, "operator");
  assert.throws(() => auth.deleteUser(administrator.user.id, administrator.user), /own account/);
  auth.updateUser(created.id, { role: "user" }, administrator.user);
  assert.equal(auth.listUsers().find((user) => user.id === created.id).role, "user");
});


test("favorites persist per user across sessions and service restarts", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tav-favorites-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "users.json");
  const auth = new AuthService({ filePath, initialPassword: "initial-password" });
  const admin = auth.login("administrator", "initial-password");
  const viewer = auth.createUser({ login: "viewer", password: "viewer-password", role: "user" });
  assert.deepEqual(auth.getFavorites(admin.user.id), []);
  auth.setFavorite(admin.user.id, "machine-1", true);
  auth.setFavorite(admin.user.id, "machine-1", true);
  auth.setFavorite(viewer.id, "machine-2", true);
  const restarted = new AuthService({ filePath });
  const session = restarted.login("administrator", "initial-password");
  assert.deepEqual(restarted.getFavorites(session.user.id), ["machine-1"]);
  assert.deepEqual(restarted.getFavorites(viewer.id), ["machine-2"]);
  restarted.updateUser(viewer.id, { login: "renamed" }, session.user);
  assert.deepEqual(restarted.getFavorites(viewer.id), ["machine-2"]);
  restarted.setFavorite(admin.user.id, "machine-1", false);
  assert.deepEqual(restarted.getFavorites(admin.user.id), []);
});


test("favorites rendering filters equipment and individual Ping rows and displays the empty state", () => {
  const vm = require("vm");
  const context = {
    machines: [{ id: "a", type: "novastar-h" }, { id: "b", type: "novastar-h" }, { id: "p", type: "other" }, { id: "q", type: "other" }],
    favoritesOnly: true, favoritesLoaded: true, favoriteMachineIds: ["b", "q"],
    monitoringCards: { innerHTML: "", classList: { toggle() {} } },
    monitoringViewToggleButton: { setAttribute() {} }, monitoringMinimized: false,
    monitoringCardOrder: [], minimizedMonitoringCards: {}, monitoringState: {},
    buildUnknownState: () => ({})
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../TAV_Monitoring_UI/public/javascripts/monitoring-renderers.js"), "utf8"), context);
  context.renderFullMonitoringCard = (machine) => "card:" + machine.id;
  context.renderPingMonitoringCard = (machines) => "ping:" + machines.map((machine) => machine.id).join(",");
  context.renderMonitoringCards();
  assert.equal(context.monitoringCards.innerHTML, "card:bping:q");
  context.favoriteMachineIds = [];
  context.renderMonitoringCards();
  assert.match(context.monitoringCards.innerHTML, /Aucun équipement favori/);
  context.favoritesOnly = false;
  context.renderMonitoringCards();
  assert.equal(context.monitoringCards.innerHTML, "card:acard:bping:p,q");
});
