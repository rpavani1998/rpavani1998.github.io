// PAV·AI — a real RAG over Pavani Rajula's resume, running on Cloudflare Workers AI.
//
// Pipeline per question:
//   1. Retrieval   — embed the question (bge-small), cosine-search the resume chunks.
//   2. Augmented   — stuff the top matches into the prompt as grounding context.
//   3. Generation  — Llama-3.1-8b answers, instructed to use ONLY that context.
//
// Everything runs on Cloudflare's free Workers AI tier. No API keys in the browser.
import { CHUNKS } from "../chunks.js";

const EMBED_MODEL = "@cf/baai/bge-small-en-v1.5";
const CHAT_MODEL  = "@cf/meta/llama-3.1-8b-instruct";

// Lock this to your site so randoms can't point their own page at your Worker.
const ALLOWED_ORIGINS = [
  "https://rpavani1998.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
];

const MAX_Q_CHARS   = 300;   // cap input — keeps cost + abuse bounded
const MAX_OUT_TOKENS = 300;  // cap output
const TOP_K         = 4;     // how many chunks to retrieve
const RATE_LIMIT    = 20;    // requests per IP per window (needs the optional RATE_KV binding)
const RATE_WINDOW_S = 3600;  // 1 hour

// Chunk embeddings are computed once per isolate and cached in memory.
// The corpus is tiny (~30 passages), so this is a few embed calls on a cold
// start, then free for every request after. No build step, no vector DB.
let VECTORS = null;

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

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

async function embed(env, texts) {
  const res = await env.AI.run(EMBED_MODEL, { text: texts });
  return res.data; // array of vectors, one per input
}

async function ensureVectors(env) {
  if (VECTORS) return VECTORS;
  const vecs = await embed(env, CHUNKS);
  VECTORS = CHUNKS.map((text, i) => ({ text, vec: vecs[i] }));
  return VECTORS;
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
      // 1. Retrieval
      const store = await ensureVectors(env);
      const [qvec] = await embed(env, [q]);
      const ranked = store
        .map((c) => ({ text: c.text, score: cosine(qvec, c.vec) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, TOP_K);
      const context = ranked.map((r, i) => `[${i + 1}] ${r.text}`).join("\n\n");

      // 2 + 3. Augmented generation, grounded in the retrieved context only.
      const system =
        "You are PAV·AI, the assistant on Pavani Rajula's portfolio. Answer questions about " +
        "Pavani using ONLY the CONTEXT provided. If the answer isn't in the context, say you " +
        "don't have that detail and suggest emailing rajulapavani@outlook.com. Be concise (2-4 " +
        "sentences), warm, and specific. Refer to her as 'Pavani' or 'she'. Never invent facts, " +
        "numbers, employers, or dates.";
      const gen = await env.AI.run(CHAT_MODEL, {
        max_tokens: MAX_OUT_TOKENS,
        messages: [
          { role: "system", content: system },
          { role: "user", content: `CONTEXT:\n${context}\n\nQUESTION: ${q}` },
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
