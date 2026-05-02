export default {
  async fetch(req, env) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS,POST",
      "Access-Control-Allow-Headers": "Content-Type"
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
    const hostname = url.hostname.toLowerCase();
    const host = hostname.split(":")[0];

    let user = null;

    if (host.endsWith(".code-mon-space.shop")) {
      user = host.replace(".code-mon-space.shop", "").split(".")[0];
    } else {
      const domainConfig = await env.STORAGE.get(`domain/v/${host}`, "text");
      if (domainConfig) {
        try {
          const parsed = JSON.parse(domainConfig);
          user = parsed.target.replace(".code-mon-space.shop", "").split(".")[0];
        } catch {}
      }
    }

    if (!user || user === "www") {
      return new Response("Invalid site", { status: 404 });
    }

    let path = url.pathname.replace(/^\/+/, "");
    if (!path || path.endsWith("/")) path += "index.html";
    if (!path.split("/").pop().includes(".")) path += ".html";

    class FileNotFound extends Error {
      constructor() {
        super("File not found");
        this.status = 404;
      }
    }

    async function loadFile(name, type = "arrayBuffer") {
      const file = await env.FILES.get(name, type);
      if (file === null) throw new FileNotFound();
      return file;
    }

    async function loadConfig(user, file) {
      try {
        return JSON.parse(await env.FILES.get(`${user}/${file}`, "text"));
      } catch {
        return null;
      }
    }

    async function getCacheRule(user, ext) {
      try {
        const rules = JSON.parse(await loadFile(`${user}/.cache.json`, "text"));
        return rules[ext] || rules.default || "no-cache";
      } catch {
        return ["js","css","png","jpg","jpeg","svg","mp4"].includes(ext) ? "1y" : "no-cache";
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

    async function serveFile(key, status = 200, customCacheRule = null) {
      const ext = key.split(".").pop().toLowerCase();

      if (ext === "js") {
        const fileText = await env.FILES.get(key, "text");
        if (fileText === null) throw new FileNotFound();

        if (fileText.startsWith("#$$")) {
          const apiRef = fileText.trim();
          const code = await env.API.get(`${user}/${apiRef}`, "text");
          if (code === null) {
            return new Response("API Not Found", { status: 404, headers: cors });
          }

          let input = null;
          const contentType = req.headers.get("Content-Type") || "";

          if (contentType.includes("application/json")) {
            input = await req.json().catch(() => null);
          } else {
            const txt = await req.text().catch(() => "");
            if (txt) input = txt;
          }

          const context = {
            method: req.method,
            url: req.url,
            headers: Object.fromEntries(req.headers),
            ip: req.headers.get("cf-connecting-ip"),
            geo: req.cf,
            query: Object.fromEntries(url.searchParams),
            body: input
          };

          const execRes = await fetch("http://ge-02.vortexa.cloud:11012/execute", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code, context })
          });

          const json = await execRes.json();

          const statusCode = json?.response?.status || 200;
          const body = json?.response?.body ?? json.output ?? "";

          let headers = { ...cors };
          if (json?.response?.headers) {
            headers = { ...headers, ...json.response.headers };
          }
          if (!headers["Content-Type"]) {
            headers["Content-Type"] = typeof body === "object" ? "application/json" : "text/plain";
          }

          return new Response(
            typeof body === "object" ? JSON.stringify(body) : body,
            { status: statusCode, headers }
          );
        }

        const data = new TextEncoder().encode(fileText).buffer;
        const cache = customCacheRule ? cacheControl(customCacheRule) : cacheControl(await getCacheRule(user, ext));
        const etag = await makeETag(data);

        if (req.headers.get("If-None-Match") === etag) {
          return new Response(null, { status: 304 });
        }

        return new Response(data, {
          status,
          headers: {
            ...cors,
            ...securityHeaders,
            "Content-Type": "text/javascript",
            "Cache-Control": cache,
            "ETag": etag
          }
        });
      }

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

    async function fallback(code, config = null) {
      if (!config) {
        config = await loadConfig(user, ".cashing");
      }

      if (config && config[code]) {
        const baseDir = config.starting_dir ? `${config.starting_dir}/` : "";
        try {
          return await serveFile(`${user}/${baseDir}${config[code]}`, code);
        } catch {}
      }

      return new Response(code === 404 ? "Not Found" : "Server Error", { status: code });
    }

    if (user.startsWith("e-")) {
      const website = user.slice(2);
      let gitInfo;

      try {
        const gitData = await env.STORAGE.get(`website/git/${website}`, "text");
        gitInfo = JSON.parse(gitData);
      } catch {
        return new Response("GitHub site not configured", { status: 404 });
      }

      if (!gitInfo || !gitInfo.url) {
        return new Response("Invalid GitHub configuration", { status: 500 });
      }

      const baseUrl = gitInfo.url.replace(/\/$/, "");
      const startingDir = gitInfo.starting_dir || "";

      const errorPages = {
        404: gitInfo["404"],
        500: gitInfo["500"]
      };

      let filePath = path;

      if (startingDir) {
        if (!path.startsWith(startingDir + "/")) {
          filePath = `${startingDir}/${path}`;
        }
      }

      const fileRes = await fetch(`${baseUrl}/${filePath}?nocash=1`);

      if (!fileRes.ok) {
        const status = fileRes.status;

        if (errorPages[status]) {
          let errorPath = errorPages[status];

          if (startingDir && !errorPath.startsWith(startingDir + "/")) {
            errorPath = `${startingDir}/${errorPath}`;
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
              status,
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

      const cacheRule = ["js","css","png","jpg","jpeg","svg","mp4"].includes(ext) ? "1y" : "no-cache";

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
                          
