"use strict";

const { RollingLogger } = require("../../shared/Logger");
const instance = new RollingLogger({ source: "BACKEND", file_enabled: false });
const defaultLogger = instance.child("Backend");

module.exports = {
  configure: (options) => instance.configure(Object.assign({ source: "BACKEND" }, options || {})),
  setLevel: (level) => instance.configure({ level }),
  child: (moduleName) => instance.child(moduleName),
  morgan: (moduleName) => instance.morgan(moduleName),
  flush: () => instance.flushSync(),
  close: () => instance.close(),
  debug: defaultLogger.debug, info: defaultLogger.info,
  warning: defaultLogger.warning, error: defaultLogger.error
};
