/**
 * 默认流程：员工请假审批
 *
 * 开始 → 提交请假申请 → 部门经理审批 → 请假天数≥3天?
 *   ├─ 是 → 总经理审批 → 人事备案
 *   └─ 否 → 人事备案
 * 人事备案 → 结束
 */
export const DEFAULT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_Leave" name="员工请假审批" isExecutable="false">
    <bpmn:startEvent id="StartEvent_1" name="开始">
      <bpmn:outgoing>Flow_Start</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:userTask id="Task_Submit" name="提交请假申请">
      <bpmn:incoming>Flow_Start</bpmn:incoming>
      <bpmn:outgoing>Flow_Submit</bpmn:outgoing>
    </bpmn:userTask>
    <bpmn:userTask id="Task_Manager" name="部门经理审批">
      <bpmn:incoming>Flow_Submit</bpmn:incoming>
      <bpmn:outgoing>Flow_Manager</bpmn:outgoing>
    </bpmn:userTask>
    <bpmn:exclusiveGateway id="Gateway_Days" name="请假天数≥3天?">
      <bpmn:incoming>Flow_Manager</bpmn:incoming>
      <bpmn:outgoing>Flow_Yes</bpmn:outgoing>
      <bpmn:outgoing>Flow_No</bpmn:outgoing>
    </bpmn:exclusiveGateway>
    <bpmn:userTask id="Task_GM" name="总经理审批">
      <bpmn:incoming>Flow_Yes</bpmn:incoming>
      <bpmn:outgoing>Flow_GM</bpmn:outgoing>
    </bpmn:userTask>
    <bpmn:userTask id="Task_HR" name="人事备案">
      <bpmn:incoming>Flow_No</bpmn:incoming>
      <bpmn:incoming>Flow_GM</bpmn:incoming>
      <bpmn:outgoing>Flow_End</bpmn:outgoing>
    </bpmn:userTask>
    <bpmn:endEvent id="EndEvent_1" name="结束">
      <bpmn:incoming>Flow_End</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_Start" sourceRef="StartEvent_1" targetRef="Task_Submit" />
    <bpmn:sequenceFlow id="Flow_Submit" sourceRef="Task_Submit" targetRef="Task_Manager" />
    <bpmn:sequenceFlow id="Flow_Manager" sourceRef="Task_Manager" targetRef="Gateway_Days" />
    <bpmn:sequenceFlow id="Flow_Yes" name="是" sourceRef="Gateway_Days" targetRef="Task_GM" />
    <bpmn:sequenceFlow id="Flow_No" name="否" sourceRef="Gateway_Days" targetRef="Task_HR" />
    <bpmn:sequenceFlow id="Flow_GM" sourceRef="Task_GM" targetRef="Task_HR" />
    <bpmn:sequenceFlow id="Flow_End" sourceRef="Task_HR" targetRef="EndEvent_1" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_Leave">
      <bpmndi:BPMNShape id="StartEvent_1_di" bpmnElement="StartEvent_1">
        <dc:Bounds x="160" y="200" width="36" height="36" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="167" y="243" width="22" height="14" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Submit_di" bpmnElement="Task_Submit">
        <dc:Bounds x="250" y="178" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Manager_di" bpmnElement="Task_Manager">
        <dc:Bounds x="400" y="178" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Gateway_Days_di" bpmnElement="Gateway_Days" isMarkerVisible="true">
        <dc:Bounds x="550" y="193" width="50" height="50" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="529" y="250" width="92" height="14" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_GM_di" bpmnElement="Task_GM">
        <dc:Bounds x="670" y="68" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_HR_di" bpmnElement="Task_HR">
        <dc:Bounds x="820" y="178" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="EndEvent_1_di" bpmnElement="EndEvent_1">
        <dc:Bounds x="970" y="200" width="36" height="36" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="977" y="243" width="22" height="14" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_Start_di" bpmnElement="Flow_Start">
        <di:waypoint x="196" y="218" />
        <di:waypoint x="250" y="218" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_Submit_di" bpmnElement="Flow_Submit">
        <di:waypoint x="350" y="218" />
        <di:waypoint x="400" y="218" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_Manager_di" bpmnElement="Flow_Manager">
        <di:waypoint x="500" y="218" />
        <di:waypoint x="550" y="218" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_Yes_di" bpmnElement="Flow_Yes">
        <di:waypoint x="575" y="193" />
        <di:waypoint x="575" y="108" />
        <di:waypoint x="670" y="108" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="584" y="141" width="14" height="14" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_No_di" bpmnElement="Flow_No">
        <di:waypoint x="600" y="218" />
        <di:waypoint x="820" y="218" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="703" y="196" width="14" height="14" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_GM_di" bpmnElement="Flow_GM">
        <di:waypoint x="770" y="108" />
        <di:waypoint x="870" y="108" />
        <di:waypoint x="870" y="178" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_End_di" bpmnElement="Flow_End">
        <di:waypoint x="920" y="218" />
        <di:waypoint x="970" y="218" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`

/** 新建流程时使用的空白模板（仅含一个开始事件） */
export const EMPTY_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_Blank" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_Blank" isExecutable="false">
    <bpmn:startEvent id="StartEvent_1" name="开始" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_Blank">
      <bpmndi:BPMNShape id="StartEvent_1_di" bpmnElement="StartEvent_1">
        <dc:Bounds x="200" y="200" width="36" height="36" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="207" y="243" width="22" height="14" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`
