package com.xingchen.oa.system.datadim;

import com.xingchen.oa.common.exception.BusinessException;
import com.xingchen.oa.common.security.CurrentUserHolder;
import com.xingchen.oa.common.security.UserContext;
import com.xingchen.oa.system.entity.SysDataDimension;
import com.xingchen.oa.system.entity.SysRole;
import com.xingchen.oa.system.entity.SysRoleDataDimension;
import com.xingchen.oa.system.entity.SysUserAssignment;
import com.xingchen.oa.system.entity.SysUserDataDimension;
import com.xingchen.oa.system.repository.SysDataDimensionRepository;
import com.xingchen.oa.system.repository.SysRoleDataDimensionRepository;
import com.xingchen.oa.system.repository.SysUserAssignmentRepository;
import com.xingchen.oa.system.repository.SysUserDataDimensionRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 数据权限「多维」框架服务（DP1）：维度注册（配置化）+ 角色/用户维度授权读写 + <b>当前用户各维可见范围解析</b>。
 *
 * <p><b>解析语义</b>（{@link #resolveForCurrentUser}）：某维度上，取该用户全部角色配置 + 用户级配置的并集——
 * 任一为 ALL（或该维无任何配置）→ 不限；否则（全 CUSTOM）→ 各值集并集（RBAC 加法：多角色更宽）。
 * 未注册维度不参与。内建 dept/self 不走本框架（仍由既有 role.dataScope → JWT DataScope 处理，向后兼容）。
 *
 * <p><b>性能（DP1a）</b>：每用户各维可见 id 集<b>预计算并缓存到 Redis</b>（{@code dp:dims:{userId}}，TTL + 主动失效），
 * 查询侧直接取集拼 {@code col IN (:集)}，不 join 授权表。失效钩子：角色/用户授权变更、任职变更即精准 evict。
 * <b>DP1b（性能深水区，TODO）</b>：登录即预热、部门子树闭包表/物化路径替代递归、超大集 {@code = ANY(array)}、
 * 声明式分区；基准 千万行 P95&lt;200ms / 失效&lt;1s。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class DataDimensionService {

    private static final String CACHE_PREFIX = "dp:dims:";
    private static final Duration CACHE_TTL = Duration.ofMinutes(30);

    private final SysDataDimensionRepository dimensionRepository;
    private final SysRoleDataDimensionRepository roleDimRepository;
    private final SysUserDataDimensionRepository userDimRepository;
    private final SysUserAssignmentRepository assignmentRepository;
    private final List<DataDimensionProvider> providers;
    private final StringRedisTemplate redis;
    private final ObjectMapper objectMapper;

    // ==================== 注册 / 元数据 / options ====================

    /** 已注册（启用）业务维度（不含内建 dept/self）。 */
    @Transactional(readOnly = true)
    public List<DimensionInfo> listDimensions() {
        return dimensionRepository.findByEnabledTrueOrderByCodeAsc().stream()
                .map(d -> new DimensionInfo(d.getCode(), d.getLabel(), d.getEntity(), Boolean.TRUE.equals(d.getEnabled())))
                .toList();
    }

    /** 某维度 CUSTOM 可选值（泛化端点，委托 provider）。维度须已注册启用，否则 400（白名单红线）。 */
    @Transactional(readOnly = true)
    public List<DimensionOption> options(String code) {
        requireRegistered(code);
        DataDimensionProvider provider = providerOf(code);
        if (provider == null) {
            return List.of();
        }
        return provider.options();
    }

    private Set<String> registeredCodes() {
        return dimensionRepository.findByEnabledTrueOrderByCodeAsc().stream()
                .map(SysDataDimension::getCode)
                .collect(java.util.stream.Collectors.toSet());
    }

    private void requireRegistered(String code) {
        if (!registeredCodes().contains(code)) {
            throw new BusinessException(400, "未注册或未启用的数据维度: " + code);
        }
    }

    private DataDimensionProvider providerOf(String code) {
        return providers.stream().filter(p -> p.code().equals(code)).findFirst().orElse(null);
    }

    // ==================== 角色 / 用户 维度授权读写 ====================

    @Transactional(readOnly = true)
    public List<DimensionConfigItem> roleConfig(Long roleId) {
        return roleDimRepository.findByRoleId(roleId).stream()
                .map(c -> new DimensionConfigItem(c.getDimension(), c.getScope(), sorted(c.getValues())))
                .toList();
    }

    /** 全量替换角色维度授权。校验维度白名单 + scope + CUSTOM 取值合法。失效该角色全部持有者缓存。 */
    @Transactional
    public void saveRoleConfig(Long roleId, List<DimensionConfigItem> items) {
        validateItems(items);
        // 全量替换：先删已有并 flush（否则 Hibernate 同事务「先 INSERT 后 DELETE」与 uk_role_data_dim 冲突），
        // deleteAll 走实体删除以级联清理 @ElementCollection 值表。
        roleDimRepository.deleteAll(roleDimRepository.findByRoleId(roleId));
        roleDimRepository.flush();
        for (DimensionConfigItem item : normalize(items)) {
            SysRoleDataDimension c = new SysRoleDataDimension();
            c.setRoleId(roleId);
            c.setDimension(item.dimension());
            c.setScope(item.scope());
            c.setValues(new HashSet<>(item.values()));
            roleDimRepository.save(c);
        }
        evictRole(roleId);
    }

    @Transactional(readOnly = true)
    public List<DimensionConfigItem> userConfig(Long userId) {
        return userDimRepository.findByUserId(userId).stream()
                .map(c -> new DimensionConfigItem(c.getDimension(), c.getScope(), sorted(c.getValues())))
                .toList();
    }

    /** 全量替换用户维度授权。失效该用户缓存。 */
    @Transactional
    public void saveUserConfig(Long userId, List<DimensionConfigItem> items) {
        validateItems(items);
        // 全量替换：先删已有并 flush（同 saveRoleConfig，避免 uk_user_data_dim 冲突 + 级联清 @ElementCollection 值表）
        userDimRepository.deleteAll(userDimRepository.findByUserId(userId));
        userDimRepository.flush();
        for (DimensionConfigItem item : normalize(items)) {
            SysUserDataDimension c = new SysUserDataDimension();
            c.setUserId(userId);
            c.setDimension(item.dimension());
            c.setScope(item.scope());
            c.setValues(new HashSet<>(item.values()));
            userDimRepository.save(c);
        }
        evictUser(userId);
    }

    /** 校验：维度须注册启用（白名单）；scope∈{ALL,CUSTOM}；CUSTOM 取值须为该维 provider 合法 id（范围校验）。 */
    private void validateItems(List<DimensionConfigItem> items) {
        if (items == null) {
            return;
        }
        Set<String> registered = registeredCodes();
        for (DimensionConfigItem item : items) {
            if (item.dimension() == null || !registered.contains(item.dimension())) {
                throw new BusinessException(400, "未注册或未启用的数据维度: " + item.dimension());
            }
            String scope = item.scope();
            if (!SysDataDimension.SCOPE_ALL.equals(scope) && !SysDataDimension.SCOPE_CUSTOM.equals(scope)) {
                throw new BusinessException(400, "非法的维度范围(仅 ALL/CUSTOM): " + scope);
            }
            if (SysDataDimension.SCOPE_CUSTOM.equals(scope)) {
                List<Long> values = item.values() == null ? List.of() : item.values();
                DataDimensionProvider provider = providerOf(item.dimension());
                if (provider != null) {
                    Set<Long> validIds = new HashSet<>();
                    provider.options().forEach(o -> validIds.add(o.id()));
                    for (Long v : values) {
                        if (v == null || !validIds.contains(v)) {
                            throw new BusinessException(400, "维度[" + item.dimension() + "]存在非法取值: " + v);
                        }
                    }
                }
            }
        }
    }

    /** 归一：同维度只保留一条（后者覆盖），CUSTOM 时 values 去空。 */
    private List<DimensionConfigItem> normalize(List<DimensionConfigItem> items) {
        Map<String, DimensionConfigItem> byDim = new HashMap<>();
        for (DimensionConfigItem item : items == null ? List.<DimensionConfigItem>of() : items) {
            List<Long> values = SysDataDimension.SCOPE_CUSTOM.equals(item.scope())
                    ? (item.values() == null ? List.of() : item.values().stream().filter(java.util.Objects::nonNull).distinct().toList())
                    : List.of();
            byDim.put(item.dimension(), new DimensionConfigItem(item.dimension(), item.scope(), values));
        }
        return new ArrayList<>(byDim.values());
    }

    // ==================== 当前用户各维可见范围解析（查询侧调用） ====================

    /**
     * 解析当前用户在给定维度集合上的可见范围（供多维 Specification 拼谓词）。
     * 未配置维度返回 {@link DimensionScope#unlimited()}（不限）。走 Redis 预计算缓存。
     */
    public Map<String, DimensionScope> resolveForCurrentUser(Set<String> codes) {
        UserContext ctx = CurrentUserHolder.get();
        if (ctx == null || ctx.getUserId() == null || codes == null || codes.isEmpty()) {
            return Map.of();
        }
        Map<String, DimensionScope> all = cachedScopes(ctx.getUserId());
        Map<String, DimensionScope> out = new HashMap<>();
        for (String code : codes) {
            out.put(code, all.getOrDefault(code, DimensionScope.unlimited()));
        }
        return out;
    }

    /** 取用户各维范围（Redis 命中直取；未命中现算并回填；Redis 故障降级为直算，不影响正确性）。 */
    private Map<String, DimensionScope> cachedScopes(Long userId) {
        String key = CACHE_PREFIX + userId;
        try {
            String json = redis.opsForValue().get(key);
            if (json != null) {
                return deserialize(json);
            }
        } catch (Exception e) {
            log.warn("DP 维度缓存读取失败(降级直算) user={}: {}", userId, e.getMessage());
        }
        Map<String, DimensionScope> computed = computeAllScopes(userId);
        try {
            redis.opsForValue().set(key, serialize(computed), CACHE_TTL);
        } catch (Exception e) {
            log.warn("DP 维度缓存写入失败(忽略) user={}: {}", userId, e.getMessage());
        }
        return computed;
    }

    /** 现算：角色配置 + 用户配置按维度并集（任一 ALL → 不限；否则 CUSTOM 值并集）。 */
    private Map<String, DimensionScope> computeAllScopes(Long userId) {
        Set<Long> roleIds = new LinkedHashSet<>();
        for (SysUserAssignment a : assignmentRepository.findByUserIdAndEnabledTrueOrderByPrimaryFlagDescIdAsc(userId)) {
            for (SysRole r : a.getRoles()) {
                if (!Boolean.FALSE.equals(r.getEnabled())) {
                    roleIds.add(r.getId());
                }
            }
        }
        // 维度 -> {anyAll, unionValues}
        Map<String, boolean[]> anyAll = new HashMap<>();
        Map<String, Set<Long>> union = new HashMap<>();
        List<SysRoleDataDimension> roleCfgs = roleIds.isEmpty() ? List.of() : roleDimRepository.findByRoleIdIn(roleIds);
        for (SysRoleDataDimension c : roleCfgs) {
            accumulate(anyAll, union, c.getDimension(), c.getScope(), c.getValues());
        }
        for (SysUserDataDimension c : userDimRepository.findByUserId(userId)) {
            accumulate(anyAll, union, c.getDimension(), c.getScope(), c.getValues());
        }
        Map<String, DimensionScope> out = new HashMap<>();
        for (String dim : union.keySet()) {
            boolean[] all = anyAll.get(dim);
            out.put(dim, (all != null && all[0]) ? DimensionScope.unlimited() : DimensionScope.custom(union.get(dim)));
        }
        return out;
    }

    private void accumulate(Map<String, boolean[]> anyAll, Map<String, Set<Long>> union,
                            String dim, String scope, Set<Long> values) {
        anyAll.computeIfAbsent(dim, k -> new boolean[]{false});
        union.computeIfAbsent(dim, k -> new HashSet<>());
        if (SysDataDimension.SCOPE_ALL.equals(scope)) {
            anyAll.get(dim)[0] = true;
        } else if (values != null) {
            union.get(dim).addAll(values);
        }
    }

    // ==================== 失效钩子 ====================

    /**
     * DP1b 登录即预热：强制重算并写入该用户各维可见范围缓存，使登录后首个受权限约束的查询直接命中，
     * 不冷启动。Redis 故障忽略（下次查询懒加载兜底）。
     */
    public void prewarm(Long userId) {
        if (userId == null) {
            return;
        }
        try {
            redis.opsForValue().set(CACHE_PREFIX + userId, serialize(computeAllScopes(userId)), CACHE_TTL);
        } catch (Exception e) {
            log.warn("DP 维度缓存预热失败(忽略) user={}: {}", userId, e.getMessage());
        }
    }

    /** 精准失效单个用户可见范围缓存（授权/任职变更 <1s 生效）。 */
    public void evictUser(Long userId) {
        if (userId == null) {
            return;
        }
        try {
            redis.delete(CACHE_PREFIX + userId);
        } catch (Exception e) {
            log.warn("DP 维度缓存失效失败 user={}: {}", userId, e.getMessage());
        }
    }

    /** 角色授权变更：失效该角色全部持有者缓存。 */
    public void evictRole(Long roleId) {
        for (Long uid : assignmentRepository.findUserIdsByRoleId(roleId)) {
            evictUser(uid);
        }
    }

    // ==================== Redis 序列化 ====================

    private String serialize(Map<String, DimensionScope> scopes) {
        ObjectNode root = objectMapper.createObjectNode();
        scopes.forEach((code, s) -> {
            ObjectNode node = root.putObject(code);
            node.put("unlimited", s.all());
            ArrayNode arr = node.putArray("values");
            s.values().forEach(arr::add);
        });
        return root.toString();
    }

    private Map<String, DimensionScope> deserialize(String json) {
        Map<String, DimensionScope> out = new HashMap<>();
        JsonNode root = objectMapper.readTree(json);
        root.properties().forEach(e -> {
            JsonNode n = e.getValue();
            boolean unlimited = n.path("unlimited").asBoolean(true);
            Set<Long> values = new HashSet<>();
            n.path("values").forEach(v -> values.add(v.asLong()));
            out.put(e.getKey(), unlimited ? DimensionScope.unlimited() : DimensionScope.custom(values));
        });
        return out;
    }

    private static List<Long> sorted(Set<Long> values) {
        return values == null ? List.of() : values.stream().sorted().toList();
    }
}
