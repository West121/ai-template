package com.hentor.oa.boot.ai.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.converter.BeanOutputConverter;
import org.springframework.ai.openai.OpenAiChatOptions;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

/**
 * 计划卡 Plan-then-Execute（亮点①，附3 批B）：复杂请求先经 Spring AI Structured Output
 * 产执行计划（步骤列表）→ PlanPart 推 SSE → 随工具事件逐步置 ✓。
 *
 * <p><b>PlanPart 契约（给前端疾风）</b>：partType={@code plan}，payload=
 * {@code {title:"执行计划", steps:[{title,status:"pending|done"}]}}；同 partId 重复推送
 * {@code message.part.created} 即为状态更新（前端按 partId 替换渲染）。
 *
 * <p>触发启发式：消息含「并且/然后/统计后/再/分别」类多步连接词，或逗号分句 ≥3。
 * 计划生成失败/超时不阻断主轮次（best-effort，无计划直接执行）。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AiPlanService {

    private static final Pattern MULTI_STEP = Pattern.compile("并且|然后|统计后|之后再|接着|分别");
    private static final int MAX_STEPS = 6;

    /** 计划结构（Structured Output 目标 bean）。 */
    public record PlanSpec(List<PlanStep> steps) {
    }

    public record PlanStep(String title) {
    }

    /** 复杂请求启发式（批B：连接词 / 分句数；批C 可换工具步数预估）。 */
    public boolean shouldPlan(String message) {
        if (!StringUtils.hasText(message)) {
            return false;
        }
        if (MULTI_STEP.matcher(message).find()) {
            return true;
        }
        return message.split("[，,；;]").length >= 4;
    }

    /**
     * 经 Structured Output 产执行计划步骤（≤6 步）；失败返回空列表（不阻断主轮次）。
     * 独立模型调用：不带工具、不注入会话历史（advisor 无 sessionId 参数即跳过 memory）。
     */
    public List<String> generate(ChatClient client, String model, String userMessage) {
        try {
            BeanOutputConverter<PlanSpec> converter = new BeanOutputConverter<>(PlanSpec.class);
            String prompt = "请为以下用户请求生成执行计划（2-" + MAX_STEPS + " 个步骤，每步一句话动作描述，"
                    + "只列你将实际执行的查询/统计/操作步骤）。\n用户请求：" + userMessage
                    + "\n\n" + converter.getFormat();
            String content = client.prompt()
                    .system("你是任务规划器，只输出符合格式要求的 JSON，不输出多余文本。")
                    .user(prompt)
                    .options(OpenAiChatOptions.builder().model(model))
                    .call().content();
            if (!StringUtils.hasText(content)) {
                return List.of();
            }
            PlanSpec spec = converter.convert(content);
            List<String> titles = new ArrayList<>();
            if (spec != null && spec.steps() != null) {
                for (PlanStep s : spec.steps()) {
                    if (s != null && StringUtils.hasText(s.title())) {
                        titles.add(s.title().trim());
                    }
                    if (titles.size() >= MAX_STEPS) {
                        break;
                    }
                }
            }
            return titles;
        } catch (Exception e) {
            log.info("执行计划生成失败（跳过计划卡，不阻断）: {}", e.getMessage());
            return List.of();
        }
    }
}
