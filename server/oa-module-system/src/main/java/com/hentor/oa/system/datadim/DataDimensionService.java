package com.hentor.oa.system.datadim;

import com.hentor.oa.common.exception.BusinessException;
import com.hentor.oa.common.security.CurrentUserHolder;
import com.hentor.oa.common.security.UserContext;
import com.hentor.oa.system.entity.SysDataDimension;
import com.hentor.oa.system.entity.SysDept;
import com.hentor.oa.system.entity.SysDimensionBinding;
import com.hentor.oa.system.entity.SysDimensionOption;
import com.hentor.oa.system.entity.SysRole;
import com.hentor.oa.system.entity.SysRoleDataDimension;
import com.hentor.oa.system.entity.SysUserAssignment;
import com.hentor.oa.system.entity.SysUserDataDimension;
import com.hentor.oa.system.repository.SysDataDimensionRepository;
import com.hentor.oa.system.repository.SysDeptRepository;
import com.hentor.oa.system.repository.SysDimensionBindingRepository;
import com.hentor.oa.system.repository.SysDimensionOptionRepository;
import com.hentor.oa.system.repository.SysRoleDataDimensionRepository;
import com.hentor.oa.system.repository.SysUserAssignmentRepository;
import com.hentor.oa.system.repository.SysUserDataDimensionRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;

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

    /**
     * V54 缓存结构升级：值从平铺 {dim:scope} 变分层 {"":{dim:scope},"<feature>":{dim:scope}}。
     * 直接换前缀 v2——旧 dp:dims:{uid} 键不再被读（TTL 30min 自然蒸发；evictUser 顺带删），零迁移代码。
     */
    private static final String CACHE_PREFIX = "dp:dims:v2:";
    private static final String LEGACY_CACHE_PREFIX = "dp:dims:";
    /** 全局默认层键（拍板：存 '' 代 NULL，唯一键干净）。 */
    public static final String FEATURE_GLOBAL = "";
    /** 内建部门维保留键（V54 覆盖层允许 dimension='dept'；维度 CRUD 禁用户占用）。 */
    public static final String DIM_DEPT = "dept";
    private static final Duration CACHE_TTL = Duration.ofMinutes(30);
    /** 维度编码（V51 CRUD）：字母开头，字母数字下划线，≤64。 */
    private static final Pattern DIM_CODE_PATTERN = Pattern.compile("[a-zA-Z][a-zA-Z0-9_]{1,63}");
    /** 绑定进程内缓存兜底 TTL（写路径本 JVM 即时清；TTL 仅防陈旧兜底）。 */
    private static final long BINDING_CACHE_TTL_MS = 60_000;

    private final SysDataDimensionRepository dimensionRepository;
    private final SysRoleDataDimensionRepository roleDimRepository;
    private final SysUserDataDimensionRepository userDimRepository;
    private final SysUserAssignmentRepository assignmentRepository;
    private final SysDimensionOptionRepository optionRepository;
    private final SysDimensionBindingRepository bindingRepository;
    private final SysDeptRepository deptRepository;
    private final List<DataDimensionProvider> providers;
    private final List<BindableEntityProvider> bindableProviders;
    private final StringRedisTemplate redis;
    private final ObjectMapper objectMapper;

    /** DICT 源经原生 SQL 读字典（system 不依赖 oa-module-infra，同库表直查）。 */
    @PersistenceContext
    private EntityManager entityManager;

    /** entity → (dimension → JPA 属性名) 绑定缓存（multiDim 查询侧高频读）。 */
    private final Map<String, BindingCacheEntry> bindingCache = new ConcurrentHashMap<>();

    private record BindingCacheEntry(Map<String, String> columns, long cachedAt) {
    }

    // ==================== 注册 / 元数据 / options ====================

    /** 已注册（启用）业务维度（不含内建 dept/self）。兼容旧签名（授权 UI 只见启用维度）。 */
    @Transactional(readOnly = true)
    public List<DimensionInfo> listDimensions() {
        return listDimensions(false);
    }

    /** V51：includeDisabled=true 供管理页（含停用行）；含 valueSource/dictType/bindings。 */
    @Transactional(readOnly = true)
    public List<DimensionInfo> listDimensions(boolean includeDisabled) {
        List<SysDataDimension> dims = includeDisabled
                ? dimensionRepository.findAllByOrderByCodeAsc()
                : dimensionRepository.findByEnabledTrueOrderByCodeAsc();
        Map<String, List<DimensionBindingItem>> byDim = new HashMap<>();
        for (SysDimensionBinding b : bindingRepository.findAll()) {
            byDim.computeIfAbsent(b.getDimension(), k -> new ArrayList<>())
                    .add(new DimensionBindingItem(b.getEntity(), b.getColumnName()));
        }
        return dims.stream().map(d -> toInfo(d, byDim.getOrDefault(d.getCode(), List.of()))).toList();
    }

    private DimensionInfo toInfo(SysDataDimension d, List<DimensionBindingItem> bindings) {
        // entity 兼容旧字段语义：首个绑定实体，无绑定回退 V43 遗留列
        String entity = !bindings.isEmpty() ? bindings.get(0).entity() : d.getEntity();
        return new DimensionInfo(d.getCode(), d.getLabel(), entity, Boolean.TRUE.equals(d.getEnabled()),
                d.getValueSource(), d.getDictType(), bindings, false);
    }

    /** 某维度 CUSTOM 可选值。维度须已注册启用，否则 400（白名单红线）。专用 provider 优先，其余按 valueSource 分发。 */
    @Transactional(readOnly = true)
    public List<DimensionOption> options(String code) {
        SysDataDimension dim = dimensionRepository.findById(code)
                .filter(d -> Boolean.TRUE.equals(d.getEnabled()))
                .orElseThrow(() -> new BusinessException(400, "未注册或未启用的数据维度: " + code));
        return optionsFor(dim);
    }

    /** 三源分发（V51）：专用 bean（PROVIDER，costCenter/project 零迁移）> OPTION 选项表 > DICT 字典 > DEPT 部门。 */
    private List<DimensionOption> optionsFor(SysDataDimension dim) {
        DataDimensionProvider dedicated = providerOf(dim.getCode());
        if (dedicated != null) {
            return dedicated.options();
        }
        String source = dim.getValueSource() == null ? "" : dim.getValueSource();
        return switch (source) {
            case SysDataDimension.SOURCE_OPTION -> optionRepository
                    .findByDimensionAndEnabledTrueOrderBySortAscIdAsc(dim.getCode()).stream()
                    .map(o -> new DimensionOption(o.getValue(), o.getLabel()))
                    .toList();
            case SysDataDimension.SOURCE_DICT -> dictOptions(dim.getDictType());
            case SysDataDimension.SOURCE_DEPT -> deptRepository.findAll().stream()
                    .filter(d -> !Boolean.FALSE.equals(d.getEnabled()))
                    .sorted(java.util.Comparator.comparing(SysDept::getId))
                    .map(d -> new DimensionOption(d.getId(), d.getName()))
                    .toList();
            default -> List.of(); // PROVIDER 但 bean 缺失（异常情形）→ 空
        };
    }

    /** DICT 源：value=字典项 id（拍板①值链路保持 Long），label=字典项文案；仅启用类型/项。 */
    @SuppressWarnings("unchecked")
    private List<DimensionOption> dictOptions(String dictType) {
        if (!StringUtils.hasText(dictType)) {
            return List.of();
        }
        List<Object[]> rows = entityManager.createNativeQuery(
                        "SELECT i.id, i.label FROM sys_dict_item i JOIN sys_dict_type t ON i.type_id = t.id "
                                + "WHERE t.code = :code AND i.enabled = TRUE AND t.enabled = TRUE "
                                + "ORDER BY i.sort, i.id")
                .setParameter("code", dictType).getResultList();
        return rows.stream()
                .map(r -> new DimensionOption(((Number) r[0]).longValue(), String.valueOf(r[1])))
                .toList();
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

    // ==================== 角色 / 用户 维度授权读写（V54 分层：''=全局，非空=功能覆盖） ====================

    /** 兼容旧签名：全局层。 */
    @Transactional(readOnly = true)
    public List<DimensionConfigItem> roleConfig(Long roleId) {
        return roleConfig(roleId, FEATURE_GLOBAL, false);
    }

    /** feature=层过滤（''=全局）；all=true 返回全部层（item 带 feature）。 */
    @Transactional(readOnly = true)
    public List<DimensionConfigItem> roleConfig(Long roleId, String feature, boolean all) {
        List<SysRoleDataDimension> rows = all
                ? roleDimRepository.findByRoleId(roleId)
                : roleDimRepository.findByRoleIdAndFeature(roleId, normFeature(feature));
        return rows.stream()
                .map(c -> new DimensionConfigItem(c.getDimension(), c.getScope(), sorted(c.getValues()), c.getFeature()))
                .toList();
    }

    /** 兼容旧签名：全局层全量替换（老 payload 缺 feature=原行为不变，功能覆盖层不受影响）。 */
    @Transactional
    public void saveRoleConfig(Long roleId, List<DimensionConfigItem> items) {
        saveRoleConfig(roleId, FEATURE_GLOBAL, items);
    }

    /** 按层全量替换角色维度授权（V54）：只动指定 feature 层的行；item.feature 忽略以入参为准。 */
    @Transactional
    public void saveRoleConfig(Long roleId, String feature, List<DimensionConfigItem> items) {
        String layer = normFeature(feature);
        validateItems(layer, items);
        // 按层全量替换：先删该层已有并 flush（避免同事务 INSERT/DELETE 撞 uk_role_data_dim；级联清值表）
        roleDimRepository.deleteAll(roleDimRepository.findByRoleIdAndFeature(roleId, layer));
        roleDimRepository.flush();
        for (DimensionConfigItem item : normalize(items)) {
            SysRoleDataDimension c = new SysRoleDataDimension();
            c.setRoleId(roleId);
            c.setDimension(item.dimension());
            c.setFeature(layer);
            c.setScope(item.scope());
            c.setValues(new HashSet<>(item.values()));
            roleDimRepository.save(c);
        }
        evictRole(roleId);
    }

    /** 兼容旧签名：全局层。 */
    @Transactional(readOnly = true)
    public List<DimensionConfigItem> userConfig(Long userId) {
        return userConfig(userId, FEATURE_GLOBAL, false);
    }

    @Transactional(readOnly = true)
    public List<DimensionConfigItem> userConfig(Long userId, String feature, boolean all) {
        List<SysUserDataDimension> rows = all
                ? userDimRepository.findByUserId(userId)
                : userDimRepository.findByUserIdAndFeature(userId, normFeature(feature));
        return rows.stream()
                .map(c -> new DimensionConfigItem(c.getDimension(), c.getScope(), sorted(c.getValues()), c.getFeature()))
                .toList();
    }

    /** 兼容旧签名：全局层全量替换。 */
    @Transactional
    public void saveUserConfig(Long userId, List<DimensionConfigItem> items) {
        saveUserConfig(userId, FEATURE_GLOBAL, items);
    }

    /** 按层全量替换用户维度授权（V54）。 */
    @Transactional
    public void saveUserConfig(Long userId, String feature, List<DimensionConfigItem> items) {
        String layer = normFeature(feature);
        validateItems(layer, items);
        userDimRepository.deleteAll(userDimRepository.findByUserIdAndFeature(userId, layer));
        userDimRepository.flush();
        for (DimensionConfigItem item : normalize(items)) {
            SysUserDataDimension c = new SysUserDataDimension();
            c.setUserId(userId);
            c.setDimension(item.dimension());
            c.setFeature(layer);
            c.setScope(item.scope());
            c.setValues(new HashSet<>(item.values()));
            userDimRepository.save(c);
        }
        evictUser(userId);
    }

    private String normFeature(String feature) {
        return StringUtils.hasText(feature) ? feature.trim() : FEATURE_GLOBAL;
    }

    /**
     * 校验：业务维须注册启用 + CUSTOM 值域=optionsFor；内建 dept 维（V54）仅允许覆盖层
     * （全局部门权限唯一真源=role.dataScope 五档，不造第二真源），CUSTOM 值域=存在的部门 id（精确集，不含子树）。
     */
    private void validateItems(String layer, List<DimensionConfigItem> items) {
        if (items == null) {
            return;
        }
        Set<String> registered = registeredCodes();
        for (DimensionConfigItem item : items) {
            boolean isDept = DIM_DEPT.equals(item.dimension());
            if (isDept && FEATURE_GLOBAL.equals(layer)) {
                throw new BusinessException(400, "内建部门维(dept)仅可用于功能覆盖层（全局部门权限走角色数据范围五档）");
            }
            if (!isDept && (item.dimension() == null || !registered.contains(item.dimension()))) {
                throw new BusinessException(400, "未注册或未启用的数据维度: " + item.dimension());
            }
            String scope = item.scope();
            if (!SysDataDimension.SCOPE_ALL.equals(scope) && !SysDataDimension.SCOPE_CUSTOM.equals(scope)) {
                throw new BusinessException(400, "非法的维度范围(仅 ALL/CUSTOM): " + scope);
            }
            if (SysDataDimension.SCOPE_CUSTOM.equals(scope)) {
                List<Long> values = item.values() == null ? List.of() : item.values();
                if (isDept) {
                    Set<Long> valid = new HashSet<>();
                    deptRepository.findAllById(values.stream().filter(java.util.Objects::nonNull).toList())
                            .forEach(dep -> valid.add(dep.getId()));
                    for (Long v : values) {
                        if (v == null || !valid.contains(v)) {
                            throw new BusinessException(400, "部门维存在非法取值(部门不存在): " + v);
                        }
                    }
                    continue;
                }
                // V51：值域校验统一走 optionsFor（专用 bean 与 OPTION/DICT/DEPT 通用源同样生效）
                List<DimensionOption> options = dimensionRepository.findById(item.dimension())
                        .map(this::optionsFor).orElse(List.of());
                if (!options.isEmpty()) {
                    Set<Long> validIds = new HashSet<>();
                    options.forEach(o -> validIds.add(o.id()));
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
            byDim.put(item.dimension(), new DimensionConfigItem(item.dimension(), item.scope(), values, null));
        }
        return new ArrayList<>(byDim.values());
    }

    // ==================== 当前用户各维可见范围解析（查询侧调用） ====================

    /**
     * 解析当前用户在给定维度集合上的可见范围（全局层，兼容旧签名）。
     * 未配置维度返回 {@link DimensionScope#unlimited()}（不限）。走 Redis 预计算缓存。
     */
    public Map<String, DimensionScope> resolveForCurrentUser(Set<String> codes) {
        return resolveForCurrentUser(null, codes);
    }

    /**
     * V54 功能级解析：某维度上 <b>功能覆盖 &gt; 全局 &gt; 不限</b>——覆盖层存在该维配置即<b>替换</b>全局
     * （拍板 C：只看覆盖层，不与全局并集，否则无法收紧）；同层内多角色/用户级仍并集放宽（RBAC 加法）。
     * feature 空 = 纯全局层。
     */
    public Map<String, DimensionScope> resolveForCurrentUser(String feature, Set<String> codes) {
        UserContext ctx = CurrentUserHolder.get();
        if (ctx == null || ctx.getUserId() == null || codes == null || codes.isEmpty()) {
            return Map.of();
        }
        Map<String, Map<String, DimensionScope>> layers = cachedScopes(ctx.getUserId());
        Map<String, DimensionScope> global = layers.getOrDefault(FEATURE_GLOBAL, Map.of());
        Map<String, DimensionScope> override = StringUtils.hasText(feature)
                ? layers.getOrDefault(feature.trim(), Map.of()) : Map.of();
        Map<String, DimensionScope> out = new HashMap<>();
        for (String code : codes) {
            out.put(code, override.containsKey(code) ? override.get(code)
                    : global.getOrDefault(code, DimensionScope.unlimited()));
        }
        return out;
    }

    /**
     * V54 dept 覆盖（内建维）：该 feature 覆盖层<b>显式配置了 dept</b> 才返回（替换全局五档），
     * 否则 null（查询侧回落 role.dataScope 全局五档）。CUSTOM values=精确部门 id 集（不含子树）。
     */
    public DimensionScope deptOverride(String feature) {
        UserContext ctx = CurrentUserHolder.get();
        if (ctx == null || ctx.getUserId() == null || !StringUtils.hasText(feature)) {
            return null;
        }
        return cachedScopes(ctx.getUserId()).getOrDefault(feature.trim(), Map.of()).get(DIM_DEPT);
    }

    /** 取用户分层范围（Redis 命中直取；未命中现算并回填；Redis 故障降级为直算，不影响正确性）。 */
    private Map<String, Map<String, DimensionScope>> cachedScopes(Long userId) {
        String key = CACHE_PREFIX + userId;
        try {
            String json = redis.opsForValue().get(key);
            if (json != null) {
                return deserialize(json);
            }
        } catch (Exception e) {
            log.warn("DP 维度缓存读取失败(降级直算) user={}: {}", userId, e.getMessage());
        }
        Map<String, Map<String, DimensionScope>> computed = computeAllScopes(userId);
        try {
            redis.opsForValue().set(key, serialize(computed), CACHE_TTL);
        } catch (Exception e) {
            log.warn("DP 维度缓存写入失败(忽略) user={}: {}", userId, e.getMessage());
        }
        return computed;
    }

    /** 现算（V54 分层）：角色配置 + 用户配置按 (feature, dimension) 并集（同层任一 ALL → 不限；否则 CUSTOM 值并集）。 */
    private Map<String, Map<String, DimensionScope>> computeAllScopes(Long userId) {
        Set<Long> roleIds = new LinkedHashSet<>();
        for (SysUserAssignment a : assignmentRepository.findByUserIdAndEnabledTrueOrderByPrimaryFlagDescIdAsc(userId)) {
            for (SysRole r : a.getRoles()) {
                if (!Boolean.FALSE.equals(r.getEnabled())) {
                    roleIds.add(r.getId());
                }
            }
        }
        // (feature, 维度) -> {anyAll, unionValues}
        Map<String, Map<String, boolean[]>> anyAll = new HashMap<>();
        Map<String, Map<String, Set<Long>>> union = new HashMap<>();
        List<SysRoleDataDimension> roleCfgs = roleIds.isEmpty() ? List.of() : roleDimRepository.findByRoleIdIn(roleIds);
        for (SysRoleDataDimension c : roleCfgs) {
            accumulate(anyAll, union, c.getFeature(), c.getDimension(), c.getScope(), c.getValues());
        }
        for (SysUserDataDimension c : userDimRepository.findByUserId(userId)) {
            accumulate(anyAll, union, c.getFeature(), c.getDimension(), c.getScope(), c.getValues());
        }
        Map<String, Map<String, DimensionScope>> out = new HashMap<>();
        union.forEach((feature, byDim) -> {
            Map<String, DimensionScope> layer = new HashMap<>();
            byDim.forEach((dim, values) -> {
                boolean[] all = anyAll.get(feature).get(dim);
                layer.put(dim, (all != null && all[0]) ? DimensionScope.unlimited() : DimensionScope.custom(values));
            });
            out.put(feature, layer);
        });
        return out;
    }

    private void accumulate(Map<String, Map<String, boolean[]>> anyAll, Map<String, Map<String, Set<Long>>> union,
                            String feature, String dim, String scope, Set<Long> values) {
        String layer = feature == null ? FEATURE_GLOBAL : feature;
        anyAll.computeIfAbsent(layer, k -> new HashMap<>()).computeIfAbsent(dim, k -> new boolean[]{false});
        union.computeIfAbsent(layer, k -> new HashMap<>()).computeIfAbsent(dim, k -> new HashSet<>());
        if (SysDataDimension.SCOPE_ALL.equals(scope)) {
            anyAll.get(layer).get(dim)[0] = true;
        } else if (values != null) {
            union.get(layer).get(dim).addAll(values);
        }
    }

    // ==================== V51：维度 CRUD ====================

    /** 新建维度（UI 自定义，valueSource ∈ OPTION|DICT|DEPT；PROVIDER 为存量代码维度专用不可建）。 */
    @Transactional
    public DimensionInfo createDimension(DimensionUpsertRequest req) {
        if (req == null || !StringUtils.hasText(req.code()) || !DIM_CODE_PATTERN.matcher(req.code()).matches()) {
            throw new BusinessException(400, "维度编码非法（字母开头，字母数字下划线，≤64）");
        }
        if (DIM_DEPT.equalsIgnoreCase(req.code()) || "self".equalsIgnoreCase(req.code())) {
            throw new BusinessException(400, "维度编码 dept/self 为内建保留键，不可占用");
        }
        if (dimensionRepository.findById(req.code()).isPresent()) {
            throw new BusinessException(400, "维度编码已存在（含已停用）: " + req.code());
        }
        if (!StringUtils.hasText(req.label())) {
            throw new BusinessException(400, "维度名称必填");
        }
        String source = req.valueSource() == null ? "" : req.valueSource().trim().toUpperCase();
        if (!Set.of(SysDataDimension.SOURCE_OPTION, SysDataDimension.SOURCE_DICT,
                SysDataDimension.SOURCE_DEPT).contains(source)) {
            throw new BusinessException(400, "valueSource 须为 OPTION/DICT/DEPT");
        }
        if (SysDataDimension.SOURCE_DICT.equals(source)) {
            requireDictType(req.dictType());
        }
        SysDataDimension d = new SysDataDimension();
        d.setCode(req.code());
        d.setLabel(req.label());
        d.setEnabled(req.enabled() == null || req.enabled());
        d.setValueSource(source);
        d.setDictType(SysDataDimension.SOURCE_DICT.equals(source) ? req.dictType().trim() : null);
        dimensionRepository.save(d);
        replaceBindings(req.code(), req.bindings());
        clearBindingCache();
        return toInfo(d, currentBindings(req.code()));
    }

    /** 编辑维度：code/valueSource 不可改（编码即外键红线）；bindings 非 null 全量替换。 */
    @Transactional
    public DimensionInfo updateDimension(String code, DimensionUpsertRequest req) {
        SysDataDimension d = dimensionRepository.findById(code)
                .orElseThrow(() -> new BusinessException(404, "维度不存在: " + code));
        if (req == null) {
            return toInfo(d, currentBindings(code));
        }
        if (StringUtils.hasText(req.valueSource())
                && !req.valueSource().trim().toUpperCase().equals(d.getValueSource())) {
            throw new BusinessException(400, "valueSource 建后不可改（换源=停用后新建）");
        }
        if (StringUtils.hasText(req.label())) {
            d.setLabel(req.label());
        }
        if (req.enabled() != null) {
            d.setEnabled(req.enabled());
        }
        if (SysDataDimension.SOURCE_DICT.equals(d.getValueSource()) && StringUtils.hasText(req.dictType())) {
            requireDictType(req.dictType());
            d.setDictType(req.dictType().trim());
        }
        dimensionRepository.save(d);
        if (req.bindings() != null) {
            replaceBindings(code, req.bindings());
        }
        clearBindingCache();
        return toInfo(d, currentBindings(code));
    }

    /** 删除=软删（enabled=false）；被角色/用户授权引用 → 409（先解除授权）。 */
    @Transactional
    public void deleteDimension(String code) {
        SysDataDimension d = dimensionRepository.findById(code)
                .orElseThrow(() -> new BusinessException(404, "维度不存在: " + code));
        if (roleDimRepository.existsByDimension(code) || userDimRepository.existsByDimension(code)) {
            throw new BusinessException(409, "维度已被角色/用户授权引用，请先解除相关授权再停用: " + code);
        }
        d.setEnabled(false);
        dimensionRepository.save(d);
        clearBindingCache();
    }

    /** 绑定全量替换：白名单校验（可绑列目录）+ P1 单实体单列。 */
    private void replaceBindings(String code, List<DimensionBindingItem> items) {
        if (items == null) {
            return;
        }
        if (items.size() > 1) {
            throw new BusinessException(400, "P1 仅支持单实体单列绑定（多实体=P4）");
        }
        Map<String, Set<String>> catalog = catalogMap();
        for (DimensionBindingItem item : items) {
            if (item == null || !StringUtils.hasText(item.entity()) || !StringUtils.hasText(item.column())
                    || !catalog.getOrDefault(item.entity(), Set.of()).contains(item.column())) {
                throw new BusinessException(400, "绑定不在可绑列目录内: "
                        + (item == null ? "null" : item.entity() + "." + item.column()));
            }
        }
        bindingRepository.deleteAll(bindingRepository.findByDimensionOrderByIdAsc(code));
        bindingRepository.flush();
        for (DimensionBindingItem item : items) {
            SysDimensionBinding b = new SysDimensionBinding();
            b.setDimension(code);
            b.setEntity(item.entity());
            b.setColumnName(item.column());
            bindingRepository.save(b);
        }
    }

    private List<DimensionBindingItem> currentBindings(String code) {
        return bindingRepository.findByDimensionOrderByIdAsc(code).stream()
                .map(b -> new DimensionBindingItem(b.getEntity(), b.getColumnName()))
                .toList();
    }

    /** DICT 源字典类型必须存在且启用。 */
    private void requireDictType(String dictType) {
        if (!StringUtils.hasText(dictType)) {
            throw new BusinessException(400, "DICT 来源须指定字典类型 dictType");
        }
        Number n = (Number) entityManager.createNativeQuery(
                        "SELECT count(*) FROM sys_dict_type WHERE code = :code AND enabled = TRUE")
                .setParameter("code", dictType.trim()).getSingleResult();
        if (n.longValue() == 0) {
            throw new BusinessException(400, "字典类型不存在或未启用: " + dictType);
        }
    }

    // ==================== V51：选项 CRUD（OPTION 源） ====================

    /** 选项管理行（含禁用，管理视图；id=行主键）。 */
    @Transactional(readOnly = true)
    public List<DimensionOptionRow> optionRows(String code) {
        dimensionRepository.findById(code)
                .orElseThrow(() -> new BusinessException(404, "维度不存在: " + code));
        return optionRepository.findByDimensionOrderBySortAscIdAsc(code).stream()
                .map(o -> new DimensionOptionRow(o.getId(), o.getValue(), o.getLabel(), o.getSort(), o.getEnabled()))
                .toList();
    }

    @Transactional
    public DimensionOptionRow addOption(String code, DimensionOptionRequest req) {
        SysDataDimension d = dimensionRepository.findById(code)
                .orElseThrow(() -> new BusinessException(404, "维度不存在: " + code));
        if (!SysDataDimension.SOURCE_OPTION.equals(d.getValueSource())) {
            throw new BusinessException(400, "仅 OPTION 来源维度可维护自定义选项（当前来源: " + d.getValueSource() + "）");
        }
        if (req == null || !StringUtils.hasText(req.label())) {
            throw new BusinessException(400, "选项名称必填");
        }
        Long value = req.value();
        if (value == null) {
            Long max = optionRepository.maxValue(code);
            value = max == null ? 1L : max + 1;
        }
        if (optionRepository.findByDimensionAndValue(code, value).isPresent()) {
            throw new BusinessException(409, "选项值已存在: " + value);
        }
        SysDimensionOption o = new SysDimensionOption();
        o.setDimension(code);
        o.setValue(value);
        o.setLabel(req.label());
        o.setSort(req.sort() == null ? 0 : req.sort());
        o.setEnabled(req.enabled() == null || req.enabled());
        optionRepository.save(o);
        return new DimensionOptionRow(o.getId(), o.getValue(), o.getLabel(), o.getSort(), o.getEnabled());
    }

    @Transactional
    public DimensionOptionRow updateOption(String code, Long id, DimensionOptionRequest req) {
        SysDimensionOption o = optionRepository.findById(id)
                .filter(x -> x.getDimension().equals(code))
                .orElseThrow(() -> new BusinessException(404, "选项不存在: " + id));
        if (req != null) {
            if (req.value() != null && !req.value().equals(o.getValue())) {
                throw new BusinessException(400, "选项值不可改（值即行数据列值；改值=删旧建新）");
            }
            if (StringUtils.hasText(req.label())) {
                o.setLabel(req.label());
            }
            if (req.sort() != null) {
                o.setSort(req.sort());
            }
            if (req.enabled() != null) {
                o.setEnabled(req.enabled());
            }
            optionRepository.save(o);
        }
        return new DimensionOptionRow(o.getId(), o.getValue(), o.getLabel(), o.getSort(), o.getEnabled());
    }

    @Transactional
    public void deleteOption(String code, Long id) {
        SysDimensionOption o = optionRepository.findById(id)
                .filter(x -> x.getDimension().equals(code))
                .orElseThrow(() -> new BusinessException(404, "选项不存在: " + id));
        optionRepository.delete(o);
    }

    // ==================== V51：可绑列目录 + 查询侧绑定消费 ====================

    /** 可绑实体目录（SPI 聚合，绑定 UI 与校验白名单同源）。 */
    public List<BindableEntityProvider.BindableEntity> bindableEntities() {
        List<BindableEntityProvider.BindableEntity> out = new ArrayList<>();
        for (BindableEntityProvider p : bindableProviders) {
            out.addAll(p.bindableEntities());
        }
        return out;
    }

    private Map<String, Set<String>> catalogMap() {
        Map<String, Set<String>> out = new HashMap<>();
        for (BindableEntityProvider.BindableEntity e : bindableEntities()) {
            out.computeIfAbsent(e.entity(), k -> new HashSet<>());
            for (BindableEntityProvider.BindableColumn c : e.columns()) {
                out.get(e.entity()).add(c.column());
            }
        }
        return out;
    }

    /**
     * 查询侧绑定消费（缺口①）：entity → {dimension: JPA 属性名}（仅启用维度）。
     * DataScopeSupport.multiDim 按实体调用；进程内缓存 + 维度写路径主动清 + TTL 兜底。
     */
    public Map<String, String> bindingsForEntity(String entity) {
        BindingCacheEntry cached = bindingCache.get(entity);
        long now = System.currentTimeMillis();
        if (cached != null && now - cached.cachedAt() < BINDING_CACHE_TTL_MS) {
            return cached.columns();
        }
        Set<String> enabledDims = registeredCodes();
        Map<String, String> out = new LinkedHashMap<>();
        for (SysDimensionBinding b : bindingRepository.findByEntityOrderByIdAsc(entity)) {
            if (enabledDims.contains(b.getDimension())) {
                out.put(b.getDimension(), b.getColumnName());
            }
        }
        Map<String, String> frozen = Map.copyOf(out);
        bindingCache.put(entity, new BindingCacheEntry(frozen, now));
        return frozen;
    }

    private void clearBindingCache() {
        bindingCache.clear();
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
            redis.delete(LEGACY_CACHE_PREFIX + userId); // V54 结构升级过渡：旧平铺键顺带清（否则等 TTL 蒸发）
            redis.delete("dp:fields:" + userId); // V52 dp 家族联动：字段权限缓存同钩失效
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

    /** V54 分层结构：{"<feature|''>": {"<dim>": {unlimited, values[]}}}。 */
    private String serialize(Map<String, Map<String, DimensionScope>> layers) {
        ObjectNode root = objectMapper.createObjectNode();
        layers.forEach((feature, scopes) -> {
            ObjectNode layer = root.putObject(feature);
            scopes.forEach((code, s) -> {
                ObjectNode node = layer.putObject(code);
                node.put("unlimited", s.all());
                ArrayNode arr = node.putArray("values");
                s.values().forEach(arr::add);
            });
        });
        return root.toString();
    }

    private Map<String, Map<String, DimensionScope>> deserialize(String json) {
        Map<String, Map<String, DimensionScope>> out = new HashMap<>();
        JsonNode root = objectMapper.readTree(json);
        root.properties().forEach(layerEntry -> {
            Map<String, DimensionScope> layer = new HashMap<>();
            layerEntry.getValue().properties().forEach(e -> {
                JsonNode n = e.getValue();
                boolean unlimited = n.path("unlimited").asBoolean(true);
                Set<Long> values = new HashSet<>();
                n.path("values").forEach(v -> values.add(v.asLong()));
                layer.put(e.getKey(), unlimited ? DimensionScope.unlimited() : DimensionScope.custom(values));
            });
            out.put(layerEntry.getKey(), layer);
        });
        return out;
    }

    private static List<Long> sorted(Set<Long> values) {
        return values == null ? List.of() : values.stream().sorted().toList();
    }
}
