import { defineConfig } from "vite";
import dts from "vite-plugin-dts";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const pkg = JSON.parse(readFileSync("./package.json", "utf-8")) as {
  version: string;
  name: string;
};

/** Node.js built-ins that must never appear in the browser bundle. */
const NODE_BUILTINS = [
  "fs", "path", "os", "crypto", "child_process", "stream",
  "http", "https", "net", "tls", "zlib", "url", "util",
  "events", "buffer", "readline", "process",
];

/** API key prefix patterns used by the post-build secret scanner. */
const SECRET_PATTERNS: Array<{ prefix: string; re: RegExp }> = [
  { prefix: "sk-ant-", re: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { prefix: "sk-",     re: /sk-[A-Za-z0-9_-]{20,}/ },
  { prefix: "xai-",    re: /xai-[A-Za-z0-9_-]{20,}/ },
  { prefix: "ven-",    re: /ven-[A-Za-z0-9_-]{20,}/ },
];

function scanDirForSecrets(dir: string): void {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) { scanDirForSecrets(fullPath); continue; }
    if (!fullPath.endsWith(".js") && !fullPath.endsWith(".mjs")) continue;
    const content = readFileSync(fullPath, "utf-8");
    for (const { prefix, re } of SECRET_PATTERNS) {
      if (re.test(content)) {
        throw new Error(
          `[ai-powered:secret-scan] Potential API key with prefix "${prefix}" ` +
          `detected in ${fullPath}. Aborting build to prevent key exposure. ` +
          `Remove the secret and rebuild.`,
        );
      }
    }
  }
}

/**
 * Vite configuration for the browser-safe web bundle.
 *
 * `vite build`  → dual ESM + UMD library bundle in dist-web/:
 *   dist-web/ai-powered.esm.js  – tree-shakeable ES module
 *   dist-web/ai-powered.umd.js  – standalone UMD (window.AiPowered)
 *
 * `vite` (dev)  → HMR dev server at http://localhost:5173 serving
 *   integrations/web-example/ with `ai-powered/web` aliased to source.
 *
 * Node.js built-ins are explicitly externalised in build mode so any
 * accidental import surfaces as a build error rather than a runtime crash.
 */
export default defineConfig(({ command }) => {
  /** Shared define constants injected into every bundle/dev server. */
  const sharedDefine = {
    __VERSION__: JSON.stringify(pkg.version),
    __PACKAGE_NAME__: JSON.stringify(pkg.name),
    "process.env": "{}",
  };

  /** Resolve `ai-powered/web` → source for both build aliases and dev HMR. */
  const webAlias = {
    "ai-powered/web": resolve(__dirname, "src/ai-powered/web/index.ts"),
  };

  if (command === "serve") {
    // Dev server: serve integrations/web-example/ with full HMR.
    // `ai-powered/web` is aliased directly to the TypeScript source so edits
    // to the library are reflected immediately without a separate build step.
    return {
      root: resolve(__dirname, "integrations/web-example"),
      define: sharedDefine,
      resolve: { alias: webAlias },
      plugins: [
        {
          // The HTML loads `../../dist-web/ai-powered.umd.js` which the
          // browser normalises to `/dist-web/ai-powered.umd.js`.  Because
          // Vite's root is integrations/web-example/ it cannot find the file
          // at the repo root.  This middleware intercepts those requests and
          // streams the file directly from <repo-root>/dist-web/.
          name: "ai-powered:serve-dist-web",
          configureServer(server) {
            server.middlewares.use("/dist-web", (req, res, next) => {
              const { createReadStream, existsSync } = require("node:fs") as typeof import("node:fs");
              const { extname } = require("node:path") as typeof import("node:path");
              const filePath = resolve(__dirname, "dist-web", (req.url ?? "/").replace(/^\//, ""));
              if (!existsSync(filePath)) { next(); return; }
              const ext = extname(filePath);
              const mime = ext === ".map" ? "application/json" : "application/javascript";
              res.setHeader("Content-Type", mime);
              createReadStream(filePath).on("error", () => next()).pipe(res as never);
            });
          },
        },
      ],
    };
  }

  // Library build (command === "build")
  return {
    build: {
      lib: {
        entry: "src/ai-powered/web/index.ts",
        name: "AiPowered",
        formats: ["es", "umd"],
        fileName: (format) =>
          format === "es" ? "ai-powered.esm.js" : "ai-powered.umd.js",
      },
      outDir: "dist-web",
      emptyOutDir: true,
      sourcemap: true,
      rollupOptions: {
        // Externalise every Node.js built-in so they cannot leak into the
        // browser bundle. Any accidental import fails the build at CI time.
        external: (id: string) =>
          id.startsWith("node:") || NODE_BUILTINS.includes(id),
      },
    },
    define: sharedDefine,
    resolve: { alias: webAlias },
    plugins: [
      dts({
        include: ["src/ai-powered/web/**/*.ts"],
        outDir: "dist-web/types",
        rollupTypes: true,
      }),
      // Post-build secret scanner: abort if any AI provider key leaks into
      // the browser bundle. Runs after Rollup closes all output chunks.
      {
        name: "ai-powered:secret-scan",
        closeBundle() { scanDirForSecrets("dist-web"); },
      },
    ],
  };
});

