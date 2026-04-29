#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const value = argv[i + 1];
      args[key] = value;
      i += 1;
    }
  }
  return args;
}

function toStringValue(v, fallback) {
  if (v === undefined || v === null) return fallback;
  return String(v);
}

function main() {
  const args = parseArgs(process.argv);
  const scriptPath = path.resolve(args.script || "");
  const inputPath = path.resolve(args.input || "");
  const outputPath = path.resolve(args.output || "runner_result.json");

  if (!fs.existsSync(scriptPath)) {
    throw new Error("Script not found: " + scriptPath);
  }
  if (!fs.existsSync(inputPath)) {
    throw new Error("Input json not found: " + inputPath);
  }

  const input = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const injected = input.injected || {};
  const vn = input.vnlib || {};
  const globalStringData = Object.assign({}, input.globalStringStore || {});
  const globalNumericData = Object.assign({}, input.globalNumericStore || {});
  const logs = [];
  const outputs = [];
  const callbackResults = [];

  const VNLib = {
    Log(msg) {
      logs.push(toStringValue(msg, ""));
    },
    SendOutput(text) {
      outputs.push(toStringValue(text, ""));
    },
    getSeparator() {
      return toStringValue(vn.separator, "|");
    },
    GetMissedTriggerCountDuringTask() {
      return toStringValue(vn.missedTriggerCountDuringTask, "0");
    },
    GetBoxCoordinates() {
      return toStringValue(vn.boxCoordinates, "[]");
    },
    GetBoxLineCoordinates() {
      return toStringValue(vn.boxLineCoordinates, "[]");
    },
    GetBoxDirection() {
      return Number(vn.boxDirection || 0);
    },
    GetOnlineSlaveCount() {
      return Number(vn.onlineSlaveCount || 0);
    },
    GetSlaveRoiIndex() {
      return toStringValue(vn.slaveRoiIndex, "{}");
    },
    GetRoiPoints() {
      return toStringValue(vn.roiPoints, "[]");
    },
    RegisterCallback(name, fn) {
      logs.push("[RegisterCallback] " + name + " registered");
      if (typeof fn === "function" && vn.invokeCallbackName === name) {
        try {
          const callbackArg =
            vn.invokeCallbackArg !== undefined ? vn.invokeCallbackArg : false;
          const result = fn(callbackArg);
          callbackResults.push({
            name,
            arg: callbackArg,
            result,
            source: "RegisterCallback",
          });
          logs.push("[RegisterCallback] " + name + " returned: " + result);
        } catch (e) {
          logs.push("[RegisterCallback] " + name + " error: " + e.message);
        }
      }
    },
  };

  const GlobalString = {
    load(key) {
      return Object.prototype.hasOwnProperty.call(globalStringData, key)
        ? globalStringData[key]
        : "";
    },
    store(key, value) {
      globalStringData[key] = toStringValue(value, "");
    },
    clear(key) {
      delete globalStringData[key];
    },
    clearAll() {
      Object.keys(globalStringData).forEach((k) => delete globalStringData[k]);
    },
  };

  const GlobalNumeric = {
    load(key) {
      return Object.prototype.hasOwnProperty.call(globalNumericData, key)
        ? Number(globalNumericData[key])
        : 0;
    },
    store(key, value) {
      globalNumericData[key] = Number(value);
    },
  };

  const sandbox = {
    VNLib,
    GlobalString,
    GlobalNumeric,
    Math,
    JSON,
    Date,
    Number,
    String,
    Boolean,
    Array,
    Object,
    RegExp,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
    decodeURI,
    encodeURI,
  };

  Object.keys(injected).forEach((k) => {
    sandbox[k] = injected[k];
  });

  const code = fs.readFileSync(scriptPath, "utf8");
  const started = Date.now();
  let error = null;
  try {
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox, {
      filename: path.basename(scriptPath),
      timeout: Number(input.timeoutMs || 5000),
    });

    if (vn.autoInvokeRegisterCallback && typeof sandbox.RegisterCallback === "function") {
      try {
        sandbox.RegisterCallback();
        logs.push("[Runner] RegisterCallback() invoked automatically");
      } catch (e) {
        logs.push("[Runner] RegisterCallback() invoke error: " + e.message);
      }
    }

    if (vn.autoInvokeSetRoiIndex && typeof sandbox.SetRoiIndex === "function") {
      try {
        const callbackArg =
          vn.invokeCallbackArg !== undefined ? vn.invokeCallbackArg : false;
        const result = sandbox.SetRoiIndex(callbackArg);
        callbackResults.push({
          name: "SetRoiIndex",
          arg: callbackArg,
          result,
          source: "RunnerDirectCall",
        });
        logs.push("[Runner] SetRoiIndex() direct call returned: " + result);
      } catch (e) {
        logs.push("[Runner] SetRoiIndex() direct call error: " + e.message);
      }
    }
  } catch (e) {
    error = {
      message: e.message,
      stack: e.stack || "",
    };
  }
  const elapsedMs = Date.now() - started;

  const result = {
    ok: !error,
    elapsedMs,
    input,
    logs,
    outputs,
    callbackResults,
    error,
    globalStringStore: globalStringData,
    globalNumericStore: globalNumericData,
    outputCount: outputs.length,
    logCount: logs.length,
  };

  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), "utf8");
}

try {
  main();
} catch (e) {
  const fallback = {
    ok: false,
    logs: [],
    outputs: [],
    error: { message: e.message, stack: e.stack || "" },
  };
  const args = parseArgs(process.argv);
  const outputPath = path.resolve(args.output || "runner_result.json");
  fs.writeFileSync(outputPath, JSON.stringify(fallback, null, 2), "utf8");
  process.exit(1);
}
