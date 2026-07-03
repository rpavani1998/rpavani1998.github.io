// Ingestion pipeline for PAV·AI — the FIRST stage of the RAG.
//
// Parses the portfolio (index.html) into clean, retrievable chunks and writes
// rag/knowledge.json. This makes the website the single source of truth: the
// chatbot's knowledge is always whatever the site says. Re-run after editing
// index.html (npm run ingest), then redeploy the Worker.
//
// Zero dependencies on purpose — runs with plain `node` anywhere, including CI.
// We split each list by its item's start marker (not by matching close tags),
// so nested <div>s inside an item don't break the chunking.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const OUT = join(HERE, "..", "knowledge.json");

const html = readFileSync(join(ROOT, "index.html"), "utf8");

const decode = (s) =>
  s
    .replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, "’").replace(/&mdash;/g, "—").replace(/&#\d+;/g, " ");

const strip = (h) =>
  decode(
    h.replace(/<script[\s\S]*?<\/script>/gi, " ")
     .replace(/<style[\s\S]*?<\/style>/gi, " ")
     .replace(/<[^>]+>/g, " ")
  ).replace(/\s+/g, " ").trim();

// Pull the inner HTML of <tag ... id="ID" ...> ... </tag>. Sections don't nest
// in this document, so a non-greedy match to the first close tag is safe.
function block(id, tag = "section") {
  const m = html.match(new RegExp(`<${tag}[^>]*id="${id}"[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? m[1] : "";
}

// Split a block into items by each item's START marker (robust to nested tags).
function items(html, startMarker) {
  const out = [];
  let i = html.indexOf(startMarker);
  while (i !== -1) {
    const next = html.indexOf(startMarker, i + startMarker.length);
    out.push(html.slice(i, next === -1 ? undefined : next));
    i = next;
  }
  return out;
}

const chunks = [];
const add = (source, text) => {
  const t = strip(text);
  if (t.length > 40) chunks.push({ source, text: t });
};

// Identity (hero): name, positioning, one-line pitch, headline stats.
add("intro", block("home", "header"));

// About: the narrative paragraphs + the at-a-glance card.
add("about", block("about"));

// Skills: one chunk per category row.
for (const row of items(block("skills"), '<div class="srow">')) add("skills", row);

// Selected work: one chunk per project case study.
for (const proj of items(block("projects"), '<article class="proj')) add("project", proj);

// Experience: one chunk per timeline entry.
for (const item of items(block("experience"), '<div class="xp-item')) add("experience", item);

// Writing.
add("writing", block("writing"));

// Recognition: one chunk per achievement.
for (const ach of items(block("achievements"), '<div class="ach ')) add("achievement", ach);

// Contact.
add("contact", block("contact"));

writeFileSync(OUT, JSON.stringify(chunks, null, 2) + "\n");
console.log(`Ingested ${chunks.length} chunks from index.html -> knowledge.json`);
for (const c of chunks) console.log(`  [${c.source}] ${c.text.slice(0, 70)}…`);
