package com.xingchen.oa.workflow.engine.expression.functions;

import com.googlecode.aviator.runtime.function.AbstractFunction;
import com.googlecode.aviator.runtime.function.FunctionUtils;
import com.googlecode.aviator.runtime.type.AviatorNil;
import com.googlecode.aviator.runtime.type.AviatorObject;
import com.googlecode.aviator.runtime.type.AviatorString;
import com.xingchen.oa.infra.entity.SysDictItem;
import com.xingchen.oa.infra.entity.SysDictType;
import com.xingchen.oa.infra.repository.SysDictItemRepository;
import com.xingchen.oa.infra.repository.SysDictTypeRepository;
import com.xingchen.oa.workflow.engine.expression.FormulaFunction;
import lombok.RequiredArgsConstructor;

import java.util.Map;

/**
 * 公式函数 {@code dictLabel(dictCode, value)}：按字典类型编码 + 字典值取显示标签（String），无则 nil。
 * 示例 Tier1 白名单纯函数——只读字典数据、无副作用。
 *
 * <p>用法：条件里把编码值映射成可读文案再比较，或表单计算字段回显标签。
 */
@FormulaFunction("dictLabel(dictCode, value) → 字典项标签")
@RequiredArgsConstructor
public class DictLabelFunction extends AbstractFunction {

    private final SysDictTypeRepository dictTypeRepository;
    private final SysDictItemRepository dictItemRepository;

    @Override
    public String getName() {
        return "dictLabel";
    }

    @Override
    public AviatorObject call(Map<String, Object> env, AviatorObject arg1, AviatorObject arg2) {
        String dictCode = FunctionUtils.getStringValue(arg1, env);
        Object rawValue = FunctionUtils.getJavaObject(arg2, env);
        if (dictCode == null || dictCode.isBlank() || rawValue == null) {
            return AviatorNil.NIL;
        }
        String value = String.valueOf(rawValue);
        SysDictType type = dictTypeRepository.findByCode(dictCode).orElse(null);
        if (type == null) {
            return AviatorNil.NIL;
        }
        return dictItemRepository.findByTypeIdOrderBySortAscIdAsc(type.getId()).stream()
                .filter(i -> value.equals(i.getValue()))
                .map(SysDictItem::getLabel)
                .findFirst()
                .<AviatorObject>map(AviatorString::new)
                .orElse(AviatorNil.NIL);
    }
}
