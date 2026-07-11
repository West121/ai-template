package com.xingchen.oa.boot.ai.tool;

import java.util.List;

/**
 * 功能菜单目录（与前端 web/src/config/menu.ts 对齐；path 即路由）。
 * perm 非空时按功能权限过滤为「用户可见」（安全红线：导航只推可见项）。
 */
public final class NavCatalog {

    private NavCatalog() {
    }

    public record Item(String path, String title, String desc, String perm) {
    }

    public static final List<Item> ITEMS = List.of(
            new Item("/dashboard", "工作台", "个人首页：待办、日程、统计概览", null),
            new Item("/workflow/tasks", "我的审批", "处理待办审批任务、查看已办", null),
            new Item("/workflow/start", "发起申请", "发起请假/报销/审批等流程", null),
            new Item("/workflow/monitor", "流程监控", "流程实例运行监控统计", "wf:instance:admin"),
            new Item("/workflow/defs", "流程定义", "流程定义管理与设计", "wf:def:edit"),
            new Item("/automation", "自动化编排", "无人值守的自动化逻辑编排", "orch:flow:read"),
            new Item("/document/receive", "收文管理", "收文登记、拟办、批办、传阅", "office:doc:recv"),
            new Item("/document/send", "发文管理", "发文拟稿、核稿、签发、用印", "office:doc:send"),
            new Item("/document/ledger", "公文台账", "文号台账与归档卷宗检索", null),
            new Item("/meeting/rooms", "会议室预订", "查看会议室占用并预订", null),
            new Item("/meeting/my", "我的会议", "我组织/参与的会议", null),
            new Item("/attendance/record", "打卡记录", "考勤打卡与月度记录", null),
            new Item("/attendance/leave", "请假管理", "请假申请与假期额度", null),
            new Item("/attendance/trip", "出差管理", "出差申请与记录", null),
            new Item("/contacts", "通讯录", "组织架构与同事联系方式", null),
            new Item("/announcement", "公告通知", "公司公告与通知", null),
            new Item("/schedule", "日程管理", "个人日程安排", null),
            new Item("/system/user", "用户管理", "系统用户维护", "system:user:edit"),
            new Item("/system/role", "角色管理", "角色与权限维护", "system:role:edit"),
            new Item("/system/org/dept", "部门管理", "部门组织维护", "system:dept:edit"));
}
