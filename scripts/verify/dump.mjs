// Снимает все страницы /orders и клиентов из внешнего API как есть, логирует аномалии ответов.
import { writeFileSync } from "node:fs";
const base = "http://localhost:4000";
const out = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];
async function get(path) {
  for (let i = 0; i < 30; i++) {
    await sleep(300);
    const res = await fetch(base + path);
    const text = await res.text();
    let body; try { body = JSON.parse(text); } catch { body = text; }
    const anomaly = res.status !== 200 || (body && typeof body === "object" && "error" in body);
    if (anomaly) { log.push({ path, status: res.status, retryAfter: res.headers.get("retry-after"), body: String(text).slice(0, 200) }); if (res.status === 404) return null; await sleep(1000); continue; }
    return body;
  }
  throw new Error("give up " + path);
}
const pages = [];
let cursor = null;
for (let n = 0; n < 1000; n++) {
  const page = await get(`/orders?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
  pages.push({ cursor, nextCursor: page.nextCursor, count: page.items.length, items: page.items, extraKeys: Object.keys(page).filter((k) => !["items", "nextCursor"].includes(k)) });
  if (!page.nextCursor || page.items.length === 0) break;
  if (pages.some((p) => p.cursor === page.nextCursor)) { log.push({ note: "cursor repeat", cursor: page.nextCursor }); break; }
  cursor = page.nextCursor;
}
const ids = [...new Set(pages.flatMap((p) => p.items.map((o) => o.customerId)))];
const customers = {};
for (const id of ids) customers[id] = await get(`/customers/${encodeURIComponent(id)}`);
writeFileSync(out, JSON.stringify({ pages, customers, log }, null, 1));
console.log("pages", pages.length, "items", pages.reduce((s, p) => s + p.count, 0), "customers", ids.length, "anomalies", log.length);
console.log(pages.map((p) => `${p.cursor}->${p.nextCursor}:${p.count}`).slice(-4).join(" | "));
