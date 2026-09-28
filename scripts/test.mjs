import esbuild from "esbuild";
import { spawnSync } from "node:child_process";

await esbuild.build({
  entryPoints: ["tests/plugin.test.ts"],
  outfile: ".test/plugin.test.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
});
const result = spawnSync(process.execPath, ["--test", ".test/plugin.test.mjs"], { stdio: "inherit" });
process.exitCode = result.status ?? 1;
