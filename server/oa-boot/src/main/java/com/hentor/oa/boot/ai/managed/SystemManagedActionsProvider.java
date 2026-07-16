package com.hentor.oa.boot.ai.managed;

import com.hentor.oa.common.ai.AiManagedAction;
import com.hentor.oa.common.ai.AiManagedActionProvider;
import com.hentor.oa.common.ai.ManagedActionKind;
import com.hentor.oa.system.dto.DeptRequest;
import com.hentor.oa.system.dto.PostRequest;
import com.hentor.oa.system.dto.RoleRequest;
import com.hentor.oa.system.dto.UserCreateRequest;
import com.hentor.oa.system.dto.UserResponse;
import com.hentor.oa.system.dto.UserUpdateRequest;
import com.hentor.oa.system.entity.SysDept;
import com.hentor.oa.system.entity.SysPost;
import com.hentor.oa.system.entity.SysRole;
import com.hentor.oa.system.repository.SysDeptRepository;
import com.hentor.oa.system.repository.SysPostRepository;
import com.hentor.oa.system.repository.SysRoleRepository;
import com.hentor.oa.system.service.SysDeptService;
import com.hentor.oa.system.service.SysPostService;
import com.hentor.oa.system.service.SysRoleService;
import com.hentor.oa.system.service.SysUserService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

/**
 * 组织人事·受控管理操作描述符（批 M1，docs/design/ai-managed-actions.md §3）。
 *
 * <p><b>依赖方向</b>：本 provider 放在 boot 侧集中声明 system 模块的管理操作，从而 <b>system 模块保持零 AI 依赖</b>
 * （不引 AI 注解、不实现 boot 接口）。boot 依赖 system，可直接绑定 {@code SysXxxService} 的 create/update 方法。
 *
 * <p>批 M1 只注册常用增改：user/dept/role/post 的 create + update，requiredAuthority 用各自现有写权限码
 * {@code system:*:edit}（现库中 create/update 同受 {@code :edit} 保护）。<b>删除/改权限/重置密码不注册</b>（高危）。
 * formSchema 对齐各创建/编辑请求 DTO 字段（widget key 必须 = DTO 字段名，提交值反序列化进 DTO）。
 */
@Component
@RequiredArgsConstructor
public class SystemManagedActionsProvider implements AiManagedActionProvider {

    private static final String M = "system";
    private static final String AUTH_USER = "system:user:edit";
    private static final String AUTH_DEPT = "system:dept:edit";
    private static final String AUTH_ROLE = "system:role:edit";
    private static final String AUTH_POST = "system:post:edit";

    private final SysUserService userService;
    private final SysDeptService deptService;
    private final SysRoleService roleService;
    private final SysPostService postService;
    private final SysDeptRepository deptRepository;
    private final SysRoleRepository roleRepository;
    private final SysPostRepository postRepository;

    @Override
    public List<AiManagedAction> managedActions() {
        List<AiManagedAction> list = new ArrayList<>();

        // ---------------- 用户 ----------------
        list.add(AiManagedAction.builder()
                .actionCode("system.user.create").module(M).entityLabel("用户")
                .action(ManagedActionKind.CREATE).label("新增用户")
                .requiredAuthority(AUTH_USER).handlerBean(userService).handlerMethod("create")
                .requestType(UserCreateRequest.class)
                .formSchema(List.of(
                        input("username", "用户名", true),
                        input("name", "姓名", true),
                        input("password", "初始密码", true),
                        number("deptId", "部门 id", true, "主任职部门 id（可先查部门树）"),
                        number("postId", "岗位 id", true, "主任职岗位 id"),
                        input("phone", "手机号", false),
                        input("email", "邮箱", false),
                        genderSelect(),
                        textarea("remark", "备注")))
                .build());

        list.add(AiManagedAction.builder()
                .actionCode("system.user.update").module(M).entityLabel("用户")
                .action(ManagedActionKind.UPDATE).label("编辑用户")
                .requiredAuthority(AUTH_USER).handlerBean(userService).handlerMethod("update")
                .requestType(UserUpdateRequest.class)
                .formSchema(List.of(
                        input("name", "姓名", true),
                        input("phone", "手机号", false),
                        input("email", "邮箱", false),
                        genderSelect(),
                        input("officeLocation", "办公地点", false),
                        textarea("remark", "备注")))
                .updateLoader(userLoader())
                .build());

        // ---------------- 部门 ----------------
        list.add(AiManagedAction.builder()
                .actionCode("system.dept.create").module(M).entityLabel("部门")
                .action(ManagedActionKind.CREATE).label("新增部门")
                .requiredAuthority(AUTH_DEPT).handlerBean(deptService).handlerMethod("create")
                .requestType(DeptRequest.class)
                .formSchema(List.of(
                        input("name", "部门名称", true),
                        number("parentId", "上级部门 id", false, "顶级部门填 0 或留空"),
                        number("sort", "排序", false, null),
                        input("code", "部门编码", false)))
                .build());

        list.add(AiManagedAction.builder()
                .actionCode("system.dept.update").module(M).entityLabel("部门")
                .action(ManagedActionKind.UPDATE).label("编辑部门")
                .requiredAuthority(AUTH_DEPT).handlerBean(deptService).handlerMethod("update")
                .requestType(DeptRequest.class)
                .formSchema(List.of(
                        input("name", "部门名称", true),
                        number("sort", "排序", false, null),
                        input("code", "部门编码", false)))
                .updateLoader(deptLoader())
                .build());

        // ---------------- 角色 ----------------
        list.add(AiManagedAction.builder()
                .actionCode("system.role.create").module(M).entityLabel("角色")
                .action(ManagedActionKind.CREATE).label("新增角色")
                .requiredAuthority(AUTH_ROLE).handlerBean(roleService).handlerMethod("create")
                .requestType(RoleRequest.class)
                .formSchema(roleSchema())
                .build());

        list.add(AiManagedAction.builder()
                .actionCode("system.role.update").module(M).entityLabel("角色")
                .action(ManagedActionKind.UPDATE).label("编辑角色")
                .requiredAuthority(AUTH_ROLE).handlerBean(roleService).handlerMethod("update")
                .requestType(RoleRequest.class)
                .formSchema(roleSchema())
                .updateLoader(roleLoader())
                .build());

        // ---------------- 岗位 ----------------
        list.add(AiManagedAction.builder()
                .actionCode("system.post.create").module(M).entityLabel("岗位")
                .action(ManagedActionKind.CREATE).label("新增岗位")
                .requiredAuthority(AUTH_POST).handlerBean(postService).handlerMethod("create")
                .requestType(PostRequest.class)
                .formSchema(postSchema())
                .build());

        list.add(AiManagedAction.builder()
                .actionCode("system.post.update").module(M).entityLabel("岗位")
                .action(ManagedActionKind.UPDATE).label("编辑岗位")
                .requiredAuthority(AUTH_POST).handlerBean(postService).handlerMethod("update")
                .requestType(PostRequest.class)
                .formSchema(postSchema())
                .updateLoader(postLoader())
                .build());

        return list;
    }

    // ==================== updateLoader（现值预填） ====================

    private Function<String, Map<String, Object>> userLoader() {
        return id -> {
            UserResponse u = userService.getById(Long.valueOf(id));
            Map<String, Object> v = new LinkedHashMap<>();
            put(v, "name", u.name());
            put(v, "phone", u.phone());
            put(v, "email", u.email());
            put(v, "gender", u.gender());
            put(v, "officeLocation", u.officeLocation());
            put(v, "remark", u.remark());
            return v;
        };
    }

    private Function<String, Map<String, Object>> deptLoader() {
        return id -> {
            SysDept d = deptRepository.findById(Long.valueOf(id)).orElse(null);
            Map<String, Object> v = new LinkedHashMap<>();
            if (d != null) {
                put(v, "name", d.getName());
                put(v, "sort", d.getSort());
                put(v, "code", d.getCode());
            }
            return v;
        };
    }

    private Function<String, Map<String, Object>> roleLoader() {
        return id -> {
            SysRole r = roleRepository.findById(Long.valueOf(id)).orElse(null);
            Map<String, Object> v = new LinkedHashMap<>();
            if (r != null) {
                put(v, "code", r.getCode());
                put(v, "name", r.getName());
                put(v, "dataScope", r.getDataScope());
            }
            return v;
        };
    }

    private Function<String, Map<String, Object>> postLoader() {
        return id -> {
            SysPost p = postRepository.findById(Long.valueOf(id)).orElse(null);
            Map<String, Object> v = new LinkedHashMap<>();
            if (p != null) {
                put(v, "code", p.getCode());
                put(v, "name", p.getName());
                put(v, "sort", p.getSort());
            }
            return v;
        };
    }

    // ==================== schema 复用 ====================

    private List<Map<String, Object>> roleSchema() {
        return List.of(
                input("code", "角色编码", true),
                input("name", "角色名称", true),
                select("dataScope", "数据范围", true, List.of(
                        opt("全部", "ALL"), opt("本部门及子部门", "DEPT_AND_CHILD"),
                        opt("本部门", "DEPT"), opt("仅本人", "SELF"), opt("自定义", "CUSTOM"))),
                textarea("remark", "备注"));
    }

    private List<Map<String, Object>> postSchema() {
        return List.of(
                input("code", "岗位编码", true),
                input("name", "岗位名称", true),
                number("sort", "排序", false, null));
    }

    private Map<String, Object> genderSelect() {
        return select("gender", "性别", false, List.of(
                opt("男", "MALE"), opt("女", "FEMALE"), opt("未知", "UNKNOWN")));
    }

    // ==================== widget 构造 ====================

    private Map<String, Object> input(String key, String label, boolean required) {
        return widget("input", key, label, required, null, null);
    }

    private Map<String, Object> textarea(String key, String label) {
        return widget("textarea", key, label, false, null, null);
    }

    private Map<String, Object> number(String key, String label, boolean required, String desc) {
        return widget("number", key, label, required, null, desc);
    }

    private Map<String, Object> select(String key, String label, boolean required, List<Map<String, String>> options) {
        return widget("select", key, label, required, options, null);
    }

    private Map<String, Object> widget(String type, String key, String label, boolean required,
                                       List<Map<String, String>> options, String desc) {
        Map<String, Object> w = new LinkedHashMap<>();
        w.put("type", type);
        w.put("key", key);
        w.put("label", label);
        if (required) {
            w.put("required", true);
        }
        if (options != null) {
            w.put("options", options);
        }
        if (desc != null) {
            w.put("description", desc);
        }
        return w;
    }

    private Map<String, String> opt(String label, String value) {
        return Map.of("label", label, "value", value);
    }

    private void put(Map<String, Object> map, String key, Object value) {
        if (value != null && !String.valueOf(value).isBlank()) {
            map.put(key, value);
        }
    }
}
