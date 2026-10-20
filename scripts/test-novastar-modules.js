#!/usr/bin/env node
"use strict";

// Diagnostic autonome : une seule requete HTTP GET, aucun acces SNMP.
const http = require("http");
const https = require("https");

function usage() {
  console.log(`Usage : node scripts/test-novastar-modules.js <IP ou URL> [options]

Exemples :
  node scripts/test-novastar-modules.js 192.168.1.40
  node scripts/test-novastar-modules.js http://192.168.1.40:8001 --json

Options :
  --timeout <ms>       Delai maximum (defaut : 10000)
  --device-key <val>   En-tete Device-Key, si votre passerelle l'exige
  --json              Rapport JSON avec la reponse brute
  --help              Afficher cette aide

Sans port explicite, le port COEX 8001 est utilise.
Seul GET /api/v1/device/monitor/info est appele.
Codes de sortie : 0 = mesures presentes, 2 = aucune mesure exploitable,
                  1 = erreur de connexion, HTTP ou API.
Une absence de mesures ne prouve pas une incompatibilite materielle.`);
}

function parseArgs(args) {
  const options = { timeout: 10000, json: false };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--timeout" || arg === "--device-key") {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new Error(`Valeur manquante pour ${arg}`);
      if (arg === "--timeout") options.timeout = Number(value);
      else options.deviceKey = value;
    } else if (arg.startsWith("-") || options.target) throw new Error(`Argument inattendu : ${arg}`);
    else options.target = arg;
  }
  if (!Number.isInteger(options.timeout) || options.timeout <= 0 || options.timeout > 300000) {
    throw new Error("Le timeout doit etre un entier entre 1 et 300000 ms.");
  }
  return options;
}

function requestJson(url, options) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    const headers = { Accept: "application/json" };
    if (options.deviceKey) headers["Device-Key"] = options.deviceKey;
    let timer;
    const request = transport.get(url, { headers, agent: false }, (response) => {
      const chunks = [];
      let length = 0;
      response.on("data", (chunk) => {
        length += chunk.length;
        if (length > 16 * 1024 * 1024) {
          request.destroy(new Error("Reponse superieure a 16 Mo."));
          return;
        }
        chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("aborted", () => reject(new Error("Reponse HTTP interrompue.")));
      response.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        if (response.statusCode < 200 || response.statusCode >= 300) {
          const hint = response.statusCode === 404 ? " Endpoint absent sur ce port/firmware."
            : response.statusCode === 401 || response.statusCode === 403 ? " Acces refuse."
              : response.statusCode >= 300 && response.statusCode < 400 ? " Redirection non suivie." : "";
          return reject(new Error(`HTTP ${response.statusCode}.${hint} ${body.slice(0, 300)}`));
        }
        try { resolve(JSON.parse(body)); }
        catch (_) { reject(new Error(`Reponse non JSON : ${body.slice(0, 300)}`)); }
      });
    });
    timer = setTimeout(() => request.destroy(new Error(`Timeout apres ${options.timeout} ms.`)), options.timeout);
    request.on("error", reject);
    request.on("close", () => clearTimeout(timer));
  });
}

function analyze(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Reponse API inattendue.");
  if (raw.code !== undefined && String(raw.code) !== "0") {
    throw new Error(`Erreur API ${raw.code} : ${raw.message || raw.msg || "sans detail"}`);
  }
  const modules = [];
  let moduleInfoArrays = 0;
  // Recherche recursive pour tolerer les enveloppes et variantes de firmware.
  function visit(value, path, context) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`, context));
      return;
    }
    const next = Object.assign({}, context);
    ["CabinetID", "cabinetID", "rvCardID", "outPutID", "netPortIndex", "cabinetIndex"].forEach((key) => {
      if (value[key] !== undefined) next[key] = value[key];
    });
    Object.keys(value).forEach((key) => {
      if (key === "moduleInfos" && Array.isArray(value[key])) {
        moduleInfoArrays += 1;
        value[key].forEach((module, index) => {
          if (!module || typeof module !== "object") return;
          modules.push({ path: `${path}.moduleInfos[${index}]`, context: next,
            moduleIndex: module.moduleIndex, temperature: module.temperature, voltage: module.voltage });
        });
      } else visit(value[key], `${path}.${key}`, next);
    });
  }
  visit(raw, "$", {});
  const hasValue = (measure) => measure && typeof measure === "object"
    && measure.value !== null && measure.value !== undefined && String(measure.value).trim() !== "";
  const measuredModules = modules.filter((module) => hasValue(module.temperature) || hasValue(module.voltage)).length;
  return { result: measuredModules ? "MODULE_MEASUREMENTS_PRESENT" : modules.length ? "MODULES_WITHOUT_MEASUREMENTS" : "NO_MODULE_DATA",
    moduleInfoArrays, moduleCount: modules.length, measuredModules, modules };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || !options.target) { usage(); process.exitCode = options.help ? 0 : 1; return; }
  const url = new URL(/^https?:\/\//i.test(options.target) ? options.target : `http://${options.target}`);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("URL HTTP(S) sans identifiants attendue.");
  if (!url.port) url.port = "8001";
  url.pathname = "/api/v1/device/monitor/info";
  url.search = "";
  url.hash = "";
  if (!options.json) console.log(`Lecture : ${url.href}`);
  const raw = await requestJson(url, options);
  const report = Object.assign({ endpoint: url.href }, analyze(raw));
  if (options.json) console.log(JSON.stringify(Object.assign({}, report, { raw }), null, 2));
  else {
    console.log(`Resultat : ${report.result}`);
    console.log(`Modules : ${report.moduleCount} ; avec temperature ou tension : ${report.measuredModules}`);
    report.modules.forEach((module) => console.log(JSON.stringify(module)));
    if (!report.measuredModules) console.log("Aucune mesure par module : verifier modele, firmware et configuration Smart Module. Utiliser --json pour examiner la reponse complete.");
    else console.log("Mesures presentes. Verifier leur coherence avec NovaLCT/VMP ; les codes status sont conserves sans interpretation.");
  }
  process.exitCode = report.measuredModules ? 0 : 2;
}

if (require.main === module) main().catch((error) => {
  console.error(`Echec du diagnostic : ${error.message}`);
  process.exitCode = 1;
});

module.exports = { analyze };
