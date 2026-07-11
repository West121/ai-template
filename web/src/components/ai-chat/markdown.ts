/**
 * 轻量 markdown → HTML（纯函数，零依赖，node 可测）。
 *
 * 仅服务助手消息渲染（丹青 §2.2 管线一：md→HTML→sanitizeHtml→注入 .ai-md 作用域）。
 * 覆盖助手回复常用子集：标题(#/##/###)、无序/有序列表、代码块(```)、行内代码、
 * 加粗/斜体、链接、表格（| 语法，包 .md-table-wrap 横滚容器）、段落/换行。
 * 输出先经本函数转义再拼 HTML；渲染侧仍统一 sanitizeHtml 兜底（双保险）。
 */

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

/** 行内语法：行内代码 → 加粗 → 斜体 → 链接（在已转义文本上进行） */
function inline(escaped: string): string {
  return escaped
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text: string, href: string) => {
      // 仅放行站内路径与 http(s)，其余降级纯文本（sanitize 双保险之外的第一道）
      if (/^(\/|https?:\/\/)/.test(href)) {
        return `<a href="${href}">${text}</a>`
      }
      return text
    })
}

/** 是否表格分隔行（| --- | --- |） */
function isTableDivider(line: string): boolean {
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line.trim())
}

function splitCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim())
}

/**
 * markdown → HTML 字符串。空输入回 ""。
 */
export function mdToHtml(md: string | null | undefined): string {
  if (!md) return ""
  const lines = md.replace(/\r\n/g, "\n").split("\n")
  const out: string[] = []
  let i = 0

  const flushParagraph = (buf: string[]) => {
    if (buf.length === 0) return
    out.push(`<p>${buf.map((l) => inline(escapeHtml(l))).join("<br>")}</p>`)
    buf.length = 0
  }

  const para: string[] = []

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    // 代码块
    if (trimmed.startsWith("```")) {
      flushParagraph(para)
      const buf: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        buf.push(lines[i])
        i++
      }
      i++ // 跳过闭合 ```
      out.push(`<pre><code>${escapeHtml(buf.join("\n"))}</code></pre>`)
      continue
    }

    // 标题
    const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed)
    if (heading) {
      flushParagraph(para)
      const level = heading[1].length
      out.push(`<h${level}>${inline(escapeHtml(heading[2]))}</h${level}>`)
      i++
      continue
    }

    // 表格：表头行 + 分隔行
    if (trimmed.startsWith("|") && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      flushParagraph(para)
      const headers = splitCells(trimmed)
      i += 2
      const bodyRows: string[][] = []
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        bodyRows.push(splitCells(lines[i]))
        i++
      }
      const thead = `<thead><tr>${headers.map((h) => `<th>${inline(escapeHtml(h))}</th>`).join("")}</tr></thead>`
      const tbody = `<tbody>${bodyRows
        .map((r) => `<tr>${headers.map((_h, ci) => `<td>${inline(escapeHtml(r[ci] ?? ""))}</td>`).join("")}</tr>`)
        .join("")}</tbody>`
      out.push(`<div class="md-table-wrap"><table>${thead}${tbody}</table></div>`)
      continue
    }

    // 无序列表
    if (/^[-*]\s+/.test(trimmed)) {
      flushParagraph(para)
      const items: string[] = []
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s+/, ""))
        i++
      }
      out.push(`<ul>${items.map((it) => `<li>${inline(escapeHtml(it))}</li>`).join("")}</ul>`)
      continue
    }

    // 有序列表
    if (/^\d+[.、]\s+/.test(trimmed)) {
      flushParagraph(para)
      const items: string[] = []
      while (i < lines.length && /^\d+[.、]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+[.、]\s+/, ""))
        i++
      }
      out.push(`<ol>${items.map((it) => `<li>${inline(escapeHtml(it))}</li>`).join("")}</ol>`)
      continue
    }

    // 空行 = 段落分隔
    if (trimmed === "") {
      flushParagraph(para)
      i++
      continue
    }

    para.push(trimmed)
    i++
  }
  flushParagraph(para)
  return out.join("")
}
