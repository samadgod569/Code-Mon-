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

    class FileNotFound extends Error {}

    /* =========================
       UTIL
    ========================= */
    async function makeETag(data) {
      const buf = typeof data === "string"
        ? new TextEncoder().encode(data)
        : new Uint8Array(data);
      const hash = await crypto.subtle.digest("SHA-1", buf);
      return `"${[...new Uint8Array(hash)]
        .map(b => b.toString(16).padStart(2, "0"))
        .join("")}"`;
    }

    function cacheControl(ext) {
      if (["js","css","png","jpg","jpeg","svg","mp4"].includes(ext)) {
        return "public, max-age=31536000, immutable";
      }
      return "no-cache";
    }

    /* =========================
       NORMAL KV MODE
    ========================= */
    async function serveKV() {
      let cashing = null;
      try {
        cashing = JSON.parse(
          await env.FILES.get(`${user}/.cashing`, "text")
        );
      } catch {}

      let finalPath = path;
      if (cashing?.starting_dir) {
        finalPath = `${cashing.starting_dir}/${path}`;
      }

      const key = `${user}/${finalPath}`;

      const data = await env.FILES.get(key, "arrayBuffer");
      if (!data) throw new FileNotFound();

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
          "Cache-Control": cacheControl(ext),
          "ETag": etag
        }
      });
    }

    /* =========================
       GITHUB MODE
    ========================= */
    
async function serveGitHub() {
  const cfgRaw = await env.STORAGE.get(`website/git/${website}`, "text");
  if (!cfgRaw) throw new FileNotFound();

  const cfg = JSON.parse(cfgRaw);
  const base = cfg.url.replace(/\/+$/, "");

  /* =========================
     PATH NORMALIZATION (CRITICAL)
  ========================= */
  let filePath = path || "";

  // 🔑 FORCE index.html
  if (filePath === "" || filePath === "/") {
    filePath = "index.html";
  }

  if (filePath.endsWith("/")) {
    filePath += "index.html";
  }

  if (!filePath.split("/").pop().includes(".")) {
    filePath += ".html";
  }

  /* =========================
     LOAD .cashing (OPTIONAL)
  ========================= */
  let cashing = null;
  try {
    const r = await fetch(`${base}/.cashing`, { redirect: "follow" });
    if (r.ok) cashing = await r.json();
  } catch {}

  if (cashing?.starting_dir) {
    filePath = `${cashing.starting_dir.replace(/\/+$/, "")}/${filePath}`;
  }

  const finalUrl = `${base}/${filePath}`;

  /* =========================
     FETCH FILE
  ========================= */
  const res = await fetch(finalUrl, {
    redirect: "follow",
    headers: { "User-Agent": "CodeMon-Worker" }
  });

  if (!res.ok) {
    // optional fallback from .cashing
    if (cashing?.[res.status]) {
      const fb = await fetch(`${base}/${cashing[res.status]}`);
      if (fb.ok) return fb;
    }
    throw new FileNotFound();
  }

  const data = await res.arrayBuffer();
  const ext = filePath.split(".").pop().toLowerCase();
  const etag = await makeETag(data);

  if (req.headers.get("If-None-Match") === etag) {
    return new Response(null, { status: 304 });
  }

  return new Response(data, {
    headers: {
      ...cors,
      ...securityHeaders,
      "Content-Type": mime(ext),
      "Cache-Control": cacheControl(ext),
      "ETag": etag
    }
  });
                                    }
    /* =========================
       FALLBACK
    ========================= */
    async function fallback(code) {
      try {
        if (isGitHub) {
          const cfg = JSON.parse(
            await env.STORAGE.get(`website/git/${website}`, "text")
          );
          const res = await fetch(`${cfg.url}/.cashing`);
          if (res.ok) {
            const map = await res.json();
            if (map[code]) {
              return fetch(`${cfg.url}/${map[code]}`);
            }
          }
        } else {
          const map = JSON.parse(
            await env.FILES.get(`${user}/.cashing`, "text")
          );
          if (map[code]) {
            return serveKV(`${user}/${map[code]}`, code);
          }
        }
      } catch {}

      return new Response(code === 404 ? "Not Found" : "Server Error", {
        status: code
      });
    }

    /* =========================
       MAIN
    ========================= */
    try {
      return isGitHub ? await serveGitHub() : await serveKV();
    } catch (err) {
      if (err instanceof FileNotFound) return fallback(404);
      return fallback(500);
    }
  }
};

/* =========================
   MIME
========================= */
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
