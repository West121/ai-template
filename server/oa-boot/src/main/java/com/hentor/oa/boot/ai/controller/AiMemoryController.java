package com.hentor.oa.boot.ai.controller;

import com.hentor.oa.boot.ai.service.AiBriefingService;
import com.hentor.oa.boot.ai.service.AiMemoryService;
import com.hentor.oa.common.core.R;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/**
 * AI 长期记忆 + 晨报 API（ai-assistant-design-v2.md §13.4 / 附3 亮点⑤，批D）。登录即用（用户隔离）。
 * <ul>
 *   <li>GET /api/ai/memories —— 当前用户活跃记忆列表；</li>
 *   <li>DELETE /api/ai/memories/{id} —— 软删（归属校验，他人 403）；</li>
 *   <li>GET /api/ai/briefing —— 当日晨报（当日首次生成、当日缓存）。</li>
 * </ul>
 * 记住偏好走对话工具 memory_remember（CONFIRM_REQUIRED 确认卡），不在此直接写入。
 */
@RestController
@RequestMapping("/api/ai")
@RequiredArgsConstructor
public class AiMemoryController {

    private final AiMemoryService memoryService;
    private final AiBriefingService briefingService;

    @GetMapping("/memories")
    public R<List<Map<String, Object>>> memories() {
        return R.ok(memoryService.list());
    }

    @DeleteMapping("/memories/{id}")
    public R<Void> deleteMemory(@PathVariable Long id) {
        memoryService.delete(id);
        return R.ok();
    }

    @GetMapping("/briefing")
    public R<Map<String, Object>> briefing() {
        return R.ok(briefingService.briefing());
    }
}
