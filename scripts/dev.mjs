import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const windows = process.platform === "win32";
const localPython = path.join(root, ".venv", windows ? "Scripts/python.exe" : "bin/python");
const python = existsSync(localPython) ? localPython : windows ? "python" : "python3";
const npm = windows ? "npm.cmd" : "npm";
const children = [];

function start(command, args, cwd) {
  const child = spawn(command, args, {
    cwd,
    stdio: "inherit",
    shell: windows,
  });
  children.push(child);
  child.on("exit", (code) => {
    if (code && code !== 0) process.exitCode = code;
    stopChildren(child);
  });
}

function stopChildren(except) {
  for (const child of children) {
    if (child !== except && child.exitCode === null) child.kill("SIGINT");
  }
}

process.on("SIGINT", () => stopChildren());
process.on("SIGTERM", () => stopChildren());

start(python, ["-m", "uvicorn", "backend.main:app", "--reload", "--host", "127.0.0.1", "--port", "8000"], root);
start(npm, ["--prefix", "frontend", "run", "dev", "--", "--host", "127.0.0.1"], root);