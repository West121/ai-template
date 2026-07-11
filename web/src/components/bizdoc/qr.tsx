/**
 * 二维码 SVG（qrcode-generator，零依赖 ~10KB 级；随 bizdoc 懒分片）。
 * 物理尺寸 mm，恒黑白（进 .bd-paper 打印语境）。编码失败（超容量等）→ 占位框。
 */
import { useMemo } from "react"
import qrcode from "qrcode-generator"

// 多字节（中文）内容按 UTF-8 编码
if (qrcode.stringToBytesFuncs["UTF-8"]) {
  qrcode.stringToBytes = qrcode.stringToBytesFuncs["UTF-8"]
}

export function QrSvg({ value, sizeMm, ecLevel = "M" }: { value: string; sizeMm: number; ecLevel?: "L" | "M" | "Q" | "H" }) {
  const cells = useMemo(() => {
    if (!value) return null
    try {
      const qr = qrcode(0, ecLevel)
      qr.addData(value, "Byte")
      qr.make()
      const n = qr.getModuleCount()
      const rects: { x: number; y: number }[] = []
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          if (qr.isDark(r, c)) rects.push({ x: c, y: r })
        }
      }
      return { n, rects }
    } catch {
      return null
    }
  }, [value, ecLevel])

  if (!cells) {
    return (
      <span
        aria-label="二维码占位"
        style={{
          display: "inline-flex",
          width: `${sizeMm}mm`,
          height: `${sizeMm}mm`,
          border: "0.3mm solid #000",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "7pt",
          color: "#666",
        }}
      >
        QR
      </span>
    )
  }

  return (
    <svg
      width={`${sizeMm}mm`}
      height={`${sizeMm}mm`}
      viewBox={`0 0 ${cells.n} ${cells.n}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={`二维码 ${value}`}
    >
      <rect width={cells.n} height={cells.n} fill="#fff" />
      {cells.rects.map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={1} height={1} fill="#000" />
      ))}
    </svg>
  )
}
