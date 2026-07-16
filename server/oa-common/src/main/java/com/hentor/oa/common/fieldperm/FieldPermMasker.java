package com.hentor.oa.common.fieldperm;

import java.lang.reflect.Constructor;
import java.lang.reflect.RecordComponent;
import java.util.Set;

/**
 * 通用 record 脱敏器（P3）：对标注 {@link FieldPerm} 且命中不可见集的组件置 null，
 * 经规范构造器重建 record（record 不可变）。未命中/无注解/原始类型组件原样保留
 * （原始类型不可置 null——可控列应声明为包装/引用类型）。失败安全：任何反射异常返回原对象（不阻断响应）。
 */
public final class FieldPermMasker {

    private FieldPermMasker() {
    }

    @SuppressWarnings("unchecked")
    public static <T> T mask(T record, Set<String> invisibleFields) {
        if (record == null || invisibleFields == null || invisibleFields.isEmpty()
                || !record.getClass().isRecord()) {
            return record;
        }
        try {
            RecordComponent[] comps = record.getClass().getRecordComponents();
            Object[] args = new Object[comps.length];
            Class<?>[] types = new Class<?>[comps.length];
            boolean touched = false;
            for (int i = 0; i < comps.length; i++) {
                types[i] = comps[i].getType();
                args[i] = comps[i].getAccessor().invoke(record);
                if (args[i] != null && !types[i].isPrimitive()
                        && comps[i].isAnnotationPresent(FieldPerm.class)
                        && invisibleFields.contains(comps[i].getName())) {
                    args[i] = null;
                    touched = true;
                }
            }
            if (!touched) {
                return record;
            }
            Constructor<?> ctor = record.getClass().getDeclaredConstructor(types);
            ctor.setAccessible(true);
            return (T) ctor.newInstance(args);
        } catch (Exception e) {
            return record; // 失败安全：脱敏失败不阻断响应（宁可返回原值也不 500）
        }
    }
}
