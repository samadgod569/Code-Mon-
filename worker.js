export default {
  async fetch(req, env) {
    try {
      const url = new URL(req.url);
      const parts = url.pathname.split("/").filter(Boolean);

      const user = parts[0];
      const filename = parts[1];

      if (!user || !filename)
        return new Response("<h2>Missing user or filename.</h2>", { status: 400 });

      const PREFIX = `${user}/`;
      const ext = filename.split(".").pop().toLowerCase();

      async function loadFile(name) {
        const data = await env.FILES.get(PREFIX + name);
        if (!data) throw new Error("Missing " + name);
        return data;
      }

      // ============================
      // RAW FILE MODE (NON HTML)
      // ============================
      if (ext !== "html" && ext !== "htm") {
  let data = await env.FILES.get(PREFIX + filename, "arrayBuffer");

  if (!data) {
    // fallback to GitHub
    return fetch("https://raw.githubusercontent.com/YOURUSER/YOURREPO/main/public/" + PREFIX + filename);
  }

  const mime = {
    js: "text/javascript",
    css: "text/css",
    json: "application/json",
    txt: "text/plain",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    svg: "image/svg+xml",
    webp: "image/webp",
    wasm: "application/wasm"
  }[ext] || "application/octet-stream";

  return new Response(data, { headers: { "Content-Type": mime }});
      }

      // ============================
      // HTML LOADER MODE
      // ============================

      let raw = await loadFile(filename);

      const headMatch = raw.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
      const bodyMatch = raw.match(/<body[^>]*>([\s\S]*?)<\/body>/i);

      const headContent = headMatch ? headMatch[1] : "";
      const bodyContent = bodyMatch ? bodyMatch[1] : raw;

      function rewriteFetches(code) {
        return code.replace(
          /fetch\(\s*["']([^"']+)["']\s*\)/g,
          (m, p) => {
            if (/^(https?:)?\/\//i.test(p) || p.startsWith("/")) return m;
            return `fetch("/${user}/${p}")`;
          }
        );
      }

      // ---------- STYLES ----------
      let finalHead = "";

      const styleRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
      const linkRegex = /<link[^>]+rel=["']stylesheet["'][^>]*>/gi;

      finalHead += headContent
        .replace(styleRegex, "")
        .replace(linkRegex, "")
        .replace(/<script[\s\S]*?<\/script>/gi, "");

      for (const m of headContent.matchAll(styleRegex)) {
        finalHead += `<style>${m[1]}</style>`;
      }

      for (const l of headContent.matchAll(linkRegex)) {
        const href = l[0].match(/href=["']([^"']+)["']/i)?.[1];
        if (!href) continue;

        if (/^(https?:)?\/\//i.test(href)) {
          finalHead += l[0];
        } else {
          try {
            const css = await loadFile(href);
            finalHead += `<style>${css}</style>`;
          } catch {}
        }
      }

      // ---------- SCRIPTS ----------
      let finalScripts = "";

      const scriptRegex = /<script([^>]*)>([\s\S]*?)<\/script>/gi;

      for (const m of (headContent + bodyContent).matchAll(scriptRegex)) {
        const attrs = m[1];
        const inline = m[2];

        const src = attrs.match(/src=["']([^"']+)["']/i)?.[1];
        const type = attrs.match(/type=["']([^"']+)["']/i)?.[1];

        if (!src) {
          finalScripts += `<script${type ? ` type="${type}"` : ""}>${rewriteFetches(inline)}</script>`;
          continue;
        }

        if (/^(https?:)?\/\//i.test(src)) {
          finalScripts += `<script src="${src}"${type ? ` type="${type}"` : ""}></script>`;
          continue;
        }

        try {
          const js = await loadFile(src);
          const isModule = type === "module" || /\b(import|export)\b/.test(js);

          if (isModule) {
            const encoded = btoa(unescape(encodeURIComponent(rewriteFetches(js))));
            finalScripts += `
<script type="module">
import(URL.createObjectURL(new Blob([decodeURIComponent(escape(atob("${encoded}")))],{type:"text/javascript"})));
</script>`;
          } else {
            finalScripts += `<script>${rewriteFetches(js)}</script>`;
          }
        } catch {}
      }

      // ---------- FINAL HTML ----------
      const finalHTML = `
<!DOCTYPE html>
<html>
<head>
${finalHead}
</head>
<body>
${bodyContent}
${finalScripts}
</body>
</html>`;

      return new Response(finalHTML, {
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });

    } catch (e) {
      return new Response("Worker crash:\n" + e.stack, { status: 500 });
    }
  }
};
