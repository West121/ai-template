package com.hentor.oa.system.fieldperm;

import com.hentor.oa.common.exception.BusinessException;
import com.hentor.oa.common.security.CurrentUserHolder;
import com.hentor.oa.common.security.UserContext;
import com.hentor.oa.system.datadim.DataDimensionService;
import com.hentor.oa.system.entity.SysRole;
import com.hentor.oa.system.entity.SysRoleFieldPerm;
import com.hentor.oa.system.entity.SysUserAssignment;
import com.hentor.oa.system.repository.SysRoleFieldPermRepository;
import com.hentor.oa.system.repository.SysUserAssignmentRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

import java.time.Duration;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 角色×功能 字段权限（权限中心 P3，V52）：配置读写 + 当前用户合并解析 + 出口脱敏/入口 editable 强制。
 *
 * <p><b>解析语义</b>：多角色<b>并集放宽</b>（任一角色 visible/editable=true 即放行，与数据维度 RBAC 加法一致）；
 * (user, feature) <b>未配置任何行 = 全可见全可编</b>（向后兼容红线，mine 返回空 map，出口零过滤）。
 * 配置了行的字段按行合并；未配置行的字段不入 map（=不受限）。
 *
 * <p><b>缓存</b>：{@code dp:fields:{userId}}（全 feature 一把，TTL 30min）。失效复用 dp 家族钩子——
 * {@link DataDimensionService#evictUser} 同时删本 key（任职变更/离职交接/授权变更全部现成覆盖）；
 * 角色字段配置保存 → {@link DataDimensionService#evictRole}（按持有者逐个失效两把 key）。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class FieldPermService {

    /** 缓存 key 前缀（dp 家族；由 DataDimensionService.evictUser 连带失效）。 */
    public static final String CACHE_PREFIX = "dp:fields:";
    private static final Duration CACHE_TTL = Duration.ofMinutes(30);

    private final SysRoleFieldPermRepository repository;
    private final SysUserAssignmentRepository assignmentRepository;
    private final DataDimensionService dataDimensionService;
    private final StringRedisTemplate redis;
    private final ObjectMapper objectMapper;

    // ==================== 角色配置读写 ====================

    @Transactional(readOnly = true)
    public List<FieldPermItem> roleConfig(Long roleId, String feature) {
        List<SysRoleFieldPerm> rows = StringUtils.hasText(feature)
                ? repository.findByRoleIdAndFeatureOrderByFieldAsc(roleId, feature)
                : repository.findByRoleIdOrderByFeatureAscFieldAsc(roleId);
        return rows.stream().map(r -> new FieldPermItem(r.getFeature(), r.getField(),
                Boolean.TRUE.equals(r.getVisible()), Boolean.TRUE.equals(r.getEditable()))).toList();
    }

    /** 按 feature 全量替换。editable=true 而 visible=false 为非法组合（不可见不可编）。 */
    @Transactional
    public void saveRoleConfig(Long roleId, String feature, List<FieldPermItem> items) {
        if (!StringUtils.hasText(feature)) {
            throw new BusinessException(400, "feature 必填");
        }
        Map<String, FieldPermItem> byField = new LinkedHashMap<>();
        for (FieldPermItem item : items == null ? List.<FieldPermItem>of() : items) {
            if (item == null || !StringUtils.hasText(item.field())) {
                throw new BusinessException(400, "field 必填");
            }
            if (item.editable() && !item.visible()) {
                throw new BusinessException(400, "非法组合：不可见字段不能可编辑（field=" + item.field() + "）");
            }
            byField.put(item.field().trim(), item); // 同 field 后者覆盖
        }
        repository.deleteByRoleIdAndFeature(roleId, feature);
        repository.flush();
        for (FieldPermItem item : byField.values()) {
            SysRoleFieldPerm row = new SysRoleFieldPerm();
            row.setRoleId(roleId);
            row.setFeature(feature);
            row.setField(item.field().trim());
            row.setVisible(item.visible());
            row.setEditable(item.editable());
            repository.save(row);
        }
        // 失效该角色全部持有者（连带 dp:dims 一起清，代价可接受、语义安全）
        dataDimensionService.evictRole(roleId);
    }

    // ==================== 当前用户合并解析（mine / 出口消费） ====================

    /** 当前用户在某 feature 的字段权限 map（仅含被配置的字段；空 map=全可见全可编）。 */
    public Map<String, FieldPermState> resolveForCurrentUser(String feature) {
        UserContext ctx = CurrentUserHolder.get();
        if (ctx == null || ctx.getUserId() == null || !StringUtils.hasText(feature)) {
            return Map.of();
        }
        return cachedAll(ctx.getUserId()).getOrDefault(feature, Map.of());
    }

    /** 当前用户某 feature 下 visible=false 的字段集（DTO 固定列脱敏用）。 */
    public Set<String> invisibleFields(String feature) {
        Set<String> out = new HashSet<>();
        resolveForCurrentUser(feature).forEach((f, s) -> {
            if (!s.visible()) {
                out.add(f);
            }
        });
        return out;
    }

    /**
     * 出口脱敏：删除 visible=false 的 key（动态表单 Map，前后端同键零转换）。
     * 无配置/无命中原样返回；入参不可变时返回新 Map。
     */
    public Map<String, Object> filterInvisible(String feature, Map<String, Object> data) {
        if (data == null || data.isEmpty()) {
            return data;
        }
        Map<String, FieldPermState> perms = resolveForCurrentUser(feature);
        if (perms.isEmpty()) {
            return data;
        }
        Map<String, Object> out = new LinkedHashMap<>(data);
        perms.forEach((field, s) -> {
            if (!s.visible()) {
                out.remove(field);
            }
        });
        return out;
    }

    /**
     * 入口 editable 强制（拍板：后端权威）：editable=false 的字段丢弃回传值——
     * 旧值存在则还原旧值，否则整键不写。visible=false 隐含不可编辑（同样丢弃）。
     */
    public Map<String, Object> dropNonEditable(String feature, Map<String, Object> incoming,
                                               Map<String, Object> oldValues) {
        if (incoming == null || incoming.isEmpty()) {
            return incoming;
        }
        Map<String, FieldPermState> perms = resolveForCurrentUser(feature);
        if (perms.isEmpty()) {
            return incoming;
        }
        Map<String, Object> out = new LinkedHashMap<>(incoming);
        perms.forEach((field, s) -> {
            if (!s.editable() || !s.visible()) {
                if (oldValues != null && oldValues.containsKey(field)) {
                    out.put(field, oldValues.get(field)); // 以旧值为准
                } else {
                    out.remove(field); // 无旧值 → 不写
                }
            }
        });
        return out;
    }

    // ==================== 缓存 ====================

    /** 用户全 feature 字段权限（Redis 命中直取；未命中现算回填；Redis 故障降级直算）。 */
    private Map<String, Map<String, FieldPermState>> cachedAll(Long userId) {
        String key = CACHE_PREFIX + userId;
        try {
            String json = redis.opsForValue().get(key);
            if (json != null) {
                return deserialize(json);
            }
        } catch (Exception e) {
            log.warn("字段权限缓存读取失败(降级直算) user={}: {}", userId, e.getMessage());
        }
        Map<String, Map<String, FieldPermState>> computed = computeAll(userId);
        try {
            redis.opsForValue().set(key, serialize(computed), CACHE_TTL);
        } catch (Exception e) {
            log.warn("字段权限缓存写入失败(忽略) user={}: {}", userId, e.getMessage());
        }
        return computed;
    }

    /** 现算：全部启用任职的启用角色行，按 (feature, field) 并集放宽。 */
    private Map<String, Map<String, FieldPermState>> computeAll(Long userId) {
        Set<Long> roleIds = new LinkedHashSet<>();
        for (SysUserAssignment a : assignmentRepository.findByUserIdAndEnabledTrueOrderByPrimaryFlagDescIdAsc(userId)) {
            for (SysRole r : a.getRoles()) {
                if (!Boolean.FALSE.equals(r.getEnabled())) {
                    roleIds.add(r.getId());
                }
            }
        }
        Map<String, Map<String, FieldPermState>> out = new LinkedHashMap<>();
        if (roleIds.isEmpty()) {
            return out;
        }
        for (SysRoleFieldPerm row : repository.findByRoleIdIn(roleIds)) {
            Map<String, FieldPermState> byField = out.computeIfAbsent(row.getFeature(), k -> new LinkedHashMap<>());
            FieldPermState prev = byField.get(row.getField());
            boolean visible = Boolean.TRUE.equals(row.getVisible()) || (prev != null && prev.visible());
            boolean editable = Boolean.TRUE.equals(row.getEditable()) || (prev != null && prev.editable());
            byField.put(row.getField(), new FieldPermState(visible, editable));
        }
        return out;
    }

    private String serialize(Map<String, Map<String, FieldPermState>> all) {
        ObjectNode root = objectMapper.createObjectNode();
        all.forEach((feature, fields) -> {
            ObjectNode f = root.putObject(feature);
            fields.forEach((field, s) -> f.putObject(field).put("v", s.visible()).put("e", s.editable()));
        });
        return root.toString();
    }

    private Map<String, Map<String, FieldPermState>> deserialize(String json) {
        Map<String, Map<String, FieldPermState>> out = new LinkedHashMap<>();
        JsonNode root = objectMapper.readTree(json);
        root.properties().forEach(fe -> {
            Map<String, FieldPermState> byField = new LinkedHashMap<>();
            fe.getValue().properties().forEach(fi -> byField.put(fi.getKey(),
                    new FieldPermState(fi.getValue().path("v").asBoolean(true),
                            fi.getValue().path("e").asBoolean(true))));
            out.put(fe.getKey(), byField);
        });
        return out;
    }
}
