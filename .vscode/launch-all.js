const path = require("path");
const { spawn } = require("child_process");

const workspace = path.resolve(__dirname, "..");
const applications = [
  { name: "Backend", folder: "TAV_Monitoring_Backend" },
  { name: "UI", folder: "TAV_Monitoring_UI" }
];
const children = [];
let stopping = false;

applications.forEach((application) => {
  const cwd = path.join(workspace, application.folder);
  const child = spawn(process.execPath, ["server.js"], {
    cwd,
    env: process.env,
    stdio: "inherit",
    windowsHide: true
  });

  children.push(child);
  child.on("error", (error) => {
    console.error("[" + application.name + "] Demarrage impossible:", error.message);
    shutdown(1);
  });
  child.on("exit", (code, signal) => {
    if (stopping) return;
    console.log("[" + application.name + "] Arret (code=" + code + ", signal=" + signal + ")");
    shutdown(code || 0);
  });
});

function shutdown(exitCode) {
  if (stopping) return;
  stopping = true;
  children.forEach((child) => {
    if (!child.killed) child.kill("SIGTERM");
  });
  windowExit(exitCode);
}

function windowExit(exitCode) {
  const timer = setTimeout(() => process.exit(exitCode), 1500);
  if (timer.unref) timer.unref();
  Promise.all(children.map((child) => new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) resolve();
    else child.once("exit", resolve);
  }))).then(() => process.exit(exitCode));
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
