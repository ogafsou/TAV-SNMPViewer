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
