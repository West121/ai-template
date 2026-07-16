package com.hentor.oa.boot.ai.service;

import com.hentor.oa.boot.ai.entity.AiChatMessage;
import com.hentor.oa.boot.ai.repository.AiChatMessageRepository;
import com.hentor.oa.common.exception.BusinessException;
import com.hentor.oa.common.security.CurrentUserHolder;
import com.hentor.oa.common.security.UserContext;
import com.hentor.oa.infra.dto.FileRecordResponse;
import com.hentor.oa.infra.service.FileService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * AI 附件服务（ai-assistant-design-v2.md §17，批D）：附件 fileId 化——上传经 {@link FileService} 鉴权 +
 * MIME/大小校验（图片 png/jpg/webp≤5MB、文本 txt/md/csv/json/log≤1MB），返回 {attachmentId,kind,name,url}；
 * 聊天消息只存 attachmentId 引用（不存大图 base64 dataURL）。
 *
 * <p><b>存量 dataURL 清洗</b>：{@link #cleanLegacy} 扫描 ai_chat_message.attachments，把内联 dataURL
 * 抽出写 FileService（uploader=消息属主，保证归属可读）并改存引用；幂等（已引用化的条目跳过），
 * 启动 runner 执行一次，亦可 admin 端点手动触发。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AiAttachmentService {

    private static final long IMAGE_MAX = 5L * 1024 * 1024;
    private static final long TEXT_MAX = 1L * 1024 * 1024;
    private static final Set<String> IMAGE_EXT = Set.of("png", "jpg", "jpeg", "webp");
    private static final Set<String> TEXT_EXT = Set.of("txt", "md", "csv", "json", "log");
    private static final Set<String> IMAGE_MIME = Set.of("image/png", "image/jpeg", "image/jpg", "image/webp");

    private final FileService fileService;
    private final AiChatMessageRepository messageRepository;
    private final ObjectMapper objectMapper;

    /** 上传结果（POST /api/ai/attachments）。 */
    public record Uploaded(Long attachmentId, String kind, String name, String url) {
    }

    /** 校验 MIME/大小 → FileService 落库 → 返回 fileId 引用。 */
    public Uploaded upload(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new BusinessException(400, "附件不能为空");
        }
        String name = StringUtils.hasText(file.getOriginalFilename()) ? file.getOriginalFilename() : "unnamed";
        String ext = extOf(name);
        String mime = file.getContentType() == null ? "" : file.getContentType().toLowerCase();
        String kind;
        if (IMAGE_EXT.contains(ext) || IMAGE_MIME.contains(mime)) {
            kind = "IMAGE";
            if (file.getSize() > IMAGE_MAX) {
                throw tooLarge("图片超过 5MB 限制");
            }
        } else if (TEXT_EXT.contains(ext) || mime.startsWith("text/")) {
            kind = "TEXT";
            if (file.getSize() > TEXT_MAX) {
                throw tooLarge("文本超过 1MB 限制");
            }
        } else {
            throw new BusinessException(400,
                    "不支持的附件类型（仅 png/jpg/webp 图片与 txt/md/csv/json/log 文本）: " + name);
        }
        FileRecordResponse rec = fileService.upload(file);
        return new Uploaded(rec.id(), kind, name, downloadUrl(rec.id()));
    }

    /**
     * 存量 dataURL 清洗（幂等）：返回 {scanned, cleaned}。attachments JSON 数组中含 dataUrl 且无
     * fileId/attachmentId 的条目 → 抽 base64/URLEncoded 内容写 FileService，改存 {attachmentId,kind,name}。
     */
    public Map<String, Object> cleanLegacy() {
        int scanned = 0;
        int cleaned = 0;
        for (AiChatMessage m : messageRepository.findAll()) {
            if (!StringUtils.hasText(m.getAttachments())) {
                continue;
            }
            JsonNode arr;
            try {
                arr = objectMapper.readTree(m.getAttachments());
            } catch (Exception e) {
                continue;
            }
            if (!arr.isArray() || arr.isEmpty()) {
                continue;
            }
            scanned++;
            boolean changed = false;
            List<Map<String, Object>> rewritten = new ArrayList<>();
            for (JsonNode a : arr) {
                // 注意：不可用混合 long/Long 三元（会强制拆箱 null → NPE），显式分支
                Long fileId = null;
                if (a.hasNonNull("attachmentId")) {
                    fileId = a.get("attachmentId").asLong();
                } else if (a.hasNonNull("fileId")) {
                    fileId = a.get("fileId").asLong();
                }
                String dataUrl = a.path("dataUrl").asString(null);
                String kind = a.path("kind").asString("TEXT");
                String name = a.path("name").asString("attachment");
                if (fileId == null && StringUtils.hasText(dataUrl)) {
                    Long newId = migrateDataUrl(m.getUserId(), dataUrl, kind, name);
                    if (newId != null) {
                        rewritten.add(reference(newId, kind, name));
                        changed = true;
                        cleaned++;
                        continue;
                    }
                }
                // 已引用化或迁移失败：保留原始（迁移失败仍去掉大 dataURL 以免反复处理？→ 保守保留原样）
                rewritten.add(refFromNode(a, fileId, kind, name, dataUrl));
            }
            if (changed) {
                m.setAttachments(toJson(rewritten));
                messageRepository.save(m);
            }
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("scanned", scanned);
        out.put("cleaned", cleaned);
        return out;
    }

    /** dataURL → FileService（uploader=消息属主，保证 getReadableOrThrow 归属可读）。 */
    private Long migrateDataUrl(Long ownerUserId, String dataUrl, String kind, String name) {
        UserContext prev = CurrentUserHolder.get();
        try {
            byte[] bytes;
            String mime;
            int comma = dataUrl.indexOf(',');
            if (dataUrl.startsWith("data:") && comma > 0) {
                String meta = dataUrl.substring(5, comma);
                String payload = dataUrl.substring(comma + 1);
                mime = meta.contains(";") ? meta.substring(0, meta.indexOf(';')) : meta;
                bytes = meta.contains("base64") ? Base64.getDecoder().decode(payload)
                        : java.net.URLDecoder.decode(payload, StandardCharsets.UTF_8).getBytes(StandardCharsets.UTF_8);
            } else {
                bytes = dataUrl.getBytes(StandardCharsets.UTF_8);
                mime = "IMAGE".equalsIgnoreCase(kind) ? "image/png" : "text/plain";
            }
            CurrentUserHolder.set(UserContext.builder().userId(ownerUserId).build());
            FileRecordResponse rec = fileService.uploadBytes(bytes, name, mime);
            return rec.id();
        } catch (Exception e) {
            log.warn("存量 dataURL 迁移失败 owner={} name={}: {}", ownerUserId, name, e.getMessage());
            return null;
        } finally {
            if (prev != null) {
                CurrentUserHolder.set(prev);
            } else {
                CurrentUserHolder.clear();
            }
        }
    }

    private Map<String, Object> reference(Long attachmentId, String kind, String name) {
        Map<String, Object> o = new LinkedHashMap<>();
        o.put("attachmentId", attachmentId);
        o.put("kind", kind);
        o.put("name", name);
        return o;
    }

    private Map<String, Object> refFromNode(JsonNode a, Long fileId, String kind, String name, String dataUrl) {
        Map<String, Object> o = new LinkedHashMap<>();
        if (fileId != null) {
            o.put("attachmentId", fileId);
        } else if (StringUtils.hasText(dataUrl)) {
            o.put("dataUrl", dataUrl); // 迁移失败保留（保守）
        }
        o.put("kind", kind);
        o.put("name", name);
        return o;
    }

    private String downloadUrl(Long id) {
        return "/api/infra/files/" + id + "/download";
    }

    private String extOf(String fileName) {
        int dot = fileName.lastIndexOf('.');
        return dot >= 0 && dot < fileName.length() - 1 ? fileName.substring(dot + 1).toLowerCase() : "";
    }

    private BusinessException tooLarge(String msg) {
        return new BusinessException(413, "AI_ATTACHMENT_TOO_LARGE: " + msg);
    }

    private String toJson(Object v) {
        try {
            return objectMapper.writeValueAsString(v);
        } catch (Exception e) {
            return "[]";
        }
    }
}
