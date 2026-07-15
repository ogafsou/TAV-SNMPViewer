/*
 * Test live de l'OpenAPI officielle NovaStar H Series (mode non chiffre).
 *
 * PowerShell :
 *   $env:NOVASTAR_OPENAPI_URL = "http://192.168.69.86:8000"
 *   $env:NOVASTAR_OPENAPI_PID = "mon-project-id"
 *   $env:NOVASTAR_OPENAPI_DEVICE_ID = "0" # optionnel
 *   node .\tests\novastar-openapi-live.test.js
 *
 * La machine doit avoir une entree active dans Settings > OpenAPI Management,
 * avec le chiffrement desactive. Le secretKey n'entre pas dans la signature
 * non chiffree documentee par NovaStar.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const http = require("http");
const https = require("https");

const BASE_URL = normalizeBaseUrl(process.env.NOVASTAR_OPENAPI_URL || "");
const PID = String(process.env.NOVASTAR_OPENAPI_PID || "").trim();
const TIMEOUT_MS = Math.max(500, Number(process.env.NOVASTAR_OPENAPI_TIMEOUT_MS) || 5000);
const DEVICE_ID = Number.isInteger(Number(process.env.NOVASTAR_OPENAPI_DEVICE_ID))
  ? Number(process.env.NOVASTAR_OPENAPI_DEVICE_ID)
  : 0;
const LIVE_ENABLED = Boolean(BASE_URL && PID);

test("NovaStar OpenAPI officielle: initialisation", { skip: !LIVE_ENABLED && usage() }, async () => {
  const response = await openApiPost("/main/initStatus", { deviceId: 0 });
  assertSuccess(response, "main/initStatus");
  const body = responseBody(response);
  assert.equal(typeof body, "object", "La reponse doit contenir un body JSON");
  assert.ok(Object.prototype.hasOwnProperty.call(body, "initStatus"), "body.initStatus absent");
  console.log("OpenAPI initStatus:", JSON.stringify(body));
});

test("NovaStar OpenAPI officielle: detail de la machine", { skip: !LIVE_ENABLED }, async () => {
  const response = await openApiPost("/device/readDetail", { deviceId: 0 });
  assertSuccess(response, "device/readDetail");
  const body = responseBody(response);
  assert.equal(typeof body, "object", "La reponse doit contenir un body JSON");
  assert.ok(Array.isArray(body.slotList), "body.slotList doit etre un tableau");
  assert.ok(Array.isArray(body.powerList), "body.powerList doit etre un tableau");
  assert.ok(Array.isArray(body.fanList), "body.fanList doit etre un tableau");
  assert.equal(typeof body.genlock, "object", "body.genlock absent");
  console.log("OpenAPI readDetail:", JSON.stringify({
    name: body.name,
    modelId: body.modelId,
    status: body.status,
    slots: body.slotList.length,
    fans: body.fanList.length,
    powerSupplies: body.powerList.length
  }));
});

test("NovaStar OpenAPI officielle: remplacement de readGenLockWorkStatus", { skip: !LIVE_ENABLED }, async () => {
  const response = await openApiPost("/device/readDetail", { deviceId: DEVICE_ID });
  assertSuccess(response, "device/readDetail pour Genlock");
  const body = responseBody(response);
  assert.equal(typeof body.genlock, "object", "readDetail ne retourne pas body.genlock");
  assert.ok(body.extSignal !== undefined || body.genlock.extSignal !== undefined,
    "Aucun etat de signal Genlock (extSignal) n'est retourne");

  const replacement = {
    enabled: body.genlock.enable,
    type: body.genlock.type,
    inputId: body.genlock.inputId,
    externalSignal: body.genlock.extSignal !== undefined ? body.genlock.extSignal : body.extSignal,
    externalFrequency: body.genlock.extFreq,
    refreshRate: body.genlock.refreshRate
  };
  console.log("Remplacement readGenLockWorkStatus via readDetail.genlock:", JSON.stringify(replacement));
});

test("NovaStar OpenAPI officielle: remplacement de readVideoServerInfo", { skip: !LIVE_ENABLED }, async () => {
  const response = await openApiPost("/main/readVideoServerInfo", { deviceId: DEVICE_ID });
  assertSuccess(response, "main/readVideoServerInfo");
  const body = responseBody(response);
  const expectedFields = ["mvrCardOnline", "videoStatus", "mvrUrl", "echoUrl"];
  const returnedFields = expectedFields.filter((key) => body[key] !== undefined);
  assert.ok(returnedFields.length > 0,
    `La reponse ne contient aucun champ MVR attendu. Champs recus: ${Object.keys(body).join(", ")}`);
  console.log("Remplacement readVideoServerInfo:", JSON.stringify(body));
});

async function openApiPost(pathname, businessBody) {
  const timeStamp = String(Date.now());
  const payload = {
    body: businessBody || {},
    sign: unsignedModeSignature(timeStamp, PID),
    pId: PID,
    timeStamp
  };
  return requestJson(`${BASE_URL}${pathname}`, payload, TIMEOUT_MS);
}

function unsignedModeSignature(timeStamp, pId) {
  // Documentation NovaStar : Base64(md5(timestamp + pId)), le MD5 etant
  // d'abord represente sous sa forme hexadecimale.
  const md5Hex = crypto.createHash("md5").update(timeStamp + pId, "utf8").digest("hex");
  return Buffer.from(md5Hex, "ascii").toString("base64");
}

function assertSuccess(response, operation) {
  const status = Number(response && (response.status !== undefined ? response.status : response["status "]));
  assert.equal(status, 0, `${operation} refusee: ${response && response.msg || "reponse inconnue"}`);
}

function responseBody(response) {
  assert.ok(response && response.body !== undefined, "Champ body absent de la reponse OpenAPI");
  assert.equal(typeof response.body, "object", "Ce test exige le mode OpenAPI non chiffre");
  return response.body;
}

function normalizeBaseUrl(value) {
  let base = String(value || "").trim().replace(/\/+$/, "");
  if (!base) return "";
  if (!/^https?:\/\//i.test(base)) base = `http://${base}`;
  return /\/open\/api$/i.test(base) ? base : `${base}/open/api`;
}

function requestJson(urlValue, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlValue);
    const body = JSON.stringify(payload);
    const transport = url.protocol === "https:" ? https : http;
    const request = transport.request(url, {
      method: "POST",
      rejectUnauthorized: false,
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body)
      }
    }, (response) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { text += chunk; });
      response.on("end", () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`HTTP ${response.statusCode}: ${text.slice(0, 300)}`));
          return;
        }
        try { resolve(JSON.parse(text)); }
        catch (_) { reject(new Error(`Reponse NovaStar non JSON: ${text.slice(0, 300)}`)); }
      });
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error(`Timeout OpenAPI apres ${timeoutMs} ms`)));
    request.on("error", reject);
    request.end(body);
  });
}

function usage() {
  console.log("Test OpenAPI ignore. Definissez NOVASTAR_OPENAPI_URL et NOVASTAR_OPENAPI_PID pour l'activer.");
  return "Configuration live absente";
}

module.exports = { normalizeBaseUrl, unsignedModeSignature };
