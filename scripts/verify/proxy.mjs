// Прокси для вебхуков: пишет каждое тело запроса и ответ сервиса в JSONL и пересылает на сервис.
import { appendFileSync } from "node:fs";
import { createServer } from "node:http";
const [, , logFile, port = "3001", target = "http://localhost:3000"] = process.argv;
let n = 0;
createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks).toString("utf8");
  let status = 502, text = "";
  try {
    const r = await fetch(target + req.url, { method: req.method, headers: { "content-type": req.headers["content-type"] ?? "application/json" }, body: req.method === "GET" ? undefined : body });
    status = r.status;
    text = await r.text();
  } catch (e) { text = String(e); }
  appendFileSync(logFile, JSON.stringify({ n: ++n, t: new Date().toISOString(), method: req.method, url: req.url, ct: req.headers["content-type"], body, status, resp: text }) + "\n");
  res.writeHead(status, { "content-type": "application/json" }).end(text);
}).listen(Number(port), "0.0.0.0", () => console.log(`proxy :${port} -> ${target}, log ${logFile}`));
