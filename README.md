# TC 工程总览（目录/文档/代码作用说明）

本仓库用于维护 TC 现场脚本、回归测试工具、业务文档与调试技能，核心目标是：  
在不依赖设备现场实时联调的情况下，完成顶扫/侧扫脚本开发、问题复盘、回归验证。

## 根目录文件作用

- `tc_topscan_master.js`：顶扫主脚本主线版本（当前常用业务脚本）。
- `tc_topscan_master_rb.js`：顶扫脚本 RB 分支/变体版本（用于版本对比或灰度验证）。
- `tc_topscan_node.js`：顶扫脚本的 Node 兼容/调试版本。
- `tc_before.js`：历史基线脚本（用于回归比对与行为追溯）。
- `tc_Lateral_1.js`：侧扫脚本（设备/通道 1）。
- `tc_Lateral_2.js`：侧扫脚本（设备/通道 2）。
- `.gitignore`：Git 忽略规则（日志、临时结果等）。
- `README.md`：仓库导航与使用说明（本文件）。

## 目录结构与职责

### `tc_test_app`

用于本地回归验证与批量测试。

- `tc_visual_test_app.py`：可视化测试入口（GUI/Web 模式），用于加载脚本与测试输入并执行。
- `tc_script_runner.js`：脚本运行器，模拟运行时注入变量（`VNLib`、`GlobalString` 等）并回收输出。
- `compare_topscan_scripts.js`：两个脚本版本的输出对比工具（用于回归差异分析）。
- `topscan_stress_compare.js`：顶扫压力/批量对比测试脚本。
- `tc_case_generator.py`：测试用例生成器（便于批量造数）。
- `topscan_regression_cases.json`：顶扫常规回归用例集合。
- `topscan_regression_cases_edge.json`：边界/异常场景用例集合。

### `docs`

业务和时序文档，用于理解脚本执行链路与规则背景。

- `脚本功能分析文档.md`：业务规则分解与字段说明。
- `脚本模块执行时序流程.md`：脚本模块级执行流程说明。
- `顶扫与侧扫脚本运行时序与时序图.md`：顶扫/侧扫协同时序与图示。

### `.cursor/skills/tc-script-development`

面向排障与脚本开发的技能知识库（供 Agent/工程师复用）。

- `SKILL.md`：主技能文档，包含排障流程、ROI 规则、版本差异经验等。
- `runtime-reference.md`：运行时对象/注入变量/接口参考。
- `troubleshooting.md`：问题定位方法与常见故障模式。
- `script-patterns.md`：常用脚本改造模式与注意事项。
- `system-business-safe-guide.md`：系统与业务安全约束说明。
- `scripts/extract_log_context.py`：日志抽取脚本（按任务/问题聚焦上下文）。

## 常见输出与临时文件

- `result_tmp/`（若存在）：本地回归结果目录，通常包含 `test_result_*.json` 与 `*.log.txt`。
- 根目录 `*.log`（如现场日志、`notes.log`）：临时排障输入，通常不应长期保留在仓库。

## 推荐工作流

1. 在目标脚本（如 `tc_topscan_master.js` 或 `tc_topscan_master_rb.js`）修改规则。  
2. 用 `tc_test_app/tc_visual_test_app.py` 执行回归（单例/批量）。  
3. 必要时用 `compare_topscan_scripts.js` 对比新旧脚本输出差异。  
4. 结合 `docs/` 与 `SKILL.md` 校验业务逻辑和时序一致性。  
5. 清理无用日志与临时产物后再提交。  

## 环境要求（建议）

- Python 3.12+
- Node.js LTS

Windows 快速检查：

```powershell
python --version
node --version
npm --version
```
