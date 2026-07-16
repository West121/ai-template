package com.hentor.oa.boot.ai.controller;

import com.hentor.oa.boot.ai.service.AiTranslateService;
import com.hentor.oa.common.core.R;
import com.hentor.oa.common.log.OperLog;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/**
 * i18n · AI 批量翻译端点（拍板④，V53）。契约（疾风 M1 前端已按此走 mock，字段名钉死）：
 * POST /api/ai/translate {texts:string[], targetLocales:string[], sourceLocale?=zh-CN, context?, credentialId?(测试用)}
 * → {translations:{<locale>: string[]}}（与 texts 同序）。locale 白名单 en/zh-TW/th/ja；
 * ≤50 条/次（超 400）；无凭据 503 信封；权限 system:i18n:translate（V53 仅 ADMIN）。
 */
@RestController
@RequestMapping("/api/ai")
@RequiredArgsConstructor
public class AiTranslateController {

    private final AiTranslateService service;

    @PostMapping("/translate")
    @PreAuthorize("hasAuthority('system:i18n:translate')")
    @OperLog(module = "AI", action = "批量翻译")
    public R<Map<String, Object>> translate(@RequestBody AiTranslateService.TranslateRequest req) {
        Map<String, List<String>> translations = service.translate(req);
        return R.ok(Map.of("translations", translations));
    }
}
