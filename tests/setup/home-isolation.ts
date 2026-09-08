import { afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const originalHome = process.env["HOME"] ?? process.env["USERPROFILE"] ?? os.homedir();
const originalUserProfile = process.env["USERPROFILE"];
const originalHomeDrive = process.env["HOMEDRIVE"];
const originalHomePath = process.env["HOMEPATH"];
const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "ai-powered-home-"));

process.env["HOME"] = tempHome;
process.env["USERPROFILE"] = tempHome;

if (process.platform === "win32") {
  process.env["HOMEDRIVE"] = tempHome.slice(0, 2);
  process.env["HOMEPATH"] = tempHome.slice(2);
} else {
  delete process.env["HOMEDRIVE"];
  delete process.env["HOMEPATH"];
}

afterAll(() => {
  fs.rmSync(tempHome, { recursive: true, force: true });

  if (originalHome === undefined) {
    delete process.env["HOME"];
  } else {
    process.env["HOME"] = originalHome;
  }

  if (originalUserProfile === undefined) {
    delete process.env["USERPROFILE"];
  } else {
    process.env["USERPROFILE"] = originalUserProfile;
  }

  if (originalHomeDrive === undefined) {
    delete process.env["HOMEDRIVE"];
  } else {
    process.env["HOMEDRIVE"] = originalHomeDrive;
  }

  if (originalHomePath === undefined) {
    delete process.env["HOMEPATH"];
  } else {
    process.env["HOMEPATH"] = originalHomePath;
  }
});
