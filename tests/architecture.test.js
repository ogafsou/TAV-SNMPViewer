const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

test("frontend and backend are independent runnable projects", () => {
  ["TAV_Monitoring_UI", "TAV_Monitoring_Backend"].forEach((project) => {
    const folder = path.join(root, project);
    assert.equal(fs.existsSync(path.join(folder, "package.json")), true);
    assert.equal(fs.existsSync(path.join(folder, "config.json")), true);
    assert.equal(fs.existsSync(path.join(folder, "server.js")), true);
    const packageJson = JSON.parse(fs.readFileSync(path.join(folder, "package.json"), "utf8"));
    assert.equal(typeof packageJson.scripts.start, "string");
  });
});

test("frontend proxy handles reset HTTP and WebSocket connections", () => {
  const proxy = fs.readFileSync(path.join(root, "TAV_Monitoring_UI", "proxy.js"), "utf8");
  assert.match(proxy, /backendResponse\.on\("error", backendFailure\)/);
  assert.match(proxy, /clientSocket\.on\("error", closeTunnel\)/);
  assert.match(proxy, /backendSocket\.on\("error", closeTunnel\)/);
});

test("device connectors exist only in the new backend", () => {
  ["SnmpLib.js", "NetgearM4300SnmpLib.js", "NovaStarApiLib.js", "KiloviewApiLib.js", "PingLib.js"].forEach((file) => {
    assert.equal(fs.existsSync(path.join(root, "TAV_Monitoring_Backend", "classes", file)), true);
    assert.equal(fs.existsSync(path.join(root, "TAV_Monitoring_UI", "classes", file)), false);
  });
});

test("NovaStar SNMP collection stays behind the single backend orchestrator", () => {
  const backendRoot = path.join(root, "TAV_Monitoring_Backend");
  const allowedImporter = path.join(backendRoot, "services", "DeviceMonitor.js");
  const connectorFile = path.join(backendRoot, "classes", "SnmpLib.js");
  const violations = javascriptFiles(backendRoot)
    .filter((file) => file !== allowedImporter && file !== connectorFile)
    .filter((file) => /require\(["'][^"']*SnmpLib["']\)|new\s+\w*SNMPConnector\s*\(/.test(fs.readFileSync(file, "utf8")))
    .map((file) => path.relative(root, file));

  assert.deepEqual(violations, [],
    "NovaStar SNMP selectors must remain orchestrated by DeviceMonitor/MonitoringService; " +
    "a direct connector call requires an explicit host:port locking design first");
});

test("frontend contains no direct device monitor endpoint", () => {
  const javascriptFolder = path.join(root, "TAV_Monitoring_UI", "public", "javascripts");
  const javascript = fs.readdirSync(javascriptFolder)
    .filter((file) => file.endsWith(".js"))
    .map((file) => fs.readFileSync(path.join(javascriptFolder, file), "utf8"))
    .join("\n");
  assert.equal(javascript.includes('fetch("/api/monitor"'), false);
  assert.equal(javascript.includes("readCommunity: machine.readCommunity"), false);
  assert.equal(javascript.includes("setupWebSocket()"), true);
});

function javascriptFiles(folder) {
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(folder, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : javascriptFiles(target);
    return entry.isFile() && entry.name.endsWith(".js") ? [target] : [];
  });
}

test("a reference difference colors the control red without replacing the icon status color", () => {
  const css = fs.readFileSync(path.join(root, "TAV_Monitoring_UI", "public", "stylesheets", "style.css"), "utf8");
  const renderer = fs.readFileSync(path.join(root, "TAV_Monitoring_UI", "public", "javascripts", "monitoring-renderers.js"), "utf8");

  assert.match(css, /\.monitor-pill\.icon-pill\.reference-changed\s*\{/);
  assert.match(css, /background:\s*#d92d20;/);
  assert.match(css, /border-color:\s*#d92d20;/);
  assert.match(css, /\.state-icon\.state-ok\s*\{[^}]*filter:\s*url\("#icon-green"\)/s);
  assert.match(css, /\.state-icon\.state-warning\s*\{[^}]*filter:\s*url\("#icon-orange"\)/s);
  assert.match(css, /\.state-icon\.state-error\s*\{[^}]*filter:\s*url\("#icon-red"\)/s);
  assert.doesNotMatch(css, /\.reference-changed\s+\.state-icon\s*\{[^}]*filter:/s);
  assert.match(renderer, /statusIcon\(item\.icon, className, item\.label\)/);
});

test("a NovaStar item matching the reference keeps its status icon inside a transparent control", () => {
  const css = fs.readFileSync(path.join(root, "TAV_Monitoring_UI", "public", "stylesheets", "style.css"), "utf8");
  const renderer = fs.readFileSync(path.join(root, "TAV_Monitoring_UI", "public", "javascripts", "monitoring-renderers.js"), "utf8");

  assert.match(renderer, /item\.changed === false && item\.referenceState !== undefined/);
  assert.match(renderer, /return ' reference-matched'/);
  assert.match(css, /\.io-status-table td\.reference-matched[\s\S]*?background:\s*transparent;/);
  assert.match(css, /\.monitor-pill\.icon-pill\.reference-matched/);
  assert.match(css, /\.state-icon\.state-warning\s*\{[^}]*filter:\s*url\("#icon-orange"\)/s);
  assert.doesNotMatch(css, /\.reference-matched\s+\.state-icon\s*\{[^}]*filter:/s);
});

test("monitoring assets use the current cache-busting version", () => {
  const view = fs.readFileSync(path.join(root, "TAV_Monitoring_UI", "views", "index.ejs"), "utf8");
  assert.match(view, /style\.css\?v=20260827-1/);
  assert.match(view, /monitoring-renderers\.js\?v=20260831-1/);
  assert.match(view, /utils\.js\?v=20260723-2/);
  assert.match(view, /auth\.js\?v=20260725-1/);
  assert.match(view, /machine-details\.js\?v=20260723-6/);
  assert.match(view, /monitoring\.js\?v=20260816-1/);
  assert.match(view, /configuration\.js\?v=20260816-4/);
  assert.match(view, /application\.js\?v=20260816-3/);
  assert.match(view, /monitoring-maps\.js\?v=20260827-1/);
  assert.match(view, /map-monitoring\.js\?v=20260827-1/);
  const css = fs.readFileSync(path.join(root, "TAV_Monitoring_UI", "public", "stylesheets", "style.css"), "utf8");
  assert.match(css, /#toggleMonitoringView\[hidden\],[\s\S]*?#refreshMonitoring\[hidden\]\s*\{\s*display:\s*none !important;/);
  assert.match(css, /\.topbar\s*\{[^}]*align-items:\s*center;[^}]*padding-bottom:\s*0;/s);
  assert.match(css, /\.topbar \.tabs\s*\{[^}]*margin-bottom:\s*0;/s);
  assert.match(css, /\.topbar \.topbar-actions\s*\{[^}]*grid-template-rows:\s*36px;/s);
  assert.match(css, /#configurationTab \.configuration-layout\s*\{[^}]*margin-top:\s*12px;/s);
  assert.match(css, /\.monitoring-grid\s*\{[^}]*margin-top:\s*12px;/s);
});

test("Kiloview summary separates actual status text from reference comparison background", () => {
  const css = fs.readFileSync(path.join(root, "TAV_Monitoring_UI", "public", "stylesheets", "style.css"), "utf8");
  const renderer = fs.readFileSync(path.join(root, "TAV_Monitoring_UI", "public", "javascripts", "monitoring-renderers.js"), "utf8");

  assert.match(renderer, /\(items \|\| \[\]\)\.some\(function\(item\) \{ return item\.changed === true; \}\)/);
  assert.match(renderer, /changed \? ' reference-changed' : ''/);
  assert.match(renderer, /Valeur courante :/);
  assert.match(renderer, /Valeur de reference :/);
  assert.match(renderer, /Tolerance :/);
  assert.match(css, /\.kiloview-summary-table td\.ok\s*\{[^}]*color:\s*#1f9d55;[^}]*background:\s*transparent;/s);
  assert.match(css, /\.kiloview-summary-table td\.warning\s*\{[^}]*color:\s*#e8a600;[^}]*background:\s*transparent;/s);
  assert.match(css, /\.kiloview-summary-table td\.error,[^}]*color:\s*#d92d20;[^}]*background:\s*transparent;/s);
  assert.match(css, /\.kiloview-summary-table td\.reference-changed\s*\{[^}]*background:\s*rgba\(217, 45, 32, 0\.28\);/s);
});

test("Kiloview network details precede the status summary and hide interfaces and protocols", () => {
  const renderer = fs.readFileSync(path.join(root, "TAV_Monitoring_UI", "public", "javascripts", "monitoring-renderers.js"), "utf8");
  assert.match(renderer, /return networkSummary \+ kiloviewStatusSummary\(groups\)/);
  assert.match(renderer, /if \(group\.title === "Reseau"\) return "";/);
  assert.match(renderer, /item\.label !== "Interfaces" && item\.label !== "Protocoles"/);
  assert.match(renderer, /visibleItems\.map\(kiloviewStatusItem\)/);
});

test("monitoring cards group system health in one compact section", () => {
  const renderer = fs.readFileSync(path.join(root, "TAV_Monitoring_UI", "public", "javascripts", "monitoring-renderers.js"), "utf8");
  const css = fs.readFileSync(path.join(root, "TAV_Monitoring_UI", "public", "stylesheets", "style.css"), "utf8");

  assert.match(renderer, /systemRow\("Sante", healthItems\)/);
  assert.match(renderer, /systemRow\("Equipements", equipmentItems\)/);
  assert.doesNotMatch(renderer, /prefixed\(state\.receivingCards, "RC "\)/);
  assert.doesNotMatch(renderer, /pillGroup\("Sante"/);
  assert.doesNotMatch(renderer, /pillGroup\("Controleur"/);
  assert.doesNotMatch(renderer, /escapeHtml\(state\.label\)/);
  assert.match(css, /\.monitoring-card\s*\{[^}]*min-height:\s*0;/s);
  assert.match(css, /\.card-head h3\s*\{[^}]*font-size:\s*20px;/s);
  assert.match(css, /\.io-status-table td\.inactive\s*\{[^}]*background:\s*#454d5f;/s);
  assert.match(css, /\.io-status-table,[\s\S]*?\.io-status-table tr\s*\{[^}]*background:\s*transparent;/);
  assert.match(css, /\.io-status-group\.dense \.io-status-table td\s*\{[^}]*font-size:\s*8px;/s);
  assert.match(renderer, /io-status-group' \+ \(dense \? ' dense' : ''\)/);
  assert.match(renderer, /function monitoringItemTooltip\(item, state\)/);
  assert.match(renderer, /var neverConnected = !previewingReference && state\.connected !== true && !\(record && record\.lastSuccessfulAt\)/);
  assert.match(renderer, /REFERENCE_MODE_ENABLED && \(machine\.monitoringReference \|\| !neverConnected\)/);
  assert.match(renderer, /machineTypeLabel\(machine\.type\)/);
  assert.match(renderer, /Aucune information retournée par l’équipement\./);
  assert.match(css, /\.monitoring-card\.never-connected\s*\{[^}]*color:\s*var\(--ink\);[^}]*filter:\s*none;/s);
  assert.doesNotMatch(renderer, /"Nom : "/);
  assert.doesNotMatch(renderer, /"Statut : "/);
  assert.match(renderer, /Etat de reference : " \+ stateTitle\(item\.referenceState\)/);
  assert.match(css, /table th,[\s\S]*?table td:first-child,[\s\S]*?\.io-status-group > span\s*\{[^}]*font-family:\s*Poppins/);
  assert.match(css, /\.io-status-table th\s*\{[^}]*vertical-align:\s*middle;/s);
});

test("configuration advanced equipment information is collapsed by default", () => {
  const configuration = fs.readFileSync(path.join(root, "TAV_Monitoring_UI", "views", "Configuration.ejs"), "utf8");
  const css = fs.readFileSync(path.join(root, "TAV_Monitoring_UI", "public", "stylesheets", "style.css"), "utf8");
  const details = fs.readFileSync(path.join(root, "TAV_Monitoring_UI", "public", "javascripts", "machine-details.js"), "utf8");
  const configurationScript = fs.readFileSync(path.join(root, "TAV_Monitoring_UI", "public", "javascripts", "configuration.js"), "utf8");
  const information = fs.readFileSync(path.join(root, "TAV_Monitoring_UI", "views", "partials", "configuration", "selected-machine-information.ejs"), "utf8");
  const machineList = fs.readFileSync(path.join(root, "TAV_Monitoring_UI", "views", "partials", "configuration", "machine-list.ejs"), "utf8");
  const selectedMachineHeader = fs.readFileSync(path.join(root, "TAV_Monitoring_UI", "views", "partials", "configuration", "selected-machine-header.ejs"), "utf8");

  assert.match(configuration, /<details id="advancedInformationDetails" class="configuration-advanced-information">/);
  assert.doesNotMatch(configuration, /partials\/configuration\/options/);
  assert.doesNotMatch(configuration, /<details[^>]*\sopen(?:\s|>)/);
  assert.match(configuration, /<summary>Informations avancées<\/summary>/);
  assert.match(configuration, /configuration-advanced-information-content[\s\S]*include\("partials\/configuration\/selected-machine-information"\)/);
  assert.match(css, /\.configuration-advanced-information-content\s*\{[^}]*display:\s*grid;/s);
  assert.match(details, /function renderPingSummary\(data, record\)/);
  assert.match(details, /summaryTile\("IP adresse", data\.host \|\| "-"\)/);
  assert.match(details, /summaryTile\("Last Ping", lastSuccessfulAt \? formatDate\(lastSuccessfulAt\) : "-", "timestamp-metric"\)/);
  assert.match(details, /summaryTile\("Last Scan", lastScanAt \? formatDate\(lastScanAt\) : "-", "timestamp-metric"\)/);
  assert.match(css, /\.metric\.timestamp-metric strong\s*\{[^}]*font-size:\s*13px;/s);
  assert.match(css, /\.metric strong\s*\{[^}]*font-size:\s*13px;/s);
  assert.match(configurationScript, /advancedInformation\.hidden = !normalizedType \|\| normalizedType === "other" \|\| hasScan !== true/);
  assert.match(configurationScript, /\["outputPortsSection", "inputSlotsSection", "screensSection", "receivingCardsSection"\]/);
  assert.match(configurationScript, /section\.hidden = normalizedType === "kiloview"/);
  assert.match(information, /id="outputPortsSection"[\s\S]*?<h2>Ports de sortie<\/h2>/);
  assert.match(information, /id="inputSlotsSection"[\s\S]*?<h2>Slots d'entree<\/h2>/);
  assert.match(information, /id="screensSection"[\s\S]*?<h2>Ecrans<\/h2>/);
  assert.match(information, /id="receivingCardsSection"[\s\S]*?<h2 id="cardsTitle">Receiving cards<\/h2>/);
  assert.doesNotMatch(machineList, /Machines H/);
  assert.match(machineList, /data-machine-type="novastar-h" aria-pressed="true">Novastar/);
  assert.match(machineList, /data-machine-type="kiloview" aria-pressed="true">Kiloview/);
  assert.match(machineList, /data-machine-type="netgear-m4300" aria-pressed="true">Netgear/);
  assert.match(machineList, /data-machine-type="other" aria-pressed="true">Ping/);
  assert.match(configurationScript, /function resetMachineTypeFilters\(\)/);
  assert.match(selectedMachineHeader, /id="selectedMachineType">Equipement/);
  assert.match(configurationScript, /selectedMachineType\.textContent = machineTypeLabel\(type\)/);
  assert.match(configurationScript, /var hasSuccessfulScan = !!\(record && record\.lastSuccessfulAt/);
  assert.match(configurationScript, /normalizeMachineType\(successfulRaw\.type\) !== machineType/);
  assert.match(details, /var lastScanAt = \(record && record\.lastSuccessfulAt\) \|\| data\.timestamp/);
  assert.match(configurationScript, /selectedMachineHint\.textContent = ""/);
  assert.match(css, /\.machine-type-filters\s*\{[^}]*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/s);
  assert.match(css, /\.machine-type-filters button\s*\{[^}]*background:\s*#697184 !important;[^}]*font-size:\s*9px;/s);
  assert.match(css, /\.machine-type-filters button\[aria-pressed="true"\]\s*\{[^}]*background:\s*var\(--accent\) !important;/s);
  assert.match(css, /\.machine-type-filters button\[aria-pressed="false"\],[\s\S]*?background:\s*#697184 !important;/s);
});

test("NovaStar SNMP options use the dialog theme and hide disabled scan frequency", () => {
  const css = fs.readFileSync(path.join(root, "TAV_Monitoring_UI", "public", "stylesheets", "style.css"), "utf8");
  const configurationScript = fs.readFileSync(path.join(root, "TAV_Monitoring_UI", "public", "javascripts", "configuration.js"), "utf8");

  assert.match(css, /\.access-mode-field,[\s\S]*?\.novastar-snmp-options,[\s\S]*?fieldset\s*\{[^}]*background:\s*var\(--panel-raised\);/s);
  assert.match(configurationScript, /document\.querySelectorAll\("\.snmp-scan-frequency"\)[\s\S]*?node\.hidden = !snmpEnabled \|\| !machineForm\.snmpScanEnabled\.checked;/s);
  assert.match(configurationScript, /machineForm\.snmpScanEnabled\.addEventListener\("change", updateMachineFormFields\);/);
});

test("reference button previews expected state and uses a confirmed context-menu action", () => {
  const renderer = fs.readFileSync(path.join(root, "TAV_Monitoring_UI", "public", "javascripts", "monitoring-renderers.js"), "utf8");
  const application = fs.readFileSync(path.join(root, "TAV_Monitoring_UI", "public", "javascripts", "application.js"), "utf8");
  const css = fs.readFileSync(path.join(root, "TAV_Monitoring_UI", "public", "stylesheets", "style.css"), "utf8");
  const view = fs.readFileSync(path.join(root, "TAV_Monitoring_UI", "views", "partials", "monitoring", "machine-cards.ejs"), "utf8");
  const machineStore = fs.readFileSync(path.join(root, "TAV_Monitoring_Backend", "classes", "MachineStore.js"), "utf8");

  assert.match(renderer, /machine\.monitoringReference \? "Reference" : "Set Reference"/);
  assert.match(renderer, /function buildReferencePreviewState\(machine, baseState\)/);
  assert.match(renderer, /reference-preview/);
  assert.match(renderer, /item\.referenceState = expectedState/);
  assert.match(machineStore, /snapshot:\s*safe\.monitoringReference\.snapshot/);
  assert.match(css, /\.monitoring-card\.reference-preview \.io-status-table td\.reference-changed[\s\S]*?background:\s*transparent;/);
  assert.match(application, /if \(!button \|\| !machine \|\| machine\.monitoringReference\) return;\s*setMachineReference\(machine\.id\);/);
  assert.match(renderer, /function buildPingReferenceState\(pingMachines, previewingReference\)/);
  assert.match(renderer, /referencePreviewMachineId === "__ping__"/);
  assert.match(renderer, /function latestPingDate\(pingMachines\)/);
  assert.match(renderer, /function pingSuccessfulTime\(value\)/);
  assert.match(renderer, /record\.lastSuccessfulAt \|\| \(isOk && record\.timestamp\)/);
  assert.match(renderer, /Dernier ping : /);
  assert.match(renderer, /function cardMessageHtml\(message\)/);
  assert.match(renderer, /card-message-label/);
  assert.match(css, /\.card-message\s*\{[^}]*grid-template-columns:\s*max-content minmax\(0, 1fr\)/s);
  assert.match(css, /\.monitoring-card\s*\{[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\) auto;/s);
  assert.match(css, /\.monitoring-card \.card-message\s*\{[^}]*align-self:\s*end;/s);
  assert.match(application, /referenceContextMachineId = "__ping__"/);
  assert.match(renderer, /data-machine-id="__ping__" data-monitoring-card-id="__ping__"/);
  assert.match(renderer, /function monitoringCardRefreshButton\(machineId, title\)/);
  assert.match(renderer, /monitoringCardRefreshButton\("__ping__", "Relancer tous les pings"\)/);
  assert.match(renderer, /monitoringMinimized \? 'Maximize\.png' : 'Minimize\.png'/);
  assert.match(renderer, /function monitoringCardMinimizeButton\(machineId, title\)/);
  assert.match(renderer, /function monitoringCardMaximizeButton\(machineId, title\)/);
  assert.match(renderer, /class="card-head-meta"/);
  assert.match(css, /\.card-head h3\s*\{[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s);
  assert.match(renderer, /\["novastar-h", "kiloview"\]\.indexOf\(machine\.type\)/);
  assert.match(css, /\.ping-monitoring-card \.card-head\s*\{[^}]*border-bottom:\s*3px solid #697184;/s);
  assert.match(renderer, /if \(machineId === "__ping__"\)/);
  assert.match(css, /\.monitoring-card-dialog \.card-minimize-button\s*\{\s*display:\s*none;/);
  assert.match(application, /var BACKEND_CONFIG_LOADED = false;/);
  const monitoring = fs.readFileSync(path.join(root, "TAV_Monitoring_UI", "public", "javascripts", "monitoring.js"), "utf8");
  assert.match(monitoring, /BACKEND_CONFIG_LOADED = true;/);
  assert.match(monitoring, /if \(!BACKEND_CONFIG_LOADED\) await loadBackendConfig\(\);/);
  assert.match(monitoring, /socket\.addEventListener\("close", function\(\) \{\s*verifyBackendConnection\(\);/);
  assert.match(monitoring, /async function verifyBackendConnection\(\)[\s\S]*?fetch\("\/api\/health", \{ cache: "no-store" \}\)/);
  assert.match(renderer, /current\.length === expected\.length/);
  assert.match(renderer, /fetch\("\/api\/monitoring\/ping\/reference", \{ method: "PUT" \}\)/);
  assert.match(application, /addEventListener\("contextmenu"/);
  assert.match(application, /window\.confirm\(/);
  assert.match(view, />Set reference<\/button>/);
});

test("large monitoring maps open the assigned NovaStar output", () => {
  const mapMonitoring = fs.readFileSync(path.join(root, "TAV_Monitoring_UI", "public", "javascripts", "map-monitoring.js"), "utf8");
  const mapConfiguration = fs.readFileSync(path.join(root, "TAV_Monitoring_UI", "public", "javascripts", "monitoring-maps.js"), "utf8");
  const css = fs.readFileSync(path.join(root, "TAV_Monitoring_UI", "public", "stylesheets", "style.css"), "utf8");
  const view = fs.readFileSync(path.join(root, "TAV_Monitoring_UI", "views", "MonitoringMap.ejs"), "utf8");
  const configurationView = fs.readFileSync(path.join(root, "TAV_Monitoring_UI", "views", "MonitoringMaps.ejs"), "utf8");

  assert.match(mapMonitoring, /cell\.dataset\.machineId = String\(assignment\.machineId\)/);
  assert.match(mapMonitoring, /map-monitoring-stage-large \.map-monitoring-segment i\[data-machine-id\]/);
  assert.match(mapMonitoring, /openMapAssignmentMonitoring\(\{/);
  assert.match(mapConfiguration, /function openMapAssignmentMonitoring\(assignment\)/);
  assert.match(mapConfiguration, /outputCell\.classList\.add\("map-output-highlight"\)/);
  assert.match(css, /\.monitoring-card-dialog \.io-status-table td\.map-output-highlight\s*\{[^}]*outline:\s*5px solid #fff;/s);
  assert.match(css, /\.map-monitoring-dialog-actions \.icon-mode-switch img\s*\{[^}]*width:\s*22px;[^}]*height:\s*22px;/s);
  assert.match(view, /if \(canAccessMonitoringMaps && page === 'monitoring-map'\)[\s\S]*?id="configureMapMonitoringDialog"[\s\S]*?Configuration\.png/);
  assert.match(mapMonitoring, /configureMapMonitoringDialog\.href = "\/monitoring-maps\?mapId=" \+ encodeURIComponent\(map\.id\)/);
  assert.match(view, /id="resetMapMonitoringViewButton"[^>]*hidden/);
  assert.match(configurationView, /id="resetMapViewButton"[^>]*hidden/);
  assert.match(view, /id="resetMapMonitoringViewButton"[\s\S]*?\/images\/resetview\.png/);
  assert.match(view, /id="closeMapMonitoringDialog"[\s\S]*?\/images\/close\.png/);
  assert.match(configurationView, /id="resetMapViewButton"[\s\S]*?\/images\/resetview\.png/);
  assert.match(mapMonitoring, /mapMonitoringDialog\.addEventListener\("wheel"/);
  assert.match(mapMonitoring, /mapMonitoringDialogPanX/);
  assert.match(mapConfiguration, /resetMapViewButton\.addEventListener\("click", resetMapTransform\)/);
  assert.match(mapConfiguration, /new URLSearchParams\(window\.location\.search\)\.get\("mapId"\)/);
  assert.match(mapConfiguration, /label: "Toutes ->", direction: 1/);
  assert.match(mapConfiguration, /label: "Toutes <-", direction: -1/);
  assert.match(mapConfiguration, /if \(!segment\.assignments\[caseIndex\]\)/);
  assert.match(mapConfiguration, /caseIndex \+= direction/);
  assert.match(mapConfiguration, /mapContent\.style\.width = mapBackgroundImage\.naturalWidth \+ "px"/);
  assert.match(mapConfiguration, /mapContent\.style\.height = mapBackgroundImage\.naturalHeight \+ "px"/);
  assert.match(mapConfiguration, /function fittedMapTransform\(\)/);
  assert.match(mapConfiguration, /Math\.max\(fittedMapTransform\(\)\.zoom, mapZoom \* factor\)/);
});
