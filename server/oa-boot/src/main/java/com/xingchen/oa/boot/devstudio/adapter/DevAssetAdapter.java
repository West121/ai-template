package com.xingchen.oa.boot.devstudio.adapter;

import com.xingchen.oa.boot.devstudio.dto.DevStudioDtos.AssetContent;
import com.xingchen.oa.boot.devstudio.dto.DevStudioDtos.AssetNode;

import java.util.List;
import java.util.Map;

/**
 * Dev Studio 资产适配器（薄委派层，dev-studio.md 附录拍板 7/8）。
 *
 * <p>红线：<b>只委派各资产既有 Service，不绕过其校验/编译/部署</b>——
 * ORCH 走 OrchFlowService（publish 编译 LiteFlow EL）、PROCESS 走 ProcessDefService
 * （publish 转 BPMN 部署引擎，且保存/发布前一律干跑转换校验，防坏 designerJson 阻塞启动）、
 * FORM 走 FormDefService（PUBLISHED 不可改 → 新版本 DRAFT）、BIZDOC_TPL 走 BizDocTplService。
 *
 * <p>快照/乐观锁/权限双门在 {@code DevStudioService} 统一处理，适配器只管读写与生效语义。
 */
public interface DevAssetAdapter {

    /** 资产类型枚举值（ORCH / PROCESS / FORM / BIZDOC_TPL）。 */
    String type();

    /** 落写第二道门：该资产原生受信写码（门面在委派前显式校验，403 拒绝）。 */
    String writeAuthority();

    /** 树列表（version=原生版本，展示用）。 */
    List<AssetNode> list();

    /** 读内容（version 置 null，由门面回填快照版本；meta 含 nativeVersion 等）。 */
    AssetContent read(String code);

    /**
     * 保存（publish=false 存草稿 / true 按该资产语义生效）。
     * 实现必须先做内容校验（JSON 解析 / PROCESS 干跑转换），失败抛 400 不落库。
     *
     * @return meta（nativeVersion / status / FORM latestPointerChanged 等，回给前端）
     */
    Map<String, Object> save(String code, String content, boolean publish);
}
