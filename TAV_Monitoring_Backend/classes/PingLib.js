const { execFile } = require("child_process");

function ping(host, timeout = 2000) {
  const timeoutMs = Math.min(Math.max(Number(timeout) || 2000, 500), 10000);
  const args = process.platform === "win32"
    ? ["-n", "1", "-w", String(timeoutMs), host]
    : ["-c", "1", "-W", String(Math.max(1, Math.ceil(timeoutMs / 1000))), host];

  return new Promise((resolve) => {
    const startedAt = Date.now();
    execFile("ping", args, { timeout: timeoutMs + 1000, windowsHide: true }, (error) => {
      resolve({
        online: !error,
        latencyMs: Date.now() - startedAt,
        error: error ? friendlyPingError(error) : ""
      });
    });
  });
}

function friendlyPingError(error) {
  if (error.killed) {
    return "Delai de reponse depasse";
  }
  return "Aucune reponse au ping";
}

module.exports = { ping };
