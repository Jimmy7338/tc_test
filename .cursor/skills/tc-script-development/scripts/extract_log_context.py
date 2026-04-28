#!/usr/bin/env python3
"""Extract task-centered log context for TC script troubleshooting.

Usage:
  python scripts/extract_log_context.py device.log --task-id 12345 --issue "ROI output is wrong"
  python scripts/extract_log_context.py device.log --task-id 12345 --window 160

The script is read-only. It prints merged context blocks and highlights likely
script/runtime clues without requiring source-code knowledge.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import Iterable, List, Sequence, Tuple


DEFAULT_MARKERS = {
    "ERROR": [
        "error", "exception", "failed", "fail", "uncaught", "timeout",
        "not found", "not callable", "invalid", "nullptr",
        "错误", "异常", "失败", "超时", "无效",
    ],
    "TASK": [
        "taskid", "task id", "taskid:", "taskid：", "task state switch",
        "TS_WAITTRI", "TS_ALGODONE", "TS_GROUP_DONE", "clienttask",
        "任务", "触发",
    ],
    "TRIGGER": [
        "trig", "trigger", "missed trigger", "io trig", "forcibly end",
        "触发", "漏触发",
    ],
    "DECODE": [
        "begin algorithm run decode", "finish algorithm run decode",
        "begin algorithm sdk run", "finish algorithm sdk run",
        "decode", "algorithm", "sdk run", "识别", "算法",
    ],
    "SCRIPT": [
        "script", "js log", "vnlib", "processcodes", "jsscript",
        "script process", "script action", "uncaught exception at line",
        "=== start processing barcodes ===", "input parameters",
        "generated task id", "bypass mode", "disposal mark",
        "only found", "multiple barcodes", "final selection",
        "callback function execution error", "registercallback call success",
        "脚本",
    ],
    "OUTPUT": [
        "camera.postscan", "sendoutput", "sendresult", "outputstring",
        "Camera.PostScan", "formatOutput", "output ???", "output !!!!", "输出",
    ],
    "ROI": [
        "roi", "roi_number", "roimode", "getslaveroiindex", "RoiIndex",
        "slave roi", "set roi index", "set all roi", "Final selection",
        "callback SetRoiIndex returned", "Tall", "Short", "高箱", "矮箱",
    ],
    "GROUP": [
        "group", "slave", "client", "host recv", "ResulReady",
        "add slave roi index", "result recved slave", "send box info to host",
        "组网", "从机", "主机",
    ],
    "HISTORY": [
        "lasttaskcodes", "codetimes", "history", "duplicate", "timeout clear",
        "storehistory", "isduplicate", "updated stored barcodes",
        "history barcodes", "历史", "重复", "去重",
    ],
    "COMP": [
        "missedtrigger", "missed trigger", "compensation",
        "GetMissedTriggerCountDuringTask", "failed to get missed trigger count",
        "漏触发", "补偿",
    ],
    "CMD": [
        "strstored", "strtcpstored", "m_tcpScriptStrIn", "m_ScriptStrIn",
        "bypass", "resetnum", "resetno", "命令",
    ],
    "CONFIG": [
        "undefined", "referenceerror", "nan", "not a callable function",
        "callback", "is empty", "变量", "映射", "配置", "未定义",
    ],
}


TAG_ADVICE = {
    "CONFIG": "优先检查上位机变量映射、脚本槽位和可选变量防护；多数 undefined/回调为空问题来自配置。",
    "ROI": "优先检查侧扫 ROI 选择结果、组网 ROI 状态、顶扫 ROI_number 是否为 1 基且与 code 对齐。",
    "GROUP": "优先检查主从连接、从机结果是否到达主机，以及该任务是否包含从机 ROI 状态。",
    "OUTPUT": "优先检查最终输出分支、formatOutput 入参、是否被历史去重/ROI 过滤改成 ????。",
    "HISTORY": "优先检查 lastTaskCodes、codeTimes、超时清理和当前码是否被判定为重复。",
    "COMP": "优先检查漏触发计数、触发设置和补偿逻辑是否被重复执行。",
    "CMD": "优先检查 strStored/strTcpStored 实际收到的命令名，尤其 resetnum/resetno、bypass on/off 是否匹配。",
    "SCRIPT": "优先检查脚本日志中第一条异常前后的变量值和分支选择。",
    "ERROR": "优先定位第一条错误/异常日志，通常后续异常都是连锁结果。",
    "TRIGGER": "优先检查触发时序、漏触发、强制结束和任务状态切换。",
    "DECODE": "优先检查该任务是否完成识别，若识别阶段无结果，脚本输出异常可能只是后续表现。",
}


def read_text(path: str) -> str:
    if path == "-":
        return sys.stdin.read()

    data = Path(path).read_bytes()
    for enc in ("utf-8", "utf-8-sig", "gb18030", "latin-1"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def normalize_token(text: str) -> str:
    return re.sub(r"[^a-zA-Z0-9\u4e00-\u9fff]+", "", text).lower()


def issue_keywords(issue: str) -> List[str]:
    if not issue:
        return []

    words = re.findall(r"[A-Za-z0-9_?.!-]{2,}|[\u4e00-\u9fff]{2,}", issue)
    useful = []
    for word in words:
        lower = word.lower()
        if lower in {"the", "and", "with", "this", "that", "问题", "日志", "任务"}:
            continue
        useful.append(word)
    return useful[:12]


def line_matches(line: str, needles: Sequence[str]) -> bool:
    lower = line.lower()
    normalized = normalize_token(line)
    for needle in needles:
        if not needle:
            continue
        n_lower = needle.lower()
        if n_lower in lower:
            return True
        if normalize_token(needle) and normalize_token(needle) in normalized:
            return True
    return False


def merge_ranges(ranges: Iterable[Tuple[int, int]], total: int) -> List[Tuple[int, int]]:
    merged: List[Tuple[int, int]] = []
    for start, end in sorted(ranges):
        start = max(0, start)
        end = min(total, end)
        if start >= end:
            continue
        if not merged or start > merged[-1][1] + 1:
            merged.append((start, end))
        else:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
    return merged


def classify_line(line: str) -> List[str]:
    lower = line.lower()
    tags = []
    for tag, markers in DEFAULT_MARKERS.items():
        if any(marker.lower() in lower for marker in markers):
            tags.append(tag)
    return tags


def collect_highlights(lines: Sequence[str], ranges: Sequence[Tuple[int, int]]) -> List[Tuple[int, List[str], str]]:
    highlights: List[Tuple[int, List[str], str]] = []
    seen = set()
    for start, end in ranges:
        for idx in range(start, end):
            if idx in seen:
                continue
            tags = classify_line(lines[idx])
            if tags:
                highlights.append((idx + 1, tags, lines[idx].rstrip()))
                seen.add(idx)
    return highlights


def print_advice(highlights: Sequence[Tuple[int, List[str], str]]) -> None:
    tag_counts = {}
    for _, tags, _ in highlights:
        for tag in tags:
            tag_counts[tag] = tag_counts.get(tag, 0) + 1

    print("=== NEXT CHECKS ===")
    if not tag_counts:
        print("未发现明显分类标记。建议扩大 --window 或增加 --keyword，例如输出条码、ROI 值、错误短语。")
        print()
        return

    for tag, _ in sorted(tag_counts.items(), key=lambda item: item[1], reverse=True):
        advice = TAG_ADVICE.get(tag)
        if advice:
            print(f"- [{tag}] {advice}")
    print()


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract task-centered TC script log context.")
    parser.add_argument("log_file", help="Log file path, or '-' to read stdin")
    parser.add_argument("--task-id", default="", help="Task ID reported by customer")
    parser.add_argument("--issue", default="", help="Customer issue description")
    parser.add_argument("--keyword", action="append", default=[], help="Extra keyword to search; can repeat")
    parser.add_argument("--window", type=int, default=120, help="Context lines before and after each match")
    parser.add_argument("--max-context-lines", type=int, default=900, help="Maximum full context lines to print")
    args = parser.parse_args()

    text = read_text(args.log_file)
    lines = text.splitlines()
    if not lines:
        print("No log lines found.")
        return 1

    needles: List[str] = []
    if args.task_id:
        needles.extend([
            args.task_id,
            f"TaskId:{args.task_id}",
            f"TaskId：{args.task_id}",
            f"taskid:{args.task_id}",
            f"taskid：{args.task_id}",
        ])
    needles.extend(args.keyword)
    needles.extend(issue_keywords(args.issue))

    match_indexes = [idx for idx, line in enumerate(lines) if line_matches(line, needles)] if needles else []

    if not match_indexes and args.task_id:
        compact_id = normalize_token(args.task_id)
        match_indexes = [
            idx for idx, line in enumerate(lines)
            if compact_id and compact_id in normalize_token(line)
        ]

    if not match_indexes:
        print("No direct match found.")
        print(f"Total lines: {len(lines)}")
        if needles:
            print("Search terms:", ", ".join(dict.fromkeys(needles)))
        print("Tip: retry with --keyword using an output barcode, ROI value, or error phrase.")
        return 2

    ranges = merge_ranges(
        ((idx - args.window, idx + args.window + 1) for idx in match_indexes),
        len(lines),
    )

    print("=== TC LOG CONTEXT SUMMARY ===")
    print(f"Log file: {args.log_file}")
    print(f"Total lines: {len(lines)}")
    print(f"Task ID: {args.task_id or '<not provided>'}")
    print(f"Issue: {args.issue or '<not provided>'}")
    print(f"Direct matches: {len(match_indexes)}")
    print("Context ranges:", ", ".join(f"{s + 1}-{e}" for s, e in ranges))
    print()

    highlights = collect_highlights(lines, ranges)
    print("=== HIGHLIGHTS ===")
    if highlights:
        for line_no, tags, content in highlights[:160]:
            print(f"{line_no}: [{' '.join(tags)}] {content}")
        if len(highlights) > 160:
            print(f"... {len(highlights) - 160} more highlight lines omitted")
    else:
        print("No marker lines found in selected context.")
    print()

    print_advice(highlights)

    print("=== FULL CONTEXT ===")
    printed = 0
    for block_no, (start, end) in enumerate(ranges, 1):
        print(f"--- block {block_no}: lines {start + 1}-{end} ---")
        for idx in range(start, end):
            if printed >= args.max_context_lines:
                print(f"... context truncated at {args.max_context_lines} lines")
                return 0
            print(f"{idx + 1}: {lines[idx]}")
            printed += 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
