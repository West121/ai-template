package com.xingchen.oa.office.controller;

import com.xingchen.oa.common.core.PageResult;
import com.xingchen.oa.common.core.R;
import com.xingchen.oa.office.dto.gongwen.ArchiveRequest;
import com.xingchen.oa.office.dto.gongwen.CirculateRequest;
import com.xingchen.oa.office.dto.gongwen.DocDetailResponse;
import com.xingchen.oa.office.dto.gongwen.GongwenListItem;
import com.xingchen.oa.office.dto.gongwen.LedgerResponse;
import com.xingchen.oa.office.dto.gongwen.NumberPreviewRequest;
import com.xingchen.oa.office.dto.gongwen.NumberRuleResponse;
import com.xingchen.oa.office.dto.gongwen.OpinionRequest;
import com.xingchen.oa.office.dto.gongwen.ReadReceiptRequest;
import com.xingchen.oa.office.dto.gongwen.RecvRegisterRequest;
import com.xingchen.oa.office.dto.gongwen.RenderResponse;
import com.xingchen.oa.office.dto.gongwen.SealRequest;
import com.xingchen.oa.office.dto.gongwen.SendDraftRequest;
import com.xingchen.oa.office.dto.gongwen.TemplateResponse;
import com.xingchen.oa.office.service.GongwenService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

/**
 * 中国式公文高级办文 API（前缀 /api/office/doc）。envelope/分页遵循项目约定。
 * 权限码：office:doc:send/review/issue/seal/recv/assign/archive/number。
 */
@RestController
@RequestMapping("/api/office/doc")
@RequiredArgsConstructor
public class GongwenController {

    private final GongwenService gongwenService;

    // ---------- 发文 / 收文 起单 ----------

    @PostMapping("/send/draft")
    @PreAuthorize("hasAuthority('office:doc:send')")
    public R<DocDetailResponse> draft(@Valid @RequestBody SendDraftRequest req) {
        return R.ok(gongwenService.draft(req));
    }

    @PostMapping("/recv/register")
    @PreAuthorize("hasAuthority('office:doc:recv')")
    public R<DocDetailResponse> register(@Valid @RequestBody RecvRegisterRequest req) {
        return R.ok(gongwenService.register(req));
    }

    // ---------- 详情 / 办理 ----------

    @GetMapping("/{id}")
    public R<DocDetailResponse> detail(@PathVariable Long id) {
        return R.ok(gongwenService.detail(id));
    }

    /** 提交办文意见并办理当前节点（同意/退回/转办，透传引擎）。节点权限在服务层按环节校验。 */
    @PostMapping("/{id}/opinion")
    public R<DocDetailResponse> opinion(@PathVariable Long id, @RequestBody OpinionRequest req) {
        return R.ok(gongwenService.opinion(id, req));
    }

    @PostMapping("/{id}/seal")
    @PreAuthorize("hasAuthority('office:doc:seal')")
    public R<DocDetailResponse> seal(@PathVariable Long id, @RequestBody(required = false) SealRequest req) {
        return R.ok(gongwenService.seal(id, req));
    }

    @PostMapping("/{id}/circulate")
    @PreAuthorize("hasAuthority('office:doc:assign')")
    public R<DocDetailResponse> circulate(@PathVariable Long id, @RequestBody CirculateRequest req) {
        return R.ok(gongwenService.circulate(id, req));
    }

    @PostMapping("/circulation/{cid}/read")
    public R<DocDetailResponse> read(@PathVariable Long cid, @RequestBody(required = false) ReadReceiptRequest req) {
        return R.ok(gongwenService.readReceipt(cid, req));
    }

    @PostMapping("/{id}/archive")
    @PreAuthorize("hasAuthority('office:doc:archive')")
    public R<DocDetailResponse> archive(@PathVariable Long id, @RequestBody(required = false) ArchiveRequest req) {
        return R.ok(gongwenService.archive(id, req));
    }

    /** 催办：对当前承办环节发催办提醒（走通知机制）。 */
    @PostMapping("/{id}/urge")
    public R<DocDetailResponse> urge(@PathVariable Long id) {
        return R.ok(gongwenService.urge(id));
    }

    // ---------- 列表 / 台账 / 归档检索 ----------

    @GetMapping("/list")
    public R<PageResult<GongwenListItem>> list(
            @RequestParam(required = false) String direction,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String docType,
            @RequestParam(required = false) String secret,
            @RequestParam(required = false) String urgency,
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        return R.ok(gongwenService.list(direction, status, docType, secret, urgency, keyword, from, to, pageNum, pageSize));
    }

    @GetMapping("/ledger")
    public R<PageResult<LedgerResponse>> ledger(
            @RequestParam(required = false) String year,
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) String status,
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "20") int pageSize) {
        return R.ok(gongwenService.ledger(year, keyword, status, pageNum, pageSize));
    }

    @GetMapping("/archive")
    public R<PageResult<GongwenListItem>> archiveList(
            @RequestParam(required = false) String direction,
            @RequestParam(required = false) String year,
            @RequestParam(required = false) String keyword,
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        return R.ok(gongwenService.archiveList(direction, year, keyword, pageNum, pageSize));
    }

    // ---------- 文号规则 / 预览 ----------

    @GetMapping("/number/rules")
    @PreAuthorize("hasAuthority('office:doc:number')")
    public R<List<NumberRuleResponse>> numberRules() {
        return R.ok(gongwenService.numberRules());
    }

    @PostMapping("/number/preview")
    public R<Map<String, String>> preview(@RequestBody NumberPreviewRequest req) {
        return R.ok(Map.of("number", gongwenService.previewNumber(req.ruleId(), req.docType())));
    }

    // ---------- 模板 / 红头正文渲染 ----------

    @GetMapping("/templates")
    public R<List<TemplateResponse>> templates() {
        return R.ok(gongwenService.templates());
    }

    @GetMapping("/templates/{id}")
    public R<TemplateResponse> template(@PathVariable Long id) {
        return R.ok(gongwenService.template(id));
    }

    /** 用公文数据渲染红头正文 HTML（.gw-typearea 内部片段，供预览/打印/PDF）。 */
    @PostMapping("/{id}/render")
    public R<RenderResponse> render(@PathVariable Long id) {
        return R.ok(gongwenService.render(id));
    }
}
