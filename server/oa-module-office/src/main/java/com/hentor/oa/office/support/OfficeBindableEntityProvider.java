package com.hentor.oa.office.support;

import com.hentor.oa.system.datadim.BindableEntityProvider;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * office 可绑列目录（V51 绑定白名单）：P1 仅 Approval（multiDim 唯一接入点）。
 * P2 各实体接 multiDim 时在此追加（BizDoc/Document/Leave/Trip）。列=JPA 属性名。
 */
@Component
public class OfficeBindableEntityProvider implements BindableEntityProvider {

    @Override
    public List<BindableEntity> bindableEntities() {
        return List.of(new BindableEntity("Approval", "审批单", List.of(
                new BindableColumn("costCenterId", "成本中心列"),
                new BindableColumn("projectId", "项目列"))));
    }
}
