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
        const name = url.searchParams.get("username");

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

  const existing = await env.APP.get(username);

  // 🔹 If key exists → check ownership
  if (existing) {
  const [owner, storedManifest, description, ...likesArr] = existing.split("*");

  const likes = likesArr.join("*"); // preserves original likes exactly

  if (owner !== username) {
    return new Response("Forbidden: Not owner", {
      status: 403,
      headers: corsHeaders
    });
  }

  // Owner matches → update manifest, keep description & likes exactly
  await env.APP.put(
    owner,
    `${owner}*${JSON.stringify(manifest)}*${description || ""}*${likes}`
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
    username,
    `${username}*${JSON.stringify(manifest)}*${name}*`
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

  // 🧩 SAFE split (VERY IMPORTANT)
  const parts = appValue.split("*");

  const owner = parts[0];
  const manifest = parts[1];
  const description = parts[2];
  let likes = parts.slice(3).join("*"); // 🛡️ protect against corruption

  // 🧹 Normalize likes
  let likedUsers = [];

  if (likes && likes.trim() !== "") {
    likedUsers = likes
      .split("[*]")
      .filter(u => u && u.trim() !== "");
  }

  // 🚫 Already liked?
  if (likedUsers.includes(username)) {
    return new Response("Already liked", {
      status: 409,
      headers: corsHeaders
    });
  }

  // ➕ Add like
  likedUsers.push(username);

  // 🔁 Rebuild likes string safely
  likes = likedUsers.map(u => `${u}[*]`).join("");

  // 🔁 Rebuild KV value
  const updatedValue = `${owner}*${manifest}*${description}*${likes}`;

  await env.APP.put(name, updatedValue);

  return new Response(JSON.stringify({
    success: true,
    totalLikes: likedUsers.length,
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
