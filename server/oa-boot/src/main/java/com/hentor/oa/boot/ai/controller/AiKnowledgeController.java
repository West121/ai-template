package com.hentor.oa.boot.ai.controller;

import com.hentor.oa.boot.ai.service.AiRagService;
import com.hentor.oa.common.core.R;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/**
 * RAG 知识文档管理 API（ai-assistant-design-v2.md §12.2，批D）：admin 增删（无 UI 亦可用）。
 * 检索/注入由 {@code RetrievalAugmentationAdvisor} 在对话链路完成，此处仅维护语料。
 * 权限 system:dict:edit（超管拥有全部权限码；普通用户 403）。
 */
@RestController
@RequestMapping("/api/ai/knowledge")
@RequiredArgsConstructor
public class AiKnowledgeController {

    private final AiRagService ragService;

    public record DocRequest(String title, String moduleCode, String content) {
    }

    @GetMapping
    @PreAuthorize("hasAuthority('system:dict:edit')")
    public R<List<Map<String, Object>>> list() {
        return R.ok(ragService.listDocs());
    }

    @PostMapping
    @PreAuthorize("hasAuthority('system:dict:edit')")
    public R<Map<String, Object>> create(@RequestBody DocRequest req) {
        return R.ok(ragService.createDoc(req.title(), req.moduleCode(), req.content()));
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasAuthority('system:dict:edit')")
    public R<Void> delete(@PathVariable Long id) {
        ragService.deleteDoc(id);
        return R.ok();
    }
}
