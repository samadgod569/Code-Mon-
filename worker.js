const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;

    // 🔹 Handle CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    if (path === "/api/engine") {

      // ---------- GET ----------
      if (req.method === "GET") {
        const name = url.searchParams.get("name");

        if (!name) {
          return new Response("Missing name", {
            status: 400,
            headers: corsHeaders
          });
        }

        const manifest = await env.APP.get(name);

        if (!manifest) {
          return new Response("Not Found", {
            status: 404,
            headers: corsHeaders
          });
        }

        return new Response(manifest, {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/manifest+json"
          }
        });
      }

      // ---------- POST ----------
      if (req.method === "POST") {
        let body;

        try {
          body = await req.json();
        } catch {
          return new Response("Invalid JSON", {
            status: 400,
            headers: corsHeaders
          });
        }

        const { name, manifest } = body;

        if (!name || !manifest) {
          return new Response("Missing fields", {
            status: 400,
            headers: corsHeaders
          });
        }

        // Check if key already exists
        const existing = await env.APP.get(name);

        if (existing) {
          return new Response("App already exists", {
            status: 409,
            headers: corsHeaders
          });
        }

        // Save manifest
        await env.APP.put(name, JSON.stringify(manifest));

        return new Response(JSON.stringify({ success: true }), {
          status: 201,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }

      return new Response("Method Not Allowed", {
        status: 405,
        headers: corsHeaders
      });
    }

    return new Response("Not Found", {
      status: 404,
      headers: corsHeaders
    });
  }
};
