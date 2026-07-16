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

test("device connectors exist only in the new backend", () => {
  ["SnmpLib.js", "NetgearM4300SnmpLib.js", "NovaStarApiLib.js", "KiloviewApiLib.js", "PingLib.js"].forEach((file) => {
    assert.equal(fs.existsSync(path.join(root, "TAV_Monitoring_Backend", "classes", file)), true);
    assert.equal(fs.existsSync(path.join(root, "TAV_Monitoring_UI", "classes", file)), false);
  });
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

test("monitoring cards group system health in one compact section", () => {
  const renderer = fs.readFileSync(path.join(root, "TAV_Monitoring_UI", "public", "javascripts", "monitoring-renderers.js"), "utf8");
  const css = fs.readFileSync(path.join(root, "TAV_Monitoring_UI", "public", "stylesheets", "style.css"), "utf8");

  assert.match(renderer, /systemRow\("Sante", healthItems\)/);
  assert.match(renderer, /systemRow\("Equipements", equipmentItems\)/);
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
  assert.doesNotMatch(renderer, /"Nom : "/);
  assert.doesNotMatch(renderer, /"Statut : "/);
  assert.match(renderer, /Reference : " \+ stateTitle\(item\.referenceState\)/);
  assert.match(css, /table th,[\s\S]*?table td:first-child,[\s\S]*?\.io-status-group > span\s*\{[^}]*font-family:\s*Poppins/);
  assert.match(css, /\.io-status-table th\s*\{[^}]*vertical-align:\s*middle;/s);
});

test("reference button previews expected state and uses a confirmed context-menu action", () => {
  const renderer = fs.readFileSync(path.join(root, "TAV_Monitoring_UI", "public", "javascripts", "monitoring-renderers.js"), "utf8");
  const application = fs.readFileSync(path.join(root, "TAV_Monitoring_UI", "public", "javascripts", "application.js"), "utf8");
  const view = fs.readFileSync(path.join(root, "TAV_Monitoring_UI", "views", "partials", "monitoring", "machine-cards.ejs"), "utf8");

  assert.match(renderer, />Reference<\/button>/);
  assert.match(renderer, /function buildReferencePreviewState\(machine, baseState\)/);
  assert.match(renderer, /reference-preview/);
  assert.match(application, /addEventListener\("contextmenu"/);
  assert.match(application, /window\.confirm\(/);
  assert.match(view, />Set reference<\/button>/);
});
