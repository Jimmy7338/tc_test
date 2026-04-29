#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function applyMetadataFlagsPatch(code, patch) {
  if (!patch || typeof patch !== "object") return code;
  let out = code;
  for (const key of Object.keys(patch)) {
    const val = patch[key];
    if (val !== true && val !== false) continue;
    const re = new RegExp(`^const ${key} = (true|false);`, "gm");
    out = out.replace(re, `const ${key} = ${val};`);
  }
  return out;
}

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

function resolveStateFilePath(args, input) {
  const fromCli = args["state-file"] || args.statefile;
  if (fromCli) {
    return path.resolve(String(fromCli));
  }
  if (input && input.persistStateFile) {
    return path.resolve(String(input.persistStateFile));
  }
  return null;
}

function loadPersistedStores(stateFilePath) {
  if (!stateFilePath || !fs.existsSync(stateFilePath)) {
    return { globalStringStore: {}, globalNumericStore: {}, error: null };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(stateFilePath, "utf8"));
    const gs =
      raw.globalStringStore && typeof raw.globalStringStore === "object" && !Array.isArray(raw.globalStringStore)
        ? raw.globalStringStore
        : {};
    const gn =
      raw.globalNumericStore && typeof raw.globalNumericStore === "object" && !Array.isArray(raw.globalNumericStore)
        ? raw.globalNumericStore
        : {};
    return { globalStringStore: gs, globalNumericStore: gn, error: null };
  } catch (e) {
    return {
      globalStringStore: {},
      globalNumericStore: {},
      error: e.message || String(e),
    };
  }
}

function savePersistedStores(stateFilePath, globalStringData, globalNumericData) {
  if (!stateFilePath) return;
  const payload = {
    version: 1,
    savedAt: new Date().toISOString(),
    globalStringStore: globalStringData,
    globalNumericStore: globalNumericData,
  };
  fs.writeFileSync(stateFilePath, JSON.stringify(payload, null, 2), "utf8");
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
  const stateFilePath = resolveStateFilePath(args, input);
  const hadPersistFileAtStart = Boolean(stateFilePath && fs.existsSync(stateFilePath));
  const persisted = loadPersistedStores(stateFilePath);
  const injected = input.injected || {};
  const vn = input.vnlib || {};
  const globalStringData = Object.assign(
    {},
    persisted.globalStringStore,
    input.globalStringStore || {}
  );
  const globalNumericData = Object.assign(
    {},
    persisted.globalNumericStore,
    input.globalNumericStore || {}
  );
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

  let code = fs.readFileSync(scriptPath, "utf8");
  if (input.metadataFlagsPatch) {
    code = applyMetadataFlagsPatch(code, input.metadataFlagsPatch);
  }
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

  let stateSaved = false;
  let stateSaveError = null;
  if (stateFilePath) {
    try {
      savePersistedStores(stateFilePath, globalStringData, globalNumericData);
      stateSaved = true;
    } catch (e) {
      stateSaveError = e.message || String(e);
    }
  }

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
    stateFile: stateFilePath,
    stateReadFromFile: hadPersistFileAtStart,
    stateSaved,
    stateSaveError: stateSaveError || undefined,
    persistedKeysPreview: stateFilePath
      ? {
          globalStringKeys: Object.keys(globalStringData).slice(0, 64),
          globalNumericKeys: Object.keys(globalNumericData).slice(0, 64),
        }
      : undefined,
    stateLoadError: persisted.error || undefined,
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
