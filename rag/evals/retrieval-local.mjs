// Local retrieval eval — measures the RETRIEVAL half of the RAG without needing
// the deployed Worker. Uses the same embedding model (bge-small-en-v1.5) via
// transformers.js, over the real chunks (knowledge.json) and the factual eval
// questions (cases.json). Reports hit@1, hit@k, and MRR against the gold chunk.
//
//   npm i @xenova/transformers   # one-time (heavy; local eval only)
//   node evals/retrieval-local.mjs
import { pipeline } from "@xenova/transformers";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const RAG = join(HERE, "..");
const TOP_K = 4;

const chunks = JSON.parse(readFileSync(join(RAG, "knowledge.json"), "utf8"));
const cases = JSON.parse(readFileSync(join(HERE, "cases.json"), "utf8"))
  .filter((c) => c.type === "factual" && c.expect_source);

const has = (s, arr) => (arr || []).some((k) => (s || "").toLowerCase().includes(k.toLowerCase()));
const cos = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) d += a[i] * b[i]; return d; }; // normalized → dot = cosine

console.log("loading bge-small-en-v1.5 …");
const extractor = await pipeline("feature-extraction", "Xenova/bge-small-en-v1.5");
const embed = async (t) => Array.from((await extractor(t, { pooling: "mean", normalize: true })).data);

const cvecs = [];
for (const c of chunks) cvecs.push(await embed(c.text));

let hit1 = 0, hitk = 0, mrr = 0;
const rows = [];
for (const c of cases) {
  const qv = await embed(c.q);
  const ranked = chunks
    .map((ch, i) => ({ i, source: ch.source, score: cos(qv, cvecs[i]) }))
    .sort((a, b) => b.score - a.score);
  // gold = a chunk of the expected section that also contains the expected fact
  const goldIdx = chunks.map((ch, i) => i).filter(
    (i) => chunks[i].source === c.expect_source && (!c.expect_includes || has(chunks[i].text, c.expect_includes))
  );
  const rank = ranked.findIndex((r) => goldIdx.includes(r.i)); // 0-based
  if (rank === 0) hit1++;
  if (rank > -1 && rank < TOP_K) hitk++;
  if (rank > -1) mrr += 1 / (rank + 1);
  rows.push({ q: c.q, rank: rank + 1, top: ranked.slice(0, TOP_K).map((r) => r.source) });
  console.log(`rank ${rank + 1}  ${c.q}\n        top-${TOP_K}: ${rows.at(-1).top.join(", ")}`);
}

const n = cases.length;
const pct = (x) => Math.round((x / n) * 100);
const out = {
  ran_at: new Date().toISOString(),
  model: "bge-small-en-v1.5 (transformers.js, local)",
  n_questions: n,
  hit_at_1: pct(hit1),
  hit_at_k: pct(hitk),
  mrr: +(mrr / n).toFixed(3),
};
console.log("\n──────── RETRIEVAL ────────");
console.log(`hit@1: ${out.hit_at_1}%   hit@${TOP_K}: ${out.hit_at_k}%   MRR: ${out.mrr}   (n=${n})`);
writeFileSync(join(HERE, "retrieval-results.json"), JSON.stringify(out, null, 2) + "\n");
console.log("wrote evals/retrieval-results.json");
