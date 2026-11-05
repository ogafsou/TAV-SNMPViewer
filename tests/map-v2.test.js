const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const http = require("http");
const { MapStore } = require("../TAV_Monitoring_Backend/classes/MapStore");
const { createBackend } = require("../TAV_Monitoring_Backend/app");
const { listen, close } = require("./helpers");

const output = (machineId) => ({ machineId, machineName: machineId, cardId: "1", outputId: "1" });
const block = () => ({ id: "block", x: .1, y: .1, orientation: "horizontal", length: .7, cases: 14, moduleRanges: [] });

test("V2 persists opposite Main/Backup ranges and preserves them through export/import", (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "tav-map-v2-"));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const store = new MapStore(path.join(folder, "v2.json"), "/api/maps-v2");
  const map = store.create({ name: "LED" });
  const segment = block();
  segment.reversed = true;
  segment.moduleRanges = [
    { role: "main", start: 2, end: 13, assignment: output("main") },
    { role: "backup", start: 13, end: 2, assignment: output("backup") },
    { role: "main", start: -1, end: 8, assignment: output("invalid") },
    { role: "main", start: 4, end: 8, assignment: output("overlap") }
  ];
  const saved = store.setSegments(map.id, [segment]);
  assert.equal(store.find(map.id).segments[0].reversed, true);
  assert.equal(saved.segments[0].moduleRanges.length, 2);
  store.setBackground(map.id, Buffer.from("image"), "image/png");
  assert.equal(store.find(map.id).backgroundUrl, "/api/maps-v2/" + map.id + "/background");
  const imported = store.importArchive(store.exportArchive(map.id), ["main"]).map;
  assert.equal(imported.segments[0].reversed, true);
  assert.deepEqual(imported.segments[0].moduleRanges, saved.segments[0].moduleRanges);
  assert.equal(fs.readFileSync(store.backgroundPath(imported), "utf8"), "image");
  store.setSegments(map.id, [{ ...segment, cases: 5 }]);
  assert.equal(store.find(map.id).segments[0].moduleRanges.length, 0);
});

function editor() {
  const map = { id: "v2", segments: [block()] };
  const context = {
    selectedMap: () => map, selectedMapId: "v2", selectedSegmentId: "block", selectedCaseIndex: 2,
    segmentById: (id) => map.segments.find((s) => s.id === id),
    mapZone: { addEventListener() {} }, document: { addEventListener() {}, getElementById: () => ({ textContent: "" }) },
    segmentGesture: null, mapEditMode: { checked: true }, segmentContextMenu: { hidden: false },
    renderMapSegments() {}, setStatus(message) { context.message = message; },
    assignmentKey: (a) => [a.machineId, a.cardId, a.outputId].join(":"),
    saveMapSegments: async () => {}, Map
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../TAV_Monitoring_UI/public/javascripts/map-v2.js"), "utf8"), context);
  context.click = (index, role) => context.mapV2Click({
    stopPropagation() {}, target: { closest(selector) {
      if (selector === "[data-role]") return { dataset: { role } };
      return { dataset: { caseIndex: String(index) }, closest: () => ({ dataset: { segmentId: "block" } }) };
    } }
  });
  return { context, map };
}

test("range selection is provisional, follows numbering both ways, and keeps the other half", async () => {
  const { context: c, map } = editor();
  c.mapV2StartRange(output("main"));
  assert.equal(map.segments[0].moduleRanges.length, 0);
  assert.equal(c.mapV2Pending.start, 2);
  await c.click(13, "backup");
  assert.equal(map.segments[0].moduleRanges.length, 0);
  await c.click(13, "main");
  assert.equal(c.mapV2Pending, null);
  c.mapV2Role = "backup";
  c.selectedCaseIndex = 13;
  await c.mapV2StartRange(output("backup"));
  const ranges = map.segments[0].moduleRanges;
  assert.equal(ranges.length, 2);
  assert.deepEqual(Array.from(ranges, (r) => [r.role, r.start, r.end]), [["main", 2, 13], ["backup", 13, 2]]);
  assert.equal(c.mapV2RangeAt(map.segments[0], 7, "main").assignment.machineId, "main");
  assert.equal(c.mapV2RangeAt(map.segments[0], 7, "backup").assignment.machineId, "backup");
});

test("start arrows mark the directed first module and expose NovaStar output details", () => {
  const { context: c, map } = editor();
  const node = () => ({ children: [], dataset: {}, className: "", attributes: {},
    appendChild(child) { this.children.push(child); },
    setAttribute(key, value) { this.attributes[key] = value; }, classList: { add() {} }
  });
  c.document.createElement = node;
  c.document.createElementNS = node;
  c.assignmentOutputIsOk = () => true;
  c.monitoringState = {};
  c.mapMonitoringHasMicroInterruption = () => false;
  const segment = map.segments[0];
  segment.moduleRanges = [
    { role: "main", start: 2, end: 13, assignment: output("Main NovaStar") },
    { role: "backup", start: 13, end: 2, assignment: output("Spare NovaStar") }
  ];
  const arrows = (index, editing) => c.mapV2CreateCell(segment, index, editing).children.filter((child) => child.className.startsWith("module-start-arrow"));
  assert.equal(arrows(7, true).length, 0);
  const main = arrows(2, true);
  assert.equal(main.length, 1);
  assert.match(main[0].className, /main horizontal/);
  assert.match(main[0].title, /Main NovaStar.*Carte 1 \/ Sortie 1.*1 → 12/);
  segment.orientation = "vertical";
  const backup = arrows(13, false);
  assert.equal(backup.length, 1);
  assert.match(backup[0].className, /backup vertical/);
  assert.match(backup[0].attributes["aria-label"], /Backup.*Spare NovaStar.*12 → 1/);
  for (const editing of [true, false]) {
    for (const state of ["ok", "warning", "error", "inactive"]) {
      for (const machineId of ["Main NovaStar", "Spare NovaStar"]) {
        c.monitoringState[machineId] = { connected: true, outputTables: [
          { label: "1", ports: [{ label: "1", state, ok: true }] }
        ] };
      }
      const triangles = c.mapV2CreateCell(segment, 7, editing).children.filter(child => child.className.startsWith("module-triangle"));
      assert.equal(triangles.length, 2);
      const expected = state === "warning" ? "backup-state" : state === "ok" ? "ok" : "error";
      triangles.forEach(triangle => assert.equal(triangle.className.split(" ").pop(), expected));
    }
  }
  c.monitoringState["Main NovaStar"].connected = false;
  assert.equal(c.mapV2OutputState(output("Main NovaStar")), "error");
  assert.equal(c.mapV2OutputState(output("missing")), "error");
});

test("quarter turns preserve pixel dimensions, center, module identities and creation direction", () => {
  const { context: c } = editor();
  const initial = { ...block(), x: .3, y: .5, length: .4, reversed: false };
  const segment = { ...initial };
  const orientations = ["vertical", "horizontal", "vertical", "horizontal"];
  const directions = [false, true, true, false];
  for (let step = 0; step < 4; step++) {
    Object.assign(segment, c.mapV2RotatedGeometry(segment, true, 1000, 800));
    assert.equal(segment.orientation, orientations[step]);
    assert.equal(segment.reversed, directions[step]);
    const horizontal = segment.orientation === "horizontal";
    assert.ok(Math.abs(segment.x + (horizontal ? segment.length / 2 : 0) - .5) < 1e-9);
    assert.ok(Math.abs(segment.y + (horizontal ? 0 : segment.length / 2) - .5) < 1e-9);
    assert.ok(Math.abs(segment.length * (horizontal ? 1000 : 800) - 400) < 1e-9);
  }
  const counterclockwise = c.mapV2RotatedGeometry(initial, false, 1000, 800);
  assert.equal(counterclockwise.reversed, true);
  const restored = c.mapV2RotatedGeometry({ ...initial, ...counterclockwise }, true, 1000, 800);
  assert.equal(restored.reversed, false);
  assert.equal(restored.orientation, "horizontal");
  const nearEdge = c.mapV2RotatedGeometry({ ...initial, y: .05 }, true, 1000, 800);
  assert.ok(nearEdge.y < 0);
  assert.ok(Math.abs(nearEdge.y + nearEdge.length / 2 - .05) < 1e-9);
  const node = { style: {} };
  for (const orientation of ["horizontal", "vertical"]) {
    c.mapV2ApplyDirection(node, { orientation, reversed: true });
    assert.equal(node.style.flexDirection, orientation === "horizontal" ? "row-reverse" : "column-reverse");
  }
});

test("module numbers progressively thin out with screen size and always retain both ends", () => {
  const { context: c } = editor();
  let pixels = 2;
  const labels = Array.from({ length: 23 }, () => ({ style: {} }));
  const cells = labels.map((label, index) => ({ dataset: { caseIndex: String(index) },
    getBoundingClientRect: () => ({ width: pixels, height: pixels }), querySelector: () => label }));
  const blockNode = { classList: { contains: () => false }, querySelectorAll: () => cells };
  const container = { querySelectorAll: () => [blockNode] };
  const visibleNumbers = () => labels.flatMap((label, index) => label.style.visibility === "visible" ? [index + 1] : []);
  c.mapV2UpdateNumbers(container);
  assert.deepEqual(visibleNumbers(), [1, 10, 20, 23]);
  pixels = 5;
  c.mapV2UpdateNumbers(container);
  assert.deepEqual(visibleNumbers(), [1, 5, 10, 15, 20, 23]);
  pixels = 12;
  c.mapV2UpdateNumbers(container);
  assert.deepEqual(visibleNumbers(), [1, 5, 10, 15, 20, 23]);
  pixels = 24;
  c.mapV2UpdateNumbers(container);
  assert.equal(visibleNumbers().length, 23);
  blockNode.classList.contains = () => true;
  cells.reverse();
  pixels = 2;
  c.mapV2UpdateNumbers(container);
  assert.deepEqual(visibleNumbers(), [1, 10, 20, 23]);
});

test("Ctrl-wheel rotates near map edges, persists overflow, and keeps targeting the moved block", async (t) => {
  const { context: c, map } = editor();
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "tav-map-v2-rotation-"));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const store = new MapStore(path.join(folder, "v2.json"), "/api/maps-v2");
  const storedMap = store.create({ name: "Rotation" });
  const segment = map.segments[0];
  Object.assign(segment, { x: .1, y: .08, length: .7 });
  c.mapContent = { clientWidth: 1000, clientHeight: 500 };
  c.saveMapSegments = async () => { map.segments = store.setSegments(storedMap.id, map.segments).segments; };
  await c.mapV2Rotate({ deltaY: 120, target: { closest: () => ({ dataset: { segmentId: "block" } }) } });
  assert.equal(map.segments[0].orientation, "vertical");
  assert.ok(Math.abs(map.segments[0].length - 1.4) < 1e-9);
  assert.ok(map.segments[0].y < 0);
  assert.ok(store.find(storedMap.id).segments[0].y < 0);
  await c.mapV2Rotate({ deltaY: 120, target: { closest: () => null } });
  assert.equal(map.segments[0].orientation, "horizontal");
  assert.equal(map.segments[0].reversed, true);
  assert.ok(Math.abs(map.segments[0].y - .08) < 1e-9);
  const previous = JSON.stringify(map.segments);
  c.saveMapSegments = async () => { throw new Error("offline"); };
  await c.mapV2Rotate({ deltaY: -120, target: { closest: () => null } });
  assert.equal(JSON.stringify(map.segments), previous);
  assert.equal(c.mapV2Saving, false);
});

test("one NovaStar output can be reused across ranges, halves and blocks and survives reload", async (t) => {
  const { context: c, map } = editor();
  const assign = async (start, end, role) => {
    c.selectedCaseIndex = start;
    c.mapV2Role = role;
    await c.mapV2StartRange(output("shared"));
    if (c.mapV2Pending) await c.click(end, role);
  };
  await assign(0, 2, "main");
  await assign(5, 7, "main");
  await assign(7, 5, "backup");
  assert.equal(map.segments[0].moduleRanges.length, 3);
  const second = { ...block(), id: "second", moduleRanges: [] };
  map.segments.push(second);
  c.selectedSegmentId = "second";
  c.selectedCaseIndex = 10;
  c.mapV2Role = "main";
  c.mapV2StartRange(output("shared"));
  // The click helper targets the first block; use the second block's pending
  // range via a real endpoint-shaped event instead.
  await c.mapV2Click({ stopPropagation() {}, target: { closest(selector) {
    return selector === "[data-role]" ? { dataset: { role: "main" } } :
      { dataset: { caseIndex: "12" }, closest: () => ({ dataset: { segmentId: "second" } }) };
  } } });
  assert.equal(map.segments[0].moduleRanges.length, 3);
  assert.equal(map.segments[1].moduleRanges.length, 1);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "tav-map-v2-reuse-"));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const store = new MapStore(path.join(folder, "maps.json"), "/api/maps-v2");
  const created = store.create({ name: "Reusable outputs" });
  store.setSegments(created.id, map.segments);
  assert.deepEqual(store.find(created.id).segments.map((s) => s.moduleRanges.length), [3, 1]);
});

test("failed saves roll back, overlaps are rejected, and cancellation leaves stored ranges intact", async () => {
  const { context: c, map } = editor();
  c.mapV2StartRange(output("main"));
  c.saveMapSegments = async () => { throw new Error("offline"); };
  await c.click(5, "main");
  assert.equal(map.segments[0].moduleRanges.length, 0);
  assert.equal(c.message, "offline");
  assert.equal(c.mapV2Pending.start, 2);
  c.mapV2CancelRange();
  assert.equal(c.mapV2Pending, null);
  c.saveMapSegments = async () => {};
  c.selectedCaseIndex = 2;
  c.mapV2StartRange(output("main"));
  await c.click(5, "main");
  c.selectedCaseIndex = 4;
  c.mapV2StartRange(output("other"));
  await c.click(8, "main");
  assert.equal(map.segments[0].moduleRanges.length, 1);
  assert.match(c.message, /chevauche/);
});

test("V2 API allows all readers and administrator/editor writes, seeds independent geometry/backgrounds, and never scans", async (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "tav-map-v2-api-"));
  const legacy = new MapStore(path.join(folder, "maps.json"));
  const source = legacy.create({ name: "Original" });
  legacy.setSegments(source.id, [{ ...block(), assignments: [output("legacy")] }]);
  legacy.setBackground(source.id, Buffer.from("image"), "image/png");
  let scans = 0;
  const backend = createBackend({
    config: { mapsFile: legacy.filePath, machinesFile: path.join(folder, "machines.json"), loglevel: "error", monitor_interval_s: 0 },
    auth: { authenticateRequest: (req) => ({ id: "test", login: req.headers.cookie === "olivier" ? "Olivier" : "admin", role: req.headers.cookie === "user" ? "user" : req.headers.cookie === "editor" ? "editor" : "administrator" }) },
    deviceMonitor: { monitor: async () => { scans++; } }
  });
  const server = http.createServer(backend.app);
  const port = await listen(server);
  t.after(async () => { backend.monitoring.stop(); await close(server); fs.rmSync(folder, { recursive: true, force: true }); });
  const base = "http://127.0.0.1:" + port;
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const suffix = method === "PUT" ? "/unknown/segments" : ["DELETE", "PATCH"].includes(method) ? "/unknown" : "";
    assert.equal((await fetch(base + "/api/maps-v2" + suffix, { method, headers: { cookie: "user" } })).status, 403);
  }
  assert.equal((await fetch(base + "/api/maps-v2", { headers: { cookie: "user" } })).status, 200);
  assert.equal((await fetch(base + "/api/maps-v2", { headers: { cookie: "admin" } })).status, 200);
  const headers = { cookie: "editor", "content-type": "application/json" };
  const response = await fetch(base + "/api/maps-v2", { headers });
  assert.equal(response.status, 200);
  const maps = await response.json();
  assert.equal(maps.length, 1);
  assert.notEqual(maps[0].id, source.id);
  assert.equal(maps[0].segments[0].assignments.filter(Boolean).length, 0);
  assert.equal((await fetch(base + maps[0].backgroundUrl, { headers })).status, 200);
  const segment = maps[0].segments[0];
  segment.moduleRanges = [{ role: "backup", start: 13, end: 2, assignment: output("backup") }];
  const saved = await fetch(base + "/api/maps-v2/" + maps[0].id + "/segments", { method: "PUT", headers, body: JSON.stringify({ segments: [segment] }) });
  assert.equal(saved.status, 200);
  const reloaded = await (await fetch(base + "/api/maps-v2", { headers })).json();
  assert.equal(reloaded[0].segments[0].moduleRanges[0].start, 13);
  assert.equal(legacy.find(source.id).segments[0].moduleRanges.length, 0);
  assert.equal(legacy.find(source.id).segments[0].assignments[0].machineId, "legacy");
  const createdResponse = await fetch(base + "/api/maps-v2", {
    method: "POST", headers, body: JSON.stringify({ name: "Nouvelle map V2" })
  });
  assert.equal(createdResponse.status, 201);
  const created = (await createdResponse.json()).map;
  assert.equal(created.name, "Nouvelle map V2");
  assert.equal(legacy.load().length, 1);
  const renamed = await fetch(base + "/api/maps-v2/" + created.id, {
    method: "PATCH", headers, body: JSON.stringify({ name: "V2 renommée" })
  });
  assert.equal(renamed.status, 200);
  assert.equal((await renamed.json()).map.name, "V2 renommée");
  assert.equal(scans, 0);
});

test("map form displays V2 backend errors inside the dialog and allows retry", async () => {
  const elements = new Map();
  const handlers = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, {
      hidden: true, disabled: false, value: "", textContent: "", name: { value: "aaa" },
      addEventListener(type, handler) { handlers.set(id + ":" + type, handler); },
      querySelector: () => element("submit"), close() { this.closed = true; }
    });
    return elements.get(id);
  };
  const c = {
    document: { getElementById: element, addEventListener() {} },
    window: { location: { search: "" }, addEventListener() {} },
    URLSearchParams, localStorage: { getItem() { return ""; } },
    mapV2Enabled: true, mapsApiBase: "/api/maps-v2", setStatus() {},
    fetch: async () => ({ ok: false, status: 404, json: async () => { throw new Error("HTML response"); } })
  };
  vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../TAV_Monitoring_UI/public/javascripts/monitoring-maps.js"), "utf8"), c);
  const submit = handlers.get("mapForm:submit");
  await submit({ preventDefault() {} });
  assert.equal(element("mapFormError").hidden, false);
  assert.match(element("mapFormError").textContent, /Redémarrez le backend/);
  assert.equal(element("mapDialog").closed, undefined);
  assert.equal(element("mapForm").name.value, "aaa");
  assert.equal(element("submit").disabled, false);
  c.fetch = async () => { throw new Error("Connexion interrompue"); };
  await submit({ preventDefault() {} });
  assert.equal(element("mapFormError").textContent, "Connexion interrompue");
  assert.equal(element("submit").disabled, false);
  c.fetch = async () => ({ ok: true, json: async () => ({ map: { id: "new", name: "aaa" } }) });
  c.resetMapTransform = c.renderMapList = c.renderSelectedMap = () => {};
  await submit({ preventDefault() {} });
  assert.equal(element("mapDialog").closed, true);
  assert.equal(c.monitoringMaps.length, 1);
  assert.equal(c.selectedMapId, "new");
});


test("mouse wiring expands rows and columns but skips intermediate diagonal modules", async () => {
  const { context: c, map } = editor();
  Object.assign(map.segments[0], { rows: 3, columns: 3, cases: 9, wiringMode: "mouse" });
  assert.deepEqual(Array.from(c.mapV2LineModules(map.segments[0], 0, 8)), [0, 8]);
  c.selectedCaseIndex = 0;
  c.mapV2StartRange(output("main"));
  await c.click(2, "main");
  await c.click(8, "main");
  await c.click(6, "main");
  await c.click(3, "main");
  await c.click(4, "main");
  assert.equal(new Set(c.mapV2Pending.modules).size, 9);
  await c.click(0, "main");
  assert.equal(c.mapV2Pending.modules.length, 9);
  await c.mapV2FinishRange();
  assert.equal(c.mapV2Pending, null);
  assert.deepEqual(Array.from(map.segments[0].moduleRanges[0].modules), [0, 1, 2, 5, 8, 7, 6, 3, 4]);
  c.mapV2Role = "backup";
  c.selectedCaseIndex = 8;
  c.mapV2StartRange(output("backup"));
  await c.click(0, "backup");
  await c.mapV2FinishRange();
  assert.deepEqual(Array.from(map.segments[0].moduleRanges[1].modules), [8, 0]);
});

test("grid geometry and arbitrary routes survive persistence and export", (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "tav-grid-"));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const store = new MapStore(path.join(folder, "maps.json"), "/api/maps-v2");
  const map = store.create({ name: "Grid" });
  const segment = { ...block(), rows: 3, columns: 3, cases: 9, gridRotation: 1, wiringMode: "mouse", moduleRanges: [
    { role: "main", start: 0, end: 8, modules: [0, 4, 8], assignment: output("main") },
    { role: "main", start: 1, end: 2, modules: [1, 4, 2], assignment: output("overlap") },
    { role: "main", start: 1, end: 1, modules: [1, 1], assignment: output("duplicate") },
    { role: "backup", start: 8, end: 0, modules: [8, 4, 0], assignment: output("backup") }
  ] };
  const saved = store.setSegments(map.id, [segment]).segments[0];
  assert.equal(saved.cases, 9);
  assert.equal(saved.rows, 3);
  assert.equal(saved.wiringMode, "mouse");
  assert.equal(saved.moduleRanges.length, 2);
  assert.deepEqual(store.importArchive(store.exportArchive(map.id), ["main", "backup"]).map.segments[0], saved);
});

test("grid quarter turns preserve module identities and square cells", () => {
  const { context: c } = editor();
  let segment = { ...block(), rows: 2, columns: 3, cases: 6, gridRotation: 0 };
  const initial = { ...segment };
  for (let turn = 0; turn < 4; turn++) {
    Object.assign(segment, c.mapV2RotatedGeometry(segment, true, 1000, 500));
    const positions = Array.from({ length: 6 }, (_, i) => c.mapV2CellPosition(segment, i));
    assert.equal(new Set(positions.map(p => p.row + ":" + p.column)).size, 6);
    assert.ok(Math.abs(c.mapV2Thickness(segment, 1000, 500) - (700 / 3 * 2)) < 1e-8);
  }
  assert.ok(Math.abs(segment.x - initial.x) < 1e-8);
  assert.ok(Math.abs(segment.y - initial.y) < 1e-8);
  assert.deepEqual(c.mapV2CellPosition(segment, 4), c.mapV2CellPosition(initial, 4));
});


test("rectangle creation preserves both dragged dimensions through save, reload and rotation", (t) => {
  const { context: c } = editor();
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "tav-rectangle-"));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const store = new MapStore(path.join(folder, "maps.json"), "/api/maps-v2");
  const map = store.create({ name: "Rectangle" });
  for (const [start, end] of [
    [{ x: .1, y: .2 }, { x: .7, y: .8 }],
    [{ x: .7, y: .8 }, { x: .1, y: .2 }],
    [{ x: .1, y: .8 }, { x: .7, y: .2 }]
  ]) {
    const rect = c.mapV2SelectionRect(start, end);
    const geometry = c.mapV2GridFromRectangle(rect, { rows: 2, columns: 3, cases: 6, wiringMode: "mouse" }, 1000, 500);
    let segment = store.setSegments(map.id, [{ ...geometry, id: "rectangle" }]).segments[0];
    assert.equal(segment.orientation, "horizontal");
    assert.ok(Math.abs(segment.x - .1) < 1e-8);
    assert.ok(Math.abs(segment.y - .5) < 1e-8);
    assert.ok(Math.abs(segment.length * 1000 - 600) < 1e-8);
    assert.ok(Math.abs(c.mapV2Thickness(segment, 1000, 500) - 300) < 1e-8);
    Object.assign(segment, c.mapV2RotatedGeometry(segment, true, 1000, 500));
    segment = store.setSegments(map.id, [segment]).segments[0];
    assert.ok(Math.abs(segment.length * 500 - 600) < 1e-8);
    assert.ok(Math.abs(c.mapV2Thickness(segment, 1000, 500) - 300) < 1e-8);
  }
});

test("diagonal skipping is independent of rotation and reversed numbering", () => {
  const { context: c, map } = editor();
  for (const reversed of [false, true]) for (let gridRotation = 0; gridRotation < 4; gridRotation++) {
    const segment = { ...map.segments[0], rows: 3, columns: 3, cases: 9, gridRotation, reversed };
    assert.deepEqual(Array.from(c.mapV2LineModules(segment, 0, 8)), [0, 8]);
    assert.deepEqual(Array.from(c.mapV2LineModules(segment, 0, 2)), [0, 1, 2]);
    assert.deepEqual(Array.from(c.mapV2LineModules(segment, 0, 6)), [0, 3, 6]);
  }
});


test("reclicking a corner undoes its whole leg and allows correcting the route", async () => {
  const { context: c, map } = editor();
  Object.assign(map.segments[0], { rows: 3, columns: 3, cases: 9, wiringMode: "mouse" });
  c.selectedCaseIndex = 0;
  c.mapV2StartRange(output("main"));
  await c.click(2, "main");
  await c.click(8, "main");
  c.mapV2Pending.previewModules = [0, 1, 2, 5, 8, 7, 6];
  c.mapV2Pending.previewIndex = 6;
  await c.click(8, "backup");
  assert.equal(c.mapV2Pending.end, 8);
  await c.click(8, "main");
  assert.deepEqual(Array.from(c.mapV2Pending.modules), [0, 1, 2]);
  assert.equal(c.mapV2Pending.end, 2);
  assert.equal(c.mapV2Pending.previewModules, undefined);
  assert.equal(c.mapV2Pending.previewIndex, undefined);
  assert.equal(map.segments[0].moduleRanges.length, 0);
  await c.click(5, "main");
  await c.click(4, "main");
  await c.click(2, "main");
  assert.deepEqual(Array.from(c.mapV2Pending.modules), [0]);
  assert.equal(c.mapV2Pending.corners.length, 1);
  await c.click(8, "main");
  await c.mapV2FinishRange();
  assert.deepEqual(Array.from(map.segments[0].moduleRanges[0].modules), [0, 8]);
});


test("choosing a Backup output reverses the Main and replaces only overlapping modules", async () => {
  const { context: c, map } = editor();
  const segment = map.segments[0];
  segment.moduleRanges = [{ role: "backup", start: 0, end: 8, assignment: output("old") }];
  const select = { value: "0", replaceChildren() {}, add() {} };
  const submit = {};
  const dialog = { showModal() { this.open = true; }, close() { this.open = false; this.onclose(); } };
  const form = { elements: { output: select }, querySelector: () => submit };
  c.document.getElementById = (id) => ({ moduleBackupDialog: dialog, moduleBackupForm: form }[id] || {});
  c.Option = function() {};
  c.novastarOutputs = () => [{ cards: [{ outputs: [output("new")] }] }];
  c.mapV2StartRange(output("main"));
  await c.click(5, "main");
  assert.equal(dialog.open, true);
  assert.equal(segment.moduleRanges.length, 2);
  await form.onsubmit({ preventDefault() {} });
  assert.equal(dialog.open, false);
  const backup = segment.moduleRanges.filter(range => range.role === "backup");
  assert.deepEqual(Array.from(backup, range => Array.from(range.modules)), [[0, 1], [6, 7, 8], [5, 4, 3, 2]]);
  assert.equal(backup[2].assignment.machineId, "new");
});

test("transposing a rotated grid swaps coordinates without renumbering the wiring", async () => {
  const { context: c, map } = editor();
  const range = { role: "main", start: 0, end: 5, modules: [0, 5], assignment: output("main") };
  const segment = Object.assign(map.segments[0], { rows: 2, columns: 3, cases: 6, gridRotation: 1, moduleRanges: [range] });
  c.mapContent = { clientWidth: 1000, clientHeight: 500 };
  const before = Array.from({ length: 6 }, (_, index) => c.mapV2CellPosition(segment, index));
  const thickness = c.mapV2Thickness(segment, 1000, 500);
  const { x, y, length, orientation } = segment;
  await c.mapV2Transpose();
  assert.deepEqual({ x: segment.x, y: segment.y, length: segment.length, orientation: segment.orientation }, { x, y, length, orientation });
  assert.ok(Math.abs(c.mapV2Thickness(segment, 1000, 500) - thickness) < 1e-8);
  for (const [index, position] of before.entries()) {
    const after = c.mapV2CellPosition(segment, index);
    assert.equal(after.row, position.column);
    assert.equal(after.column, position.row);
  }
  assert.equal(segment.moduleRanges[0], range);
  await c.mapV2Transpose();
  assert.deepEqual(Array.from({ length: 6 }, (_, index) => c.mapV2CellPosition(segment, index)), before);
});

test("each Main starts at one and its last module can provision a deferred reverse Backup", async () => {
  const { context: c, map } = editor();
  const segment = Object.assign(map.segments[0], { rows: 3, columns: 3, cases: 9, wiringMode: "mouse" });
  segment.moduleRanges = [
    { role: "main", start: 8, end: 0, modules: [8, 5, 2, 0], assignment: output("first") },
    { role: "main", start: 6, end: 3, modules: [6, 3], assignment: output("second") }
  ];
  assert.deepEqual([8, 5, 2, 0, 6, 3].map(index => c.mapV2ModuleNumber(segment, index)), [1, 2, 3, 4, 1, 2]);
  c.selectedCaseIndex = 0;
  c.mapV2Role = "backup";
  await c.mapV2StartRange(output("deferred"));
  assert.deepEqual(Array.from(segment.moduleRanges[2].modules), [0, 2, 5, 8]);
  assert.equal(segment.moduleRanges[2].assignment.machineId, "deferred");
});
