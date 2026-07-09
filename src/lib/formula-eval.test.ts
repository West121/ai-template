import { describe, expect, it } from "vitest"
import { FormulaError, evaluate, validate } from "@/lib/formula-eval"

describe("formula-eval · 字面量与算术", () => {
  it("数字/字符串/布尔/null 字面量", () => {
    expect(evaluate("42")).toBe(42)
    expect(evaluate("3.14")).toBe(3.14)
    expect(evaluate("'hi'")).toBe("hi")
    expect(evaluate('"hi"')).toBe("hi")
    expect(evaluate("true")).toBe(true)
    expect(evaluate("false")).toBe(false)
    expect(evaluate("null")).toBe(null)
  })

  it("四则运算与取模、优先级、括号", () => {
    expect(evaluate("1 + 2 * 3")).toBe(7)
    expect(evaluate("(1 + 2) * 3")).toBe(9)
    expect(evaluate("10 / 4")).toBe(2.5)
    expect(evaluate("10 % 3")).toBe(1)
    expect(evaluate("2 - 3 - 4")).toBe(-5) // 左结合
    expect(evaluate("-5 + 3")).toBe(-2) // 一元负号
  })

  it("字段值参与算术（字符串数字被强制为数值）", () => {
    expect(evaluate("price * qty", { price: "3", qty: 4 })).toBe(12)
  })
})

describe("formula-eval · 比较与逻辑", () => {
  it("关系运算（数值）", () => {
    expect(evaluate("days > 3", { days: 5 })).toBe(true)
    expect(evaluate("days >= 5", { days: 5 })).toBe(true)
    expect(evaluate("days < 3", { days: 5 })).toBe(false)
    expect(evaluate("days <= 4", { days: 5 })).toBe(false)
  })

  it("相等运算（字符串归一化，兼容 '3' == 3）", () => {
    expect(evaluate("type == '事假'", { type: "事假" })).toBe(true)
    expect(evaluate("type != '年假'", { type: "事假" })).toBe(true)
    expect(evaluate("days == 3", { days: "3" })).toBe(true)
  })

  it("逻辑与/或/非 + 短路", () => {
    expect(evaluate("days > 3 && amount > 1000", { days: 5, amount: 2000 })).toBe(true)
    expect(evaluate("days > 3 && amount > 1000", { days: 1, amount: 2000 })).toBe(false)
    expect(evaluate("urgent || days > 5", { urgent: false, days: 6 })).toBe(true)
    expect(evaluate("!urgent", { urgent: false })).toBe(true)
  })
})

describe("formula-eval · 白名单函数", () => {
  it("聚合：SUM/AVG/MAX/MIN/ROUND/ABS", () => {
    expect(evaluate("SUM(1, 2, 3)")).toBe(6)
    expect(evaluate("AVG(2, 4, 6)")).toBe(4)
    expect(evaluate("MAX(3, 9, 5)")).toBe(9)
    expect(evaluate("MIN(3, 9, 5)")).toBe(3)
    expect(evaluate("ROUND(3.14159, 2)")).toBe(3.14)
    expect(evaluate("ROUND(3.7)")).toBe(4)
    expect(evaluate("ABS(0 - 8)")).toBe(8)
  })

  it("SUM 展开数组 + 成员摘取（items.amount）", () => {
    const ctx = { items: [{ amount: 10 }, { amount: 20 }, { amount: 30 }] }
    expect(evaluate("SUM(items.amount)", ctx)).toBe(60)
    expect(evaluate("SUM(items.amount) > 1000", ctx)).toBe(false)
  })

  it("逻辑函数：IF/AND/OR/NOT", () => {
    expect(evaluate("IF(days > 3, 'A', 'B')", { days: 5 })).toBe("A")
    expect(evaluate("IF(days > 3, 'A', 'B')", { days: 1 })).toBe("B")
    expect(evaluate("AND(true, true, false)")).toBe(false)
    expect(evaluate("OR(false, false, true)")).toBe(true)
    expect(evaluate("NOT(false)")).toBe(true)
  })

  it("文本：LEN/CONCAT/UPPER/LOWER/TRIM/CONTAINS/ISEMPTY", () => {
    expect(evaluate("LEN('hello')")).toBe(5)
    expect(evaluate("LEN(tags)", { tags: ["a", "b"] })).toBe(2)
    expect(evaluate("CONCAT('a', 'b', 'c')")).toBe("abc")
    expect(evaluate("UPPER('ab')")).toBe("AB")
    expect(evaluate("LOWER('AB')")).toBe("ab")
    expect(evaluate("TRIM('  x  ')")).toBe("x")
    expect(evaluate("CONTAINS('hello', 'ell')")).toBe(true)
    expect(evaluate("CONTAINS(tags, 'vip')", { tags: ["vip", "new"] })).toBe(true)
    expect(evaluate("ISEMPTY(reason)", { reason: "" })).toBe(true)
    expect(evaluate("ISEMPTY(reason)", { reason: "x" })).toBe(false)
  })

  it("日期函数返回数值天数，可参与差值算术", () => {
    expect(typeof evaluate("TODAY()")).toBe("number")
    expect(evaluate("DATE('2026-01-11') - DATE('2026-01-01')")).toBe(10)
  })
})

describe("formula-eval · 字段引用与成员访问", () => {
  it("缺失字段解析为 undefined，不抛错", () => {
    expect(evaluate("missing", {})).toBe(undefined)
    expect(evaluate("ISEMPTY(missing)", {})).toBe(true)
  })

  it("嵌套对象成员访问", () => {
    expect(evaluate("value > data.min", { value: 10, data: { min: 5 } })).toBe(true)
    expect(evaluate("value > data.min", { value: 3, data: { min: 5 } })).toBe(false)
  })
})

describe("formula-eval · 错误表达式", () => {
  it("validate 捕获语法错误", () => {
    expect(validate("").ok).toBe(false)
    expect(validate("1 +").ok).toBe(false)
    expect(validate("(1 + 2").ok).toBe(false)
    expect(validate("1 + 2)").ok).toBe(false)
    expect(validate("'unterminated").ok).toBe(false)
  })

  it("validate 拒绝未知函数", () => {
    const r = validate("FOO(1)")
    expect(r.ok).toBe(false)
    expect(r.error).toContain("未知函数")
  })

  it("validate 接受合法公式", () => {
    expect(validate("SUM(items.amount) > 1000 && days > 3").ok).toBe(true)
  })

  it("evaluate 对未知函数抛 FormulaError", () => {
    expect(() => evaluate("FOO(1)")).toThrow(FormulaError)
  })
})

describe("formula-eval · 安全（不执行任意代码）", () => {
  it("危险全局标识符解析为 undefined，不触达真实对象", () => {
    expect(evaluate("window")).toBe(undefined)
    expect(evaluate("globalThis")).toBe(undefined)
    expect(evaluate("process")).toBe(undefined)
    expect(evaluate("fetch")).toBe(undefined)
    expect(evaluate("constructor")).toBe(undefined)
  })

  it("屏蔽 constructor / __proto__ / prototype 成员访问", () => {
    expect(evaluate("x.constructor", { x: {} })).toBe(undefined)
    expect(evaluate("x.__proto__", { x: {} })).toBe(undefined)
    expect(evaluate("x.prototype", { x: {} })).toBe(undefined)
    // 即使值是函数，也拿不到其 constructor（无法通往 Function 构造器）
    expect(evaluate("f.constructor", { f: () => 1 })).toBe(undefined)
  })

  it("无法通过成员调用构造函数执行代码（只能调白名单裸函数）", () => {
    // x.constructor(...) 形式：调用目标非裸标识符 → 解析期即拒绝
    expect(() => evaluate("x.constructor('return 1')()", { x: {} })).toThrow(FormulaError)
    expect(() => evaluate("(1).constructor('return 1')", {})).toThrow(FormulaError)
  })

  it("成员访问只读自有属性，够不到原型链方法", () => {
    // toString 是原型方法，非自有属性 → undefined（而非可调用函数）
    expect(evaluate("x.toString", { x: {} })).toBe(undefined)
    expect(evaluate("x.hasOwnProperty", { x: {} })).toBe(undefined)
  })

  it("基本类型不暴露原生属性（如 .length），改用 LEN()", () => {
    expect(evaluate("s.length", { s: "abcd" })).toBe(undefined)
    expect(evaluate("LEN(s)", { s: "abcd" })).toBe(4)
  })

  it("拒绝超长输入", () => {
    expect(() => evaluate("1 + ".repeat(1000) + "1")).toThrow(FormulaError)
  })
})
