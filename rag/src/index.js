// PAV·AI — a grounded résumé assistant on Cloudflare Workers AI.
//
// Right-sized for the job: the entire résumé (~3k tokens, see knowledge.js)
// fits in the model's context window, so it's passed in FULL on every question.
// No chunking, embeddings, or vector search — those solve "corpus too big for
// context," which isn't the problem here. What keeps it honest is the grounding
// prompt: the model answers ONLY from the résumé, or says it doesn't know.
//
// (If the knowledge base ever outgrew the context window — essays, docs — that's
// when retrieval/RAG earns its keep. Not before.)
import { FACTS } from "../knowledge.js";

const CHAT_MODEL = "@cf/meta/llama-3.1-8b-instruct";
const RESUME = FACTS.join("\n");

// Lock this to your site so randoms can't point their own page at your Worker.
const ALLOWED_ORIGINS = [
  "https://rpavani1998.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
];

const MAX_Q_CHARS    = 300;  // cap input — keeps cost + abuse bounded
const MAX_OUT_TOKENS = 300;  // cap output
const RATE_LIMIT     = 20;   // requests per IP per window (needs the optional RATE_KV binding)
const RATE_WINDOW_S  = 3600; // 1 hour

function cors(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors(origin) },
  });
}

// Optional per-IP rate limit. No-op unless you bind a KV namespace named RATE_KV.
async function rateLimited(env, ip) {
  if (!env.RATE_KV || !ip) return false;
  const key = `rl:${ip}`;
  const count = parseInt((await env.RATE_KV.get(key)) || "0", 10);
  if (count >= RATE_LIMIT) return true;
  await env.RATE_KV.put(key, String(count + 1), { expirationTtl: RATE_WINDOW_S });
  return false;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") return new Response(null, { headers: cors(origin) });
    if (request.method !== "POST") return json({ error: "POST only" }, 405, origin);

    let q;
    try { q = (await request.json()).q; } catch { return json({ error: "bad json" }, 400, origin); }
    if (typeof q !== "string") return json({ error: "missing q" }, 400, origin);
    q = q.trim().slice(0, MAX_Q_CHARS);
    if (!q) return json({ error: "empty q" }, 400, origin);

    const ip = request.headers.get("CF-Connecting-IP");
    if (await rateLimited(env, ip)) {
      return json({ answer: "You've hit the hourly question limit — try again later, or email rajulapavani@outlook.com." }, 429, origin);
    }

    try {
      const system =
        "You are PAV·AI, the assistant on Pavani Rajula's portfolio. Answer questions about " +
        "Pavani using ONLY the RÉSUMÉ below. If the answer isn't in it, say you don't have that " +
        "detail and suggest emailing rajulapavani@outlook.com. Be concise (2-4 sentences), warm, " +
        "and specific. Refer to her as 'Pavani' or 'she'. Never invent facts, numbers, employers, or dates.";
      const gen = await env.AI.run(CHAT_MODEL, {
        max_tokens: MAX_OUT_TOKENS,
        messages: [
          { role: "system", content: system },
          { role: "user", content: `RÉSUMÉ:\n${RESUME}\n\nQUESTION: ${q}` },
        ],
      });

      const answer = (gen.response || "").trim() ||
        "I couldn't generate an answer just now — try rephrasing, or email rajulapavani@outlook.com.";
      return json({ answer }, 200, origin);
    } catch (err) {
      return json({ error: "generation_failed", answer: "PAV·AI is momentarily unavailable — please email rajulapavani@outlook.com." }, 500, origin);
    }
  },
};
