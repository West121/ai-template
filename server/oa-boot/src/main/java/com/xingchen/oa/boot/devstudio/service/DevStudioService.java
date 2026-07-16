package com.xingchen.oa.boot.devstudio.service;

import com.xingchen.oa.boot.devstudio.adapter.DevAssetAdapter;
import com.xingchen.oa.boot.devstudio.dto.DevStudioDtos.AssetContent;
import com.xingchen.oa.boot.devstudio.dto.DevStudioDtos.AssetNode;
import com.xingchen.oa.boot.devstudio.dto.DevStudioDtos.SaveRequest;
import com.xingchen.oa.boot.devstudio.dto.DevStudioDtos.SaveResponse;
import com.xingchen.oa.boot.devstudio.dto.DevStudioDtos.VersionDetail;
import com.xingchen.oa.boot.devstudio.dto.DevStudioDtos.VersionItem;
import com.xingchen.oa.boot.devstudio.entity.DevAssetVersion;
import com.xingchen.oa.boot.devstudio.repository.DevAssetVersionRepository;
import com.xingchen.oa.common.exception.BusinessException;
import com.xingchen.oa.common.security.CurrentUserHolder;
import com.xingchen.oa.common.security.UserContext;
import com.xingchen.oa.system.entity.SysUser;
import com.xingchen.oa.system.repository.SysUserRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Dev Studio 统一门面（docs/design/dev-studio.md 附录拍板；契约 docs/api-contract.md「Dev Studio」节）。
 *
 * <p>职责分层：适配器（{@link DevAssetAdapter}×4）只管读写与该资产生效语义（委派原生 Service，
 * 原校验/编译/部署照走）；本服务统一：
 * <ol>
 *   <li><b>权限双门</b>：端点 {@code @PreAuthorize dev:studio:*} 之外，落写前显式复验该资产
 *       原生受信写码（{@code orch:flow:write}/{@code wf:def:edit}/{@code bizdoc:def:write}），403 拒绝。
 *       （原生 @PreAuthorize 在各资产 Controller 层，Service 无注解——故第二道门由此处显式补上。）</li>
 *   <li><b>乐观锁</b>：PUT {@code baseVersion} 与当前快照 version_no 比对，冲突 409；
 *       并发写由 (asset_type, code, version_no) 唯一索引兜底，违约转 409。</li>
 *   <li><b>统一快照</b>：每次保存/发布/回滚落一行 {@code dev_asset_version}（actor USER|AI），
 *       四类 versions/rollback 统一读写此表（ORCH 原生 orch_flow_version 并存不冲突）。</li>
 * </ol>
 */
@Slf4j
@Service
public class DevStudioService {

    private final Map<String, DevAssetAdapter> adapters = new LinkedHashMap<>();
    private final DevAssetVersionRepository versionRepository;
    private final SysUserRepository userRepository;

    public DevStudioService(List<DevAssetAdapter> adapterList, DevAssetVersionRepository versionRepository,
                            SysUserRepository userRepository) {
        for (DevAssetAdapter a : adapterList) {
            adapters.put(a.type(), a);
        }
        this.versionRepository = versionRepository;
        this.userRepository = userRepository;
    }

    // ==================== 读 ====================

    /** 资产树（四类平铺；type 定序按适配器注册序）。 */
    public List<AssetNode> listAssets() {
        List<AssetNode> out = new ArrayList<>();
        for (DevAssetAdapter a : adapters.values()) {
            out.addAll(a.list());
        }
        return out;
    }

    /** 读内容：content + version（Dev Studio 快照版本，乐观锁基准；未经工作台改过=0）+ meta。 */
    public AssetContent read(String type, String code) {
        DevAssetAdapter adapter = resolve(type);
        AssetContent raw = adapter.read(code);
        return new AssetContent(raw.type(), raw.code(), raw.content(), currentVersion(adapter.type(), code), raw.meta());
    }

    // ==================== 写（保存草稿 / 发布） ====================

    /**
     * 统一保存：乐观锁 → 双门 → 适配器委派（原生校验/编译/部署照走）→ 落快照。
     * publish=false 存草稿不生效；true 按该资产语义生效。整体一个事务：任一环节失败全部回滚。
     */
    @Transactional
    public SaveResponse save(String type, String code, SaveRequest req, String actor) {
        DevAssetAdapter adapter = resolve(type);
        if (req == null || !StringUtils.hasText(req.content())) {
            throw new BusinessException(400, "content 必填");
        }
        requireWriteDoors(adapter);
        int current = currentVersion(adapter.type(), code);
        if (req.baseVersion() != null && req.baseVersion() != current) {
            throw new BusinessException(409, "版本冲突：当前已是 v" + current + "，你基于 v" + req.baseVersion()
                    + "。请刷新后重试");
        }
        boolean publish = Boolean.TRUE.equals(req.publish());
        Map<String, Object> meta = adapter.save(code, req.content(), publish);
        String summary = StringUtils.hasText(req.summary()) ? req.summary()
                : (publish ? "发布" : "保存草稿");
        int next = snapshot(adapter.type(), code, current + 1, req.content(), actor, summary);
        return new SaveResponse(next, meta);
    }

    // ==================== 版本 / 回滚（统一读写 dev_asset_version） ====================

    public List<VersionItem> versions(String type, String code) {
        DevAssetAdapter adapter = resolve(type);
        List<DevAssetVersion> rows = versionRepository
                .findByAssetTypeAndCodeOrderByVersionNoDesc(adapter.type(), code);
        Map<Long, String> names = actorNames(rows);
        List<VersionItem> out = new ArrayList<>();
        for (DevAssetVersion v : rows) {
            out.add(new VersionItem(v.getVersionNo(), v.getActor(), v.getActorId(),
                    names.get(v.getActorId()), v.getSummary(), v.getCreatedAt()));
        }
        return out;
    }

    public VersionDetail versionDetail(String type, String code, Integer versionNo) {
        DevAssetAdapter adapter = resolve(type);
        DevAssetVersion v = versionRepository
                .findByAssetTypeAndCodeAndVersionNo(adapter.type(), code, versionNo)
                .orElseThrow(() -> new BusinessException(404, "快照版本不存在: v" + versionNo));
        String actorName = v.getActorId() == null ? null
                : userRepository.findById(v.getActorId()).map(SysUser::getName).orElse(null);
        return new VersionDetail(v.getVersionNo(), v.getContent(), v.getActor(), v.getActorId(),
                actorName, v.getSummary(), v.getCreatedAt());
    }

    /** actorId → 姓名（批量解析，缺省不阻断）。 */
    private Map<Long, String> actorNames(List<DevAssetVersion> rows) {
        List<Long> ids = rows.stream().map(DevAssetVersion::getActorId)
                .filter(java.util.Objects::nonNull).distinct().toList();
        Map<Long, String> names = new LinkedHashMap<>();
        if (!ids.isEmpty()) {
            for (SysUser u : userRepository.findAllById(ids)) {
                names.put(u.getId(), u.getName());
            }
        }
        return names;
    }

    /**
     * 回滚：取快照内容 → 该资产「覆盖 + 重走发布链」（ORCH update+publish=原生回滚同义、
     * FORM 旧 schema 建新版并发布、PROCESS 干跑+重部署、BIZDOC_TPL 覆盖+version+1）→ 落新快照（历史不改写）。
     */
    @Transactional
    public SaveResponse rollback(String type, String code, Integer versionNo, String actor) {
        DevAssetAdapter adapter = resolve(type);
        requireWriteDoors(adapter);
        DevAssetVersion snap = versionRepository
                .findByAssetTypeAndCodeAndVersionNo(adapter.type(), code, versionNo)
                .orElseThrow(() -> new BusinessException(404, "快照版本不存在: v" + versionNo));
        if (!StringUtils.hasText(snap.getContent())) {
            throw new BusinessException(400, "该快照无内容，无法回滚");
        }
        int current = currentVersion(adapter.type(), code);
        Map<String, Object> meta = adapter.save(code, snap.getContent(), true);
        int next = snapshot(adapter.type(), code, current + 1, snap.getContent(), actor, "回滚自 v" + versionNo);
        return new SaveResponse(next, meta);
    }

    // ==================== 供 AI 工具复用（批W2） ====================

    /** 内容干跑校验（不落库）：JSON 解析 / PROCESS 转换干跑；失败抛 400。propose 阶段预检用。 */
    public void validateContent(String type, String code, String content) {
        if (!StringUtils.hasText(content)) {
            throw new BusinessException(400, "content 必填");
        }
        resolve(type).validate(code, content);
    }

    /** 该资产原生受信写码（AI 工具 propose 阶段预检第二道门用）。 */
    public String writeAuthority(String type) {
        return resolve(type).writeAuthority();
    }

    // ==================== 内部 ====================

    private DevAssetAdapter resolve(String type) {
        DevAssetAdapter a = type == null ? null : adapters.get(type.trim().toUpperCase());
        if (a == null) {
            throw new BusinessException(400, "未知资产类型: " + type + "（支持 " + String.join("/", adapters.keySet()) + "）");
        }
        return a;
    }

    /** 落写双门第二道：显式复验该资产原生受信写码（第一道 dev:studio:edit 在端点 @PreAuthorize）。 */
    private void requireWriteDoors(DevAssetAdapter adapter) {
        String required = adapter.writeAuthority();
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        boolean ok = auth != null && auth.getAuthorities() != null && auth.getAuthorities().stream()
                .anyMatch(g -> required.equals(g.getAuthority()));
        if (!ok) {
            throw new BusinessException(403, "缺少该资产写权限: " + required);
        }
    }

    private int currentVersion(String type, String code) {
        return versionRepository.findTopByAssetTypeAndCodeOrderByVersionNoDesc(type, code)
                .map(DevAssetVersion::getVersionNo).orElse(0);
    }

    /** 落快照；唯一索引违约（并发同号）→ 409。 */
    private int snapshot(String type, String code, int versionNo, String content, String actor, String summary) {
        DevAssetVersion v = new DevAssetVersion();
        v.setAssetType(type);
        v.setCode(code);
        v.setVersionNo(versionNo);
        v.setContent(content);
        v.setActor(StringUtils.hasText(actor) ? actor : DevAssetVersion.ACTOR_USER);
        UserContext u = CurrentUserHolder.get();
        v.setActorId(u != null ? u.getUserId() : null);
        v.setSummary(summary != null && summary.length() > 255 ? summary.substring(0, 255) : summary);
        try {
            versionRepository.saveAndFlush(v);
        } catch (DataIntegrityViolationException e) {
            throw new BusinessException(409, "并发写冲突（快照 v" + versionNo + " 已被占用），请刷新重试");
        }
        return versionNo;
    }
}
