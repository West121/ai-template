package com.hentor.oa.system.fieldperm;

import com.hentor.oa.common.fieldperm.FieldPerm;
import com.hentor.oa.common.fieldperm.FieldPermEntity;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.config.BeanDefinition;
import org.springframework.context.annotation.ClassPathScanningCandidateComponentProvider;
import org.springframework.core.type.filter.AnnotationTypeFilter;
import org.springframework.stereotype.Service;

import java.lang.reflect.RecordComponent;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 可控固定列目录（P3 附2 拍板：注解反射替代手工常量目录）：扫描 {@code com.hentor.oa} 下标注
 * {@link FieldPermEntity} 的 DTO record，收集 {@link FieldPerm} 组件 → feature → [{field,label}]。
 * 首次访问懒扫描 + 进程内缓存（运行期零反射；模式同 @ScriptApi/@AiManaged 启动收集）。
 * 只有标注解的列才进配置矩阵（天然白名单——没标的列后端脱敏不支持，不假装能控）。
 */
@Slf4j
@Service
public class FieldPermCatalogService {

    public record FixedColumn(String field, String label) {
    }

    private volatile Map<String, List<FixedColumn>> catalog;

    /** 某 feature 的可控固定列（无 → 空列表）。 */
    public List<FixedColumn> fixedColumns(String feature) {
        return catalog().getOrDefault(feature, List.of());
    }

    /** 全目录（feature → 列清单）。 */
    public Map<String, List<FixedColumn>> catalog() {
        Map<String, List<FixedColumn>> c = catalog;
        if (c == null) {
            synchronized (this) {
                if (catalog == null) {
                    catalog = scan();
                }
                c = catalog;
            }
        }
        return c;
    }

    private Map<String, List<FixedColumn>> scan() {
        Map<String, List<FixedColumn>> out = new LinkedHashMap<>();
        try {
            ClassPathScanningCandidateComponentProvider scanner =
                    new ClassPathScanningCandidateComponentProvider(false);
            scanner.addIncludeFilter(new AnnotationTypeFilter(FieldPermEntity.class));
            for (BeanDefinition bd : scanner.findCandidateComponents("com.hentor.oa")) {
                Class<?> clazz = Class.forName(bd.getBeanClassName());
                FieldPermEntity entity = clazz.getAnnotation(FieldPermEntity.class);
                if (entity == null || !clazz.isRecord()) {
                    continue;
                }
                List<FixedColumn> cols = out.computeIfAbsent(entity.feature(), k -> new ArrayList<>());
                for (RecordComponent comp : clazz.getRecordComponents()) {
                    FieldPerm fp = comp.getAnnotation(FieldPerm.class);
                    if (fp != null) {
                        cols.add(new FixedColumn(comp.getName(), fp.label()));
                    }
                }
            }
            log.info("字段权限固定列目录扫描完成：{} 个 feature {}", out.size(), out.keySet());
        } catch (Exception e) {
            log.warn("字段权限固定列目录扫描失败（目录降级为空）: {}", e.getMessage());
        }
        return out;
    }
}
