import { defineConfig } from "vite";
import dts from "vite-plugin-dts";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const pkg = JSON.parse(readFileSync("./package.json", "utf-8")) as {
  version: string;
  name: string;
};

/** Node.js built-ins that must never appear in the browser bundle. */
const NODE_BUILTINS = [
  "fs",
  "path",
  "os",
  "crypto",
  "child_process",
  "stream",
  "http",
  "https",
  "net",
  "tls",
  "zlib",
  "url",
  "util",
  "events",
  "buffer",
  "readline",
  "process",
];

/** API key prefix patterns used by the post-build secret scanner. */
const SECRET_PATTERNS: Array<{ prefix: string; re: RegExp }> = [
  { prefix: "sk-ant-", re: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { prefix: "sk-", re: /sk-[A-Za-z0-9_-]{20,}/ },
  { prefix: "xai-", re: /xai-[A-Za-z0-9_-]{20,}/ },
  { prefix: "ven-", re: /ven-[A-Za-z0-9_-]{20,}/ },
];

function scanDirForSecrets(dir: string): void {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      scanDirForSecrets(fullPath);
      continue;
    }
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
 * `vite build`  → multi-entry library bundle in dist-web/:
 *   dist-web/ai-powered.esm.js  – tree-shakeable ES module
 *   dist-web/ai-powered.umd.js  – standalone UMD (window.AiPowered)
 *   dist-web/jszip.min.js       – self-contained JSZip browser bundle
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

    // When the -Ngrok flag is used in cycle-service.ps1, ngrok tunnels to this
    // Vite dev-server port.  The proxy block below forwards every known API path
    // to the local proxy server so a single public URL serves both the web UI
    // and all API endpoints — no paid multi-tunnel plan required.
    const proxyTarget = "http://localhost:3001";
    const apiPaths = [
      "/health",
      "/config",
      "/models",
      "/pricing",
      "/providers",
      "/text",
      "/stream",
      "/image",
      "/audio",
      "/video",
      "/structured",
      "/batch",
      "/stitch", // server-side video concat via POST /stitch (REQ-SS-06)
      "/upload", // multipart file upload for reference images (mobile camera photos)
      "/files", // serves uploaded file blobs; required for Luma AI keyframe URLs
      "/v1",
      "/images",
      "/.well-known",
    ];
    const serverProxy = Object.fromEntries(
      apiPaths.map((p) => [p, { target: proxyTarget, changeOrigin: true }]),
    );

    return {
      root: resolve(__dirname, "integrations/web-example"),
      define: sharedDefine,
      resolve: { alias: webAlias },
      server: {
        // Cross-origin isolation headers — retained for compatibility with browsers
        // that may require cross-origin isolation for other features (e.g.
        // performance.now() precision, Atomics).  Video stitching now runs server-side
        // via POST /stitch and no longer requires SharedArrayBuffer in the browser.
        headers: {
          "Cross-Origin-Opener-Policy": "same-origin",
          "Cross-Origin-Embedder-Policy": "require-corp",
        },
        proxy: serverProxy,
        // Allow external hostnames so the dev server can be reached through
        // an ngrok tunnel.  This only applies to `vite serve` (dev mode).
        allowedHosts: ["contorted-jarrod-supersecure.ngrok-free.dev"],
      },
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
              const { createReadStream, existsSync } =
                require("node:fs") as typeof import("node:fs");
              const { extname } = require("node:path") as typeof import("node:path");
              const filePath = resolve(__dirname, "dist-web", (req.url ?? "/").replace(/^\//, ""));
              if (!existsSync(filePath)) {
                next();
                return;
              }
              const ext = extname(filePath);
              const mime = ext === ".map" ? "application/json" : "application/javascript";
              res.setHeader("Content-Type", mime);
              // Repeat isolation headers explicitly: this middleware pipes directly
              // to res via createReadStream, which can bypass Vite's global
              // server.headers injection.  Without explicit headers here, dist-web
              // assets would be served without COOP/COEP cross-origin isolation.
              res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
              res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
              // CORP: same-origin tells the browser this resource is safe to embed
              // inside a COEP: require-corp page (it's served from the same origin).
              res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
              createReadStream(filePath)
                .on("error", () => next())
                .pipe(res as never);
            });
          },
        },
        {
          // When VITE_PROXY_URL is set (e.g. via -Ngrok in cycle-service.ps1),
          // inject a small inline script that sets window.__AI_PROXY_URL__ so
          // app.js can pre-fill the proxy URL input for remote visitors.
          name: "ai-powered:inject-proxy-url",
          transformIndexHtml() {
            const proxyUrl = process.env["VITE_PROXY_URL"];
            if (!proxyUrl) return [];
            return [
              {
                tag: "script",
                attrs: { type: "text/javascript" },
                children: `window.__AI_PROXY_URL__=${JSON.stringify(proxyUrl)};`,
                injectTo: "head-prepend",
              },
            ];
          },
        },
      ],
    };
  }

  // Library build (command === "build")
  return {
    build: {
      lib: {
        entry: resolve(__dirname, "src/ai-powered/web/index.ts"),
        name: "AiPowered",
        formats: ["es", "umd"],
        fileName: (format) => (format === "es" ? "ai-powered.esm.js" : "ai-powered.umd.js"),
      },
      outDir: "dist-web",
      emptyOutDir: true,
      sourcemap: true,
      rollupOptions: {
        // Externalise every Node.js built-in so they cannot leak into the
        // browser bundle. Any accidental import fails the build at CI time.
        external: (id: string) => id.startsWith("node:") || NODE_BUILTINS.includes(id),
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
      // Copy jszip.min.js from node_modules into dist-web/ so the browser
      // can load it as a local script without hitting an external CDN.
      // Runs before the secret scanner so the scan covers jszip too.
      // (Q1 fallback: Vite 8 / Rolldown rejects multiple entries when formats
      //  include "umd"; copying the pre-built jszip bundle is the safe path.)
      {
        name: "ai-powered:copy-jszip",
        closeBundle() {
          const src = resolve(__dirname, "node_modules/jszip/dist/jszip.min.js");
          const dest = resolve(__dirname, "dist-web/jszip.min.js");
          mkdirSync(resolve(__dirname, "dist-web"), { recursive: true });
          copyFileSync(src, dest);
        },
      },
      // Post-build secret scanner: abort if any AI provider key leaks into
      // the browser bundle. Runs after Rollup closes all output chunks.
      {
        name: "ai-powered:secret-scan",
        closeBundle() {
          scanDirForSecrets("dist-web");
        },
      },
    ],
  };
});
