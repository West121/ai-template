import { describe, expect, it } from "vitest"
import {
  analyzeStructure,
  currentIdentifier,
  findActiveCall,
  findUnbalancedParen,
  fuzzyScore,
  locateError,
  matchCompletions,
  parseSignatureParams,
  tokenize,
  type FieldRef,
  type FnDoc,
} from "@/lib/formula-highlight"

const FNS: FnDoc[] = [
  { name: "IF", insertTemplate: "IF(, , )", signature: "IF(条件, 真值, 假值)", category: "逻辑", description: "条件取值", example: "IF(a,b,c)" },
  { name: "SUM", insertTemplate: "SUM()", signature: "SUM(...值)", category: "数学", description: "求和", example: "SUM(x)" },
  { name: "ROUND", insertTemplate: "ROUND(, 2)", signature: "ROUND(数, 位)", category: "数学", description: "四舍五入", example: "ROUND(x,2)" },
]
const FIELDS: FieldRef[] = [
  { key: "days", label: "请假天数" },
  { key: "amount", label: "金额" },
]

describe("tokenize · 对齐与分类", () => {
  it("token.value 拼接后逐字符等于原串（高亮层对齐前提）", () => {
    const samples = [
      "IF(days>3, ROLE('总经理'), DEPT_LEADER(1))",
      "SUM(items.amount) > 1000 && days > 3",
      "  \t 缺 结 尾 '未闭合",
      "",
    ]
    for (const s of samples) {
      expect(tokenize(s).map((t) => t.value).join("")).toBe(s)
    }
  })

  it("按类别着色：函数调用位 / 字段 / 关键字 / 字符串 / 数字 / 运算符", () => {
    const toks = tokenize("SUM(days) > 3 && ok == true", {
      fieldKeys: ["days"],
      keywords: ["true"],
    })
    const kindOf = (v: string) => toks.find((t) => t.value === v)?.kind
    expect(kindOf("SUM")).toBe("fn") // 紧跟 ( → 函数
    expect(kindOf("days")).toBe("field") // 命中字段集合
    expect(kindOf("true")).toBe("keyword")
    expect(kindOf("ok")).toBe("ident") // 普通标识符
    expect(kindOf("3")).toBe("number")
    expect(kindOf(">")).toBe("operator")
    expect(kindOf("&&")).toBe("operator")
    expect(kindOf("==")).toBe("operator")
    expect(kindOf("(")).toBe("paren")
  })

  it("字符串含引号与转义整体成一个 string token", () => {
    const toks = tokenize("ROLE('总经理')")
    const str = toks.find((t) => t.kind === "string")
    expect(str?.value).toBe("'总经理'")
  })

  it("函数名与 ( 之间有空白仍判为函数调用位", () => {
    const toks = tokenize("SUM (x)")
    expect(toks.find((t) => t.value === "SUM")?.kind).toBe("fn")
  })
})

describe("fuzzyScore / matchCompletions", () => {
  it("前缀命中 > 包含命中 > 离散子序列 > 不匹配", () => {
    const prefix = fuzzyScore("su", "SUM")
    const contain = fuzzyScore("um", "SUM")
    const subseq = fuzzyScore("sm", "SUM")
    expect(prefix).not.toBeNull()
    expect(contain).not.toBeNull()
    expect(subseq).not.toBeNull()
    expect(prefix as number).toBeGreaterThan(contain as number)
    expect(contain as number).toBeGreaterThan(subseq as number)
    expect(fuzzyScore("zzz", "SUM")).toBeNull()
  })

  it("匹配函数（按名）与字段（按 key 或 label），函数优先", () => {
    const out = matchCompletions("day", FNS, FIELDS)
    expect(out.some((c) => c.kind === "field" && c.field?.key === "days")).toBe(true)

    const su = matchCompletions("su", FNS, FIELDS)
    expect(su[0]?.kind).toBe("fn")
    expect(su[0]?.label).toBe("SUM")
    expect(su[0]?.insert).toBe("SUM()")
  })

  it("字段可按中文 label 命中", () => {
    const out = matchCompletions("金额", FNS, FIELDS)
    expect(out.some((c) => c.field?.key === "amount")).toBe(true)
  })

  it("空前缀不打扰（返回空）", () => {
    expect(matchCompletions("", FNS, FIELDS)).toEqual([])
  })
})

describe("currentIdentifier", () => {
  it("从光标向左取标识符", () => {
    const src = "IF(day"
    expect(currentIdentifier(src, src.length)).toEqual({ text: "day", start: 3, end: 6 })
  })
  it("光标在运算符 / 括号后无标识符 → null", () => {
    expect(currentIdentifier("SUM(", 4)).toBeNull()
    expect(currentIdentifier("a > ", 4)).toBeNull()
  })
  it("纯数字不触发补全", () => {
    expect(currentIdentifier("123", 3)).toBeNull()
  })
})

describe("findActiveCall · 参数提示定位", () => {
  it("光标在第几个实参就返回对应 argIndex", () => {
    const src = "IF(a, b, c)"
    expect(findActiveCall(src, 3)?.argIndex).toBe(0) // 第 1 参
    expect(findActiveCall(src, 6)?.argIndex).toBe(1) // 第 2 参
    expect(findActiveCall(src, 9)?.argIndex).toBe(2) // 第 3 参
    expect(findActiveCall(src, "IF(a, b, c)".length)).toBeNull() // ) 之后不在调用内
  })

  it("嵌套调用返回最内层", () => {
    const src = "IF(SUM(x, y" // 光标在 SUM 内第 2 参
    const call = findActiveCall(src, src.length)
    expect(call?.name).toBe("SUM")
    expect(call?.argIndex).toBe(1)
  })

  it("忽略字符串内的逗号与括号", () => {
    const src = "ROLE('a, b, c'"
    const call = findActiveCall(src, src.length)
    expect(call?.name).toBe("ROLE")
    expect(call?.argIndex).toBe(0)
  })

  it("白名单过滤：不在名单内的调用不返回", () => {
    const src = "FOO(x"
    expect(findActiveCall(src, src.length, ["IF", "SUM"])).toBeNull()
    expect(findActiveCall(src, src.length)?.name).toBe("FOO")
  })
})

describe("parseSignatureParams", () => {
  it("拆出函数头与参数列表", () => {
    expect(parseSignatureParams("IF(条件, 真值, 假值)")).toEqual({
      head: "IF",
      params: ["条件", "真值", "假值"],
    })
  })
  it("无参 / 无括号", () => {
    expect(parseSignatureParams("INITIATOR()").params).toEqual([])
    expect(parseSignatureParams(">").params).toEqual([])
  })
})

describe("analyzeStructure · 解析结构摘要", () => {
  it("去重摘出函数与字段引用", () => {
    const s = analyzeStructure("IF(days>3, ROLE('x'), days)", {
      fieldKeys: ["days"],
    })
    expect(s.functions).toEqual(["IF", "ROLE"])
    expect(s.fields).toEqual(["days"])
  })
})

describe("findUnbalancedParen", () => {
  it("多余的 )", () => {
    expect(findUnbalancedParen("IF(a))")).toEqual({ index: 5, kind: "extra" })
  })
  it("缺少 )", () => {
    expect(findUnbalancedParen("IF(a")).toEqual({ index: 2, kind: "missing" })
  })
  it("平衡 → null；忽略字符串内括号", () => {
    expect(findUnbalancedParen("IF(a)")).toBeNull()
    expect(findUnbalancedParen("ROLE(')')")).toBeNull()
  })
})

describe("locateError · 消息 → 区间", () => {
  it("显式「位置 N」", () => {
    expect(locateError("a @ b", "无法识别的字符：「@」（位置 2）")).toEqual({
      errorStart: 2,
      errorEnd: 3,
    })
  })

  it("未知函数 → 定位函数名区间", () => {
    const expr = "FOO(x) + 1"
    expect(locateError(expr, "未知函数：FOO（不在白名单）")).toEqual({
      errorStart: 0,
      errorEnd: 3,
    })
  })

  it("括号不匹配（多余 / 缺少）", () => {
    expect(locateError("IF(a))", "括号不匹配：多余的 )")).toEqual({
      errorStart: 5,
      errorEnd: 6,
    })
    expect(locateError("IF(a", "括号不匹配：缺少 )")).toEqual({
      errorStart: 2,
      errorEnd: 3,
    })
  })

  it("未闭合引号 → 从引号到串尾", () => {
    expect(locateError("ROLE('x", "字符串缺少结束引号")).toEqual({
      errorStart: 5,
      errorEnd: 7,
    })
  })

  it("无法定位 → 空对象", () => {
    expect(locateError("a b c", "表达式多余内容：b")).toEqual({})
  })
})
