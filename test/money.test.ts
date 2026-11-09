import { describe, expect, it } from "vitest";
import { fromKop, parseRub, toKop } from "../src/utils/money.js";

describe("parseRub", () => {
  it("принимает число и строку с числом", () => {
    expect(parseRub(2500)).toBe(2500);
    expect(parseRub("2500.00")).toBe(2500);
    expect(parseRub(" 99 ")).toBe(99);
  });

  it("отклоняет мусор и отрицательные суммы", () => {
    expect(() => parseRub("abc")).toThrow();
    expect(() => parseRub(null)).toThrow();
    expect(() => parseRub(-1)).toThrow();
  });
});

describe("toKop / fromKop", () => {
  it("рубли в копейки", () => {
    expect(toKop(2500)).toBe(250000);
    expect(toKop(99)).toBe(9900);
  });

  it("отбрасывает доли копейки", () => {
    expect(toKop(10.999)).toBe(1099);
    expect(toKop(0.019)).toBe(1);
  });

  it("не теряет копейку на погрешности двоичной дроби", () => {
    // 4723.9 * 100 === 472389.99999999994 — значения из реальных amountPaid
    expect(toKop(4723.9)).toBe(472390);
    expect(toKop(19.99)).toBe(1999);
    expect(toKop(1.15)).toBe(115);
    expect(toKop(0.29)).toBe(29);
    expect(toKop(4549.23)).toBe(454923);
  });

  it("копейки в рубли", () => {
    expect(fromKop(250000)).toBe(2500);
    expect(fromKop(1099)).toBe(10.99);
  });
});
