import { describe, expect, it } from "vitest";
import { apiOrder, postWebhook, setupTestApp } from "./helpers.js";

const ctx = setupTestApp();

describe("POST /webhooks/order", () => {
  it("создаёт заказ", async () => {
    const res = await postWebhook(ctx.app, apiOrder());
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ result: "created" });
  });

  it("повтор того же события ничего не меняет", async () => {
    const o = apiOrder();
    await postWebhook(ctx.app, o);
    expect((await postWebhook(ctx.app, o)).json()).toEqual({ result: "stale" });
  });

  it("устаревшее событие после нового игнорируется", async () => {
    const o = apiOrder({ status: "paid", updatedAt: "2026-02-10T12:00:00Z" });
    await postWebhook(ctx.app, { ...o, status: "refunded", updatedAt: "2026-02-11T12:00:00Z" });
    expect((await postWebhook(ctx.app, o)).json()).toEqual({ result: "stale" });
    const { rows } = await ctx.db.query(`SELECT status FROM orders WHERE id = $1`, [o.id]);
    expect(rows[0].status).toBe("refunded");
  });

  it("новое событие обновляет заказ", async () => {
    const o = apiOrder({ status: "pending" });
    await postWebhook(ctx.app, o);
    const res = await postWebhook(ctx.app, { ...o, status: "paid", updatedAt: "2026-02-11T00:00:00Z" });
    expect(res.json()).toEqual({ result: "updated" });
  });

  it("параллельные повторы одного события: применяется один раз", async () => {
    const o = apiOrder({ status: "pending" });
    const created = await Promise.all(Array.from({ length: 5 }, () => postWebhook(ctx.app, o)));
    expect(created.map((r) => r.json().result).sort()).toEqual(["created", "stale", "stale", "stale", "stale"]);

    const paid = { ...o, status: "paid", updatedAt: "2026-02-11T00:00:00.000Z" };
    const updated = await Promise.all(Array.from({ length: 5 }, () => postWebhook(ctx.app, paid)));
    expect(updated.map((r) => r.json().result).sort()).toEqual(["stale", "stale", "stale", "stale", "updated"]);
  });

  it("параллельные версии вперемешку: в БД остаётся самая новая", async () => {
    const base = apiOrder({ status: "pending", updatedAt: "2026-02-10T12:00:00Z" });
    await postWebhook(ctx.app, base);
    const v = (status: string, hour: number) => ({ ...base, status, updatedAt: `2026-02-10T${hour}:00:00.000Z` });
    // Новейшая версия идёт первой, за ней — более старые: при гонке они затирали бы её
    const versions = [v("refunded", 16), v("paid", 13), v("paid", 14), v("paid", 15), v("paid", 13), v("paid", 14)];
    const results = await Promise.all(versions.map((o) => postWebhook(ctx.app, o)));

    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    const { rows } = await ctx.db.query(`SELECT status, updated_at FROM orders WHERE id = $1`, [base.id]);
    expect(rows[0].status).toBe("refunded");
    expect(rows[0].updated_at.toISOString()).toBe("2026-02-10T16:00:00.000Z");
  });

  it("невалидное тело — 400", async () => {
    const res = await postWebhook(ctx.app, { id: "x" });
    expect(res.statusCode).toBe(400);
  });
});
