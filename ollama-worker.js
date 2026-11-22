/**
 * ARQUITETO — ponte Ollama (Cloudflare Worker, plano gratuito)
 *
 * Autocontido: no painel da Cloudflare, apague o Hello World, cole este
 * ficheiro inteiro e faça Deploy.
 *
 * Secrets (Settings → Variables and Secrets → Add → tipo Secret → Deploy):
 *   OLLAMA_API_KEY  = chave do Ollama na nuvem (obrigatória)
 *   PANEL_TOKEN     = código partilhado com o painel ARQUITETO (recomendado)
 *
 * Opcional, só em testes locais (não defina isto em produção):
 *   UPSTREAM        = origem alternativa (predefinição: https://ollama.com)
 *
 * URL final: https://<nome-do-worker>.<subdominio>.workers.dev
 * No painel ARQUITETO: Endereço base = esse URL; Token do painel = PANEL_TOKEN.
 */
const ALLOWED_ORIGINS = new Set([
  "https://marcelo7777777.github.io",
  "http://127.0.0.1:8765",
]);

const ALLOWED_PATHS = new Set(["/api/tags", "/api/chat", "/api/generate"]);
const ALLOWED_METHODS = new Set(["GET", "POST"]);
const DEFAULT_UPSTREAM = "https://ollama.com";

function normalizePath(pathname) {
  const p = String(pathname || "/").replace(/\/+$/, "");
  return p || "/";
}

function corsHeaders(origin, extra) {
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Panel-Token",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  if (extra) {
    for (const k in extra) headers[k] = extra[k];
  }
  return headers;
}

function json(status, body, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders(origin, { "Content-Type": "application/json; charset=utf-8" }),
  });
}

function safeEqual(a, b) {
  const s1 = String(a || "");
  const s2 = String(b || "");
  const n = Math.max(s1.length, s2.length, 1);
  let diff = s1.length === s2.length ? 0 : 1;
  for (let i = 0; i < n; i++) {
    const c1 = i < s1.length ? s1.charCodeAt(i) : 0;
    const c2 = i < s2.length ? s2.charCodeAt(i) : 0;
    diff |= c1 ^ c2;
  }
  return diff === 0;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const url = new URL(request.url);
    const path = normalizePath(url.pathname);
    const method = (request.method || "GET").toUpperCase();

    if (method === "OPTIONS") {
      if (origin && !ALLOWED_ORIGINS.has(origin)) {
        return json(403, { error: "Origem não autorizada." }, origin);
      }
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return json(403, { error: "Origem não autorizada. Só o painel ARQUITETO pode usar esta ponte." }, origin);
    }

    if (!ALLOWED_PATHS.has(path)) {
      return json(404, {
        error: "Este caminho não é permitido. Use apenas /api/tags, /api/chat ou /api/generate.",
      }, origin);
    }

    if (!ALLOWED_METHODS.has(method)) {
      return json(405, { error: "Método não permitido." }, origin);
    }

    const requiredToken = String((env && env.PANEL_TOKEN) || "").trim();
    if (requiredToken) {
      const sent = request.headers.get("X-Panel-Token") || "";
      if (!safeEqual(sent, requiredToken)) {
        return json(401, { error: "Token do painel em falta ou inválido (cabeçalho X-Panel-Token)." }, origin);
      }
    }

    const apiKey = String((env && env.OLLAMA_API_KEY) || "").trim();
    if (!apiKey) {
      return json(500, {
        error: "Secret OLLAMA_API_KEY em falta no Worker. Defina-o em Settings → Variables and Secrets.",
      }, origin);
    }

    let upstreamBase = String((env && env.UPSTREAM) || DEFAULT_UPSTREAM).trim() || DEFAULT_UPSTREAM;
    upstreamBase = upstreamBase.replace(/\/+$/, "");
    if (/\/api$/i.test(upstreamBase)) upstreamBase = upstreamBase.replace(/\/api$/i, "");

    const upstreamUrl = upstreamBase + path + url.search;
    const headers = new Headers();
    headers.set("Authorization", "Bearer " + apiKey);
    const accept = request.headers.get("Accept");
    headers.set("Accept", accept || "*/*");
    const contentType = request.headers.get("Content-Type");
    if (contentType) headers.set("Content-Type", contentType);
    else if (method === "POST") headers.set("Content-Type", "application/json");

    const init = { method, headers };
    if (method !== "GET" && method !== "HEAD") {
      init.body = request.body;
      init.duplex = "half";
    }

    let upstream;
    try {
      upstream = await fetch(upstreamUrl, init);
    } catch (err) {
      return json(502, {
        error: "A ponte não conseguiu contactar o Ollama: " + (err && err.message ? err.message : "erro de rede"),
      }, origin);
    }

    const out = corsHeaders(origin);
    const ct = upstream.headers.get("Content-Type");
    if (ct) out["Content-Type"] = ct;

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: out,
    });
  },
};
