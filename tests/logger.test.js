"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { RollingLogger, formatLine } = require("../shared/Logger");

test("rolling logger aligns columns, redacts secrets and flushes errors immediately", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tav-logger-"));
  const file = path.join(directory, "application.log");
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const logger = new RollingLogger({ source: "BACKEND", file, file_enabled: true,
    console_enabled: false, flush_interval_ms: 600000, max_file_bytes: 1048576 });
  t.after(() => logger.close());

  logger.child("Short").info("queued message", { token: "private", lockKey: "192.0.2.10:161" });
  assert.equal(fs.existsSync(file), false);
  logger.child("A much longer module name").error("failure", { password: "hidden", code: 12 });
  const lines = fs.readFileSync(file, "utf8").trimEnd().split("\n");
  assert.equal(lines.length, 2);
  const separators = (line) => Array.from(line.matchAll(/ \| /g), (match) => match.index);
  assert.deepEqual(separators(lines[0]), separators(lines[1]));
  assert.match(lines[0], /"token":"\[redacted\]"/);
  assert.match(lines[0], /"lockKey":"192\.0\.2\.10:161"/);
  assert.match(lines[1], /"password":"\[redacted\]"/);
  assert.doesNotMatch(lines.join("\n"), /private|hidden/);
});

test("rolling logger rotates files without deleting earlier logs", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tav-rotation-"));
  const file = path.join(directory, "ui.log");
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const logger = new RollingLogger({ source: "UI", file, file_enabled: true,
    console_enabled: false, flush_interval_ms: 600000, max_file_bytes: 180 });
  t.after(() => logger.close());
  for (let index = 0; index < 5; index += 1) logger.child("Browser").info("message-" + index + "-" + "x".repeat(40));
  logger.flushSync();
  const files = fs.readdirSync(directory);
  assert.ok(files.includes("ui.log"));
  assert.ok(files.some((name) => /^ui\..+\.log$/.test(name)));
  const content = files.map((name) => fs.readFileSync(path.join(directory, name), "utf8")).join("");
  for (let index = 0; index < 5; index += 1) assert.match(content, new RegExp("message-" + index));
});

test("logger line format keeps the documented five columns", () => {
  const line = formatLine(new Date("2026-08-16T12:34:56.789Z"), "UI", "module", "warning", "content");
  assert.equal(line, "2026-08-16 12:34:56.789 | UI      | module                           | WARNING | content");
});

test("browser logger records semantic user interactions without form values", () => {
  const script = fs.readFileSync(path.join(__dirname, "..", "TAV_Monitoring_UI", "public", "javascripts", "browser-logger.js"), "utf8");
  assert.match(script, /User clicked Refresh all/);
  assert.match(script, /User minimized monitoring card/);
  assert.match(script, /User switched to Monitoring Map/);
  assert.match(script, /User switched to Configuration/);
  assert.match(script, /document\.addEventListener\("click", logUserClick\)/);
  assert.doesNotMatch(script, /control\.value/);
});
