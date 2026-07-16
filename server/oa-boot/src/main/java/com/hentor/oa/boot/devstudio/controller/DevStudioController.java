package com.hentor.oa.boot.devstudio.controller;

import com.hentor.oa.boot.devstudio.dto.DevStudioDtos.AssetContent;
import com.hentor.oa.boot.devstudio.dto.DevStudioDtos.AssetNode;
import com.hentor.oa.boot.devstudio.dto.DevStudioDtos.RollbackRequest;
import com.hentor.oa.boot.devstudio.dto.DevStudioDtos.SaveRequest;
import com.hentor.oa.boot.devstudio.dto.DevStudioDtos.SaveResponse;
import com.hentor.oa.boot.devstudio.dto.DevStudioDtos.VersionDetail;
import com.hentor.oa.boot.devstudio.dto.DevStudioDtos.VersionItem;
import com.hentor.oa.boot.devstudio.entity.DevAssetVersion;
import com.hentor.oa.boot.devstudio.service.DevStudioService;
import com.hentor.oa.common.core.R;
import com.hentor.oa.common.exception.BusinessException;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * Dev Studio 统一资产门面（/api/dev-studio/assets*，dev-studio.md 附录拍板 7/8）。
 *
 * <p>权限：读 {@code dev:studio:view}，写 {@code dev:studio:edit}（第一道门）；
 * 落写在 {@link DevStudioService} 内再验各资产原生受信写码（第二道门）。
 * type ∈ ORCH | PROCESS | FORM | BIZDOC_TPL（大小写不敏感，未知 400）。
 */
@RestController
@RequestMapping("/api/dev-studio/assets")
@RequiredArgsConstructor
public class DevStudioController {

    private final DevStudioService service;

    /** 资产树：[{type,code,name,status,version(原生),updatedAt}]。 */
    @GetMapping
    @PreAuthorize("hasAuthority('dev:studio:view')")
    public R<List<AssetNode>> list() {
        return R.ok(service.listAssets());
    }

    /** 内容：{content, version(快照版本=乐观锁基准，未改过=0), meta{nativeVersion,...}}。 */
    @GetMapping("/{type}/{code}")
    @PreAuthorize("hasAuthority('dev:studio:view')")
    public R<AssetContent> read(@PathVariable String type, @PathVariable String code) {
        return R.ok(service.read(type, code));
    }

    /**
     * 统一保存：{content, baseVersion?, publish?, summary?} → {version(新快照), meta}。
     * baseVersion 冲突 409；publish=true 按资产语义生效（PROCESS 先干跑校验，坏内容 400 不落库）。
     */
    @PutMapping("/{type}/{code}")
    @PreAuthorize("hasAuthority('dev:studio:edit')")
    public R<SaveResponse> save(@PathVariable String type, @PathVariable String code,
                                @RequestBody SaveRequest req) {
        return R.ok(service.save(type, code, req, DevAssetVersion.ACTOR_USER));
    }

    /** 快照版本列表（四类统一读 dev_asset_version；不含 content）。 */
    @GetMapping("/{type}/{code}/versions")
    @PreAuthorize("hasAuthority('dev:studio:view')")
    public R<List<VersionItem>> versions(@PathVariable String type, @PathVariable String code) {
        return R.ok(service.versions(type, code));
    }

    /** 快照版本详情（含 content，供查看/对比）。 */
    @GetMapping("/{type}/{code}/versions/{versionNo}")
    @PreAuthorize("hasAuthority('dev:studio:view')")
    public R<VersionDetail> versionDetail(@PathVariable String type, @PathVariable String code,
                                          @PathVariable Integer versionNo) {
        return R.ok(service.versionDetail(type, code, versionNo));
    }

    /** 回滚：{versionNo}（兼容 {version}）→ 以该快照内容覆盖并重走发布链，产生新快照（历史不改写）。 */
    @PostMapping("/{type}/{code}/rollback")
    @PreAuthorize("hasAuthority('dev:studio:edit')")
    public R<SaveResponse> rollback(@PathVariable String type, @PathVariable String code,
                                    @RequestBody RollbackRequest req) {
        if (req == null || req.target() == null) {
            throw new BusinessException(400, "缺少回滚目标 versionNo");
        }
        return R.ok(service.rollback(type, code, req.target(), DevAssetVersion.ACTOR_USER));
    }
}
