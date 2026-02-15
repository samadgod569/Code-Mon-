export default {
  async fetch(req, env) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS",
      "Access-Control-Allow-Headers": ""
    };

    const securityHeaders = {
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Accept-Ranges": "bytes"
    };

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    const url = new URL(req.url);
    const hostParts = url.hostname.split(".");
    const user = hostParts[0];

    if (!user || user === "www") {
      return new Response("Invalid user", { status: 400 });
    }

    // Normalize path
    let path = url.pathname.replace(/^\/+/, "");
    if (!path || path.endsWith("/")) path += "index.html";
    if (!path.split("/").pop().includes(".")) path += ".html";

    // Custom error class
    class FileNotFound extends Error {
      constructor() {
        super("File not found");
        this.status = 404;
      }
    }

    // Helper: load file from KV with error handling
    async function loadFile(name, type = "arrayBuffer") {
      const file = await env.FILES.get(name, type);
      if (file === null) throw new FileNotFound();
      return file;
    }

    // Helper: load JSON config from KV (returns null if missing/invalid)
    async function loadConfig(user, file) {
      try {
        return JSON.parse(await env.FILES.get(`${user}/${file}`, "text"));
      } catch {
        return null;
      }
    }

    // Helper: get cache rule from .cache.json
    async function getCacheRule(user, ext) {
      try {
        const rules = JSON.parse(await loadFile(`${user}/.cache.json`, "text"));
        return rules[ext] || rules.default || "no-cache";
      } catch {
        return ["js", "css", "png", "jpg", "jpeg", "svg", "mp4"].includes(ext) ? "1y" : "no-cache";
      }
    }

    function cacheControl(rule) {
      if (rule === "1y") return "public, max-age=31536000, immutable";
      if (rule.endsWith("s")) return `public, max-age=${rule}`;
      return "no-cache";
    }

    async function makeETag(data) {
      const buf = new Uint8Array(data);
      const hash = await crypto.subtle.digest("SHA-1", buf);
      return `"${[...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("")}"`;
    }

    // Helper: serve a file from KV with proper headers
    async function serveFile(key, status = 200, customCacheRule = null) {
      const ext = key.split(".").pop().toLowerCase();
      const cache = customCacheRule ? cacheControl(customCacheRule) : cacheControl(await getCacheRule(user, ext));
      const data = await loadFile(key);
      const etag = await makeETag(data);

      if (req.headers.get("If-None-Match") === etag) {
        return new Response(null, { status: 304 });
      }

      const mime = {
        html: "text/html; charset=utf-8",
        js: "text/javascript",
        css: "text/css",
        json: "application/json",
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        svg: "image/svg+xml",
        mp4: "video/mp4"
      }[ext] || "application/octet-stream";

      return new Response(data, {
        status,
        headers: {
          ...cors,
          ...securityHeaders,
          "Content-Type": mime,
          "Cache-Control": cache,
          "ETag": etag
        }
      });
    }

    // Helper: fallback error pages using .cashing map
    async function fallback(code, config = null) {
      if (!config) {
        config = await loadConfig(user, ".cashing");
      }
      if (config && config[code]) {
        const baseDir = config.starting_dir ? `${config.starting_dir}/` : "";
        try {
          return await serveFile(`${user}/${baseDir}${config[code]}`, code);
        } catch {
          // fall through to default
        }
      }
      return new Response(code === 404 ? "Not Found" : "Server Error", { status: code });
    }

    // ========== GITHUB MODE (e- subdomain) ==========
    if (user.startsWith("e-")) {
      const website = user.slice(2);
      let gitInfo;
      try {
        const gitData = await env.STORAGE.get(`${website}/git/${website}`, "text");
        gitInfo = JSON.parse(gitData);
      } catch {
        return new Response("GitHub site not configured", { status: 404 });
      }
      if (!gitInfo || !gitInfo.url) {
        return new Response("Invalid GitHub configuration", { status: 500 });
      }
      const baseUrl = gitInfo.url.replace(/\/$/, "");

      // Fetch .cashing from the GitHub repo
      let cashingConfig = null;
      try {
        const cashingRes = await fetch(`${baseUrl}/.cashing`);
        if (cashingRes.ok) {
          cashingConfig = await cashingRes.json();
        }
      } catch {
        // ignore
      }

      // Determine actual file path with starting_dir
      let filePath = path;
      if (cashingConfig && cashingConfig.starting_dir) {
        // Avoid double prefix if path already contains starting_dir
        if (!path.startsWith(cashingConfig.starting_dir + '/')) {
          filePath = `${cashingConfig.starting_dir}/${path}`;
        }
      }

      // Fetch the file from GitHub
      const fileRes = await fetch(`${baseUrl}/${filePath}`);
      if (!fileRes.ok) {
        // Try custom error page from .cashing map (also apply starting_dir)
        if (cashingConfig && cashingConfig[fileRes.status]) {
          let errorPath = cashingConfig[fileRes.status];
          if (cashingConfig.starting_dir && !errorPath.startsWith(cashingConfig.starting_dir + '/')) {
            errorPath = `${cashingConfig.starting_dir}/${errorPath}`;
          }
          const errorRes = await fetch(`${baseUrl}/${errorPath}`);
          if (errorRes.ok) {
            const data = await errorRes.arrayBuffer();
            const etag = await makeETag(data);
            const ext = errorPath.split(".").pop().toLowerCase();
            const mime = {
              html: "text/html; charset=utf-8",
              js: "text/javascript",
              css: "text/css",
              json: "application/json",
              png: "image/png",
              jpg: "image/jpeg",
              jpeg: "image/jpeg",
              svg: "image/svg+xml",
              mp4: "video/mp4"
            }[ext] || "application/octet-stream";

            return new Response(data, {
              status: fileRes.status,
              headers: {
                ...cors,
                ...securityHeaders,
                "Content-Type": mime,
                "Cache-Control": "no-cache",
                "ETag": etag
              }
            });
          }
        }
        return new Response(fileRes.statusText, { status: fileRes.status });
      }

      // Success: return file
      const data = await fileRes.arrayBuffer();
      const etag = await makeETag(data);
      const ext = filePath.split(".").pop().toLowerCase();
      const mime = {
        html: "text/html; charset=utf-8",
        js: "text/javascript",
        css: "text/css",
        json: "application/json",
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        svg: "image/svg+xml",
        mp4: "video/mp4"
      }[ext] || "application/octet-stream";

      let cacheRule = "no-cache";
      if (cashingConfig && cashingConfig.cache) {
        cacheRule = cashingConfig.cache[ext] || cashingConfig.cache.default || "no-cache";
      } else {
        cacheRule = ["js","css","png","jpg","jpeg","svg","mp4"].includes(ext) ? "1y" : "no-cache";
      }

      return new Response(data, {
        status: 200,
        headers: {
          ...cors,
          ...securityHeaders,
          "Content-Type": mime,
          "Cache-Control": cacheControl(cacheRule),
          "ETag": etag
        }
      });
    }

    // ========== NORMAL MODE ==========
    const cashingConfig = await loadConfig(user, ".cashing");
    let baseDir = "";
    if (cashingConfig && cashingConfig.starting_dir) {
      baseDir = `${cashingConfig.starting_dir}/`;
    }
    const key = `${user}/${baseDir}${path}`;

    try {
      return await serveFile(key);
    } catch (err) {
      if (err instanceof FileNotFound) {
        return fallback(404, cashingConfig);
      }
      return fallback(500, cashingConfig);
    }
  }
};
