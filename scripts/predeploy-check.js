#!/usr/bin/env node
// Runs before every `firebase deploy`.
// Fails if web/src/ has uncommitted changes so git always matches production.

const { execSync } = require("child_process");

let dirty = false;

// 1. Modified / deleted tracked files
try {
  execSync("git diff --quiet HEAD -- web/src/", { stdio: "pipe" });
} catch {
  const files = execSync("git diff --name-only HEAD -- web/src/").toString().trim();
  console.error("\n❌  Uncommitted changes in web/src/:");
  files.split("\n").forEach((f) => console.error("     " + f));
  dirty = true;
}

// 2. New untracked files inside web/src/
const untracked = execSync("git ls-files --others --exclude-standard web/src/")
  .toString()
  .trim();
if (untracked) {
  console.error("\n❌  Untracked new files in web/src/:");
  untracked.split("\n").forEach((f) => console.error("     " + f));
  dirty = true;
}

if (dirty) {
  console.error(
    "\n⚠️   Stage and commit these files before deploying:\n" +
      "      git add <files>\n" +
      '      git commit -m "your message"\n' +
      "      firebase deploy\n"
  );
  process.exit(1);
}

console.log("✅  web/src/ is clean — proceeding with build.");
