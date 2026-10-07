/**
 * Checks what `npm pack` would publish: everything pi needs to load and run pi-system-pin, and nothing that only
 * the repository needs (tests, the fake pi, scripts, contributor docs). Exits 1 naming each problem.
 */
import { execFileSync } from "node:child_process";
import * as path from "node:path";

const repo = path.join(import.meta.dirname, "..");
const REQUIRED = ["package.json", "README.md", "LICENSE", "CHANGELOG.md", "pi-compat.json",
  "src/index.ts", "src/entries.ts", "src/patch.ts", "src/pin.ts", "src/pi-compat.ts"];
const FORBIDDEN = [/\.test\.ts$/, /^src\/test-support\.ts$/, /^scripts\//, /^\.github\//, /^load-smoke\.mjs$/,
  /^AGENTS\.md$/, /^CLAUDE\.md$/, /^CONTRIBUTING\.md$/, /^tsconfig\.json$/, /\.env/, /\.tgz$/];

const packed = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json"], { cwd: repo, encoding: "utf8" })) as
  { files: { path: string }[]; unpackedSize: number }[];
const files = packed[0].files.map((file) => file.path);

const problems = [
  ...REQUIRED.filter((name) => !files.includes(name)).map((name) => `missing: ${name}`),
  ...files.filter((name) => FORBIDDEN.some((pattern) => pattern.test(name))).map((name) => `must not ship: ${name}`),
];
for (const problem of problems) console.error(`check-pack: ${problem}`);
console.log(`check-pack: ${files.length} files, ${packed[0].unpackedSize} bytes unpacked: ${problems.length ? "FAIL" : "ok"}`);
process.exit(problems.length ? 1 : 0);
