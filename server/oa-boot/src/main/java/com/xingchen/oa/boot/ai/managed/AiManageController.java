package com.xingchen.oa.boot.ai.managed;

import com.xingchen.oa.common.core.R;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/**
 * 受控管理操作 REST（AI 助手·受控管理操作框架，docs/design/ai-managed-actions.md §2/§4）。
 * 登录即用；具体操作按 requiredAuthority 在服务内过滤（无权不返回）。供前端「AI 可帮你新增…」提示面板
 * 直接调用（免一次 LLM 轮次），也供表单卡提交：
 * <ul>
 *   <li>GET  /api/ai/manage/actions —— 当前用户有权的管理操作清单；</li>
 *   <li>POST /api/ai/manage/prepare —— 生成表单卡（formSchema + 预填）；</li>
 *   <li>POST /api/ai/manage/submit —— 表单卡提交 → 暂存动作草稿并返回确认卡
 *       （确认执行走 {@code POST /api/ai/actions/{id}/confirm}，复用批A 二段式）。</li>
 * </ul>
 */
@RestController
@RequestMapping("/api/ai/manage")
@RequiredArgsConstructor
public class AiManageController {

    private final ManageActionService manageService;

    public record PrepareRequest(String actionCode, Map<String, Object> knownValues, String targetId) {
    }

    public record SubmitRequest(String actionCode, Map<String, Object> values, String targetId) {
    }

    @GetMapping("/actions")
    public R<List<Map<String, Object>>> actions(
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) String module) {
        return R.ok(manageService.listActions(keyword, module));
    }

    @PostMapping("/prepare")
    public R<Map<String, Object>> prepare(@RequestBody PrepareRequest req) {
        return R.ok(manageService.prepareCard(req.actionCode(), req.knownValues(), req.targetId()));
    }

    @PostMapping("/submit")
    public R<Map<String, Object>> submit(@RequestBody SubmitRequest req) {
        return R.ok(manageService.submit(req.actionCode(), req.values(), req.targetId()));
    }
}
