export default {
  async fetch(req, env, ctx) {
    const cache = caches.default;
    const cached = await cache.match(req);
    if (cached) return cached;

    try {
      const url = new URL(req.url);
      const parts = url.pathname.split("/").filter(Boolean);

      const user = parts[0];
      const filename = parts[1];

      if (!user || !filename)
        return new Response("Missing user or filename", { status: 400 });

      const PREFIX = `${user}/`;
      const ext = filename.split(".").pop().toLowerCase();

      async function loadFile(name) {
        const data = await env.FILES.get(PREFIX + name);
        if (!data) throw new Error("Missing " + name);
        return data;
      }

      // ---------------- RAW FILE MODE ----------------
      if (!["html","htm"].includes(ext)) {
        let data = await env.FILES.get(PREFIX + filename, "arrayBuffer");
        if (!data)
          return fetch("https://raw.githubusercontent.com/samadgod569/Code-Mon-space/main/public/" + PREFIX + filename);

        const mime = {
          js:"text/javascript", css:"text/css", json:"application/json",
          png:"image/png", jpg:"image/jpeg", jpeg:"image/jpeg",
          svg:"image/svg+xml", wasm:"application/wasm"
        }[ext] || "application/octet-stream";

        const res = new Response(data,{headers:{
          "Content-Type":mime,
          "Cache-Control":"public,max-age=31536000,immutable"
        }});

        ctx.waitUntil(cache.put(req,res.clone()));
        return res;
      }

      // ---------------- HTML COMPILE ----------------

      let raw = await loadFile(filename);

      const head = raw.match(/<head[^>]*>([\s\S]*?)<\/head>/i)?.[1] || "";
      const body = raw.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] || raw;

      function rewriteFetches(code){
        return code.replace(/fetch\(["']([^"']+)["']\)/g,(m,p)=>{
          if(/^(https?:)?\/\//.test(p)||p.startsWith("/")) return m;
          return `fetch("/${user}/${p}")`;
        });
      }

      function fixCSSUrls(css){
        return css.replace(/url\(["']?([^"')]+)["']?\)/g,(m,p)=>{
          if(/^(https?:)?\/\//.test(p)||p.startsWith("/")) return m;
          return `url("/${user}/${p}")`;
        });
      }

      // ---------- STYLES ----------
      let finalHead = head.replace(/<script[\s\S]*?<\/script>/gi,"")
                          .replace(/<style[\s\S]*?<\/style>/gi,"")
                          .replace(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi,"");

      for(const m of head.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)){
        finalHead+=`<style>${fixCSSUrls(m[1])}</style>`;
      }

      for(const l of head.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi)){
        const href=l[0].match(/href=["']([^"']+)["']/i)?.[1];
        if(!href) continue;
        if(/^(https?:)?\/\//.test(href)) finalHead+=l[0];
        else{
          try{
            const css=await loadFile(href);
            finalHead+=`<style>${fixCSSUrls(css)}</style>`;
          }catch{}
        }
      }

      // ---------- SCRIPT GRAPH ----------
      let finalScripts="";
      const scriptRegex=/<script([^>]*)>([\s\S]*?)<\/script>/gi;

      const allScripts=[...head.matchAll(scriptRegex),...body.matchAll(scriptRegex)];

      for(const m of allScripts){
        const attrs=m[1];
        const inline=m[2];
        const src=attrs.match(/src=["']([^"']+)["']/i)?.[1];
        const type=attrs.match(/type=["']([^"']+)["']/i)?.[1];

        if(!src){
          finalScripts+=`<script${type?` type="${type}"`:""}>${rewriteFetches(inline)}</script>`;
          continue;
        }

        if(/^(https?:)?\/\//.test(src)){
          finalScripts+=`<script src="${src}"${type?` type="${type}"`:""}></script>`;
          continue;
        }

        try{
          const js=await loadFile(src);
          const rewritten=rewriteFetches(js);

          const hash=await crypto.subtle.digest("SHA-384",new TextEncoder().encode(rewritten));
          const integrity="sha384-"+btoa(String.fromCharCode(...new Uint8Array(hash)));

          if(type==="module"||/\b(import|export)\b/.test(js)){
            const encoded=btoa(unescape(encodeURIComponent(rewritten)));
            finalScripts+=`
<script type="module" integrity="${integrity}">
import(URL.createObjectURL(new Blob([decodeURIComponent(escape(atob("${encoded}")))],{type:"text/javascript"})));
</script>`;
          }else{
            finalScripts+=`<script integrity="${integrity}">${rewritten}
//# sourceMappingURL=${src}.map
</script>`;
          }
        }catch{}
      }

      const cleanBody=body.replace(/<script[\s\S]*?<\/script>/gi,"");

      const finalHTML=`
<!DOCTYPE html>
<html>
<head>
${finalHead}
</head>
<body>
${cleanBody}
${finalScripts}
</body>
</html>`;

      const res=new Response(finalHTML,{
        headers:{
          "Content-Type":"text/html; charset=utf-8",
          "Cache-Control":"public,max-age=3600"
        }
      });

      ctx.waitUntil(cache.put(req,res.clone()));
      return res;

    }catch(e){
      return new Response("Worker crash:\n"+e.stack,{status:500});
    }
  }
};
