# PAV·AI — grounded résumé assistant

A tiny Cloudflare Worker that answers questions about Pavani from her résumé,
running entirely on Cloudflare's free Workers AI tier. No API keys in the browser.

## How it works (and why it's built this way)

The entire résumé (~3k tokens, in `knowledge.js`) fits comfortably in the model's
context window, so it's passed in **full** on every question:

1. The full résumé + the visitor's question go to `llama-3.1-8b-instruct`.
2. A grounding system prompt forces the model to answer **only** from the résumé,
   or say it doesn't know — that's the "no hallucination" guarantee.

No chunking, no embeddings, no vector search, no vector database. Those exist to
solve *"corpus too big for the context window"* — a problem this doesn't have.
Adding them here would be over-engineering, not sophistication.

### When would retrieval (RAG) actually be warranted?

If the knowledge base outgrew the context window — say, all of Pavani's Substack
essays, long project write-ups, or transcripts — then you'd chunk the corpus,
embed it, and vector-search the relevant passages per query (classic RAG). Graph
RAG goes further, building an entity/relationship graph, and only pays off on
large corpora with rich cross-document relationships. Right tool for the size.

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

Edit `knowledge.js` (the `FACTS` array) and redeploy. Keep it factual and
concise — it's passed to the model verbatim as grounding context.
