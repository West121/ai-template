package com.hentor.oa.boot.ai.controller;

import com.hentor.oa.boot.ai.service.AiAttachmentService;
import com.hentor.oa.common.core.R;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.util.Map;

/**
 * AI 附件 API（ai-assistant-design-v2.md §17，批D）。登录即用。
 * <ul>
 *   <li>POST /api/ai/attachments（multipart file）—— 校验 MIME/大小 → 返回 {attachmentId,kind,name,url}；
 *       聊天请求随后以 {attachmentId,kind,name} 引用（dataUrl 兼容期仍收）；</li>
 *   <li>POST /api/ai/attachments/clean-legacy（admin）—— 手动触发存量 dataURL 清洗（启动亦执行一次，幂等）。</li>
 * </ul>
 */
@RestController
@RequestMapping("/api/ai/attachments")
@RequiredArgsConstructor
public class AiAttachmentController {

    private final AiAttachmentService attachmentService;

    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public R<AiAttachmentService.Uploaded> upload(@RequestParam("file") MultipartFile file) {
        return R.ok(attachmentService.upload(file));
    }

    /** 存量 dataURL 清洗（幂等）：{scanned, cleaned}。admin 手动触发；启动 runner 亦执行一次。 */
    @PostMapping("/clean-legacy")
    @PreAuthorize("hasAuthority('system:dict:edit')")
    public R<Map<String, Object>> cleanLegacy() {
        return R.ok(attachmentService.cleanLegacy());
    }
}
