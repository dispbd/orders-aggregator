/**
 * Деньги внутри сервиса — целые копейки. Рубли — только на входе (внешний API) и в ответах.
 */

/** Сумма из внешнего API: число или строка с числом ("250.10"). */
export function parseRub(raw: unknown): number {
  const value = typeof raw === "string" ? Number(raw.trim()) : raw;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`invalid amount: ${JSON.stringify(raw)}`);
  }
  return value;
}

/**
 * Рубли → копейки. Доли копейки отбрасываются: деньги клиенту не досчитываем.
 * Сначала округляем до сотых долей копейки: `4723.9 * 100` в двоичной арифметике
 * даёт 472389.99999999994, и простой floor терял бы целую копейку.
 */
export function toKop(rub: number): number {
  return Math.floor(Math.round(rub * 10_000) / 100);
}

/** Процент скидки из внешнего API: число или строка с числом ("33"), от 0 до 100. */
export function parsePercent(raw: unknown): number {
  const value = typeof raw === "string" && raw.trim() !== "" ? Number(raw.trim()) : raw;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`invalid discountPercent: ${JSON.stringify(raw)}`);
  }
  return value;
}

/** Сумма в копейках после скидки `percent` %. Доли копейки отбрасываются, как в toKop. */
export function applyDiscount(kop: number, percent: number): number {
  return Math.floor(Math.round(kop * (100 - percent) * 100) / 10_000);
}

/** Копейки → рубли для ответа API. */
export function fromKop(kop: number): number {
  return kop / 100;
}
