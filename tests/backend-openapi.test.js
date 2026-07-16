const test = require("node:test");
const assert = require("node:assert/strict");
const NovaStarOpenApiConnector = require("../TAV_Monitoring_Backend/classes/NovaStarApiLib");
const { normalizeApiProtocol, apiBaseUrl } = require("../TAV_Monitoring_Backend/services/DeviceMonitor");

test("OpenAPI signature matches the NovaStar unencrypted specification", () => {
  assert.equal(
    NovaStarOpenApiConnector.base64Md5Hex("1689586062335YmRj"),
    "YjlhMWRmZTVlNzJhYTg4MTgzMDFhNTdlOWE0NjMyNDc="
  );
});

test("OpenAPI encrypted body uses a reversible DES-compatible payload", () => {
  const encrypted = NovaStarOpenApiConnector.encryptBody({ deviceId: 0 }, "YWlwNGQy");
  assert.equal(typeof encrypted, "string");
  assert.deepEqual(NovaStarOpenApiConnector.decryptBody(encrypted, "YWlwNGQy"), { deviceId: 0 });
});

test("OpenAPI derives Genlock and MVR compatibility fields from official responses", () => {
  assert.deepEqual(NovaStarOpenApiConnector.normalizeGenlock({
    extSignal: 0, genlock: { enable: 1, type: 1, inputId: 0 }
  }), {
    status: 0, enable: 1, type: 1, inputId: 0, extSignal: 0, refreshRate: undefined
  });
  const video = NovaStarOpenApiConnector.normalizeVideoServer({
    videoStatus: 1, mvrUrl: "ws://device/mvr", echoUrl: "ws://device/echo"
  });
  assert.equal(video.mvrCardOnline, 1);
});

test("existing machines stay legacy while configured pId machines use OpenAPI", () => {
  assert.equal(normalizeApiProtocol({ apiUsername: "admin" }), "legacy");
  assert.equal(normalizeApiProtocol({ apiProjectId: "NDAz" }), "openapi");
  assert.equal(normalizeApiProtocol({ apiProtocol: "legacy", apiProjectId: "NDAz" }), "legacy");
  assert.equal(apiBaseUrl({}, "192.168.69.94", "openapi"), "http://192.168.69.94:8000/open/api");
  assert.equal(apiBaseUrl({}, "192.168.69.94", "legacy"), "http://192.168.69.94");
});
