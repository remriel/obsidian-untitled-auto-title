import esbuild from "esbuild";

const options = {
  entryPoints: ["src/main.ts"],
  outfile: "main.js",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "es2022",
  external: ["obsidian", "electron", "node:*"],
  sourcemap: false,
  minify: false,
  banner: { js: "/* Untitled Auto Title - MIT license. No credentials are included in this bundle. */" },
  logLevel: "info",
};

if (process.argv.includes("--watch")) {
  const context = await esbuild.context(options);
  await context.watch();
} else {
  await esbuild.build(options);
}
