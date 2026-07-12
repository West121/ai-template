package com.xingchen.oa.office.knowledge.controller;

import com.xingchen.oa.common.core.PageResult;
import com.xingchen.oa.common.core.R;
import com.xingchen.oa.office.knowledge.dto.KbDtos.RelatedDoc;
import com.xingchen.oa.office.knowledge.dto.KbDtos.SearchHit;
import com.xingchen.oa.office.knowledge.dto.KbDtos.SearchRequest;
import com.xingchen.oa.office.knowledge.service.KbSearchService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 知识库检索 + 相关推荐（ai-knowledge-base.md §3/§7 批2）。
 * 读须持 kb:doc:view；结果严格按当前用户可见空间过滤（KbSearchService，红线：不可见空间不进结果）。
 */
@RestController
@RequestMapping("/api/kb")
@RequiredArgsConstructor
public class KbSearchController {

    private final KbSearchService searchService;

    /** 混合检索（语义 + 全文）：q 必填，spaceId 可选，分页。 */
    @PostMapping("/search")
    @PreAuthorize("hasAuthority('kb:doc:view')")
    public R<PageResult<SearchHit>> search(@Valid @RequestBody SearchRequest req) {
        int pageNum = req.pageNum() != null ? req.pageNum() : 1;
        int pageSize = req.pageSize() != null ? req.pageSize() : 10;
        return R.ok(searchService.search(req.q(), req.spaceId(), pageNum, pageSize));
    }

    /** 相关文档：对给定文档求 Top-N 相似（语义→全文降级），排除自身、仅可见空间。 */
    @GetMapping("/docs/{id}/related")
    @PreAuthorize("hasAuthority('kb:doc:view')")
    public R<List<RelatedDoc>> related(@PathVariable Long id,
                                       @RequestParam(defaultValue = "5") int topN) {
        return R.ok(searchService.related(id, Math.max(1, Math.min(topN, 20))));
    }
}
