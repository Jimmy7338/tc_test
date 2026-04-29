#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith("--")) {
      args[token.slice(2)] = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

function makeRng(seed) {
  let s = seed >>> 0;
  return function rand() {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function randInt(rand, min, max) {
  return Math.floor(rand() * (max - min + 1)) + min;
}

function deepClone(v) {
  return JSON.parse(JSON.stringify(v));
}

function normalizeText(s) {
  return String(s || "").replace(/\r?\n/g, "").trim();
}

function decodeEscapedControls(s) {
  return String(s || "")
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t");
}

function pickFirstPostScanLine(text) {
  const decoded = decodeEscapedControls(text);
  const lines = decoded.split(/\r?\n/).map((v) => v.trim()).filter(Boolean);
  for (const line of lines) {
    if (line.startsWith("Camera.PostScan\t")) return line;
  }
  return normalizeText(decoded);
}

function extractFinalPostScan(result) {
  const logs = Array.isArray(result.logs) ? result.logs : [];
  for (let i = logs.length - 1; i >= 0; i -= 1) {
    const line = String(logs[i] || "");
    const marker = "LastTaskOutputToAssistant:";
    const idx = line.indexOf(marker);
    if (idx >= 0) return pickFirstPostScanLine(line.slice(idx + marker.length));
  }
  const outputs = Array.isArray(result.outputs) ? result.outputs : [];
  for (let i = outputs.length - 1; i >= 0; i -= 1) {
    const line = normalizeText(outputs[i]);
    if (line.startsWith("Camera.PostScan\t")) return pickFirstPostScanLine(line);
  }
  return "<empty>";
}

function formatTaskTime(ms) {
  const d = new Date(ms);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  const mss = String(d.getUTCMilliseconds()).padStart(3, "0");
  return `${yyyy}/${mm}/${dd} ${hh}:${mi}:${ss}:${mss}`;
}

function perturbCase(baseCase, rand, baseMs, globalIndex, level) {
  const one = deepClone(baseCase);
  one._stressId = globalIndex;
  if (!one.timeoutMs) one.timeoutMs = 5000;
  one.timeoutMs = Math.max(1000, one.timeoutMs + randInt(rand, -250, 450));
  one.vnlib = one.vnlib || {};
  if (Object.prototype.hasOwnProperty.call(one.vnlib, "missedTriggerCountDuringTask")) {
    const v = Number(one.vnlib.missedTriggerCountDuringTask || 0);
    one.vnlib.missedTriggerCountDuringTask = Math.max(0, v + randInt(rand, -1, 2));
  }
  one.injected = one.injected || {};
  one.injected.time = formatTaskTime(baseMs + globalIndex * 973 + randInt(rand, -120, 120));
  if (level === "minimal") {
    return one;
  }
  if (typeof one.injected.is_box_pass_line === "string") {
    if (rand() < 0.25) {
      one.injected.is_box_pass_line = one.injected.is_box_pass_line === "true" ? "false" : "true";
    }
  } else if (typeof one.injected.is_box_pass_line === "boolean") {
    if (rand() < 0.25) one.injected.is_box_pass_line = !one.injected.is_box_pass_line;
  }
  return one;
}

function runOne(runnerPath, scriptPath, oneCase, outputPath, stateFilePath) {
  const inputPath = outputPath.replace(/\.json$/, ".input.json");
  fs.writeFileSync(inputPath, JSON.stringify(oneCase, null, 2), "utf8");
  cp.execFileSync(
    process.execPath,
    [
      runnerPath,
      "--script",
      scriptPath,
      "--input",
      inputPath,
      "--output",
      outputPath,
      "--state-file",
      stateFilePath,
    ],
    { stdio: "pipe" }
  );
  return JSON.parse(fs.readFileSync(outputPath, "utf8"));
}

function main() {
  const args = parseArgs(process.argv);
  const beforeScript = path.resolve(args.before || "tc_before.js");
  const afterScript = path.resolve(args.after || "tc_topscan_master_rb.js");
  const casesPath = path.resolve(args.cases || path.join(__dirname, "topscan_regression_cases.json"));
  const runnerPath = path.resolve(args.runner || path.join(__dirname, "tc_script_runner.js"));
  const rounds = Math.max(1, Number(args.rounds || 12));
  const seed = Number(args.seed || 20260429);
  const perturbLevel = String(args["perturb-level"] || "full");
  const outPath = path.resolve(
    args.out || path.join(path.dirname(casesPath), `topscan_stress_compare_report_${Date.now()}.json`)
  );

  const rand = makeRng(seed);
  const cases = JSON.parse(fs.readFileSync(casesPath, "utf8"));
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "tc-stress-"));
  const beforeState = path.join(workDir, "before_state.json");
  const afterState = path.join(workDir, "after_state.json");
  const baseMs = Date.UTC(2026, 3, 29, 8, 0, 0, 0);

  const summary = [];
  let globalIndex = 0;
  let mismatchCount = 0;

  for (let round = 1; round <= rounds; round += 1) {
    for (let i = 0; i < cases.length; i += 1) {
      globalIndex += 1;
      const baseCase = cases[i];
      const oneCase = perturbCase(baseCase, rand, baseMs, globalIndex, perturbLevel);
      const name = oneCase._name || `case_${i + 1}`;
      const beforeOut = path.join(workDir, `before_${round}_${i + 1}.json`);
      const afterOut = path.join(workDir, `after_${round}_${i + 1}.json`);
      const beforeResult = runOne(runnerPath, beforeScript, oneCase, beforeOut, beforeState);
      const afterResult = runOne(runnerPath, afterScript, oneCase, afterOut, afterState);
      const beforeFinal = extractFinalPostScan(beforeResult);
      const afterFinal = extractFinalPostScan(afterResult);
      const same = beforeFinal === afterFinal;
      if (!same) mismatchCount += 1;
      summary.push({
        round,
        index: i + 1,
        name,
        same,
        beforeFinal,
        afterFinal,
        beforeOk: !!beforeResult.ok,
        afterOk: !!afterResult.ok,
        beforeOutputCount: beforeResult.outputCount || 0,
        afterOutputCount: afterResult.outputCount || 0,
      });
    }
  }

  const report = {
    seed,
    perturbLevel,
    rounds,
    total: summary.length,
    mismatchCount,
    allMatched: mismatchCount === 0,
    beforeScript,
    afterScript,
    casesPath,
    summary,
  };
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");

  console.log(
    `Stress compare done. rounds=${rounds}, total=${report.total}, mismatch=${report.mismatchCount}, allMatched=${report.allMatched}, seed=${seed}`
  );
  if (mismatchCount > 0) {
    const first = summary.find((x) => !x.same);
    if (first) {
      console.log(`First diff: round=${first.round}, case=${first.index} ${first.name}`);
    }
  }
  console.log(`Report: ${outPath}`);
}

main();
