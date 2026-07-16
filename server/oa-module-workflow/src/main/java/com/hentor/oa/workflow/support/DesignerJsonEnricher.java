package com.hentor.oa.workflow.support;

import com.hentor.oa.system.entity.SysDept;
import com.hentor.oa.system.entity.SysPost;
import com.hentor.oa.system.entity.SysRole;
import com.hentor.oa.system.entity.SysUser;
import com.hentor.oa.system.repository.SysDeptRepository;
import com.hentor.oa.system.repository.SysPostRepository;
import com.hentor.oa.system.repository.SysRoleRepository;
import com.hentor.oa.system.repository.SysUserRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

import java.util.HashMap;
import java.util.Map;

/**
 * 返回时动态给 designerJson / flowConfig 里的组织引用（OrgRef）补 name（<b>不改存储</b>，零迁移）。
 *
 * <p>背景：设计器新建的办理人规则 refs 会随存 name（{@code orgRefToBackend}），但存量 / 种子 /
 * smoke 造的 designerJson 里 refs 只有 {@code {kind,id}}。前端跟踪图（DingtalkTrack）与画布摘要
 * （{@code summarizeAssignees}）靠 {@code refs[].name} 展示，缺 name 只能退化占位「成员#5」
 * （用户实测「账户·成员#5」的根因）。前端拿不到全局 userId→姓名映射，故在后端返回处补最干净。
 *
 * <p>覆盖字段：递归全树，凡数组字段 {@code refs}（办理人规则 refs）/{@code users}（抄送人）/
 * {@code scope}（flowConfig.start.scope 发起范围）内的元素按其 {@code kind}（缺省 USER）解析：
 * USER/ACCOUNT/GROUP→用户名、DEPT→部门名、ROLE→角色名、POST→岗位名。已有 name 不覆盖；
 * 解析不到（如已删除的实体）保持无 name（前端仍占位兜底，不崩）。DINGTALK / GRAPH / 任意嵌套通用。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class DesignerJsonEnricher {

    private final SysUserRepository userRepository;
    private final SysDeptRepository deptRepository;
    private final SysRoleRepository roleRepository;
    private final SysPostRepository postRepository;
    private final ObjectMapper objectMapper;

    /**
     * 解析 designerJson 字符串并补 name，返回补全后的 {@link JsonNode}（供实例详情等直接作为响应对象）。
     * 解析失败退化为空对象 {@code {}}（与旧 {@code parseJson} 兜底一致，绝不抛）。
     */
    public JsonNode enrich(String json) {
        if (!StringUtils.hasText(json)) {
            return objectMapper.createObjectNode();
        }
        try {
            JsonNode root = objectMapper.readTree(json);
            walk(root, new HashMap<>());
            return root;
        } catch (Exception e) {
            log.warn("designerJson 补 name 失败，返回空对象: {}", e.getMessage());
            return objectMapper.createObjectNode();
        }
    }

    /**
     * 补 name 后回序列化为字符串（供流程定义响应 designerJson / flowConfig 字段）。
     * 空/解析失败原样返回（不影响既有存储与前端载入）。
     */
    public String enrichToString(String json) {
        if (!StringUtils.hasText(json)) {
            return json;
        }
        try {
            JsonNode root = objectMapper.readTree(json);
            walk(root, new HashMap<>());
            return root.toString();
        } catch (Exception e) {
            log.warn("designerJson 补 name(字符串) 失败，原样返回: {}", e.getMessage());
            return json;
        }
    }

    /** 递归全树：ref 型数组字段（refs/users/scope）逐个补 name，其余字段继续下探。 */
    private void walk(JsonNode node, Map<String, String> cache) {
        if (node == null) {
            return;
        }
        if (node.isArray()) {
            for (JsonNode child : node) {
                walk(child, cache);
            }
            return;
        }
        if (!node.isObject()) {
            return;
        }
        for (Map.Entry<String, JsonNode> e : node.properties()) {
            String field = e.getKey();
            JsonNode value = e.getValue();
            if (value != null && value.isArray()
                    && ("refs".equals(field) || "users".equals(field) || "scope".equals(field))) {
                for (JsonNode ref : value) {
                    enrichRef(ref, cache);
                }
            }
            walk(value, cache);
        }
    }

    /** 单个 OrgRef {kind,id,name?} 补 name：已有 name 不动；按 kind 解析实体名写入。 */
    private void enrichRef(JsonNode ref, Map<String, String> cache) {
        if (ref == null || !ref.isObject()) {
            return;
        }
        if (StringUtils.hasText(ref.path("name").asString(""))) {
            return; // 已有 name，不覆盖
        }
        Long id = longOf(ref.get("id"));
        if (id == null) {
            return; // 无 id（动态来源/未指定）不处理
        }
        String kind = ref.path("kind").asString("USER");
        String name = resolveName(kind, id, cache);
        if (StringUtils.hasText(name)) {
            ((ObjectNode) ref).put("name", name);
        }
    }

    /** kind+id → 实体名（带本次调用缓存，避免同一引用重复查库）。未知 kind / 查不到返回 null。 */
    private String resolveName(String kind, Long id, Map<String, String> cache) {
        String norm = kind == null ? "USER" : kind.toUpperCase();
        String key = norm + ":" + id;
        if (cache.containsKey(key)) {
            return cache.get(key);
        }
        String name = switch (norm) {
            case "USER", "ACCOUNT", "GROUP" -> userRepository.findById(id).map(SysUser::getName).orElse(null);
            case "DEPT", "UNIT" -> deptRepository.findById(id).map(SysDept::getName).orElse(null);
            case "ROLE" -> roleRepository.findById(id).map(SysRole::getName).orElse(null);
            case "POST", "ROLE_POST" -> postRepository.findById(id).map(SysPost::getName).orElse(null);
            default -> null;
        };
        cache.put(key, name);
        return name;
    }

    private Long longOf(JsonNode idNode) {
        if (idNode == null || idNode.isNull()) {
            return null;
        }
        if (idNode.isNumber()) {
            return idNode.asLong();
        }
        try {
            return Long.parseLong(idNode.asString("").trim());
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
