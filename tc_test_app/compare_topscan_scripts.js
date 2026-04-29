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
    if (line.startsWith("Camera.PostScan\t")) {
      return line;
    }
  }
  return normalizeText(decoded);
}

function extractFinalPostScan(result) {
  const logs = Array.isArray(result.logs) ? result.logs : [];
  for (let i = logs.length - 1; i >= 0; i -= 1) {
    const line = String(logs[i] || "");
    const marker = "LastTaskOutputToAssistant:";
    const idx = line.indexOf(marker);
    if (idx >= 0) {
      return pickFirstPostScanLine(line.slice(idx + marker.length));
    }
  }

  const outputs = Array.isArray(result.outputs) ? result.outputs : [];
  for (let i = outputs.length - 1; i >= 0; i -= 1) {
    const line = normalizeText(outputs[i]);
    if (line.startsWith("Camera.PostScan\t")) {
      return pickFirstPostScanLine(line);
    }
  }
  return "<empty>";
}

function runOne(runnerPath, scriptPath, oneCase, tmpDir) {
  const inputPath = path.join(tmpDir, `input_${oneCase.__id}.json`);
  const outputPath = path.join(tmpDir, `output_${oneCase.__id}.json`);
  fs.writeFileSync(inputPath, JSON.stringify(oneCase, null, 2), "utf8");

  cp.execFileSync(process.execPath, [runnerPath, "--script", scriptPath, "--input", inputPath, "--output", outputPath], {
    stdio: "pipe",
  });
  return JSON.parse(fs.readFileSync(outputPath, "utf8"));
}

function main() {
  const args = parseArgs(process.argv);
  const beforeScript = path.resolve(args.before || "tc_before.js");
  const afterScript = path.resolve(args.after || "tc_topscan_master.js");
  const casesPath = path.resolve(args.cases || path.join(__dirname, "topscan_regression_cases.json"));
  const runnerPath = path.resolve(args.runner || path.join(__dirname, "tc_script_runner.js"));
  const reportPath = path.resolve(args.out || path.join(path.dirname(casesPath), "topscan_compare_report.json"));

  const cases = JSON.parse(fs.readFileSync(casesPath, "utf8"));
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tc-compare-"));
  const summary = [];
  let mismatchCount = 0;

  for (let i = 0; i < cases.length; i += 1) {
    const oneCase = Object.assign({ __id: i + 1 }, cases[i]);
    const name = oneCase._name || `case_${i + 1}`;

    const beforeResult = runOne(runnerPath, beforeScript, oneCase, tmpDir);
    const afterResult = runOne(runnerPath, afterScript, oneCase, tmpDir);

    const beforeFinal = extractFinalPostScan(beforeResult);
    const afterFinal = extractFinalPostScan(afterResult);
    const same = beforeFinal === afterFinal;
    if (!same) mismatchCount += 1;

    summary.push({
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

  const report = {
    beforeScript,
    afterScript,
    casesPath,
    total: summary.length,
    mismatchCount,
    allMatched: mismatchCount === 0,
    summary,
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");

  const header = `Topscan compare done. total=${report.total}, mismatch=${report.mismatchCount}, allMatched=${report.allMatched}`;
  console.log(header);
  summary.forEach((item) => {
    console.log(`${item.same ? "OK " : "DIFF"} #${item.index} ${item.name}`);
  });
  console.log(`Report: ${reportPath}`);
}

main();
