package com.hentor.oa.boot.devstudio.dto;

import java.time.OffsetDateTime;
import java.util.Map;

/**
 * Dev Studio 统一门面 DTO（契约 docs/api-contract.md「Dev Studio」节 / dev-studio.md 附录拍板 7）。
 *
 * <p><b>版本字段口径（两套版本空间，勿混）</b>：
 * <ul>
 *   <li>{@link AssetNode#version}：资产<b>原生</b>版本（orch version / form version / tpl version /
 *       Flowable 部署版本），树列表展示用；</li>
 *   <li>{@link AssetContent#version} / {@link SaveResponse#version} / {@code baseVersion}：
 *       Dev Studio <b>快照</b>版本（dev_asset_version.version_no，乐观锁基准；未经工作台改过 = 0）。
 *       原生版本恒在 {@code meta.nativeVersion}。</li>
 * </ul>
 */
public final class DevStudioDtos {

    private DevStudioDtos() {
    }

    /** 资产树节点。version=原生版本（展示）。 */
    public record AssetNode(String type, String code, String name, String status,
                            Integer version, OffsetDateTime updatedAt) {
    }

    /** 资产内容。version=Dev Studio 快照版本（乐观锁基准）；meta 含 nativeVersion 及类型旁路字段。 */
    public record AssetContent(String type, String code, String content,
                               Integer version, Map<String, Object> meta) {
    }

    /**
     * 统一保存。publish=false 只存草稿（不生效）；true 按该资产语义生效
     * （ORCH 编译 EL、PROCESS 干跑+部署、FORM 发布该版本、BIZDOC_TPL version+1）。
     * baseVersion 缺省跳过乐观锁比对。
     */
    public record SaveRequest(String content, Integer baseVersion, Boolean publish, String summary) {
    }

    /** version=新快照版本；meta 透传适配层（含 nativeVersion / status / FORM latestPointerChanged）。 */
    public record SaveResponse(Integer version, Map<String, Object> meta) {
    }

    /** 快照版本项（前端对账：字段名 versionNo；actorName 由 actorId 解析，可空）。 */
    public record VersionItem(Integer versionNo, String actor, Long actorId, String actorName,
                              String summary, OffsetDateTime createdAt) {
    }

    public record VersionDetail(Integer versionNo, String content, String actor, Long actorId,
                                String actorName, String summary, OffsetDateTime createdAt) {
    }

    /** 回滚目标：前端发 versionNo（兼容收 version，二者取其一）。 */
    public record RollbackRequest(Integer versionNo, Integer version) {

        public Integer target() {
            return versionNo != null ? versionNo : version;
        }
    }
}
