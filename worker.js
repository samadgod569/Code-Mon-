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

  const { name, manifest, username, pass } = body;

  if (!name || !manifest || !username || !pass) {
    return new Response("Missing fields", {
      status: 400,
      headers: corsHeaders
    });
  }

  // 🔐 Verify password
  const storedPass = await env.Pass.get(username);

  if (!storedPass || storedPass !== pass) {
    return new Response("Unauthorized: Invalid credentials", {
      status: 401,
      headers: corsHeaders
    });
  }

  const existing = await env.APP.get(name);

  // 🔹 If key exists → check ownership
  if (existing) {
    const [owner, storedManifest, description , like] = existing.split("*");

    if (owner !== username) {
      return new Response("Forbidden: Not owner", {
        status: 403,
        headers: corsHeaders
      });
    }

    // Owner matches → update manifest
    await env.APP.put(
      name,
      `${owner}*${JSON.stringify(manifest)}`
    );

    return new Response(JSON.stringify({ success: true, updated: true }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }

  // 🔹 If key does NOT exist → create new
  await env.APP.put(
    name,
    `${username}*${JSON.stringify(manifest)}`
  );

  return new Response(JSON.stringify({ success: true, created: true }), {
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

    if (path === "/api/like") {

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: corsHeaders
    });
  }

  let body;

  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", {
      status: 400,
      headers: corsHeaders
    });
  }

  const { username, pass, name } = body;

  if (!username || !pass || !name) {
    return new Response("Missing fields", {
      status: 400,
      headers: corsHeaders
    });
  }

  // 🔐 Password check
  const storedPass = await env.Pass.get(username);
  if (!storedPass || storedPass !== pass) {
    return new Response("Unauthorized", {
      status: 401,
      headers: corsHeaders
    });
  }

  // 🔍 Get app
  const appValue = await env.APP.get(name);
  if (!appValue) {
    return new Response("App Not Found", {
      status: 404,
      headers: corsHeaders
    });
  }

  // 🧩 Split app data
  let [owner, manifest, description, likes] = appValue.split("*");

  // Normalize likes
  if (!likes || likes.trim() === "") {
    // No likes yet
    likes = `${username}[*]`;
  } else {
    // Split and clean (handles trailing empty index)
    const likedUsers = likes
      .split("[*]")
      .filter(u => u && u.trim() !== "");

    // Already liked?
    if (likedUsers.includes(username)) {
      return new Response("Already liked", {
        status: 409,
        headers: corsHeaders
      });
    }

    // Add new like
    likedUsers.push(username);
    likes = likedUsers.map(u => `${u}[*]`).join("");
  }

  // 🔁 Rebuild value
  const updatedValue = `${owner}*${manifest}*${description}*${likes}`;

  await env.APP.put(name, updatedValue);

  return new Response(JSON.stringify({
    success: true,
    likes
  }), {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
    }

    return new Response("Not Found", {
      status: 404,
      headers: corsHeaders
    });
  }
};
