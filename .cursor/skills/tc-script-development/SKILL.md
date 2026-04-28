---
name: tc-script-development
description: Develop and modify TC customer JavaScript scripts for the scanner lower-computer script engine in customer-use mode by default. Use when changing tc_in/tc_out top-scan output scripts, tc_in_front/tc_out_front side-scan ROI scripts, VNLib calls, Camera.PostScan formatting, ROI filtering, barcode classification, history deduplication, missed-trigger compensation, or customer-specific script behavior.
---

# TC Script Development

## Default Usage Model

This skill always works in customer-use mode by default. Assume the customer will copy generated or modified JavaScript script text into the upper-computer script configuration page.

The customer normally has:

- script files or copied script text;
- the upper-computer program where script text and script variables are configured;
- device logs or observed trigger/output behavior.

Treat lower/upper-computer implementation details as internal reasoning only. Do not expose source file paths, function names, or implementation internals in customer-facing answers or markdown unless the user explicitly asks for internal engineering details. Explain issues with customer-safe terms such as "upper-computer variable mapping", "script runtime", "ROI selection callback", "group ROI state", and "device output pipeline".

When delivering a change, give:

- the exact script file or script block to paste into the upper-computer script editor;
- the required variable mappings in the upper-computer format/script variable configuration;
- validation steps on the device after one or more triggers.

Do not assume the customer will apply a source-code diff. If they need to paste a complete script, provide complete script content or clearly identify the exact function/block to replace.

## Required Context

Before editing scripts, read the relevant files:

- For top-scan output behavior: read `tc_in_0401.js` and/or `tc_out_0401.js`.
- For side-scan ROI behavior: read `tc_in_front_0401.js` and/or `tc_out_front_0401.js`.
- For execution flow: read `脚本模块执行时序流程.md`.
- For existing business rules: read `脚本功能分析文档.md` and `更新要点.md`.

Additional skill references:

- For customer-safe runtime concepts, see [runtime-reference.md](runtime-reference.md).
- For log-driven field troubleshooting paths, see [troubleshooting.md](troubleshooting.md).
- For common script modification patterns and sync rules, see [script-patterns.md](script-patterns.md).

## Default Log-Driven Workflow

Most customer issues arrive as a log file or pasted log segment plus a problem description, usually including a task ID and the observed wrong behavior. Use this workflow first.

1. If the user provides a log directly in chat, treat that pasted text as the primary log input. Do not ask them to upload a file unless the pasted log is clearly truncated or missing the reported task.
2. Ask only for missing essentials: task ID, expected behavior, or actual wrong behavior. If the task ID is present in the pasted text or problem description, infer it.
3. Automatically run the log extraction helper before diagnosing. For an uploaded file, run:

```bash
python .cursor/skills/tc-script-development/scripts/extract_log_context.py <log-file> --task-id <task-id> --issue "<problem description>"
```

4. For pasted chat logs, pipe the pasted log into the helper through stdin or save it to a temporary log file first, then run the helper. Preferred stdin form:

```bash
python .cursor/skills/tc-script-development/scripts/extract_log_context.py - --task-id <task-id> --issue "<problem description>" <<'EOF'
<paste the user's log text exactly here>
EOF
```

5. Use the helper output as the first analysis source. Focus on the selected task segment and highlighted lines: script logs, output lines, ROI mode, variable values, command input, duplicate/history messages, compensation messages, and error markers.
6. Identify the first abnormal point in the task sequence. Work backward from the wrong output to variable mapping, ROI state, classification, history, command handling, or compensation logic.
7. Assume the most likely root cause is configuration or usage first. In customer support experience, most issues come from upper-computer variable mapping, wrong script slot, ROI configuration, command name mismatch, stale history, or diagnostic misuse rather than lower-computer or script engine defects.
8. Give the customer a correction plan: what setting to change, which script block to paste if a script change is needed, and how to validate with another trigger.
9. Only propose script changes after ruling out configuration and usage mistakes from the log evidence.

Do not skip the extraction step for long pasted logs. Manual inspection is acceptable only for very short snippets where the complete task context is already visible.

## Runtime Model

The device runs customer JavaScript in its embedded script runtime.

The upper-computer program stores script text and variable mappings. During device operation, the lower-computer receives or loads that script configuration, injects mapped values into the script engine, and executes the uploaded script text.

Top-scan output scripts are executed as full JavaScript text for each task. The lower-computer injects globals before evaluation, then the script calls `processCodes()` near the end of the file.

Side-scan ROI scripts are used differently. The script runtime registers `SetRoiIndex()` through `RegisterCallback()`, then invokes that callback during ROI decision to obtain the ROI index.

## Execution Timeline

Use this sequence to reason about bugs and requirements:

1. The device receives a trigger and starts a new task.
2. The lower-computer clears previous package information, slave ROI state, current ROI index, and missed-trigger task state.
3. Side-scan algorithm runs first-frame/package detection logic.
4. The device runtime prepares ROI polygons, package boxes, package direction, and virtual lines for script access.
5. Side-scan script callback `SetRoiIndex(isBoxPassLine)` is registered and invoked.
6. `SetRoiIndex()` returns a side-scan ROI index, usually zero-based.
7. In group mode, the slave sends recognition result plus `RoiIndex` to the host.
8. The host stores slave ROI values and exposes them to scripts through `VNLib.GetSlaveRoiIndex()`.
9. Top-scan result processing builds mapped JS variables such as `code`, `center`, `ROI_number`, `time`, and command inputs.
10. Top-scan script executes, filters by ROI if needed, classifies barcodes, builds metadata, and calls `VNLib.SendOutput()`.
11. `VNLib.SendOutput()` enters the formal lower-computer output pipeline and produces customer protocol output.

If the observed symptom happens immediately after trigger, check side-scan callback logic, JSON parsing, repeated `SendOutput()` calls, and missing injected variables first.

## Global Objects

Scripts can call these injected objects.

### `VNLib`

- `VNLib.Log(msg)`: write script debug logs. Prefer this for diagnostics.
- `VNLib.SendOutput(text, delayTimeMs?)`: send formal output to the lower-computer result pipeline. Do not use it for frequent debug printing.
- `VNLib.getSeparator()`: return the separator used between multiple barcode values.
- `VNLib.GetMissedTriggerCountDuringTask()`: return missed trigger count for the current task.
- `VNLib.GetBoxCoordinates()`: return package boxes as compact JSON.
- `VNLib.GetBoxLineCoordinates()`: return virtual detection lines as compact JSON.
- `VNLib.GetBoxDirection()`: return package movement direction. `0`: left to right, `1`: right to left, `2`: top to bottom, `3`: bottom to top.
- `VNLib.GetOnlineSlaveCount()`: return online slave count.
- `VNLib.GetSlaveRoiIndex()`: return host-side slave ROI map as JSON, such as `{"1":0,"2":1}`.
- `VNLib.GetRoiPoints()`: return ROI polygon list as JSON.
- `VNLib.RegisterCallback(name, func)`: register a JS callback, used by side-scan scripts.

### `GlobalString`

- `GlobalString.load(key)`: read a persistent string value.
- `GlobalString.store(key, value)`: store a persistent string value.
- `GlobalString.clear(key)`: clear one value if supported by the target version.
- `GlobalString.clearAll()`: clear all values if supported. Avoid using this in customer scripts unless required.

### `GlobalNumeric`

- `GlobalNumeric.load(key)`: read a persistent number.
- `GlobalNumeric.store(key, value)`: store a persistent number.

## Top-Scan Injected Variables

Top-scan scripts receive variables based on format configuration. Do not assume a variable exists unless it is configured or already used in the target script.

Common variables:

- `code`: barcode content list separated by `VNLib.getSeparator()`.
- `center`: barcode center list aligned with `code`.
- `ROI_number`: one-based ROI number list aligned with `code`.
- `time`: task time.
- `device_number`: device number list aligned with results.
- `strStored`: serial command input.
- `strTcpStored`: TCP command input.
- `box_coordinate`: package coordinate string if available.
- `box_angle`: package angle if available.

Supported data-source keys in lower-computer configuration include `code_content`, `code_type`, `code_angle`, `code_coordinate`, `code_center`, `code_center_x`, `code_center_y`, `ROI_number`, `PPM`, `time`, `algTime`, `taskTime`, `deviceName`, `code_quality`, `codenum`, and `code_length`. The actual JavaScript variable name is the configured `dataName`; for example, the script may receive `code`, not `code_content`.

Always use safe checks for optional variables:

```js
const value = typeof optionalName !== 'undefined' ? optionalName : '';
```

## Upper-Computer Variable Mapping

The upper-computer script page must map lower-computer data sources to JavaScript variable names. A script can only use variables that the upper-computer configured and the lower-computer injected.

For standard TC top-scan scripts, configure at least:

| Required | Data source | JS variable name | Purpose |
| --- | --- | --- | --- |
| Yes | `code_content` | `code` | barcode contents |
| Yes | `code_center` | `center` | barcode center points |
| Yes | `ROI_number` | `ROI_number` | ROI-based filtering |
| Yes | `time` | `time` | `Metadata.Time` |
| Optional | device-name/device-number source | `device_number` | device logs or metadata |
| Optional | `code_type` | configured name | diagnostics or custom classification |
| Optional | `code_quality` | configured name | quality output or diagnostics |
| Optional | `PPM` | configured name | diagnostics or metadata |
| Optional | `algTime` / `taskTime` | configured name | timing diagnostics |

For diagnostic scripts, either:

- map each data source to the exact variable name referenced by the script; or
- write the script using the existing configured variable names.

Example: `code_content` is a data-source key, not automatically a JS variable. If the upper-computer maps `code_content` to `code`, the script must read `code`, not `code_content`.

When a customer reports `ReferenceError`, frozen trigger behavior, or no output after pasting a script, first check:

- whether every referenced variable is mapped in the upper-computer;
- whether optional variables are guarded with `typeof`;
- whether the script sends excessive debug output through `VNLib.SendOutput()`;
- whether JSON-returning `VNLib` APIs are parsed inside `try/catch`.

## Output Rules

Top-scan scripts output customer protocol lines through `VNLib.SendOutput()`.

Default format:

```text
Camera.PostScan	JobId	1Z-or-special-1D	Maxicode	PostalCode	DisposalMark	0	Metadata...
```

Use tab characters between fields and `\r\n` at line end.

`VNLib.SendOutput()` is a formal result output API, not a debug print API. Excessive calls during one trigger can block or confuse the task/result pipeline. For diagnostics:

- Prefer `VNLib.Log(msg)`.
- If external output is necessary, aggregate diagnostics into one string and send once.
- Do not emit many independent `SendOutput()` lines during one trigger.

If the customer only wants to inspect variables, provide a `VNLib.Log()` diagnostic script first. Use `VNLib.SendOutput()` for diagnostics only when the customer explicitly needs the upper-computer or external receiver to see that text.

## Top-Scan Workflow

When modifying `tc_in_0401.js` or `tc_out_0401.js`:

1. Identify the customer requirement type:
   - output field change
   - barcode classification
   - `DisposalMark` rule
   - ROI filtering
   - metadata
   - history deduplication
   - serial/TCP command
   - missed-trigger compensation
2. Locate the existing function that owns the behavior. Prefer changing existing functions rather than adding a parallel flow.
3. Preserve the final `processCodes()` execution pattern.
4. Preserve separator handling with `const sep = VNLib.getSeparator()`.
5. Keep `code`, `center`, and `ROI_number` arrays aligned when filtering.
6. Use `GlobalString` only for values that must persist across tasks.
7. Use `VNLib.Log()` for debug information.
8. Call `VNLib.SendOutput()` only for intended customer protocol output.

Top-scan business flow normally runs in this order:

1. Read serial/TCP command input.
2. Build metadata from package, time, camera status, ROI mode, and box length.
3. Optionally filter `code` and `center` by side-scan ROI mode.
4. Split barcode strings by `VNLib.getSeparator()`.
5. Classify barcodes into `1Z`, Maxicode, PostalCode, and special 1D.
6. Read historical output from `GlobalString` and remove duplicates.
7. Calculate `DisposalMark`.
8. Choose which code fields to output.
9. Store newly output main codes in history.
10. Send `Camera.PostScan`.
11. Append missed-trigger compensation lines if needed.

When changing one step, inspect the later steps that depend on it. For example, changing barcode classification may also require changing `DisposalMark`, history storage, and output field selection.

## Side-Scan ROI Workflow

When modifying `tc_in_front_0401.js` or `tc_out_front_0401.js`:

1. Preserve the function names `SetRoiIndex` and `RegisterCallback`.
2. Preserve callback registration:

```js
function RegisterCallback(){
    VNLib.RegisterCallback("SetRoiIndex", SetRoiIndex);
}
```

3. Do not add a required direct call to `RegisterCallback()` at file end. The device script runtime handles callback registration timing.
4. Return a numeric ROI index from `SetRoiIndex`.
5. Treat side-scan ROI index as zero-based unless the target script clearly shows otherwise.
6. Use `VNLib.GetRoiPoints()`, `VNLib.GetBoxCoordinates()`, and `VNLib.GetBoxDirection()` for package and ROI decisions.
7. On error, log and return a safe default such as `0`.

Current side-scan scripts select ROI by package shape:

- Sort or select the target package according to movement direction.
- Determine package size using the current script logic.
- Select small ROI for `Short`, large ROI for `Tall`.
- Return the selected ROI object's `index`.

If changing the package-shape rule, update comments and logs so they match the real logic.

## ROI Mapping Rules

Be careful with zero-based and one-based ROI values.

Side-scan callback return value:

- Usually zero-based ROI index.
- Example: `0` means ROI1, `1` means ROI2.

Top-scan `ROI_number`:

- Comes from lower-computer result `ROINo + 1 + roioffse`.
- Usually one-based in JavaScript.
- Example: ROI index `0` becomes `ROI_number = 1`; ROI index `1` becomes `ROI_number = 2`.

Current top-scan behavior:

- If any slave ROI value is `1`, `judgeRoiMode()` returns `Tall`.
- Otherwise it returns `Short`.
- `Tall` filters top-scan barcodes by `ROI_number = 2`.
- `Short` filters top-scan barcodes by `ROI_number = 1`.
- If ROI mode is valid and original barcodes exist, but no barcode matches the target ROI, output barcode content as `????` instead of falling back to the original unfiltered barcode set. Keep other available recognition data and metadata unchanged unless the requirement says otherwise.

If changing this rule, keep side-scan return values and top-scan filtering consistent.

## Barcode Categories

Existing top-scan scripts classify barcodes mainly by content:

- Maxicode: starts with `[)`.
- `1Z`: starts with `1Z`.
- PostalCode: length equals `8`.
- Special 1D: starts with `B` or `1B`.

Current `DisposalMark` meanings:

- `0`: normal result.
- `1`: incomplete or no valid main code.
- `2`: multi-package or same-category multi-code conflict.
- `3`: special 1D related output.

When changing classification, update all affected places:

- category extraction
- duplicate/history checks
- `DisposalMark`
- output selection
- history storage
- metadata or logs if relevant

## History and State

Top-scan scripts use `GlobalString` for cross-task state:

- `jobIdCounter`: output job number.
- `bypassMode`: bypass state.
- `lastTaskCodes`: recent emitted main barcodes.
- `codeTimes`: timestamps used for timeout cleanup.

Do not clear all global state as a quick fix. Only clear the specific keys required by the customer behavior.

If changing duplicate logic:

- Preserve timeout cleanup unless the customer explicitly disables it.
- Keep stored history format compatible with existing `storeHistory()` and `checkAndClearTimeoutHistory()`.
- Do not store postal-only values as main barcode history unless required.

## External Commands

Top-scan scripts process command input from:

- `strStored`: serial input, higher priority.
- `strTcpStored`: TCP input.

Existing commands:

- `bypass on`
- `bypass off`
- `resetnum`

If adding commands:

- Trim and lowercase input before comparison.
- Preserve existing command behavior.
- If command output is needed, send a short response once.
- Document the command in script comments and related markdown.

## Defensive Coding

Follow these patterns:

```js
function safeJsonParse(text, fallback) {
    try {
        return JSON.parse(text);
    } catch (e) {
        VNLib.Log("JSON parse failed: " + e.message + "\r\n");
        return fallback;
    }
}
```

```js
const sep = VNLib.getSeparator();
const codes = (typeof code === 'string' && code !== '') ? code.split(sep) : [];
```

Avoid:

- Directly referencing optional variables without `typeof`.
- Repeated `VNLib.SendOutput()` calls for debugging.
- Changing output field order without explicit requirement.
- Breaking `code` / `center` / `ROI_number` alignment.
- Adding dependencies not supported by the device script runtime.
- Using browser or Node APIs such as `window`, `document`, `require`, `fs`, or `process`.
- Depending on `console.log`, `setTimeout`, `Promise`, dynamic import, CommonJS modules, filesystem APIs, or network APIs.
- Using very new JavaScript syntax unless it has already been verified on the target device script runtime.

`node --check` can catch syntax errors only. It does not prove runtime compatibility with the device script runtime or availability of injected globals such as `VNLib`.

## Validation Checklist

After modifying a script, verify:

- The modified file has valid JavaScript syntax.
- Optional injected variables are guarded with `typeof`.
- `VNLib.SendOutput()` is only used for intended external output.
- The upper-computer variable mapping includes every variable referenced by the script.
- Side-scan scripts still define `SetRoiIndex` and `RegisterCallback`.
- Top-scan scripts still call `processCodes()` once at the end.
- ROI mapping remains consistent between side-scan and top-scan scripts.
- Output still uses tab-separated `Camera.PostScan` fields.
- History state keys remain compatible.
- Logs are useful but not excessive.
- Related markdown is updated if behavior or customer command names changed.
- Related customer-facing examples and upper-computer command descriptions are updated when output fields or command names change.

## Common Tasks

### Add a metadata field

1. Find metadata construction near the top-scan script configuration section.
2. Add a feature switch if the field may be optional.
3. Compute the value using injected variables or `VNLib`.
4. Append `Metadata.Name=value` to `metadataParts`.
5. Guard missing values with a clear placeholder such as `????` or `undefined`, matching existing style.

### Change ROI selection

1. Modify side-scan `SetRoiIndex()` if package shape selection changes.
2. Modify top-scan `judgeRoiMode()` or `filterCodesByRoi()` only if the top-scan filtering rule also changes.
3. Keep logs showing selected ROI and reason.
4. Verify zero-based side-scan return value versus one-based top-scan `ROI_number`.

### Add a barcode rule

1. Add classification logic in `processCodes()` or a nearby helper.
2. Decide whether the new code type is a main code, auxiliary code, or metadata only.
3. Update `DisposalMark` logic.
4. Update history storage only for main codes that should suppress future repeats.
5. Add logs for rule decisions.

### Debug injected values safely

Use one aggregated log:

```js
let msg = "";
msg += "code=" + (typeof code !== 'undefined' ? code : "<undefined>") + "\r\n";
msg += "ROI_number=" + (typeof ROI_number !== 'undefined' ? ROI_number : "<undefined>") + "\r\n";
msg += "time=" + (typeof time !== 'undefined' ? time : "<undefined>") + "\r\n";
VNLib.Log(msg);
```

Do not send each debug value with `VNLib.SendOutput()`.

## Deliverable Expectations

When completing a script change, report:

- Which script slot/file the customer should paste into, such as top-scan input, top-scan output, side-scan input-front, or side-scan output-front.
- What customer behavior changed.
- The exact upper-computer variable mappings required.
- Whether the delivered content is a complete script or a replacement block/function.
- How to validate on a trigger.
- Any risk involving ROI numbering, output format, history, or missing injected variables.
