// Эталон: для каждого заказа — версия с максимальным updatedAt из /orders + вебхуков.
// Дни считаются по локальной дате клиента на момент createdAt (Intl, без фиксированного смещения).
// Сравнивает эталон с текущим состоянием БД сервиса и с ответом daily-totals.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const [, , dumpFile, hooksFile, totalsFile, composeFile] = process.argv;
const { pages, customers } = JSON.parse(readFileSync(dumpFile, "utf8"));
const hooks = readFileSync(hooksFile, "utf8").trim().split("\n").map(JSON.parse).filter((r) => r.method === "POST").map((r) => JSON.parse(r.body));
const utc = (s) => new Date(/(Z|[+-]\d{2}:?\d{2})$/i.test(s) ? s : `${s}Z`);
const kop = (x) => Math.round(Number(x) * 100);
const latest = new Map();
for (const o of [...pages.flatMap((p) => p.items), ...hooks]) {
  const cur = latest.get(o.id);
  if (!cur || utc(o.updatedAt) > utc(cur.updatedAt)) latest.set(o.id, o);
}
const tz = customers.c_7.timezone;
const localDate = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const days = ["2026-03-27", "2026-03-28", "2026-03-29", "2026-03-30", "2026-03-31"];
const truth = Object.fromEntries(days.map((d) => [d, { gross: 0, net: 0 }]));
for (const o of latest.values()) {
  if (o.customerId !== "c_7" || o.status !== "paid") continue;
  const d = localDate(utc(o.createdAt));
  if (!truth[d]) continue;
  truth[d].gross += kop(o.amount);
  truth[d].net += o.amountPaid === undefined ? kop(o.amount) : kop(o.amountPaid);
}
const service = JSON.parse(readFileSync(totalsFile, "utf8"));
console.log("date        truth_gross  truth_net  discount | service_total  diff");
for (const d of days) {
  const s = service.find((x) => x.date === d)?.total;
  const t = truth[d];
  console.log(d, String(t.gross / 100).padStart(11), String(t.net / 100).padStart(10), String((t.gross - t.net) / 100).padStart(9), "|", String(s).padStart(13), String(+(s - t.gross / 100).toFixed(2)).padStart(6));
}
// Состояние БД против эталона
const psql = execFileSync("docker", ["compose", "-f", composeFile, "exec", "-T", "postgres", "psql", "-U", "postgres", "-d", "orders", "-At", "-F", "|", "-c",
  "select id,status,amount_kop,updated_at at time zone 'UTC' from orders"], { encoding: "utf8" });
let wrong = [];
for (const line of psql.trim().split("\n")) {
  const [id, status, amountKop, upd] = line.split("|");
  const t = latest.get(id);
  if (new Date(upd + "Z").getTime() !== utc(t.updatedAt).getTime() || status !== t.status) wrong.push({ id, db: { status, upd }, truth: { status: t.status, upd: t.updatedAt, disc: t.discountPercent } });
}
console.log("DB rows not at latest version:", wrong.length, JSON.stringify(wrong));
// Какие заказы c_7 переезжают между днями из-за DST
for (const o of latest.values()) {
  if (o.customerId !== "c_7" || o.status !== "paid") continue;
  const c = utc(o.createdAt);
  const wrongDay = new Date(c.getTime() + 60 * 60_000).toISOString().slice(0, 10);
  const realDay = localDate(c);
  if (wrongDay !== realDay && (days.includes(realDay) || days.includes(wrongDay))) console.log(" DST shift:", o.id, o.createdAt, "real", realDay, "with +60:", wrongDay, o.amount);
}
