import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const windows = process.platform === "win32";
const localPython = path.join(root, ".venv", windows ? "Scripts/python.exe" : "bin/python");
const python = existsSync(localPython) ? localPython : windows ? "py" : "python3";
const result = spawnSync(python, ["-m", "unittest", "discover", "-s", path.join(root, "backend", "tests"), "-v"], {
  cwd: root,
  stdio: "inherit",
});

process.exit(result.status ?? 1);