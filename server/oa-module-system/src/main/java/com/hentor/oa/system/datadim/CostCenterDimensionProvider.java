package com.hentor.oa.system.datadim;

import com.hentor.oa.system.entity.SysCostCenter;
import com.hentor.oa.system.repository.SysCostCenterRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * 成本中心维度 provider（code=costCenter）。CUSTOM 可选值 = 启用的成本中心。
 */
@Component
@RequiredArgsConstructor
public class CostCenterDimensionProvider implements DataDimensionProvider {

    public static final String CODE = "costCenter";

    private final SysCostCenterRepository repository;

    @Override
    public String code() {
        return CODE;
    }

    @Override
    public List<DimensionOption> options() {
        return repository.findByEnabledTrueOrderByIdAsc().stream()
                .map(c -> new DimensionOption(c.getId(), c.getName()))
                .toList();
    }
}
