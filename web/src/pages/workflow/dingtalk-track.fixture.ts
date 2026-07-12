/**
 * 真实实例快照（zhangsan 发起 leave_approval days=5 → manager 同意，DINGTALK 定义，server API 抓取）。
 * 证明 timeline nodeId(start/mgr) 与 designerJson 节点 id 同一套；DingtalkTrack 办理信息渲染断言用。勿手改。
 */
import type { WfHighlight, WfTimelineItem } from "@/types/workflow"
export interface LeaveTrackFixture {
  designerType: string
  highlight: WfHighlight
  timeline: WfTimelineItem[]
  currentNodes: { nodeId?: string; nodeName?: string }[]
  designerJson: unknown
}
export const LEAVE_TRACK_FIXTURE = {
  "designerType": "DINGTALK",
  "highlight": {
    "completed": [
      "start",
      "flow_10",
      "mgr",
      "flow_7",
      "cond_split",
      "flow_4"
    ],
    "active": [
      "gm"
    ]
  },
  "timeline": [
    {
      "nodeId": "start",
      "nodeName": "发起",
      "actorName": "张三",
      "action": "SUBMIT",
      "comment": null,
      "createdAt": "2026-07-12T02:26:50.055321Z"
    },
    {
      "nodeId": "mgr",
      "nodeName": "部门经理审批",
      "actorName": "王经理",
      "action": "APPROVE",
      "comment": "同意-fixture意见",
      "createdAt": "2026-07-12T02:26:50.100168Z"
    }
  ],
  "currentNodes": [
    {
      "nodeId": "gm",
      "nodeName": "总经理审批",
      "assignees": [
        {
          "userId": "1",
          "name": "系统管理员",
          "status": "ACTIVE"
        }
      ]
    }
  ],
  "designerJson": {
    "nodes": [
      {
        "id": "mgr",
        "type": "approval",
        "name": "部门经理审批",
        "assigneeRules": [
          {
            "type": "LEADER",
            "level": 1
          }
        ],
        "multiMode": "ANY",
        "emptyStrategy": "TO_ADMIN"
      },
      {
        "id": "cond",
        "type": "condition",
        "name": "天数判断",
        "branches": [
          {
            "id": "b_gt3",
            "name": "天数大于3",
            "logic": "AND",
            "conditions": [
              {
                "field": "days",
                "operator": ">",
                "value": 3
              }
            ],
            "steps": [
              {
                "id": "gm",
                "type": "approval",
                "name": "总经理审批",
                "assigneeRules": [
                  {
                    "type": "ORG",
                    "refs": [
                      {
                        "kind": "USER",
                        "id": 1
                      }
                    ]
                  }
                ],
                "multiMode": "ANY",
                "emptyStrategy": "TO_ADMIN"
              }
            ]
          },
          {
            "id": "b_default",
            "name": "默认",
            "default": true,
            "steps": []
          }
        ]
      },
      {
        "id": "cc1",
        "type": "cc",
        "name": "抄送人事",
        "users": [
          {
            "kind": "USER",
            "id": 3
          }
        ]
      }
    ]
  }
} as unknown as LeaveTrackFixture
