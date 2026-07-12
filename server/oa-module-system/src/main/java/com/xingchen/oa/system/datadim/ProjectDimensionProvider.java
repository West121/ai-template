package com.xingchen.oa.system.datadim;

import com.xingchen.oa.system.repository.BizProjectRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * 项目维度 provider（code=project）。CUSTOM 可选值 = 启用的项目。
 */
@Component
@RequiredArgsConstructor
public class ProjectDimensionProvider implements DataDimensionProvider {

    public static final String CODE = "project";

    private final BizProjectRepository repository;

    @Override
    public String code() {
        return CODE;
    }

    @Override
    public List<DimensionOption> options() {
        return repository.findByEnabledTrueOrderByIdAsc().stream()
                .map(p -> new DimensionOption(p.getId(), p.getName()))
                .toList();
    }
}
