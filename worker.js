export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);

    // ===============================
    // PATH PARSING
    // ===============================
    const parts = url.pathname.split("/").filter(Boolean);
    const user = parts[0];
    if (!user) return new Response("Missing user", { status: 400 });

    const rawRelPath = parts.slice(1).join("/") || ""; // <-- ORIGINAL path for .cashing
    let filename = rawRelPath;

    if (!filename) filename = "index.html";
    if (url.pathname.endsWith("/")) filename = filename ? `${filename}index.html` : "index.html";

    const last = filename.split("/").pop();
    if (last && !last.includes(".")) filename += ".html";

    const PREFIX = `${user}/`;
    const ext = filename.split(".").pop().toLowerCase();

    // ===============================
    // DB LOADER
    // ===============================
    async function loadFile(name, type = "text") {
      const data = await env.FILES.get(PREFIX + name, type === "arrayBuffer" ? "arrayBuffer" : "text");
      if (data == null) throw new Error("Missing " + name);
      return data;
    }

    // ===============================
    // HTML HELPERS
    // ===============================
    function rewriteFetches(code) {
      if (!code) return code;
      return code.replace(/fetch\(["']([^"']+)["']\)/g, (m, p) => {
        if (/^(https?:)?\/\//.test(p) || p.startsWith("/")) return m;
        return `fetch("/${user}/${p}")`;
      });
    }

    function fixCSSUrls(css) {
      if (!css) return css;
      return css.replace(/url\(["']?([^"')]+)["']?\)/g, (m, p) => {
        if (/^(https?:)?\/\//.test(p) || p.startsWith("/")) return m;
        return `url("/${user}/${p}")`;
      });
    }

    async function processHTML(raw) {
      raw ??= "";
      const head = raw.match(/<head[^>]*>([\s\S]*?)<\/head>/i)?.[1] || "";
      const body = raw.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] || raw;

      let finalHead = "";

      for (const m of head.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
        finalHead += `<style>${fixCSSUrls(m[1])}</style>`;
      }

      for (const l of head.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi)) {
        const href = l[0].match(/href=["']([^"']+)["']/i)?.[1];
        if (!href) continue;

        if (/^(https?:)?\/\//.test(href)) {
          finalHead += l[0];
        } else {
          try {
            const css = await loadFile(href);
            finalHead += `<style>${fixCSSUrls(css)}</style>`;
          } catch {}
        }
      }

      let scripts = "";
      const scriptRegex = /<script([^>]*)>([\s\S]*?)<\/script>/gi;

      for (const m of [...head.matchAll(scriptRegex), ...body.matchAll(scriptRegex)]) {
        const attrs = m[1] || "";
        const inline = m[2] || "";
        const src = attrs.match(/src=["']([^"']+)["']/i)?.[1];
        const type = attrs.match(/type=["']([^"']+)["']/i)?.[1];

        if (!src) {
          scripts += `<script${type ? ` type="${type}"` : ""}>${rewriteFetches(inline)}</script>`;
        } else if (/^(https?:)?\/\//.test(src)) {
          scripts += `<script src="${src}"></script>`;
        } else {
          try {
            const js = await loadFile(src);
            scripts += `<script${type ? ` type="${type}"` : ""}>${rewriteFetches(js)}</script>`;
          } catch {}
        }
      }

      const cleanBody = body.replace(/<script[\s\S]*?<\/script>/gi, "");

      return `<!DOCTYPE html>
<html>
<head>${finalHead}</head>
<body>${cleanBody}${scripts}</body>
</html>`;
    }

    // ===============================
    // .CASHING EXECUTOR
    // ===============================
    async function runCashing(relPath, status) {
      try {
        const code = await loadFile(".cashing");
        const fn = new Function(
          "path",
          "status",
          `"use strict";
           const fetch = undefined;
           const WebSocket = undefined;
           const Request = undefined;
           const Response = undefined;
           const env = undefined;
           ${code}`
        );
        const result = fn(relPath, status);
        if (typeof result !== "string") return null;
        return result.replace(/^\/+/, "");
      } catch {
        return null;
      }
    }

    // ===============================
    // DYNAMIC SERVE
    // ===============================
    async function serveDynamic(file, status) {
      const e = file.split(".").pop().toLowerCase();

      let data;
      try {
        data = await loadFile(file, e === "html" ? "text" : "arrayBuffer");
      } catch {
        return new Response("Not Found", { status: 404 });
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
      }[e] || "application/octet-stream";

      const body = e === "html" ? await processHTML(data) : data;

      return new Response(body, {
        status,
        headers: { "Content-Type": mime },
      });
    }

    // ===============================
    // MAIN FLOW
    // ===============================
    try {
      if (!["html", "htm"].includes(ext)) {
        const bin = await loadFile(filename, "arrayBuffer");
        return new Response(bin, {
          headers: { "Content-Type": "application/octet-stream" },
        });
      }

      const raw = await loadFile(filename);
      return new Response(await processHTML(raw), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    } catch {
      // Pass RAW requested path to .cashing, not auto-modified filename
      const f = await runCashing(rawRelPath, 404);
      if (f) return await serveDynamic(f, 404);
      return new Response("Not Found", { status: 404 });
    }
  },
};
