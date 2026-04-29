#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json
import random
import tkinter as tk
from copy import deepcopy
from datetime import datetime
from pathlib import Path
from tkinter import filedialog, messagebox, scrolledtext, ttk


PROJECT_ROOT = Path(__file__).resolve().parent.parent
RESULT_DIR = PROJECT_ROOT / "result_tmp"
DEFAULT_SEPARATOR = "($#;#$)"


def now_time_str():
    return datetime.now().strftime("%Y/%m/%d %H:%M:%S:%f")[:-3]


def default_case():
    return {
        "timeoutMs": 5000,
        "injected": {
            "code": "",
            "center": "",
            "ROI_number": "",
            "time": now_time_str(),
            "device_number": "",
            "strStored": "",
            "strTcpStored": "",
            "box_coordinate": "",
            "is_box_pass_line": "",
        },
        "vnlib": {
            "separator": DEFAULT_SEPARATOR,
            "missedTriggerCountDuringTask": 0,
            "boxCoordinates": "[]",
            "boxLineCoordinates": "[]",
            "boxDirection": 0,
            "onlineSlaveCount": 1,
            "slaveRoiIndex": "{\"1\":-1}",
            "roiPoints": "[{\"index\":0,\"points\":[{\"x\":840,\"y\":1300},{\"x\":5400,\"y\":1300},{\"x\":840,\"y\":3640},{\"x\":5400,\"y\":3640}]},{\"index\":1,\"points\":[{\"x\":820,\"y\":140},{\"x\":5460,\"y\":140},{\"x\":820,\"y\":3640},{\"x\":5460,\"y\":3640}]}]",
        },
        "globalStringStore": {},
        "globalNumericStore": {},
    }

def default_side_case():
    return {
        "timeoutMs": 5000,
        "injected": {
            "is_box_pass_line": False,
        },
        "vnlib": {
            "separator": DEFAULT_SEPARATOR,
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


def build_center(index):
    x = round(1800 + index * 530 + random.random() * 70, 2)
    y = round(1200 + index * 350 + random.random() * 90, 2)
    return f"{{{x},{y}}}"


def build_onez(index):
    tail = 88000000 + index * 137
    return f"1Z8252200388{tail}"


def build_maxicode(index, onez_value):
    return f"[)>\u001e01\u001d96951120000\u001d840\u001d003\u001d{onez_value}\u001dUPSN\u001d825220\u001e07QO-CASE-{index:03d}\u001dS\u000d\u001e\u0004"


def build_postal(index):
    return f"{42090000 + index:08d}"


def build_special_1d(index):
    return f"BSP{300000 + index}"


def to_joined(values, sep):
    return sep.join(values)


def apply_scenario(case_data, scenario, code_count, barcode_type, per_code_types, roi_mode, history_count, command_mode, missed_count):
    sep = case_data["vnlib"]["separator"]
    codes = []
    centers = []
    rois = []
    devices = []

    count = max(1, code_count)
    onez_list = [build_onez(i) for i in range(1, count + 1)]
    qr_list = [build_maxicode(i, onez_list[i - 1]) for i in range(1, count + 1)]
    postal_list = [build_postal(i) for i in range(1, count + 1)]
    special_list = [build_special_1d(i) for i in range(1, count + 1)]

    history_source_codes = []

    if scenario == "normal_pair":
        codes = pick_codes_by_sequence(per_code_types, onez_list, qr_list, postal_list, special_list, code_count, barcode_type)
        if barcode_type == "mixed":
            codes = [postal_list[0], onez_list[0], qr_list[0]]
    elif scenario == "only_onez":
        codes = [onez_list[0]]
    elif scenario == "only_maxicode":
        codes = [qr_list[0]]
    elif scenario == "special_1d":
        codes = [special_list[0], postal_list[0]]
    elif scenario == "multi_conflict":
        codes = [onez_list[0], onez_list[min(1, len(onez_list) - 1)], qr_list[0], qr_list[min(1, len(qr_list) - 1)]]
    elif scenario == "roi_tall_filter":
        codes = [onez_list[0], qr_list[0], postal_list[0]]
        case_data["vnlib"]["slaveRoiIndex"] = "{\"1\":1}"
    elif scenario == "history_duplicate":
        codes = pick_codes_by_sequence(per_code_types, onez_list, qr_list, postal_list, special_list, code_count, barcode_type)
    else:
        codes = pick_codes_by_sequence(per_code_types, onez_list, qr_list, postal_list, special_list, code_count, barcode_type)

    history_source_codes = extract_main_codes_for_history(codes)

    for idx, _ in enumerate(codes):
        centers.append(build_center(idx))
        devices.append("0")
        if roi_mode == "short":
            rois.append("1")
        elif roi_mode == "tall":
            rois.append("2")
        else:
            rois.append("1" if idx % 2 == 0 else "2")

    case_data["injected"]["code"] = to_joined(codes, sep)
    case_data["injected"]["center"] = to_joined(centers, sep)
    case_data["injected"]["ROI_number"] = to_joined(rois, sep)
    case_data["injected"]["device_number"] = to_joined(devices, sep)
    case_data["injected"]["time"] = now_time_str()
    case_data["vnlib"]["missedTriggerCountDuringTask"] = max(0, missed_count)

    if history_count > 0:
        case_data["globalStringStore"] = build_history_by_count(history_source_codes, history_count)
    else:
        case_data["globalStringStore"] = {}

    if command_mode == "on":
        case_data["injected"]["strStored"] = "bypass on"
        case_data["injected"]["strTcpStored"] = ""
    elif command_mode == "off":
        case_data["injected"]["strStored"] = "bypass off"
        case_data["injected"]["strTcpStored"] = ""
    else:
        case_data["injected"]["strStored"] = ""
        case_data["injected"]["strTcpStored"] = ""

    if scenario == "multi_conflict":
        case_data["globalStringStore"].setdefault("jobIdCounter", "20")

    return case_data

def apply_side_scenario(case_data, scenario, direction, invoke_arg, online_slave_count, slave_roi_index):
    if scenario == "side_tall":
        case_data["vnlib"]["boxCoordinates"] = "[[{\"x\":3998,\"y\":1663},{\"x\":4308,\"y\":3323},{\"x\":2191,\"y\":3682},{\"x\":1833,\"y\":2021}]]"
    elif scenario == "side_short":
        case_data["vnlib"]["boxCoordinates"] = "[[{\"x\":1998,\"y\":1663},{\"x\":2208,\"y\":2523},{\"x\":1791,\"y\":2682},{\"x\":1633,\"y\":1821}]]"
    elif scenario == "side_empty_box":
        case_data["vnlib"]["boxCoordinates"] = "[]"
    elif scenario == "side_invalid_roi":
        case_data["vnlib"]["roiPoints"] = "[]"

    case_data["vnlib"]["boxDirection"] = int(direction)
    case_data["vnlib"]["onlineSlaveCount"] = int(max(0, online_slave_count))
    case_data["vnlib"]["slaveRoiIndex"] = slave_roi_index or "{\"1\":-1}"
    case_data["vnlib"]["invokeCallbackArg"] = bool(invoke_arg)
    case_data["injected"]["is_box_pass_line"] = bool(invoke_arg)
    return case_data


def pick_codes_by_type(barcode_type, onez_list, qr_list, postal_list, special_list, count):
    c = max(1, count)
    if barcode_type == "onez":
        return onez_list[:c]
    if barcode_type == "maxicode":
        return qr_list[:c]
    if barcode_type == "postal":
        return postal_list[:c]
    if barcode_type == "special_1d":
        return special_list[:c]
    if barcode_type == "onez_maxicode":
        merged = []
        for idx in range(c):
            merged.append(onez_list[idx])
            merged.append(qr_list[idx])
        return merged
    if barcode_type == "mixed":
        merged = []
        for idx in range(c):
            merged.extend([postal_list[idx], onez_list[idx], qr_list[idx]])
        return merged
    return [postal_list[0], onez_list[0], qr_list[0]]


def pick_code_by_single_type(single_type, idx, onez_list, qr_list, postal_list, special_list):
    if single_type == "onez":
        return onez_list[idx]
    if single_type == "maxicode":
        return qr_list[idx]
    if single_type == "postal":
        return postal_list[idx]
    if single_type == "special_1d":
        return special_list[idx]
    if single_type == "mixed":
        pick_pool = [postal_list[idx], onez_list[idx], qr_list[idx]]
        return random.choice(pick_pool)
    return onez_list[idx]


def pick_codes_by_sequence(per_code_types, onez_list, qr_list, postal_list, special_list, count, fallback_type):
    c = max(1, count)
    if not per_code_types:
        return pick_codes_by_type(fallback_type, onez_list, qr_list, postal_list, special_list, c)
    codes = []
    for idx in range(c):
        item_type = per_code_types[idx] if idx < len(per_code_types) else fallback_type
        codes.append(pick_code_by_single_type(item_type, idx, onez_list, qr_list, postal_list, special_list))
    return codes


def build_history_by_count(codes, history_count):
    size = max(0, min(history_count, len(codes)))
    picked = codes[:size]
    now_ms = int(datetime.now().timestamp() * 1000)
    return {
        "lastTaskCodes": json.dumps(picked, ensure_ascii=False),
        "codeTimes": json.dumps({code: now_ms for code in picked}),
        "jobIdCounter": "8",
    }


def extract_main_codes_for_history(codes):
    main_codes = []
    for item in codes:
        if isinstance(item, str) and (item.startswith("1Z") or item.startswith("[)") or item.startswith("B") or item.startswith("1B")):
            main_codes.append(item)
    return main_codes


class CaseGeneratorApp:
    def __init__(self, master):
        self.master = master
        self.master.title("TC 测试用例结果生成器")
        self.master.geometry("1200x860")
        self.master.minsize(1060, 760)

        self.mode_var = tk.StringVar(value="top")
        self.scenario_var = tk.StringVar(value="normal_pair")
        self.count_var = tk.IntVar(value=2)
        self.barcode_type_var = tk.StringVar(value="mixed")
        self.code_type_vars = [tk.StringVar(value="mixed") for _ in range(8)]
        self.roi_var = tk.StringVar(value="mixed")
        self.side_direction_var = tk.IntVar(value=3)
        self.side_invoke_arg_var = tk.BooleanVar(value=False)
        self.history_count_var = tk.IntVar(value=0)
        self.command_mode_var = tk.StringVar(value="none")
        self.missed_count_var = tk.IntVar(value=0)
        self.timeout_var = tk.IntVar(value=5000)
        self.separator_var = tk.StringVar(value=DEFAULT_SEPARATOR)
        self.online_slave_count_var = tk.IntVar(value=1)
        self.slave_roi_index_var = tk.StringVar(value="{\"1\":-1}")
        self.last_save_path = None

        self._build_ui()
        self.generate_case()

    def _build_ui(self):
        root = ttk.Frame(self.master, padding=12)
        root.pack(fill=tk.BOTH, expand=True)

        head = ttk.Label(root, text="TC 测试用例结果生成器（顶扫/侧扫）", font=("Microsoft YaHei UI", 13, "bold"))
        head.pack(anchor=tk.W, pady=(0, 8))

        tip = ttk.Label(
            root,
            text="按脚本输入判定维度生成 JSON：支持顶扫与侧扫，可直接导入 tc_visual_test_app。",
            foreground="#44526e",
        )
        tip.pack(anchor=tk.W, pady=(0, 8))

        config = ttk.LabelFrame(root, text="场景配置", padding=10)
        config.pack(fill=tk.X, pady=(0, 8))

        ttk.Label(config, text="模式").grid(row=0, column=0, sticky="w", padx=4, pady=4)
        mode_combo = ttk.Combobox(config, textvariable=self.mode_var, state="readonly", values=["top", "side"], width=10)
        mode_combo.grid(row=0, column=1, sticky="w", padx=4, pady=4)
        mode_combo.bind("<<ComboboxSelected>>", lambda _e: self.on_mode_change())

        ttk.Label(config, text="测试场景").grid(row=0, column=2, sticky="w", padx=4, pady=4)
        scenario_combo = ttk.Combobox(
            config,
            textvariable=self.scenario_var,
            state="readonly",
            values=[],
            width=24,
        )
        scenario_combo.grid(row=0, column=3, sticky="w", padx=4, pady=4)
        scenario_combo.bind("<<ComboboxSelected>>", lambda _e: self.generate_case())
        self.scenario_combo = scenario_combo

        ttk.Label(config, text="条码基数").grid(row=0, column=4, sticky="w", padx=4, pady=4)
        ttk.Spinbox(config, from_=1, to=8, textvariable=self.count_var, width=8, command=self.generate_case).grid(row=0, column=5, sticky="w", padx=4, pady=4)

        ttk.Label(config, text="条码类型").grid(row=1, column=0, sticky="w", padx=4, pady=4)
        ttk.Label(config, text="每个条码可单独设置，默认类型用于补位", foreground="#44526e").grid(row=1, column=1, sticky="w", padx=4, pady=4)

        ttk.Label(config, text="ROI模式").grid(row=1, column=2, sticky="w", padx=4, pady=4)
        roi_combo = ttk.Combobox(config, textvariable=self.roi_var, state="readonly", values=["mixed", "short", "tall"], width=12)
        roi_combo.grid(row=1, column=3, sticky="w", padx=4, pady=4)
        roi_combo.bind("<<ComboboxSelected>>", lambda _e: self.generate_case())

        ttk.Label(config, text="默认条码类型").grid(row=1, column=4, sticky="w", padx=4, pady=4)
        default_type_combo = ttk.Combobox(
            config,
            textvariable=self.barcode_type_var,
            state="readonly",
            values=["mixed", "onez", "maxicode", "postal", "special_1d", "onez_maxicode"],
            width=14,
        )
        default_type_combo.grid(row=1, column=5, sticky="w", padx=4, pady=4)
        default_type_combo.bind("<<ComboboxSelected>>", lambda _e: self.generate_case())

        ttk.Label(config, text="漏触发补偿").grid(row=2, column=0, sticky="w", padx=4, pady=4)
        ttk.Spinbox(config, from_=0, to=5, textvariable=self.missed_count_var, width=8, command=self.generate_case).grid(row=2, column=1, sticky="w", padx=4, pady=4)

        ttk.Label(config, text="timeoutMs").grid(row=2, column=2, sticky="w", padx=4, pady=4)
        ttk.Spinbox(config, from_=1000, to=20000, increment=500, textvariable=self.timeout_var, width=10, command=self.generate_case).grid(row=2, column=3, sticky="w", padx=4, pady=4)

        ttk.Label(config, text="分隔符").grid(row=2, column=4, sticky="w", padx=4, pady=4)
        ttk.Entry(config, textvariable=self.separator_var, width=16).grid(row=2, column=5, sticky="w", padx=4, pady=4)

        ttk.Label(config, text="历史注入条数").grid(row=3, column=0, sticky="w", padx=4, pady=4)
        ttk.Spinbox(config, from_=0, to=20, textvariable=self.history_count_var, width=8, command=self.generate_case).grid(row=3, column=1, sticky="w", padx=4, pady=4)

        ttk.Label(config, text="注入命令(顶扫)").grid(row=3, column=2, sticky="w", padx=4, pady=4)
        cmd_combo = ttk.Combobox(config, textvariable=self.command_mode_var, state="readonly", values=["none", "off", "on"], width=12)
        cmd_combo.grid(row=3, column=3, sticky="w", padx=4, pady=4)
        cmd_combo.bind("<<ComboboxSelected>>", lambda _e: self.generate_case())

        self.per_code_frame = ttk.LabelFrame(root, text="每个条码类型（按条码基数生效）", padding=8)
        self.per_code_frame.pack(fill=tk.X, pady=(0, 8))
        self.code_type_combos = []
        for i in range(8):
            ttk.Label(self.per_code_frame, text=f"第{i+1}个").grid(row=i // 4, column=(i % 4) * 2, sticky="w", padx=4, pady=4)
            cb = ttk.Combobox(
                self.per_code_frame,
                textvariable=self.code_type_vars[i],
                state="readonly",
                values=["mixed", "onez", "maxicode", "postal", "special_1d"],
                width=10,
            )
            cb.grid(row=i // 4, column=(i % 4) * 2 + 1, sticky="w", padx=4, pady=4)
            cb.bind("<<ComboboxSelected>>", lambda _e: self.generate_case())
            self.code_type_combos.append(cb)

        self.side_params_frame = ttk.LabelFrame(root, text="侧扫参数", padding=8)
        self.side_params_frame.pack(fill=tk.X, pady=(0, 8))
        ttk.Label(self.side_params_frame, text="侧扫方向(0~3)").grid(row=0, column=0, sticky="w", padx=4, pady=4)
        ttk.Spinbox(self.side_params_frame, from_=0, to=3, textvariable=self.side_direction_var, width=8, command=self.generate_case).grid(row=0, column=1, sticky="w", padx=4, pady=4)
        ttk.Checkbutton(self.side_params_frame, text="is_box_pass_line=true", variable=self.side_invoke_arg_var, command=self.generate_case).grid(row=0, column=2, sticky="w", padx=8, pady=4)
        ttk.Label(self.side_params_frame, text="onlineSlaveCount").grid(row=1, column=0, sticky="w", padx=4, pady=4)
        ttk.Spinbox(self.side_params_frame, from_=0, to=8, textvariable=self.online_slave_count_var, width=8, command=self.generate_case).grid(row=1, column=1, sticky="w", padx=4, pady=4)
        ttk.Label(self.side_params_frame, text="slaveRoiIndex(JSON)").grid(row=1, column=2, sticky="w", padx=4, pady=4)
        ttk.Entry(self.side_params_frame, textvariable=self.slave_roi_index_var, width=28).grid(row=1, column=3, sticky="we", padx=4, pady=4)

        btns = ttk.Frame(root)
        btns.pack(fill=tk.X, pady=(0, 8))
        ttk.Button(btns, text="生成用例", command=self.generate_case).pack(side=tk.LEFT)
        ttk.Button(btns, text="一键随机参数", command=self.randomize_params).pack(side=tk.LEFT, padx=6)
        ttk.Button(btns, text="复制JSON", command=self.copy_json).pack(side=tk.LEFT, padx=6)
        ttk.Button(btns, text="保存到文件", command=self.save_json).pack(side=tk.LEFT, padx=6)
        ttk.Button(btns, text="生成多用例数组", command=self.generate_batch).pack(side=tk.LEFT, padx=6)
        ttk.Button(btns, text="打开结果目录", command=self.open_result_dir).pack(side=tk.LEFT, padx=6)

        self.status_var = tk.StringVar(value="就绪")
        ttk.Label(root, textvariable=self.status_var, foreground="#52617d").pack(anchor=tk.W, pady=(0, 4))

        self.text = scrolledtext.ScrolledText(root, wrap=tk.NONE, font=("Consolas", 10))
        self.text.pack(fill=tk.BOTH, expand=True)
        self.on_mode_change()

    def on_mode_change(self):
        if self.mode_var.get() == "side":
            self.scenario_combo.configure(values=["side_tall", "side_short", "side_empty_box", "side_invalid_roi"])
            self.scenario_var.set("side_tall")
            self.side_params_frame.pack(fill=tk.X, pady=(0, 8))
            self.per_code_frame.pack_forget()
        else:
            self.scenario_combo.configure(values=[
                "normal_pair",
                "only_onez",
                "only_maxicode",
                "special_1d",
                "multi_conflict",
                "roi_tall_filter",
                "history_duplicate",
            ])
            self.scenario_var.set("normal_pair")
            self.per_code_frame.pack(fill=tk.X, pady=(0, 8))
            self.side_params_frame.pack_forget()
        self.generate_case()

    def _build_case(self):
        if self.mode_var.get() == "side":
            base = default_side_case()
            base["timeoutMs"] = max(1000, self.timeout_var.get())
            base["vnlib"]["separator"] = self.separator_var.get() or DEFAULT_SEPARATOR
            return apply_side_scenario(
                case_data=base,
                scenario=self.scenario_var.get().strip(),
                direction=self.side_direction_var.get(),
                invoke_arg=bool(self.side_invoke_arg_var.get()),
                online_slave_count=self.online_slave_count_var.get(),
                slave_roi_index=self.slave_roi_index_var.get().strip(),
            )

        base = default_case()
        base["timeoutMs"] = max(1000, self.timeout_var.get())
        base["vnlib"]["separator"] = self.separator_var.get() or DEFAULT_SEPARATOR
        base["vnlib"]["onlineSlaveCount"] = int(max(0, self.online_slave_count_var.get()))
        base["vnlib"]["slaveRoiIndex"] = self.slave_roi_index_var.get().strip() or "{\"1\":-1}"
        return apply_scenario(
            case_data=base,
            scenario=self.scenario_var.get().strip(),
            code_count=self.count_var.get(),
            barcode_type=self.barcode_type_var.get().strip(),
            per_code_types=[v.get().strip() for v in self.code_type_vars],
            roi_mode=self.roi_var.get().strip(),
            history_count=self.history_count_var.get(),
            command_mode=self.command_mode_var.get().strip(),
            missed_count=self.missed_count_var.get(),
        )

    def generate_case(self):
        self._refresh_per_code_type_visibility()
        case_data = self._build_case()
        self.text.delete("1.0", tk.END)
        self.text.insert("1.0", json.dumps(case_data, ensure_ascii=False, indent=2))
        self.status_var.set(f"已生成模式/场景: {self.mode_var.get()} / {self.scenario_var.get()}")

    def _refresh_per_code_type_visibility(self):
        active_count = max(1, min(8, self.count_var.get()))
        for i, cb in enumerate(self.code_type_combos):
            cb.configure(state="readonly" if i < active_count else "disabled")

    def generate_batch(self):
        if self.mode_var.get() == "side":
            scenarios = ["side_tall", "side_short", "side_empty_box", "side_invalid_roi"]
        else:
            scenarios = [
                "normal_pair",
                "only_onez",
                "only_maxicode",
                "special_1d",
                "multi_conflict",
                "roi_tall_filter",
                "history_duplicate",
            ]
        batch = []
        for name in scenarios:
            if self.mode_var.get() == "side":
                temp = default_side_case()
                temp["timeoutMs"] = max(1000, self.timeout_var.get())
                temp["vnlib"]["separator"] = self.separator_var.get() or DEFAULT_SEPARATOR
                batch.append(
                    apply_side_scenario(
                        case_data=deepcopy(temp),
                        scenario=name,
                        direction=self.side_direction_var.get(),
                        invoke_arg=bool(self.side_invoke_arg_var.get()),
                        online_slave_count=self.online_slave_count_var.get(),
                        slave_roi_index=self.slave_roi_index_var.get().strip(),
                    )
                )
            else:
                temp = default_case()
                temp["timeoutMs"] = max(1000, self.timeout_var.get())
                temp["vnlib"]["separator"] = self.separator_var.get() or DEFAULT_SEPARATOR
                temp["vnlib"]["onlineSlaveCount"] = int(max(0, self.online_slave_count_var.get()))
                temp["vnlib"]["slaveRoiIndex"] = self.slave_roi_index_var.get().strip() or "{\"1\":-1}"
                batch.append(
                    apply_scenario(
                        case_data=deepcopy(temp),
                        scenario=name,
                        code_count=self.count_var.get(),
                        barcode_type=self.barcode_type_var.get().strip(),
                        per_code_types=[v.get().strip() for v in self.code_type_vars],
                        roi_mode=self.roi_var.get().strip(),
                        history_count=self.history_count_var.get(),
                        command_mode=self.command_mode_var.get().strip(),
                        missed_count=self.missed_count_var.get(),
                    )
                )
        self.text.delete("1.0", tk.END)
        self.text.insert("1.0", json.dumps(batch, ensure_ascii=False, indent=2))
        self.status_var.set(f"已生成多用例数组: {len(batch)} 条")

    def randomize_params(self):
        if self.mode_var.get() == "side":
            self.scenario_var.set(random.choice(["side_tall", "side_short", "side_empty_box", "side_invalid_roi"]))
            self.side_direction_var.set(random.randint(0, 3))
            self.side_invoke_arg_var.set(random.choice([True, False]))
            self.online_slave_count_var.set(random.randint(0, 3))
            self.slave_roi_index_var.set(random.choice(["{\"1\":-1}", "{\"1\":0}", "{\"1\":1}", "{\"1\":0,\"2\":1}"]))
        else:
            self.scenario_var.set(random.choice([
                "normal_pair",
                "only_onez",
                "only_maxicode",
                "special_1d",
                "multi_conflict",
                "roi_tall_filter",
                "history_duplicate",
            ]))
            self.count_var.set(random.randint(1, 5))
            self.barcode_type_var.set(random.choice(["mixed", "onez", "maxicode", "postal", "special_1d", "onez_maxicode"]))
            for i in range(8):
                self.code_type_vars[i].set(random.choice(["mixed", "onez", "maxicode", "postal", "special_1d"]))
            self.roi_var.set(random.choice(["mixed", "short", "tall"]))
            self.history_count_var.set(random.randint(0, 4))
            self.command_mode_var.set(random.choice(["none", "off", "on"]))
            self.online_slave_count_var.set(random.randint(0, 3))
            self.slave_roi_index_var.set(random.choice(["{\"1\":-1}", "{\"1\":0}", "{\"1\":1}", "{\"1\":0,\"2\":1}"]))

        self.timeout_var.set(random.choice([3000, 5000, 8000, 10000]))
        self.missed_count_var.set(random.randint(0, 3))
        self.separator_var.set(random.choice([DEFAULT_SEPARATOR, "|", ";;"]))
        self.generate_case()

    def copy_json(self):
        raw = self.text.get("1.0", tk.END).strip()
        if not raw:
            messagebox.showwarning("提示", "当前没有可复制的 JSON。")
            return
        self.master.clipboard_clear()
        self.master.clipboard_append(raw)
        self.status_var.set("JSON 已复制到剪贴板")

    def save_json(self):
        raw = self.text.get("1.0", tk.END).strip()
        if not raw:
            messagebox.showwarning("提示", "当前没有可保存的 JSON。")
            return
        try:
            json.loads(raw)
        except json.JSONDecodeError as exc:
            messagebox.showerror("JSON错误", f"当前内容不是有效 JSON：{exc}")
            return

        RESULT_DIR.mkdir(parents=True, exist_ok=True)
        default_name = f"generated_case_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        path = filedialog.asksaveasfilename(
            title="保存测试用例",
            initialdir=str(RESULT_DIR),
            initialfile=default_name,
            defaultextension=".json",
            filetypes=[("JSON 文件", "*.json"), ("所有文件", "*.*")],
        )
        if not path:
            return
        Path(path).write_text(raw, encoding="utf-8")
        self.last_save_path = path
        self.status_var.set(f"已保存: {path}")
        messagebox.showinfo("保存成功", f"测试用例已保存到:\n{path}")

    def open_result_dir(self):
        RESULT_DIR.mkdir(parents=True, exist_ok=True)
        messagebox.showinfo("结果目录", str(RESULT_DIR))


def main():
    root = tk.Tk()
    app = CaseGeneratorApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
