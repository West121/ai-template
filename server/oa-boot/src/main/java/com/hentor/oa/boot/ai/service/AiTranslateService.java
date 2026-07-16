package com.hentor.oa.boot.ai.service;

import com.hentor.oa.boot.ai.orchestration.AiChatClientFactory;
import com.hentor.oa.boot.ai.support.AiErrors;
import com.hentor.oa.common.exception.BusinessException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.openai.OpenAiChatOptions;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * i18n · AI 批量翻译（docs/design/i18n.md 拍板④，M1 前端已上线走 mock，本端点补真源）。
 *
 * <p>策略：<b>逐 locale 一次 LLM 调用译一批</b>（比一次多语稳：prompt 单一目标、解析面小、
 * 单语失败可定位）；FAST 模型档优先（低成本），档未配置/不可用回退系统默认凭据；
 * <b>输出严格 JSON 数组解析 + 条数校验</b>——数量/格式不符直接报错（502），不瞎填不静默截断。
 * 无副作用、可重试；审计=轻量日志（非工具调用不进 ai_tool_call，控制器另挂 @OperLog）。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AiTranslateService {

    /** 目标语言白名单（拍板④）：locale → 提示词里的人话语言名。 */
    private static final Map<String, String> LOCALES = Map.of(
            "en", "英语（English）",
            "zh-TW", "繁体中文（台湾用语习惯）",
            "th", "泰语（ไทย）",
            "ja", "日语（日本語）");

    private static final int MAX_TEXTS = 50;

    private final AiModelService modelService;
    private final AiChatClientFactory chatClientFactory;
    private final ObjectMapper objectMapper;

    public record TranslateRequest(List<String> texts, List<String> targetLocales,
                                   String sourceLocale, String context, Long credentialId) {
    }

    /** 翻译：返回 {locale: [与 texts 同序译文]}。 */
    public Map<String, List<String>> translate(TranslateRequest req) {
        List<String> texts = req == null || req.texts() == null ? List.of() : req.texts();
        if (texts.isEmpty()) {
            throw new BusinessException(400, "texts 必填（待翻译文案数组）");
        }
        if (texts.size() > MAX_TEXTS) {
            throw new BusinessException(400, "单次最多翻译 " + MAX_TEXTS + " 条（当前 " + texts.size() + "）");
        }
        Set<String> locales = new LinkedHashSet<>(req.targetLocales() == null ? List.of() : req.targetLocales());
        if (locales.isEmpty()) {
            throw new BusinessException(400, "targetLocales 必填");
        }
        for (String locale : locales) {
            if (!LOCALES.containsKey(locale)) {
                throw new BusinessException(400, "不支持的目标语言: " + locale
                        + "（白名单 " + String.join("/", LOCALES.keySet()) + "）");
            }
        }
        AiModelService.ResolvedModel resolved = resolveModel(req.credentialId());
        ChatClient client = chatClientFactory.client(resolved.credential(), resolved.apiKey());
        String source = StringUtils.hasText(req.sourceLocale()) ? req.sourceLocale() : "zh-CN";

        Map<String, List<String>> out = new LinkedHashMap<>();
        for (String locale : locales) {
            out.put(locale, translateBatch(client, resolved.model(), source, locale, texts, req.context()));
        }
        log.info("AI 批量翻译：{} 条 × {} 语（source={}，model={}）", texts.size(), locales.size(), source,
                resolved.model() != null ? resolved.model() : resolved.credential().getModel());
        return out;
    }

    /** FAST 档优先（低成本）；档不存在/未配置回退系统默认凭据；均无 → 503 明确提示。credentialId 显式指定优先（测试/回归用）。 */
    private AiModelService.ResolvedModel resolveModel(Long credentialId) {
        AiModelService.ResolvedModel resolved;
        if (credentialId != null) {
            resolved = modelService.resolve(credentialId, null, null);
        } else {
            try {
                resolved = modelService.resolve(null, "FAST", null);
            } catch (BusinessException e) {
                resolved = modelService.resolve(null, null, null); // FAST 档不可用 → 默认凭据
            }
        }
        if (resolved == null) {
            throw AiErrors.e(503, AiErrors.MODEL_UNAVAILABLE,
                    "AI 翻译不可用：未配置 LLM 凭据，请管理员在「自动化编排-凭据」新增 LLM 型凭据");
        }
        return resolved;
    }

    /** 单语一批：严格 JSON 数组输出（剥 markdown 代码栅栏），条数不符/解析失败 → 502 报错不瞎填。 */
    private List<String> translateBatch(ChatClient client, String model, String source, String locale,
                                        List<String> texts, String context) {
        String system = "你是企业 OA 系统界面文案的专业翻译。把用户给出的源语言（" + source + "）UI 文案数组翻译为【"
                + LOCALES.get(locale) + "】。要求：使用专业 OA/办公术语；保持界面标签的简短风格；不添加解释；"
                + "严格输出 JSON 字符串数组——与输入同序、同条数、仅输出数组本身（不要 markdown 代码块、不要其它文字）。";
        String user = (StringUtils.hasText(context) ? "场景提示：" + context + "\n" : "")
                + "待翻译文案（JSON 数组）：\n" + toJson(texts);
        String content;
        try {
            content = client.prompt().system(system).user(user)
                    .options(OpenAiChatOptions.builder().model(model))
                    .call().content();
        } catch (Exception e) {
            throw new BusinessException(502, "AI 翻译调用失败（locale=" + locale + "）：" + e.getMessage());
        }
        return parseStrict(content, texts.size(), locale);
    }

    private List<String> parseStrict(String content, int expected, String locale) {
        if (!StringUtils.hasText(content)) {
            throw new BusinessException(502, "AI 翻译返回为空（locale=" + locale + "），请重试");
        }
        String cleaned = content.trim();
        if (cleaned.startsWith("```")) { // 剥 ```json ... ``` 栅栏（LLM 常见违约）
            int start = cleaned.indexOf('\n');
            int end = cleaned.lastIndexOf("```");
            if (start >= 0 && end > start) {
                cleaned = cleaned.substring(start + 1, end).trim();
            }
        }
        JsonNode node;
        try {
            node = objectMapper.readTree(cleaned);
        } catch (Exception e) {
            throw new BusinessException(502, "AI 翻译结果解析失败（locale=" + locale + "，非合法 JSON），请重试");
        }
        if (!node.isArray() || node.size() != expected) {
            throw new BusinessException(502, "AI 翻译结果条数不符（locale=" + locale + "，期望 " + expected
                    + " 得到 " + (node.isArray() ? node.size() : "非数组") + "），请重试");
        }
        List<String> out = new ArrayList<>(expected);
        for (JsonNode item : node) {
            out.add(item.isTextual() ? item.asString() : item.toString());
        }
        return out;
    }

    private String toJson(Object o) {
        try {
            return objectMapper.writeValueAsString(o);
        } catch (Exception e) {
            throw new BusinessException(400, "texts 序列化失败");
        }
    }
}
