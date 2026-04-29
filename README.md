# TC 脚本测试工程说明

本目录用于维护和测试 TC 下位机脚本，重点关注顶扫主机脚本在 PC 端的独立验证。

## 1. 目录定位

- 业务主脚本（当前最关注）：`tc_topscan_master.js`
- 其他脚本（按现场需求使用）：`tc_topscan_node.js`、`tc_Lateral_1.js`、`tc_Lateral_2.js`
- 测试程序目录：`tc_test_app`
  - 可视化测试程序：`tc_test_app/tc_visual_test_app.py`
  - 用例生成器（可视化）：`tc_test_app/tc_case_generator.py`
  - Node 执行器：`tc_test_app/tc_script_runner.js`
- 测试结果目录：`result_tmp`
  - 结构化结果：`test_result_*.json`
  - 可读日志：`test_result_*.log.txt`
- 文档资料：`脚本功能分析文档.md`、`脚本模块执行时序流程.md`、`runtime-reference.md`、`troubleshooting.md`

## 2. 推荐工作流

1. 在 `tc_topscan_master.js` 上做规则修改。
2. 启动 `tc_test_app/tc_visual_test_app.py`（PC GUI）。
3. 在 GUI 中选择测试模式（`top` 顶扫 / `side` 侧扫）。
4. 在 GUI 中编辑或导入测试输入 JSON（支持单用例/多用例）。
5. 点击“运行测试”，查看日志、回调结果和输出结果。
6. 到 `result_tmp` 对照 `json` 与 `log.txt` 做回归确认。

## 3. 环境要求

- Python 3.12+（建议）
- Node.js LTS（用于执行 `tc_script_runner.js`）

Windows 快速检查：

```powershell
python --version
node --version
npm --version
```

## 4. 启动测试程序

在项目根目录执行：

```powershell
python "f:\tc\tc_test_app\tc_visual_test_app.py" --gui
```

生成测试输入 JSON（可视化）：

```powershell
python "f:\tc\tc_test_app\tc_case_generator.py"
```

常用模式：

- `--gui`：强制 PC 图形界面
- `--web`：强制 Web 模式（无图形环境时备用）

## 5. 默认路径约定（已按当前项目调整）

- 默认测试脚本：`f:\tc\tc_topscan_master.js`
- Runner 路径：`f:\tc\tc_test_app\tc_script_runner.js`
- 结果输出目录：`f:\tc\result_tmp`

## 6. 测试输入格式

### 6.1 单个测试用例

```json
{
  "timeoutMs": 5000,
  "injected": {
    "code": "1Z1234567890|[)>\\u001E01\\u001DABC\\u001D1Z1234567890\\u001E",
    "center": "{100,200}|{120,220}",
    "ROI_number": "1|2",
    "time": "2026/04/28 10:20:30:123",
    "device_number": "1|2",
    "strStored": "",
    "strTcpStored": "",
    "box_coordinate": "[]",
    "is_box_pass_line": "false"
  },
  "vnlib": {
    "separator": "|",
    "missedTriggerCountDuringTask": 0,
    "boxCoordinates": "[]",
    "boxLineCoordinates": "[]",
    "boxDirection": 0,
    "onlineSlaveCount": 0,
    "slaveRoiIndex": "{}",
    "roiPoints": "[]"
  },
  "globalStringStore": {},
  "globalNumericStore": {}
}
```

### 6.2 多个测试用例（一次性运行）

支持两种写法：

1) JSON 数组（推荐）

```json
[
  { "timeoutMs": 5000, "injected": {}, "vnlib": {}, "globalStringStore": {}, "globalNumericStore": {} },
  { "timeoutMs": 5000, "injected": {}, "vnlib": {}, "globalStringStore": {}, "globalNumericStore": {} }
]
```

2) 连续多个 JSON 对象（不包数组）

```json
{ "timeoutMs": 5000, "injected": {}, "vnlib": {}, "globalStringStore": {}, "globalNumericStore": {} }
{ "timeoutMs": 5000, "injected": {}, "vnlib": {}, "globalStringStore": {}, "globalNumericStore": {} }
```

## 7. 结果文件说明

- `test_result_*.json`
  - `ok`：是否执行成功
  - `logs`：脚本内 `VNLib.Log` 输出
  - `outputs`：脚本内 `VNLib.SendOutput` 输出
  - `globalStringStore/globalNumericStore`：脚本执行后状态
- `test_result_*.log.txt`
  - 面向测试人员的可读摘要（时间、耗时、日志、输出、异常）

## 8. 常见问题

- 终端执行 GUI “没反应”
  - GUI 程序启动后通常不会在终端持续打印日志，需看桌面窗口是否弹出。
- 提示未找到 Node.js
  - 安装 Node.js，并确认 `node --version` 可用。
- 提示脚本不存在
  - 检查脚本路径是否为 `f:\tc\tc_topscan_master.js` 或在 GUI 里重新选择脚本。
- 多用例运行时结果覆盖
  - 当前结果文件名已包含微秒时间戳，默认不会覆盖。

## 9. 维护建议

- 规则变更优先改 `tc_topscan_master.js`，再用 `tc_test_app` 回归验证。
- 关键变更后更新同目录业务文档，确保测试人员与脚本逻辑一致。
