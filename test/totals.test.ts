import { describe, expect, it } from "vitest";
import { apiOrder, dailyTotals, postWebhook, setupTestApp } from "./helpers.js";

const ctx = setupTestApp();

/** Строка ответа для дня без скидок: gross = total, net = total. */
const noDiscount = (date: string, total: number) => ({ date, total, gross: total, discount: 0, net: total });

describe("GET /customers/:id/daily-totals", () => {
  it("суммирует оплаченные заказы по дням в таймзоне клиента", async () => {
    // c_1 — Europe/Moscow (UTC+3): 20:30Z ещё 10-е, 21:30Z уже 11-е
    await postWebhook(ctx.app, apiOrder({ amount: 1000, createdAt: "2026-02-10T20:30:00Z" }));
    await postWebhook(ctx.app, apiOrder({ amount: 250, createdAt: "2026-02-10T21:30:00Z" }));
    await postWebhook(ctx.app, apiOrder({ amount: "99", createdAt: "2026-02-11T10:00:00Z" }));

    const res = await dailyTotals(ctx.app, "c_1", "2026-02-09", "2026-02-11");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      noDiscount("2026-02-09", 0),
      noDiscount("2026-02-10", 1000),
      noDiscount("2026-02-11", 349),
    ]);
  });

  it("день считает по смещению таймзоны на момент заказа, а не на текущую дату (переход на летнее время)", async () => {
    // Europe/Berlin: до 29.03.2026 01:00Z — UTC+1, после — UTC+2.
    // Заказы по обе стороны перехода, чтобы тест ловил ошибку в любое время года.
    ctx.api.customers.set("c_b", "Europe/Berlin");
    const order = (amount: number, createdAt: string) => apiOrder({ customerId: "c_b", amount, createdAt, updatedAt: createdAt });
    await postWebhook(ctx.app, order(100, "2026-03-28T22:30:00Z")); // 23:30 CET → 28.03
    await postWebhook(ctx.app, order(200, "2026-03-28T23:30:00Z")); // 00:30 CET → 29.03
    await postWebhook(ctx.app, order(400, "2026-03-29T22:30:00Z")); // 00:30 CEST → 30.03
    await postWebhook(ctx.app, order(800, "2026-03-30T21:30:00Z")); // 23:30 CEST → 30.03

    const res = await dailyTotals(ctx.app, "c_b", "2026-03-28", "2026-03-30");
    expect(res.json()).toEqual([
      noDiscount("2026-03-28", 100),
      noDiscount("2026-03-29", 200),
      noDiscount("2026-03-30", 1200),
    ]);
  });

  it("не учитывает pending и refunded", async () => {
    await postWebhook(ctx.app, apiOrder({ amount: 500 }));
    await postWebhook(ctx.app, apiOrder({ amount: 700, status: "pending" }));
    await postWebhook(ctx.app, apiOrder({ amount: 900, status: "refunded" }));
    const res = await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    expect(res.json()).toEqual([noDiscount("2026-02-10", 500)]);
  });

  it("учитывает только заказы этого клиента", async () => {
    ctx.api.customers.set("c_2", "Asia/Novosibirsk");
    await postWebhook(ctx.app, apiOrder({ amount: 500 }));
    await postWebhook(ctx.app, apiOrder({ amount: 800, customerId: "c_2" }));
    const res = await dailyTotals(ctx.app, "c_2", "2026-02-10", "2026-02-10");
    expect(res.json()).toEqual([noDiscount("2026-02-10", 800)]);
  });

  it("таймзона клиента берётся из API один раз", async () => {
    await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    ctx.api.customers.set("c_1", "UTC");
    await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    const { rows } = await ctx.db.query(`SELECT timezone FROM customers WHERE id = 'c_1'`);
    expect(rows[0].timezone).toBe("Europe/Moscow");
  });

  it("валидирует даты", async () => {
    expect((await dailyTotals(ctx.app, "c_1", "2026-02-30", "2026-03-01")).statusCode).toBe(400);
    expect((await dailyTotals(ctx.app, "c_1", "2026-03-02", "2026-03-01")).statusCode).toBe(400);
  });

  it("неизвестный клиент — 404", async () => {
    const res = await dailyTotals(ctx.app, "nobody", "2026-02-10", "2026-02-10");
    expect(res.statusCode).toBe(404);
  });
});
