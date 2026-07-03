# PAV·AI — a grounded RAG chatbot

A full retrieval-augmented generation pipeline over Pavani's portfolio, running
on Cloudflare's free Workers AI tier. No API keys in the browser. The narrated
version lives at [`/rag.html`](../rag.html); this is the operational README.

> **Honest framing:** the corpus is a résumé — it fits in a context window, so at
> this scale you don't *need* retrieval. This RAG is a deliberate **reference
> implementation**: the point is the full pipeline, guardrails, and evals done
> right. Knowing when retrieval is overkill is part of the skill.

## Pipeline

```
index.html ──ingest──▶ knowledge.json ──embed──▶ [vectors] ──retrieve──▶ top-k ──ground──▶ Llama-3.1-8b ──▶ answer + sources
 (source of truth)      (28 chunks)      bge-small     cosine + threshold        prompt
```

- **Ingest** (`scripts/ingest.mjs`, zero-dep): parses `index.html`, cleans it,
  and writes `knowledge.json` — one chunk per project / role / skill group. The
  website is the single source of truth; re-run after editing the site.
- **Retrieve** (`src/index.js`): embeds the question, cosine-ranks chunks, keeps
  the top-K above a relevance threshold (`MIN_SCORE`) — below it, the bot refuses.
- **Generate**: the retrieved chunks ground `llama-3.1-8b-instruct`, which answers
  only from them. Returns the answer **plus its sources** (which chunks + scores).

## Guardrails

- Grounding + refusal (relevance threshold makes "I don't know" first-class)
- Prompt-injection resistance (user input fenced as data, not instructions)
- Input cap (300 chars) and output cap (300 tokens)
- Optional per-IP rate limit (bind a KV namespace `RATE_KV`)
- CORS locked to the portfolio origin; no secrets in the browser

## Evaluation

Labelled cases in `evals/cases.json`, runner in `evals/run.mjs`. Scores four axes
across factual / refusal / adversarial questions: **retrieval hit@k, answer
recall, refusal accuracy, injection resistance.**

```bash
RAG_ENDPOINT="https://pavai-rag.<you>.workers.dev" npm run eval
```

Runs against the live Worker (real model, not a mock); writes `evals/results.json`.

## Deploy (about 5 minutes, $0)

```bash
cd rag
npm install
npm run ingest            # index.html -> knowledge.json (commit the result)
npx wrangler login        # one-time OAuth
npm run deploy            # prints your Worker URL
```

Paste the printed `*.workers.dev` URL into `RAG_ENDPOINT` in `../index.html`, then
commit + push. Leave it empty and the site falls back to a scripted responder, so
nothing breaks before you deploy.

## Scaling path

- Corpus outgrows the context window (essays, docs) → this pipeline with a real
  vector store (Cloudflare Vectorize, Qdrant, pgvector) instead of the in-memory index.
- Rich cross-document relationships / multi-hop questions → consider Graph RAG.
  Overkill for a résumé; right tool for the size.

## Files

| File | Role |
|------|------|
| `scripts/ingest.mjs` | Build the knowledge base from `index.html` |
| `knowledge.json` | Generated chunks (the corpus) |
| `src/index.js` | The RAG Worker (retrieve → ground → generate) |
| `evals/cases.json` | Labelled test set |
| `evals/run.mjs` | Eval runner |
| `wrangler.toml` | Worker config (Workers AI binding, optional KV) |
