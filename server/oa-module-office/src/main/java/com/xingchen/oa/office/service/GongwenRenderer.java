package com.xingchen.oa.office.service;

import com.xingchen.oa.office.entity.DocTemplate;
import com.xingchen.oa.office.entity.Document;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.time.LocalDate;
import java.util.Set;

/**
 * 红头正文渲染器：按 docs/design/gongwen-format-spec.md 输出 <b>.gw-typearea 内部 HTML 片段</b>，
 * class 命名与丹青版式契约一致（前端只套 .gongwen-paper &gt; .gw-page 外壳）。
 *
 * <p>红线：六角括号〔〕由文号本身携带；上行文（请示/报告）签发人居右；印章仅 seal_status=SEALED 时渲染。
 */
@Component
public class GongwenRenderer {

    /** 上行文文种：签发人居右、发文字号居左。 */
    private static final Set<String> UPWARD_TYPES = Set.of("请示", "报告");

    public String render(Document doc, DocTemplate template) {
        boolean upward = doc.getDocType() != null && UPWARD_TYPES.contains(doc.getDocType());
        String issuingOrg = firstNonBlank(doc.getIssuingOrg(),
                template != null ? template.getIssuingOrg() : null, "发文机关文件");

        StringBuilder sb = new StringBuilder();
        sb.append("<div class=\"gw-typearea\">");

        // 版心顶部标注：份号/密级（左）紧急程度（右）
        boolean hasCopyNo = StringUtils.hasText(doc.getCopyNo());
        boolean hasSecret = StringUtils.hasText(doc.getSecret()) && !"PUBLIC".equalsIgnoreCase(doc.getSecret());
        String urgency = urgencyLabel(doc.getUrgency());
        if (hasCopyNo || hasSecret || urgency != null) {
            sb.append("<div class=\"gw-marks\"><div class=\"gw-marks-left\">");
            if (hasCopyNo) {
                sb.append("<div class=\"gw-copyno\">").append(esc(doc.getCopyNo())).append("</div>");
            }
            if (hasSecret) {
                sb.append("<div class=\"gw-secret\">").append(esc(secretLabel(doc))).append("</div>");
            }
            sb.append("</div>");
            sb.append("<div class=\"gw-urgency\">").append(urgency == null ? "" : esc(urgency)).append("</div>");
            sb.append("</div>");
        }

        // 红头：发文机关标志
        sb.append("<div class=\"gw-header\">").append(esc(issuingOrg)).append("</div>");

        // 发文字号（+ 上行文签发人）
        String docNumber = StringUtils.hasText(doc.getCode()) ? doc.getCode() : "";
        if (upward) {
            sb.append("<div class=\"gw-docnum gw-docnum--upward\">")
                    .append("<span class=\"gw-docnum-text\">").append(esc(docNumber)).append("</span>")
                    .append("<span class=\"gw-issuer\">签发人：")
                    .append(esc(firstNonBlank(doc.getIssuer(), doc.getSigner(), ""))).append("</span>")
                    .append("</div>");
        } else {
            sb.append("<div class=\"gw-docnum gw-docnum--center\">").append(esc(docNumber)).append("</div>");
        }

        // 红反线
        sb.append("<hr class=\"gw-red-line\" />");

        // 标题
        sb.append("<div class=\"gw-title\">").append(esc(doc.getTitle())).append("</div>");

        // 主送机关：全角冒号由 CSS .gw-recipients::after 统一补，这里**不再追加**，
        // 并剥掉数据自带的尾部冒号，避免出现「各部门：：」(渲染器 + CSS 各加一次)。
        String recipients = firstNonBlank(doc.getMainRecipients(), doc.getUnit(), "");
        if (StringUtils.hasText(recipients)) {
            recipients = recipients.replace("；", "、").replace(";", "、").trim();
            recipients = recipients.replaceAll("[：:]+$", "");
            sb.append("<div class=\"gw-recipients\">").append(esc(recipients)).append("</div>");
        }

        // 正文（富文本 HTML，原样注入；若非 HTML 则包 <p>）
        sb.append("<div class=\"gw-body\">").append(bodyHtml(doc.getContent())).append("</div>");

        // 成文日期 + 电子印章（仅 SEALED）
        sb.append("<div class=\"gw-docdate\">").append(esc(cnDate(doc.getDocDate())));
        if (Document.SEAL_SEALED.equals(doc.getSealStatus())) {
            Long sealImageId = template != null ? template.getSealImageId() : null;
            if (sealImageId != null) {
                sb.append("<img class=\"gw-seal\" src=\"/api/infra/files/").append(sealImageId)
                        .append("/download\" alt=\"\" aria-hidden=\"true\" />");
            } else {
                // 纯 CSS 兜底章（无印章图片时的演示章）
                sb.append("<span class=\"gw-seal gw-seal--css\" aria-hidden=\"true\">")
                        .append(esc(shortOrg(issuingOrg))).append("</span>");
            }
        }
        sb.append("</div>");

        // 附注
        if (StringUtils.hasText(doc.getAnnotation())) {
            String note = doc.getAnnotation().trim();
            if (!note.startsWith("（")) {
                note = "（" + note + "）";
            }
            sb.append("<div class=\"gw-annotation\">").append(esc(note)).append("</div>");
        }

        // 版记：抄送 + 印发机关和日期
        if (StringUtils.hasText(doc.getCcRecipients())) {
            String cc = doc.getCcRecipients().replace("；", "、").replace(";", "、").trim();
            sb.append("<div class=\"gw-record\"><div class=\"gw-cc\">抄送：").append(esc(cc)).append("</div>")
                    .append("<div class=\"gw-print-info\"><span class=\"gw-print-org\">").append(esc(issuingOrg))
                    .append("</span><span class=\"gw-print-date\">").append(esc(cnDate(doc.getDocDate())))
                    .append("印发</span></div></div>");
        }

        sb.append("</div>");
        return sb.toString();
    }

    private String bodyHtml(String content) {
        if (!StringUtils.hasText(content)) {
            return "";
        }
        String trimmed = content.trim();
        if (trimmed.startsWith("<")) {
            return trimmed; // 已是富文本 HTML
        }
        StringBuilder sb = new StringBuilder();
        for (String line : trimmed.split("\\r?\\n")) {
            if (StringUtils.hasText(line)) {
                sb.append("<p>").append(esc(line.trim())).append("</p>");
            }
        }
        return sb.toString();
    }

    private String secretLabel(Document doc) {
        String base = switch (doc.getSecret() == null ? "" : doc.getSecret().toUpperCase()) {
            case "INTERNAL" -> "内部";
            case "SECRET" -> "秘密★";
            case "CONFIDENTIAL" -> "机密★";
            case "TOP_SECRET" -> "绝密★";
            default -> doc.getSecret();
        };
        if (doc.getSecretExpire() != null && base.endsWith("★")) {
            return base + doc.getSecretExpire();
        }
        return base;
    }

    private String urgencyLabel(String urgency) {
        if (!StringUtils.hasText(urgency)) {
            return null;
        }
        return switch (urgency.toUpperCase()) {
            case "NORMAL", "" -> null;
            case "URGENT" -> "加急";
            case "FLASH", "EXTRA_URGENT" -> "特急";
            case "IMMEDIATE" -> "特提";
            default -> urgency;
        };
    }

    private String cnDate(LocalDate d) {
        if (d == null) {
            return "";
        }
        return d.getYear() + "年" + d.getMonthValue() + "月" + d.getDayOfMonth() + "日";
    }

    private String shortOrg(String org) {
        return org == null ? "" : org.replace("文件", "");
    }

    private String firstNonBlank(String... values) {
        for (String v : values) {
            if (StringUtils.hasText(v)) {
                return v;
            }
        }
        return "";
    }

    private String esc(String s) {
        if (s == null) {
            return "";
        }
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                .replace("\"", "&quot;");
    }
}
