"use strict";

const fs = require("fs");
const path = require("path");

const LEVELS = { debug: 10, info: 20, warning: 30, error: 40 };
const WIDTHS = { date: 23, source: 7, module: 32, level: 7 };

class RollingLogger {
  constructor(options) {
    this.options = Object.assign({ source: "APP", level: "info", file_enabled: true,
      file: "./logs/application.log", max_file_bytes: 10485760,
      flush_interval_ms: 30000, console_enabled: true }, options || {});
    this.options.source = fixed(this.options.source, WIDTHS.source);
    this.options.level = normalizeLevel(this.options.level);
    this.options.max_file_bytes = positiveInteger(this.options.max_file_bytes, 10485760);
    this.options.flush_interval_ms = positiveInteger(this.options.flush_interval_ms, 30000);
    this.queue = [];
    this.timer = null;
    this.rotationSequence = 0;
    this.startTimer();
  }

  configure(options) {
    Object.assign(this.options, options || {});
    this.options.source = fixed(this.options.source, WIDTHS.source);
    this.options.level = normalizeLevel(this.options.level);
    this.options.max_file_bytes = positiveInteger(this.options.max_file_bytes, 10485760);
    this.options.flush_interval_ms = positiveInteger(this.options.flush_interval_ms, 30000);
    this.startTimer();
    return this;
  }

  child(moduleName) {
    const logger = this;
    const module = cleanModule(moduleName);
    return {
      debug: (message, metadata) => logger.log("debug", module, message, metadata),
      info: (message, metadata) => logger.log("info", module, message, metadata),
      warning: (message, metadata) => logger.log("warning", module, message, metadata),
      error: (message, metadata) => logger.log("error", module, message, metadata)
    };
  }

  log(level, moduleName, message, metadata) {
    const normalizedLevel = normalizeLevel(level);
    if (LEVELS[normalizedLevel] < LEVELS[this.options.level]) return;
    const line = formatLine(new Date(), this.options.source, moduleName, normalizedLevel, message, metadata);
    if (this.options.console_enabled !== false) console.log(line);
    if (!this.options.file_enabled || !this.options.file) return;
    this.queue.push(line + "\n");
    if (normalizedLevel === "error") this.flushSync();
  }

  morgan(moduleName) { return { write: (line) => this.log("info", moduleName || "HTTP", String(line || "").trim()) }; }

  startTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (!this.options.file_enabled) return;
    this.timer = setInterval(() => this.flushSync(), this.options.flush_interval_ms);
    if (this.timer.unref) this.timer.unref();
  }

  flushSync() {
    if (!this.queue.length || !this.options.file_enabled || !this.options.file) return;
    const pending = this.queue.splice(0);
    try {
      const file = path.resolve(this.options.file);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      pending.forEach((line) => {
        this.rotateIfNeeded(file, Buffer.byteLength(line));
        fs.appendFileSync(file, line, "utf8");
      });
      const descriptor = fs.openSync(file, "r+");
      try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    } catch (error) {
      this.queue.unshift(...pending);
      console.error("Logger file flush failed:", error.message);
    }
  }

  rotateIfNeeded(file, incomingBytes) {
    if (!fs.existsSync(file)) return;
    const currentBytes = fs.statSync(file).size;
    if (currentBytes === 0 || currentBytes + incomingBytes <= this.options.max_file_bytes) return;
    const parsed = path.parse(file);
    const stamp = fileStamp(new Date());
    let rotated;
    do {
      this.rotationSequence += 1;
      rotated = path.join(parsed.dir, parsed.name + "." + stamp + "." + this.rotationSequence + parsed.ext);
    } while (fs.existsSync(rotated));
    fs.renameSync(file, rotated);
  }

  close() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.flushSync();
  }
}

function formatLine(date, source, moduleName, level, message, metadata) {
  const dateText = date.toISOString().replace("T", " ").replace("Z", "");
  const details = metadata === undefined ? "" : " " + safeJson(redact(metadata));
  return fixed(dateText, WIDTHS.date) + " | " + fixed(source, WIDTHS.source) + " | " +
    fixed(cleanModule(moduleName), WIDTHS.module) + " | " + fixed(String(level).toUpperCase(), WIDTHS.level) +
    " | " + cleanText(message) + details;
}

function fixed(value, width) { const text = String(value || ""); return text.length <= width ? text.padEnd(width, " ") : text.slice(0, width - 3) + "..."; }
function cleanModule(value) { return cleanText(value || "unknown"); }
function cleanText(value) { return String(value === undefined ? "" : value).replace(/[\r\n\t]+/g, " ").trim(); }
function normalizeLevel(value) { const level = String(value || "info").toLowerCase(); return LEVELS[level] ? level : "info"; }
function positiveInteger(value, fallback) { const number = Number(value); return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback; }
function safeJson(value) { try { return JSON.stringify(value); } catch (_) { return '"[unserializable]"'; } }
function fileStamp(date) { return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z").replace("T", "-"); }

function redact(value, seen) {
  if (Array.isArray(value)) return value.map((item) => redact(item, seen));
  if (!value || typeof value !== "object") return value;
  const visited = seen || new Set();
  if (visited.has(value)) return "[circular]";
  visited.add(value);
  const result = {};
  Object.keys(value).forEach((key) => {
    result[key] = isSensitiveKey(key) ? "[redacted]" : redact(value[key], visited);
  });
  visited.delete(value);
  return result;
}

function isSensitiveKey(key) {
  const name = String(key || "");
  return /^key$/i.test(name) || /password|community|secret|token|authorization|cookie|api.?key|private.?key/i.test(name);
}

module.exports = { RollingLogger, formatLine, redact, WIDTHS };
