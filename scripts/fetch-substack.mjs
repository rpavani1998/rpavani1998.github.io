// Fetch Pavani's Substack RSS and write a slim data/posts.json for the site.
// Runs in GitHub Actions (server-side), so there's no browser CORS problem.
// No dependencies — Node 20+ has global fetch.
import { writeFileSync, mkdirSync } from "node:fs";

const FEED = "https://pavanirajula.substack.com/feed";
const MAX_POSTS = 8;

const strip = (s) => s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
function pick(block, tag) {
  const m = block.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`));
  return m ? m[1].trim() : "";
}

const res = await fetch(FEED, { headers: { "User-Agent": "rpavani1998-portfolio-substack-sync" } });
if (!res.ok) throw new Error(`feed fetch failed: ${res.status}`);
const xml = await res.text();

const posts = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
  .map((m) => m[1])
  .map((block) => {
    const title = strip(pick(block, "title"));
    const url = pick(block, "link");
    const pub = pick(block, "pubDate");
    let excerpt = strip(pick(block, "description"));
    if (excerpt.length > 180) excerpt = excerpt.slice(0, 177).trimEnd() + "…";
    return { title, url, date: pub ? new Date(pub).toISOString() : "", excerpt };
  })
  .filter((p) => p.title && p.url)
  .slice(0, MAX_POSTS);

mkdirSync("data", { recursive: true });
writeFileSync("data/posts.json", JSON.stringify(posts, null, 2) + "\n");
console.log(`Wrote ${posts.length} post(s) to data/posts.json`);
