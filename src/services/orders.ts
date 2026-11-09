import { z } from "zod";
import { ValidationError } from "../errors.js";
import type { Order, OrdersRepository } from "../repositories/orders.js";
import { applyDiscount, parsePercent, parseRub, toKop } from "../utils/money.js";
import { parseUtc } from "../utils/time.js";

/** Заказ в формате внешнего API (поля, которые нам нужны; остальные игнорируем). */
const ExternalOrder = z.object({
  id: z.string().min(1),
  customerId: z.string().min(1),
  amount: z.union([z.number(), z.string()]),
  // Появились в API позже: в старых заказах их нет. Как и amount, иногда приходят строкой.
  discountPercent: z.union([z.number(), z.string()]).nullish(),
  amountPaid: z.union([z.number(), z.string()]).nullish(),
  status: z.enum(["pending", "paid", "refunded"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ApplyResult = "created" | "updated" | "stale";

/**
 * Сколько оплачено, в копейках. Источник правды — amountPaid: это фактическая оплата.
 * Без amountPaid считаем из discountPercent, без обоих — скидки нет (заказы до появления полей).
 */
function paidKop(amountKop: number, discountPercent: unknown, amountPaid: unknown): number {
  const percent = discountPercent == null ? null : parsePercent(discountPercent);
  if (amountPaid != null) {
    const kop = toKop(parseRub(amountPaid));
    if (kop > amountKop) throw new Error(`amountPaid ${JSON.stringify(amountPaid)} is greater than amount`);
    return kop;
  }
  return percent === null ? amountKop : applyDiscount(amountKop, percent);
}

export class OrdersService {
  constructor(private readonly orders: OrdersRepository) {}

  normalize(raw: unknown): Order {
    const parsed = ExternalOrder.safeParse(raw);
    if (!parsed.success) throw new ValidationError(`invalid order: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
    const o = parsed.data;
    try {
      const amountKop = toKop(parseRub(o.amount));
      return {
        id: o.id,
        customerId: o.customerId,
        amountKop,
        amountPaidKop: paidKop(amountKop, o.discountPercent, o.amountPaid),
        status: o.status,
        createdAt: parseUtc(o.createdAt),
        updatedAt: parseUtc(o.updatedAt),
      };
    } catch (e) {
      throw new ValidationError((e as Error).message);
    }
  }

  /**
   * Применяет версию заказа (из синка или вебхука).
   * Вебхуки приходят с повторами, не по порядку и параллельно, поэтому версию сохраняем,
   * только если она новее уже сохранённой (по updatedAt). Проверка атомарна — в репозитории.
   */
  async apply(raw: unknown): Promise<ApplyResult> {
    return this.orders.saveIfNewer(this.normalize(raw));
  }
}
