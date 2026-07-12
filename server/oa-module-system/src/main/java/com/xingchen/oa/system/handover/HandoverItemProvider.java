package com.xingchen.oa.system.handover;

import com.xingchen.oa.system.entity.SysHandoverItem;

import java.util.List;

/**
 * 交接项处理器（可插拔 SPI，DP2）。每类交接对象（待办/部门负责人/知识库空间…）实现一个 provider bean，
 * 负责<b>扫描</b>某用户名下该类归属 + <b>幂等执行</b>交接。
 *
 * <p>与 DataDimensionProvider 同思路：provider 可存在任意业务模块（业务模块单向依赖 oa-module-system，
 * 故可实现本接口）；{@code HandoverService}（system）注入 {@code List<HandoverItemProvider>} 按 itemType 分发，
 * <b>不反向依赖业务模块</b>（system 定义 SPI，workflow/office 实现）。
 */
public interface HandoverItemProvider {

    /** 交接项类型（WF_TASK / DEPT_LEADER / …），与 {@link SysHandoverItem#getItemType()} 对应。 */
    String itemType();

    /** 扫描该用户名下待交接项（离职触发时调用）。 */
    List<HandoverScan> scan(Long fromUserId);

    /**
     * 执行单项交接（幂等：重复执行/已交接不报错）；失败抛异常，由 HandoverService 计入 failed 供重试。
     *
     * @param successorId 继任者（item 级覆盖或交接单默认）
     */
    void execute(SysHandoverItem item, Long successorId);
}
