/**
 * 公文信息分组网格（重构阶段 D §2.2）：把 8+ 项按语义分组（拟稿 / 文号 / 收发），不再平铺散。
 * 复用基座 `ShellField`（label 灰 + value）；分组小标题 + 组间发丝分隔；空值 —，长文本 truncate+title。
 * 收/发差异走 direction。附件在末尾。
 */
import { Paperclip } from "lucide-react"
import { ShellField } from "@/pages/workflow/workflow-detail-shell"
import { gwFormatDate, type GwDoc } from "./types"

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t pt-3 first:border-t-0 first:pt-0">
      <div className="mb-2 text-xs font-medium text-muted-foreground">{title}</div>
      <div className="grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">{children}</div>
    </div>
  )
}

export function GongwenInfoGrid({ doc }: { doc: GwDoc }) {
  const isSend = doc.direction === "SEND"
  const isPlain = doc.headerType === "PLAIN"

  // 密级/紧急/文种在头卡 badges 展示，此处不重复；分组只放次要元数据
  return (
    <div className="space-y-3">
      {isSend ? (
        <>
          <Group title="拟稿信息">
            <ShellField label="拟稿人" value={doc.drafter ?? ""} />
            <ShellField label="签发人" value={doc.issuer ?? ""} />
            <ShellField label="成文日期" value={gwFormatDate(doc.docDate)} />
          </Group>
          <Group title="文号信息">
            <ShellField label={isPlain ? "印发机关" : "发文机关"} value={doc.issuingOrg ?? ""} />
            <ShellField label="文号" value={doc.code} />
            {doc.copyNo && <ShellField label="份号" value={doc.copyNo} />}
          </Group>
          <Group title="收发信息">
            <ShellField label="主送" value={doc.mainRecipients ?? ""} />
            {doc.ccRecipients && <ShellField label="抄送" value={doc.ccRecipients} />}
          </Group>
          {doc.annotation && (
            <Group title="附注">
              <ShellField className="col-span-full" label="" value={doc.annotation} />
            </Group>
          )}
        </>
      ) : (
        <Group title="来文信息">
          <ShellField label="来文单位" value={doc.sourceUnit ?? ""} />
          <ShellField label="来文字号" value={doc.sourceCode ?? ""} />
          <ShellField label="收文日期" value={gwFormatDate(doc.receivedAt)} />
          <ShellField label="成文日期" value={gwFormatDate(doc.docDate)} />
          {doc.mainRecipients && <ShellField label="承办范围" value={doc.mainRecipients} />}
        </Group>
      )}

      {/* 附件 */}
      {doc.attachments && doc.attachments.length > 0 && (
        <div className="border-t pt-3">
          <div className="mb-1.5 text-xs font-medium text-muted-foreground">附件（{doc.attachments.length}）</div>
          <div className="flex flex-wrap gap-2">
            {doc.attachments.map((a, i) => (
              <div key={i} className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm">
                <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="max-w-52 truncate" title={a.name}>
                  {a.name}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
