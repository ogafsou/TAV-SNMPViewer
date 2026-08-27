"use strict";

const { RollingLogger } = require("../shared/Logger");
const instance = new RollingLogger({ source: "UI", file_enabled: false });
const defaultLogger = instance.child("UI");

module.exports = {
  configure: (options) => instance.configure(Object.assign({ source: "UI" }, options || {})),
  child: (moduleName) => instance.child(moduleName),
  morgan: (moduleName) => instance.morgan(moduleName),
  flush: () => instance.flushSync(),
  close: () => instance.close(),
  debug: defaultLogger.debug, info: defaultLogger.info,
  warning: defaultLogger.warning, error: defaultLogger.error
};
