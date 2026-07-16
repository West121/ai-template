/**
 * 全局测试 setup（i18n M2）：初始化 i18next（zh-CN 空 bundle）。
 *
 * 没有它，react-i18next 未初始化时 t("共 {{n}} 条", {n}) 会原样返回 "共 {{n}} 条"
 * （不做插值），带插值断言的存量测试会挂；初始化后与运行时 zh-CN 行为一致：
 * t(key, opts) = key（中文原样）+ 插值展开。测试内切语言的用例自行 setState({locale})。
 */
import "@/lib/i18n"
