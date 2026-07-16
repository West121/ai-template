package com.hentor.oa.common.core;

import lombok.Getter;

import java.util.ArrayList;
import java.util.List;

/**
 * 批量操作统一结果（拍板协议）：{@code {successIds:number[], failed:[{id,reason}]}}。
 *
 * <p>语义约定：
 * <ul>
 *   <li><b>部分失败逐条返回，不整体回滚</b>——每条 id 独立校验/执行，失败仅记入 {@link #failed}，
 *       成功记入 {@link #successIds}，互不影响；</li>
 *   <li><b>幂等</b>——已删除/不存在的 id 由调用方按语义计入 success（删除类）或 failed（更新类）；</li>
 *   <li>前端据此汇总「成功 N / 失败 M」并可展开失败明细（每条 {@code {id, reason}}）。</li>
 * </ul>
 *
 * <p>作为 {@link PageResult} 的同级响应型别，供各模块批量接口复用。
 */
@Getter
public class BatchResult {

    private final List<Long> successIds = new ArrayList<>();

    private final List<Failed> failed = new ArrayList<>();

    /** 记一条成功。 */
    public void success(Long id) {
        successIds.add(id);
    }

    /** 记一条失败，附带业务原因（展示给操作者，如「不能删除当前登录用户」）。 */
    public void fail(Long id, String reason) {
        failed.add(new Failed(id, reason));
    }

    /** 单条失败明细。 */
    public record Failed(Long id, String reason) {
    }
}
