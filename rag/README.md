# PAV·AI — real RAG backend

A tiny Cloudflare Worker that turns the portfolio chatbot into an actual
Retrieval-Augmented Generation system, running entirely on Cloudflare's free
Workers AI tier. No API keys live in the browser.

## How it works

1. **Retrieval** — the question is embedded (`bge-small`) and cosine-searched
   against Pavani's resume, split into ~30 chunks in `chunks.js`.
2. **Augmented** — the top matches are injected into the prompt as context.
3. **Generation** — `llama-3.1-8b-instruct` answers, instructed to use *only*
   that context (this is the "no hallucination" grounding).

Chunk embeddings are computed once per isolate and cached in memory — no build
step, no vector database.

## Deploy (about 5 minutes, $0)

You need a free Cloudflare account. Workers AI is on the free tier.

```bash
cd rag
npm install
npx wrangler login        # opens a browser, one-time OAuth
npm run deploy            # deploys the Worker, prints its URL
```

The deploy prints a URL like `https://pavai-rag.<your-subdomain>.workers.dev`.

## Turn it on

Open `../index.html`, find this line in the chatbot script near the bottom:

```js
const RAG_ENDPOINT = ""; // paste your deployed Worker URL here
```

Paste your Worker URL between the quotes, save, commit, push. Done — the chatbot
is now a real RAG. Leave it empty and the site falls back to the scripted
keyword responder, so nothing breaks before you deploy.

## Cost & abuse control

- Input capped at 300 chars, output at 300 tokens.
- CORS locked to your Pages domain (edit `ALLOWED_ORIGINS` in `src/index.js`).
- Optional per-IP hourly rate limit — create a KV namespace and uncomment the
  `RATE_KV` binding in `wrangler.toml`:
  ```bash
  npx wrangler kv namespace create RATE_KV
  ```
  Paste the returned id into `wrangler.toml`, then `npm run deploy` again.

## Local test

```bash
npm run dev   # serves the Worker at http://localhost:8787
curl -s http://localhost:8787 -X POST -H 'Content-Type: application/json' \
  -d '{"q":"what does pavani do?"}'
```

## Update the knowledge base

Edit `chunks.js` and redeploy. Keep each chunk short and self-contained —
retrieval quality depends on each passage making sense on its own.
