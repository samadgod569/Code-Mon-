export default {
  async fetch(req, env, ctx) {
    /* ---------------- CORS ---------------- */
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS",
      "Access-Control-Allow-Headers": "*",
    };

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      /* ---------------- PATH ---------------- */
      const url = new URL(req.url);
      let path = url.pathname;

      const parts = path.split("/").filter(Boolean);
      const user = parts[0];
      let filename = parts.slice(1).join("/");

      if (!user) return new Response("Missing user", { status: 400 });

      if (!filename) {
        if (!path.endsWith("/")) {
          url.pathname = `/${user}/`;
          return Response.redirect(url.toString(), 301);
        }
        filename = "index.html";
      }

      if (path.endsWith("/")) {
        filename = filename ? `${filename}index.html` : "index.html";
      }

      if (!filename.split("/").pop().includes(".")) {
        filename += ".html";
      }

      const PREFIX = `${user}/`;
      const ext = filename.split(".").pop().toLowerCase();

      /* ---------------- KV ---------------- */
      async function loadFile(name, type = "text") {
        const data = await env.FILES.get(
          PREFIX + name,
          type === "arrayBuffer" ? "arrayBuffer" : "text"
        );
        if (data === null) throw new Error("Missing " + name);
        return data;
      }

      /* ---------------- CACHE RULES ---------------- */
      async function getCacheRule(ext) {
        try {
          const rules = JSON.parse(await loadFile(".cache.json"));
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

      /* ---------------- ETAG ---------------- */
      async function makeETag(data) {
        const buf =
          typeof data === "string"
            ? new TextEncoder().encode(data)
            : new Uint8Array(data);
        const hash = await crypto.subtle.digest("SHA-1", buf);
        return `"${[...new Uint8Array(hash)]
          .map(b => b.toString(16).padStart(2, "0"))
          .join("")}"`;
      }

      function headers({ type, etag, cache }) {
        return {
          ...corsHeaders,
          "Content-Type": type,
          "Cache-Control": cache,
          "ETag": etag,
          "Accept-Ranges": "bytes",
          "Vary": "Accept-Encoding",
          "X-Content-Type-Options": "nosniff",
          "X-Frame-Options": "DENY",
          "Referrer-Policy": "no-referrer",
        };
      }

      /* ---------------- REWRITES ---------------- */
      function rewriteFetches(code) {
        if (!code) return code;
        return code.replace(/fetch\(["']([^"']+)["']\)/g, (m, p) =>
          /^(https?:)?\/\//.test(p) || p.startsWith("/")
            ? m
            : `fetch("/${user}/${p}")`
        );
      }

      function fixCSS(css) {
        if (!css) return css;
        return css.replace(/url\(["']?([^"')]+)["']?\)/g, (m, p) =>
          /^(https?:)?\/\//.test(p) || p.startsWith("/")
            ? m
            : `url("/${user}/${p}")`
        );
      }

      /* ---------------- HTML PROCESS ---------------- */
      async function processHTML(raw) {
        raw ??= "";

        const headMatch = raw.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
        const bodyMatch = raw.match(/<body[^>]*>([\s\S]*?)<\/body>/i);

        const originalHead = headMatch?.[1] || "";
        const body = bodyMatch?.[1] || raw;

        let injectedCSS = "";
        let injectedJS = "";

        /* styles */
        for (const m of originalHead.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
          injectedCSS += `<style>${fixCSS(m[1])}</style>`;
        }

        for (const l of originalHead.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi)) {
          const href = l[0].match(/href=["']([^"']+)["']/i)?.[1];
          if (!href) continue;

          if (/^(https?:)?\/\//.test(href)) {
            injectedCSS += l[0];
          } else {
            try {
              injectedCSS += `<style>${fixCSS(await loadFile(href))}</style>`;
            } catch {}
          }
        }

        /* scripts */
        const scripts = [
          ...originalHead.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi),
          ...body.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi),
        ];

        for (const s of scripts) {
          const attrs = s[1] || "";
          const inline = s[2] || "";
          const src = attrs.match(/src=["']([^"']+)["']/i)?.[1];
          const type = attrs.match(/type=["']([^"']+)["']/i)?.[1];

          if (!src) {
            injectedJS += `<script${type ? ` type="${type}"` : ""}>${rewriteFetches(inline)}</script>`;
          } else if (/^(https?:)?\/\//.test(src)) {
            injectedJS += `<script src="${src}"${type ? ` type="${type}"` : ""}></script>`;
          } else {
            try {
              injectedJS += `<script${type ? ` type="${type}"` : ""}>${rewriteFetches(await loadFile(src))}</script>`;
            } catch {}
          }
        }

        const cleanBody = body.replace(/<script[\s\S]*?<\/script>/gi, "");

        return `<!DOCTYPE html>
<html>
<head>
${originalHead}
${injectedCSS}
</head>
<body>
${cleanBody}
${injectedJS}
</body>
</html>`;
      }

      /* ---------------- FALLBACK ---------------- */
      async function fallback(status) {
        try {
          const map = JSON.parse(await loadFile(".cashing"));
          const file = map[status];
          if (!file) throw 0;
          return serve(file, status);
        } catch {
          return new Response(
            status === 404 ? "Not Found" : "Internal Server Error",
            { status }
          );
        }
      }

      /* ---------------- SERVE ---------------- */
      async function serve(name, status = 200) {
        const ext = name.split(".").pop().toLowerCase();
        const rule = await getCacheRule(ext);
        const cache = cacheControl(rule);

        const isHTML = ["html", "htm"].includes(ext);
        const data = isHTML
          ? await processHTML(await loadFile(name))
          : await loadFile(name, "arrayBuffer");

        const etag = await makeETag(data);

        if (req.headers.get("If-None-Match") === etag) {
          return new Response(null, { status: 304, headers: { ETag: etag } });
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
          mp4: "video/mp4",
        }[ext] || "application/octet-stream";

        return new Response(data, {
          status,
          headers: headers({ type: mime, etag, cache }),
        });
      }

      /* ---------------- MAIN ---------------- */
      try {
        return await serve(filename);
      } catch {
        return await fallback(404);
      }
    } catch (e) {
      return new Response("Worker crash\n" + (e?.stack || e), { status: 500 });
    }
  },
};
