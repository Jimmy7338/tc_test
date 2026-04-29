#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json
import subprocess
import tempfile
import threading
import webbrowser
import shutil
import os
import sys
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parent
DEFAULT_SCRIPT = PROJECT_ROOT / "tc_topscan_master.js"
DEFAULT_SIDE_SCRIPT = PROJECT_ROOT / "tc_Lateral_1.js"
RUNNER = ROOT / "tc_script_runner.js"
CASE_GENERATOR = ROOT / "tc_case_generator.py"
RESULT_DIR = PROJECT_ROOT / "result_tmp"

DEFAULT_TOP_INPUT = {
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
        "is_box_pass_line": "false",
    },
    "vnlib": {
        "separator": "|",
        "missedTriggerCountDuringTask": 0,
        "boxCoordinates": "[]",
        "boxLineCoordinates": "[]",
        "boxDirection": 0,
        "onlineSlaveCount": 0,
        "slaveRoiIndex": "{}",
        "roiPoints": "[]",
    },
    "globalStringStore": {},
    "globalNumericStore": {},
}

DEFAULT_SIDE_INPUT = {
    "timeoutMs": 5000,
    "injected": {
        "is_box_pass_line": False,
    },
    "vnlib": {
        "separator": "|",
        "missedTriggerCountDuringTask": 0,
        "boxCoordinates": "[[{\"x\":3998,\"y\":1663},{\"x\":4308,\"y\":3323},{\"x\":2191,\"y\":3682},{\"x\":1833,\"y\":2021}]]",
        "boxLineCoordinates": "[[{\"x\":1460,\"y\":1630},{\"x\":3380,\"y\":1790}]]",
        "boxDirection": 3,
        "onlineSlaveCount": 1,
        "slaveRoiIndex": "{\"1\":-1}",
        "roiPoints": "[{\"index\":0,\"points\":[{\"x\":840,\"y\":1300},{\"x\":5400,\"y\":1300},{\"x\":840,\"y\":3640},{\"x\":5400,\"y\":3640}]},{\"index\":1,\"points\":[{\"x\":820,\"y\":140},{\"x\":5460,\"y\":140},{\"x\":820,\"y\":3640},{\"x\":5460,\"y\":3640}]}]",
        "invokeCallbackName": "SetRoiIndex",
        "invokeCallbackArg": False,
        "autoInvokeRegisterCallback": True,
        "autoInvokeSetRoiIndex": True,
    },
    "globalStringStore": {},
    "globalNumericStore": {},
}


def resolve_node_bin():
    candidates = [shutil.which("node"), shutil.which("nodejs")]
    if os.name == "nt":
        user_profile = os.environ.get("USERPROFILE", "")
        local_app_data = os.environ.get("LOCALAPPDATA", "")
        program_files = os.environ.get("ProgramFiles", r"C:\Program Files")
        program_files_x86 = os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")
        candidates.extend([
            str(Path(program_files) / "nodejs" / "node.exe"),
            str(Path(program_files_x86) / "nodejs" / "node.exe"),
            str(Path(local_app_data) / "Programs" / "nodejs" / "node.exe"),
            str(Path(user_profile) / "scoop" / "apps" / "nodejs-lts" / "current" / "node.exe"),
        ])
    else:
        candidates.extend(["/usr/bin/node", "/usr/local/bin/node", "/bin/node"])

    seen = set()
    for item in candidates:
        if item and item not in seen and Path(item).exists():
            seen.add(item)
            return str(Path(item))
    return None


def build_runtime_env():
    env = os.environ.copy()
    if os.name == "nt":
        machine_path = env.get("Path", "")
        user_path = env.get("PATH", "")
        merged = ";".join([p for p in [machine_path, user_path] if p])
        if merged:
            env["Path"] = merged
            env["PATH"] = merged
    return env


def run_case(script_path: Path, test_input: dict):
    if not script_path.exists():
        fallback_script = PROJECT_ROOT / script_path.name
        if fallback_script.exists():
            script_path = fallback_script
    if not script_path.exists():
        fallback_script = ROOT / script_path.name
        if fallback_script.exists():
            script_path = fallback_script
    if not script_path.exists():
        raise FileNotFoundError(f"脚本不存在: {script_path}")
    if not RUNNER.exists():
        raise FileNotFoundError(f"Runner 不存在: {RUNNER}")
    node_bin = resolve_node_bin()
    if not node_bin:
        raise RuntimeError(
            "未找到 Node.js 可执行文件（node/nodejs）。请安装 Node.js，"
            "或确认 node 已加入 PATH。"
        )

    RESULT_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    out_json = RESULT_DIR / f"test_result_{timestamp}.json"
    out_log = RESULT_DIR / f"test_result_{timestamp}.log.txt"

    with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".json", delete=False) as tmpf:
        json.dump(test_input, tmpf, ensure_ascii=False, indent=2)
        input_json_path = Path(tmpf.name)

    cmd = [
        node_bin,
        str(RUNNER),
        "--script",
        str(script_path),
        "--input",
        str(input_json_path),
        "--output",
        str(out_json),
    ]

    completed = subprocess.run(
        cmd,
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        env=build_runtime_env(),
    )

    if not out_json.exists():
        raise RuntimeError("执行失败，未生成结果文件。\nstdout:\n%s\nstderr:\n%s" % (completed.stdout, completed.stderr))

    result = json.loads(out_json.read_text(encoding="utf-8"))

    lines = []
    lines.append("=" * 80)
    lines.append(f"执行时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    lines.append(f"运行状态: {'成功' if result.get('ok') else '失败'}")
    lines.append(f"耗时: {result.get('elapsedMs')} ms")
    lines.append(f"日志条数: {result.get('logCount')} | 输出条数: {result.get('outputCount')}")
    lines.append("-" * 80)
    lines.append("[VNLib.Log]")
    logs = result.get("logs", [])
    if logs:
        for idx, line in enumerate(logs, 1):
            lines.append(f"{idx:04d}. {line}")
    else:
        lines.append("(无)")

    lines.append("-" * 80)
    lines.append("[Callback Results]")
    callback_results = result.get("callbackResults", [])
    if callback_results:
        lines.append(json.dumps(callback_results, ensure_ascii=False, indent=2))
    else:
        lines.append("(无)")

    lines.append("-" * 80)
    lines.append("[VNLib.SendOutput]")
    outputs = result.get("outputs", [])
    if outputs:
        for idx, line in enumerate(outputs, 1):
            lines.append(f"{idx:04d}. {line}")
    else:
        lines.append("(无)")

    if result.get("error"):
        lines.append("-" * 80)
        lines.append("[执行异常]")
        lines.append(json.dumps(result["error"], ensure_ascii=False, indent=2))

    if completed.stderr.strip():
        lines.append("-" * 80)
        lines.append("[Node stderr]")
        lines.append(completed.stderr.strip())

    text_result = "\n".join(lines)
    out_log.write_text(text_result, encoding="utf-8")
    return result, text_result, out_json, out_log


def parse_test_cases_input(input_text: str):
    text = input_text.strip()
    if not text:
        raise ValueError("测试输入不能为空。")

    # 优先尝试标准 JSON：单对象或对象数组
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return [parsed]
        if isinstance(parsed, list):
            if not parsed:
                raise ValueError("测试用例数组不能为空。")
            for idx, item in enumerate(parsed, 1):
                if not isinstance(item, dict):
                    raise ValueError(f"测试用例数组第 {idx} 项不是 JSON 对象。")
            return parsed
        raise ValueError("输入必须是 JSON 对象或 JSON 对象数组。")
    except json.JSONDecodeError:
        pass

    # 兼容“连续多个 JSON 对象”输入模式
    decoder = json.JSONDecoder()
    pos = 0
    length = len(text)
    cases = []
    while pos < length:
        while pos < length and text[pos].isspace():
            pos += 1
        if pos >= length:
            break
        obj, end_pos = decoder.raw_decode(text, pos)
        if not isinstance(obj, dict):
            raise ValueError("连续输入模式下，每个测试用例都必须是 JSON 对象。")
        cases.append(obj)
        pos = end_pos
    if not cases:
        raise ValueError("无法解析测试输入，请检查 JSON 格式。")
    return cases


def run_cases(script_path: Path, input_text: str):
    cases = parse_test_cases_input(input_text)
    run_results = []
    text_parts = []

    total = len(cases)
    success = 0
    fail = 0

    for idx, case_input in enumerate(cases, 1):
        try:
            result, text_result, out_json, out_log = run_case(script_path, case_input)
            run_results.append({
                "index": idx,
                "ok": bool(result.get("ok")),
                "result_path": out_json,
                "log_path": out_log,
                "raw": result,
            })
            if result.get("ok"):
                success += 1
            else:
                fail += 1
            text_parts.append(
                f"{'=' * 28} 用例 {idx}/{total} {'=' * 28}\n"
                f"{text_result}\n"
                f"日志已保存: {out_log}\n结构化结果已保存: {out_json}\n"
            )
        except Exception as exc:
            fail += 1
            run_results.append({
                "index": idx,
                "ok": False,
                "result_path": None,
                "log_path": None,
                "raw": {"error": str(exc)},
            })
            text_parts.append(
                f"{'=' * 28} 用例 {idx}/{total} {'=' * 28}\n"
                f"运行失败: {exc}\n"
            )

    summary = (
        f"批量运行完成：共 {total} 个用例，成功 {success}，失败 {fail}\n"
        + "-" * 80
        + "\n"
    )
    return run_results, summary + "\n".join(text_parts)


def run_tk_mode():
    import tkinter as tk
    from tkinter import filedialog, messagebox, scrolledtext, ttk

    class VisualTesterApp:
        def __init__(self, master: tk.Tk):
            self.master = master
            self.master.title("TC 脚本可视化测试工具")
            self.master.geometry("1320x900")
            self.master.minsize(1120, 760)
            self.current_theme = "light"
            self.test_mode_var = tk.StringVar(value="top")
            self.script_path_var = tk.StringVar(value=str(DEFAULT_SCRIPT))
            self.log_keyword_var = tk.StringVar(value="")
            self.last_result_path = None
            self._search_keyword = ""
            self._search_hits = []
            self._search_index = -1
            self._init_styles()
            self._build_layout()
            self.apply_theme(self.current_theme)
            self._fill_default_input()

        def _init_styles(self):
            style = ttk.Style(self.master)
            try:
                style.theme_use("clam")
            except Exception:
                pass
            style.configure("App.TFrame", background="#f5f7fb")
            style.configure("Card.TLabelframe", background="#ffffff", bordercolor="#dce3ef")
            style.configure("Card.TLabelframe.Label", background="#ffffff", foreground="#1f2a44", font=("Microsoft YaHei UI", 10, "bold"))
            style.configure("App.TLabel", background="#f5f7fb", foreground="#1f2a44", font=("Microsoft YaHei UI", 10))
            style.configure("Hint.TLabel", background="#f5f7fb", foreground="#63708a", font=("Microsoft YaHei UI", 9))
            style.configure("Primary.TButton", font=("Microsoft YaHei UI", 10, "bold"))
            style.configure("App.TButton", font=("Microsoft YaHei UI", 9))

        def _get_theme_palette(self, theme_name: str):
            if theme_name == "dark":
                return {
                    "window_bg": "#1b1f2a",
                    "card_bg": "#232a3a",
                    "text_fg": "#e6ecff",
                    "muted_fg": "#9aa6bf",
                    "border": "#313b54",
                    "input_bg": "#1f2636",
                    "output_bg": "#1f2636",
                    "insert_fg": "#e6ecff",
                    "search_hit": "#665c2f",
                    "search_current": "#8a5b24",
                }
            return {
                "window_bg": "#f5f7fb",
                "card_bg": "#ffffff",
                "text_fg": "#1f2a44",
                "muted_fg": "#63708a",
                "border": "#dce3ef",
                "input_bg": "#fcfdff",
                "output_bg": "#fbfcff",
                "insert_fg": "#1f2a44",
                "search_hit": "#ffe58f",
                "search_current": "#ffb347",
            }

        def apply_theme(self, theme_name: str):
            palette = self._get_theme_palette(theme_name)
            style = ttk.Style(self.master)
            self.master.configure(bg=palette["window_bg"])
            style.configure("App.TFrame", background=palette["window_bg"])
            style.configure("Card.TLabelframe", background=palette["card_bg"], bordercolor=palette["border"])
            style.configure("Card.TLabelframe.Label", background=palette["card_bg"], foreground=palette["text_fg"])
            style.configure("App.TLabel", background=palette["window_bg"], foreground=palette["text_fg"])
            style.configure("Hint.TLabel", background=palette["window_bg"], foreground=palette["muted_fg"])

            if hasattr(self, "input_text"):
                self.input_text.configure(
                    background=palette["input_bg"],
                    foreground=palette["text_fg"],
                    insertbackground=palette["insert_fg"],
                )
            if hasattr(self, "output_text"):
                self.output_text.configure(
                    background=palette["output_bg"],
                    foreground=palette["text_fg"],
                    insertbackground=palette["insert_fg"],
                )
                self.output_text.tag_configure("search_hit", background=palette["search_hit"])
                self.output_text.tag_configure("search_current", background=palette["search_current"])

            if hasattr(self, "splitter"):
                self.splitter.configure(bg=palette["window_bg"])
            if hasattr(self, "theme_toggle_btn"):
                self.theme_toggle_btn.configure(text="切换浅色" if theme_name == "dark" else "切换深色")

        def toggle_theme(self):
            self.current_theme = "dark" if self.current_theme == "light" else "light"
            self.apply_theme(self.current_theme)

        def _build_layout(self):
            root = ttk.Frame(self.master, style="App.TFrame", padding=(12, 10, 12, 12))
            root.pack(fill=tk.BOTH, expand=True)

            header = ttk.Frame(root, style="App.TFrame")
            header.pack(fill=tk.X, pady=(0, 8))
            ttk.Label(header, text="TC 脚本可视化测试工具", style="App.TLabel", font=("Microsoft YaHei UI", 13, "bold")).pack(side=tk.LEFT)
            ttk.Label(
                header,
                text=f"默认脚本: {DEFAULT_SCRIPT.name}   |   结果目录: {RESULT_DIR}",
                style="Hint.TLabel",
            ).pack(side=tk.RIGHT)

            path_card = ttk.LabelFrame(root, text="脚本配置", style="Card.TLabelframe", padding=(10, 8))
            path_card.pack(fill=tk.X, pady=(0, 8))
            ttk.Label(path_card, text="模式:", style="App.TLabel").pack(side=tk.LEFT)
            ttk.Combobox(
                path_card,
                textvariable=self.test_mode_var,
                state="readonly",
                values=["top", "side"],
                width=8,
            ).pack(side=tk.LEFT, padx=(6, 8))
            ttk.Button(path_card, text="应用模式", command=self.apply_test_mode, style="App.TButton").pack(side=tk.LEFT, padx=(0, 8))
            ttk.Label(path_card, text="脚本路径:", style="App.TLabel").pack(side=tk.LEFT)
            ttk.Entry(path_card, textvariable=self.script_path_var).pack(side=tk.LEFT, padx=8, fill=tk.X, expand=True)
            ttk.Button(path_card, text="选择脚本", command=self.choose_script, style="App.TButton").pack(side=tk.LEFT, padx=(0, 6))
            ttk.Button(path_card, text="恢复默认输入", command=self._fill_default_input, style="App.TButton").pack(side=tk.LEFT)

            toolbar = ttk.Frame(root, style="App.TFrame")
            toolbar.pack(fill=tk.X, pady=(0, 8))
            ttk.Button(toolbar, text="运行测试", command=self.run_test, style="Primary.TButton").pack(side=tk.LEFT)
            ttk.Button(toolbar, text="打开结果文件", command=self.open_result_file, style="App.TButton").pack(side=tk.LEFT, padx=8)
            ttk.Button(toolbar, text="清空输出区", command=self.clear_output, style="App.TButton").pack(side=tk.LEFT)
            ttk.Button(toolbar, text="打开生成器", command=self.open_case_generator, style="App.TButton").pack(side=tk.LEFT, padx=8)
            ttk.Button(toolbar, text="导入生成JSON", command=self.import_generated_json, style="App.TButton").pack(side=tk.LEFT)

            locate_card = ttk.LabelFrame(root, text="问题日志快速定位", style="Card.TLabelframe", padding=(10, 8))
            locate_card.pack(fill=tk.X, pady=(0, 8))
            ttk.Label(locate_card, text="关键词:", style="App.TLabel").pack(side=tk.LEFT)
            ttk.Entry(locate_card, textvariable=self.log_keyword_var, width=34).pack(side=tk.LEFT, padx=8)
            ttk.Button(locate_card, text="查找", command=self.find_keyword, style="App.TButton").pack(side=tk.LEFT)
            ttk.Button(locate_card, text="上一个", command=lambda: self.navigate_keyword(-1), style="App.TButton").pack(side=tk.LEFT, padx=4)
            ttk.Button(locate_card, text="下一个", command=lambda: self.navigate_keyword(1), style="App.TButton").pack(side=tk.LEFT, padx=(0, 8))
            ttk.Button(locate_card, text="定位异常", command=self.locate_issue_logs, style="App.TButton").pack(side=tk.LEFT, padx=(0, 4))
            ttk.Button(locate_card, text="InputSnapshot", command=lambda: self.quick_locate("InputSnapshot"), style="App.TButton").pack(side=tk.LEFT, padx=2)
            ttk.Button(locate_card, text="ROI", command=lambda: self.quick_locate("ROI filter"), style="App.TButton").pack(side=tk.LEFT, padx=2)
            ttk.Button(
                locate_card,
                text="最终输出",
                command=lambda: self.quick_locate("LastTaskOutputToAssistant"),
                style="App.TButton",
            ).pack(side=tk.LEFT, padx=2)

            self.theme_toggle_btn = ttk.Button(toolbar, text="切换深色", command=self.toggle_theme, style="App.TButton")
            self.theme_toggle_btn.pack(side=tk.RIGHT)

            self.splitter = tk.PanedWindow(root, orient=tk.VERTICAL, sashrelief=tk.FLAT, bg="#f5f7fb", sashwidth=8, bd=0)
            self.splitter.pack(fill=tk.BOTH, expand=True)

            input_frame = ttk.LabelFrame(self.splitter, text="测试输入 JSON（可编辑）", style="Card.TLabelframe", padding=(8, 8))
            self.input_text = scrolledtext.ScrolledText(
                input_frame,
                wrap=tk.NONE,
                font=("Consolas", 10),
                background="#fcfdff",
                foreground="#1f2a44",
                insertbackground="#1f2a44",
                relief=tk.FLAT,
                borderwidth=1,
            )
            self.input_text.pack(fill=tk.BOTH, expand=True)
            self.splitter.add(input_frame, height=320)

            output_frame = ttk.LabelFrame(self.splitter, text="运行结果（日志 + 输出）", style="Card.TLabelframe", padding=(8, 8))
            self.output_text = scrolledtext.ScrolledText(
                output_frame,
                wrap=tk.WORD,
                font=("Consolas", 10),
                background="#fbfcff",
                foreground="#1f2a44",
                insertbackground="#1f2a44",
                relief=tk.FLAT,
                borderwidth=1,
            )
            self.output_text.pack(fill=tk.BOTH, expand=True)
            self.output_text.tag_configure("search_hit", background="#ffe58f")
            self.output_text.tag_configure("search_current", background="#ffb347")
            self.splitter.add(output_frame, height=500)

        def _fill_default_input(self):
            selected = DEFAULT_TOP_INPUT if self.test_mode_var.get() == "top" else DEFAULT_SIDE_INPUT
            self._set_input_text(json.dumps(selected, indent=2, ensure_ascii=False))

        def apply_test_mode(self):
            mode = self.test_mode_var.get()
            if mode == "side":
                self.script_path_var.set(str(DEFAULT_SIDE_SCRIPT))
            else:
                self.script_path_var.set(str(DEFAULT_SCRIPT))
            self._fill_default_input()

        def _set_input_text(self, content: str):
            self.input_text.delete("1.0", tk.END)
            self.input_text.insert("1.0", content)

        def open_case_generator(self):
            if not CASE_GENERATOR.exists():
                messagebox.showerror("打开失败", f"未找到生成器脚本:\n{CASE_GENERATOR}")
                return
            python_exe = sys.executable or "python"
            try:
                subprocess.Popen([python_exe, str(CASE_GENERATOR)], cwd=str(ROOT))
            except Exception as exc:
                messagebox.showerror("打开失败", f"启动生成器失败:\n{exc}")

        def import_generated_json(self):
            selected = filedialog.askopenfilename(
                title="导入生成的测试 JSON",
                initialdir=str(RESULT_DIR),
                filetypes=[("JSON Files", "*.json"), ("All Files", "*.*")],
            )
            if not selected:
                return
            try:
                raw = Path(selected).read_text(encoding="utf-8")
                parse_test_cases_input(raw)
                self._set_input_text(raw)
                messagebox.showinfo("导入成功", f"已导入测试输入:\n{selected}")
            except Exception as exc:
                messagebox.showerror("导入失败", f"JSON 解析失败:\n{exc}")

        def choose_script(self):
            selected = filedialog.askopenfilename(
                title="选择要测试的脚本",
                initialdir=str(PROJECT_ROOT),
                filetypes=[("JavaScript Files", "*.js"), ("All Files", "*.*")],
            )
            if selected:
                self.script_path_var.set(selected)

        def clear_output(self):
            self.output_text.delete("1.0", tk.END)
            self._reset_search_state()

        def _reset_search_state(self):
            self._search_keyword = ""
            self._search_hits = []
            self._search_index = -1
            self.output_text.tag_remove("search_hit", "1.0", tk.END)
            self.output_text.tag_remove("search_current", "1.0", tk.END)

        def _collect_keyword_hits(self, keyword: str):
            self.output_text.tag_remove("search_hit", "1.0", tk.END)
            self.output_text.tag_remove("search_current", "1.0", tk.END)
            hits = []
            if not keyword:
                return hits
            start = "1.0"
            while True:
                idx = self.output_text.search(keyword, start, stopindex=tk.END, nocase=True)
                if not idx:
                    break
                end = f"{idx}+{len(keyword)}c"
                hits.append((idx, end))
                self.output_text.tag_add("search_hit", idx, end)
                start = end
            return hits

        def _focus_hit(self, hit_index: int):
            if not self._search_hits:
                return
            if hit_index < 0:
                hit_index = len(self._search_hits) - 1
            if hit_index >= len(self._search_hits):
                hit_index = 0
            self._search_index = hit_index
            self.output_text.tag_remove("search_current", "1.0", tk.END)
            start, end = self._search_hits[self._search_index]
            self.output_text.tag_add("search_current", start, end)
            self.output_text.see(start)

        def find_keyword(self):
            keyword = self.log_keyword_var.get().strip()
            if not keyword:
                messagebox.showinfo("提示", "请输入要查找的日志关键词。")
                return
            self._search_keyword = keyword
            self._search_hits = self._collect_keyword_hits(keyword)
            if not self._search_hits:
                messagebox.showinfo("提示", f"未找到关键词：{keyword}")
                return
            self._focus_hit(0)

        def navigate_keyword(self, direction: int):
            keyword = self.log_keyword_var.get().strip()
            if not keyword:
                messagebox.showinfo("提示", "请输入要查找的日志关键词。")
                return
            if keyword != self._search_keyword or not self._search_hits:
                self.find_keyword()
                return
            self._focus_hit(self._search_index + direction)

        def quick_locate(self, keyword: str):
            self.log_keyword_var.set(keyword)
            self.find_keyword()

        def locate_issue_logs(self):
            issue_keywords = [
                "[执行异常]",
                "[Node stderr]",
                "ReferenceError",
                "TypeError",
                "SyntaxError",
                "Processing error",
                "运行失败",
                "error",
                "exception",
                "failed",
            ]
            for kw in issue_keywords:
                hits = self._collect_keyword_hits(kw)
                if hits:
                    self.log_keyword_var.set(kw)
                    self._search_keyword = kw
                    self._search_hits = hits
                    self._focus_hit(0)
                    return
            messagebox.showinfo("提示", "未定位到明显异常关键词，可手动输入关键词查找。")

        def open_result_file(self):
            if not self.last_result_path:
                messagebox.showinfo("提示", "还没有结果文件，请先运行测试。")
                return
            messagebox.showinfo("结果文件", f"最新结果文件:\n{self.last_result_path}")

        def run_test(self):
            script_path = Path(self.script_path_var.get().strip())
            try:
                run_results, all_text = run_cases(script_path, self.input_text.get("1.0", tk.END))
                latest_result = next(
                    (item["result_path"] for item in reversed(run_results) if item.get("result_path")),
                    None,
                )
                self.last_result_path = latest_result
                self.output_text.delete("1.0", tk.END)
                self.output_text.insert("1.0", all_text)
                self.output_text.see(tk.END)
                self._reset_search_state()
            except Exception as exc:
                messagebox.showerror("运行失败", str(exc))

    root = tk.Tk()
    app = VisualTesterApp(root)
    root.mainloop()


def run_web_mode():
    default_json = json.dumps(DEFAULT_TOP_INPUT, ensure_ascii=False, indent=2)
    default_node = resolve_node_bin() or "<not-found>"

    class Handler(BaseHTTPRequestHandler):
        def _send_json(self, payload, code=200):
            raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def do_GET(self):
            if self.path != "/":
                self.send_response(404)
                self.end_headers()
                return
            html = f"""<!doctype html>
<html><head><meta charset="utf-8"><title>TC 脚本可视化测试工具</title>
<style>
body{{font-family:Arial;margin:16px}} textarea{{width:100%;height:360px;font-family:Consolas,monospace}}
input{{width:100%;padding:6px}} button{{padding:8px 14px;margin-right:8px}} pre{{background:#111;color:#ddd;padding:12px;white-space:pre-wrap}}
</style></head><body>
<h2>TC 脚本可视化测试工具（Web 模式）</h2>
<div style="margin-bottom:8px;color:#666">Runner: {str(RUNNER)} | Node: {default_node}</div>
<div>脚本路径</div><input id="script" value="{str(DEFAULT_SCRIPT)}"/>
<div style="margin-top:8px">测试输入 JSON</div><textarea id="input">{default_json}</textarea>
<div style="margin-top:8px"><button onclick="runTest()">运行测试</button></div>
<div id="meta" style="margin-top:8px;color:#333"></div>
<pre id="out"></pre>
<script>
async function runTest(){{
  const payload={{script:document.getElementById('script').value,inputText:document.getElementById('input').value}};
  const res=await fetch('/run',{{method:'POST',headers:{{'Content-Type':'application/json'}},body:JSON.stringify(payload)}});
  const data=await res.json();
  if(!data.ok){{document.getElementById('meta').innerText='运行失败';document.getElementById('out').innerText=data.error||'unknown';return;}}
  document.getElementById('meta').innerText='结果文件: '+data.resultFile+' | 日志文件: '+data.logFile;
  document.getElementById('out').innerText=data.textResult;
}}
</script></body></html>"""
            raw = html.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def do_POST(self):
            if self.path != "/run":
                self._send_json({"ok": False, "error": "not found"}, 404)
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                body = self.rfile.read(length).decode("utf-8")
                payload = json.loads(body)
                script_path = Path(payload.get("script", "")).expanduser().resolve()
                run_results, text_result = run_cases(script_path, payload.get("inputText", "{}"))
                result_files = [str(item["result_path"]) for item in run_results if item.get("result_path")]
                log_files = [str(item["log_path"]) for item in run_results if item.get("log_path")]
                self._send_json({
                    "ok": True,
                    "resultFiles": result_files,
                    "logFiles": log_files,
                    "textResult": text_result,
                })
            except Exception as exc:
                self._send_json({"ok": False, "error": str(exc)}, 500)

        def log_message(self, format, *args):
            return

    host = "127.0.0.1"
    port = 8765
    server = ThreadingHTTPServer((host, port), Handler)
    url = f"http://{host}:{port}/"
    print("检测到 tkinter 不可用，已切换到 Web 可视化模式。")
    print("打开浏览器访问:", url)
    threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    server.serve_forever()


def main():
    force_web = "--web" in sys.argv[1:]
    force_gui = "--gui" in sys.argv[1:]
    if force_web and force_gui:
        raise RuntimeError("参数冲突：--web 与 --gui 不能同时使用。")
    if force_web:
        run_web_mode()
        return

    try:
        import tkinter  # noqa: F401
        # Windows / macOS 默认走本地 GUI；Linux 无显示环境才回退 Web。
        if not force_gui and os.name != "nt" and sys.platform != "darwin" and not os.environ.get("DISPLAY"):
            run_web_mode()
            return
        try:
            run_tk_mode()
        except Exception as exc:
            if "no display name" in str(exc).lower() or "no $display" in str(exc).lower():
                run_web_mode()
                return
            raise
    except ModuleNotFoundError:
        run_web_mode()


if __name__ == "__main__":
    main()
