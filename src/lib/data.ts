import { readFileSync } from "fs";
import path from "path";
import type { AppConfig } from "./types";

const root = process.cwd();

export function loadAppConfig(): AppConfig {
  const raw = readFileSync(path.join(root, "data", "config.json"), "utf8");
  return JSON.parse(raw) as AppConfig;
}

export function loadRegistryCsv(): string {
  return readFileSync(path.join(root, "data", "staff_registry.csv"), "utf8");
}

export function loadMasterCsv(): string {
  return readFileSync(path.join(root, "data", "mf_staff_master.csv"), "utf8");
}
