package com.xingchen.oa.boot.ai.controller;

import com.xingchen.oa.boot.ai.service.AiChatService;
import com.xingchen.oa.boot.ai.service.AiChatService.ChatResponse;
import com.xingchen.oa.boot.ai.service.AiConfirmService;
import com.xingchen.oa.common.core.PageResult;
import com.xingchen.oa.common.core.R;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/**
 * AI 智能助手 API（§3/§7）。登录即用（无新权限码，工具沿用各自模块权限）。
 */
@RestController
@RequestMapping("/api/ai")
@RequiredArgsConstructor
public class AiChatController {

    private final AiChatService chatService;
    private final AiConfirmService confirmService;

    public record ChatRequest(Long sessionId, String message) {
    }

    public record ConfirmRequest(String actionId) {
    }

    /** 对话：sessionId 空=新会话。返回 {sessionId, messages:[{role,content,cards?}]}。 */
    @PostMapping("/chat")
    public R<ChatResponse> chat(@RequestBody ChatRequest req) {
        return R.ok(chatService.chat(req.sessionId(), req.message()));
    }

    /** 确认执行暂存的变更动作（§0.2 二段式）。不存在/过期 → 410，他人动作 → 403。 */
    @PostMapping("/confirm")
    public R<Map<String, Object>> confirm(@RequestBody ConfirmRequest req) {
        return R.ok(confirmService.confirm(req.actionId()));
    }

    @GetMapping("/sessions")
    public R<List<Map<String, Object>>> sessions() {
        return R.ok(chatService.sessions());
    }

    @GetMapping("/sessions/{id}/messages")
    public R<PageResult<Map<String, Object>>> messages(
            @PathVariable Long id,
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "50") int pageSize) {
        return R.ok(chatService.messages(id, pageNum, pageSize));
    }

    @DeleteMapping("/sessions/{id}")
    public R<Void> deleteSession(@PathVariable Long id) {
        chatService.deleteSession(id);
        return R.ok();
    }
}
