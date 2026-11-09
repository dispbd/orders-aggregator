import { describe, expect, it } from "vitest";
import { apiOrder, dailyTotals, postWebhook, setupTestApp } from "./helpers.js";

const ctx = setupTestApp();

const day = async (date = "2026-02-10") => (await dailyTotals(ctx.app, "c_1", date, date)).json()[0];

describe("скидки в daily-totals", () => {
  it("отдаёт gross, net и discount; total = gross", async () => {
    await postWebhook(ctx.app, apiOrder({ amount: 2500, discountPercent: 16.5, amountPaid: 2087.5 }));
    expect(await day()).toEqual({ date: "2026-02-10", total: 2500, gross: 2500, discount: 412.5, net: 2087.5 });
  });

  it("суммирует заказы со скидкой и без, считает до копейки", async () => {
    await postWebhook(ctx.app, apiOrder({ amount: 1000, discountPercent: 10, amountPaid: 900 }));
    await postWebhook(ctx.app, apiOrder({ amount: 5429, discountPercent: 13, amountPaid: 4723.23 }));
    await postWebhook(ctx.app, apiOrder({ amount: 777, discountPercent: 0, amountPaid: 777 }));
    // 4723.9 * 100 в двоичной арифметике — 472389.99999999994: проверяем, что копейка не теряется
    await postWebhook(ctx.app, apiOrder({ amount: 5430, discountPercent: 13, amountPaid: 4723.9 }));
    expect(await day()).toEqual({ date: "2026-02-10", total: 12636, gross: 12636, discount: 1511.87, net: 11124.13 });
  });

  it("старые заказы без discountPercent и amountPaid — без скидки", async () => {
    await postWebhook(ctx.app, apiOrder({ amount: 1500 }));
    expect(await day()).toEqual({ date: "2026-02-10", total: 1500, gross: 1500, discount: 0, net: 1500 });
  });

  it("принимает discountPercent и amountPaid строкой", async () => {
    await postWebhook(ctx.app, apiOrder({ amount: "2500.00", discountPercent: "16.5", amountPaid: "2087.50" }));
    expect(await day()).toMatchObject({ gross: 2500, discount: 412.5, net: 2087.5 });
  });

  it("без amountPaid считает net из discountPercent, доли копейки отбрасывает", async () => {
    await postWebhook(ctx.app, apiOrder({ amount: 99.99, discountPercent: 33 }));
    // 99.99 * 0.67 = 66.9933
    expect(await day()).toMatchObject({ gross: 99.99, net: 66.99, discount: 33 });
  });

  it("источник правды для net — amountPaid, а не процент", async () => {
    await postWebhook(ctx.app, apiOrder({ amount: 1000, discountPercent: 10, amountPaid: 850 }));
    expect(await day()).toMatchObject({ gross: 1000, net: 850, discount: 150 });
  });

  it("pending и refunded не учитываются ни в gross, ни в net", async () => {
    await postWebhook(ctx.app, apiOrder({ amount: 1000, discountPercent: 10, amountPaid: 900 }));
    await postWebhook(ctx.app, apiOrder({ amount: 700, discountPercent: 10, amountPaid: 630, status: "pending" }));
    await postWebhook(ctx.app, apiOrder({ amount: 900, discountPercent: 10, amountPaid: 810, status: "refunded" }));
    expect(await day()).toMatchObject({ total: 1000, gross: 1000, net: 900, discount: 100 });
  });

  it("изменение скидки после оплаты (новая версия заказа) меняет net", async () => {
    const o = apiOrder({ amount: 1780, discountPercent: 10, amountPaid: 1602, updatedAt: "2026-02-10T13:00:00Z" });
    await postWebhook(ctx.app, o);
    await postWebhook(ctx.app, { ...o, discountPercent: 33, amountPaid: 1192.6, updatedAt: "2026-02-10T14:00:00Z" });
    await postWebhook(ctx.app, o); // устаревшая версия пришла повторно
    expect(await day()).toMatchObject({ gross: 1780, net: 1192.6, discount: 587.4 });
  });

  it("невалидные скидки — 400", async () => {
    const bad = [
      apiOrder({ discountPercent: "abc", amountPaid: 900 }),
      apiOrder({ discountPercent: 120 }),
      apiOrder({ discountPercent: -5 }),
      apiOrder({ amount: 1000, discountPercent: 0, amountPaid: 1000.01 }),
      apiOrder({ amountPaid: "abc" }),
    ];
    for (const o of bad) expect((await postWebhook(ctx.app, o)).statusCode).toBe(400);
  });

  it("строки, сохранённые до появления скидок: net = amount, синк дозаполняет их той же версией", async () => {
    const o = apiOrder({ amount: 2000, discountPercent: 25, amountPaid: 1500 });
    // Так строка выглядит после миграции 002: версия та же, amount_paid_kop ещё не заполнен
    await ctx.db.query(
      `INSERT INTO orders (id, customer_id, amount_kop, amount_paid_kop, status, created_at, updated_at)
       VALUES ($1, $2, 200000, NULL, 'paid', $3, $4)`,
      [o.id, o.customerId, o.createdAt, o.updatedAt],
    );
    expect(await day()).toMatchObject({ gross: 2000, net: 2000, discount: 0 });

    ctx.api.pages.set(null, { items: [o], nextCursor: null });
    const sync = await ctx.app.inject({ method: "POST", url: "/sync" });
    expect(sync.json()).toMatchObject({ applied: 1, stale: 0 });
    expect(await day()).toMatchObject({ gross: 2000, net: 1500, discount: 500 });

    // Дальше та же версия — уже повтор
    expect((await postWebhook(ctx.app, o)).json()).toEqual({ result: "stale" });
  });
});
