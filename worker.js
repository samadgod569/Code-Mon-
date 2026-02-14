export default {
  async fetch(req, env) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS",
      "Access-Control-Allow-Headers": "*"
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

    let path = url.pathname.replace(/^\/+/, "");
    if (!path || path.endsWith("/")) path += "index.html";
    if (!path.split("/").pop().includes(".")) path += ".html";

    const isGitHub = user.startsWith("e-");
    const website = isGitHub ? user.slice(2) : user;

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

    async function getCacheRule(ext) {
      try {
        const rules = JSON.parse(await loadFile(`${user}/.cache.json`, "text"));
        return rules[ext] || rules.default || "no-cache";
      } catch {
        return ["js","css","png","jpg","jpeg","svg","mp4"].includes(ext)
          ? "1y"
          : "no-cache";
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
      return `"${[...new Uint8Array(hash)]
        .map(b => b.toString(16).padStart(2, "0"))
        .join("")}"`;
    }

    async function serveFile(name, status = 200) {
      const ext = name.split(".").pop().toLowerCase();
      const cache = cacheControl(await getCacheRule(ext));
      const data = await loadFile(name);
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

    async function serveGitHub() {
      const cfgRaw = await env.STORAGE.get(`website/git/${website}`, "text");
      if (!cfgRaw) {
        return new Response("Config not found", { status: 404 });
      }

      const { url } = JSON.parse(cfgRaw);
      const base = url.replace(/\/+$/, "");
      const finalUrl = `${base}/${path}`;

      const res = await fetch(finalUrl, {
        redirect: "follow",
        headers: { ...cors, ...securityHeaders }
      });

      return new Response(res.body, {
        status: res.status,
        headers: {
          ...cors,
          ...securityHeaders,
          "Content-Type": res.headers.get("content-type") || "application/octet-stream",
          "Cache-Control": res.headers.get("cache-control") || "no-cache"
        }
      });
    }

    async function fallback(code) {
      try {
        const map = JSON.parse(await loadFile(`${user}/.cashing`, "text"));
        if (map[code]) return serveFile(`${user}/${map[code]}`, code);
      } catch {}
      return new Response(
        code === 404 ? "Not Found" : "Server Error",
        { status: code }
      );
    }

    try {
      return isGitHub ? await serveGitHub() : await serveKV();
    } catch (err) {
      if (err instanceof FileNotFound) return fallback(404);
      return fallback(500);
    }

    async function serveKV() {
      let finalPath = path;
      const data = await loadFile(`${user}/${finalPath}`, "arrayBuffer");
      const ext = finalPath.split(".").pop().toLowerCase();
      const etag = await makeETag(data);

      if (req.headers.get("If-None-Match") === etag) {
        return new Response(null, { status: 304 });
      }

      return new Response(data, {
        headers: {
          ...cors,
          ...securityHeaders,
          "Content-Type": mime(ext),
          "Cache-Control": cacheControl(await getCacheRule(ext)),
          "ETag": etag
        }
      });
    }

  }
};

function mime(ext) {
  return {
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
}
