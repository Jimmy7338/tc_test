# Script Patterns

Use these patterns when modifying customer scripts. Keep the delivered script compatible with the device script runtime.

## Sync Rules After Script Changes

When script behavior changes, update the related explanation files or customer instructions.

ROI behavior changes:

- Update `脚本模块执行时序流程.md`.
- Update `脚本功能分析文档.md`.
- Update this skill or reference files if the "current behavior" changes.
- Recheck side-scan zero-based ROI return values and top-scan one-based `ROI_number`.

Command name changes:

- Update script header comments.
- Update business documentation.
- Update upper-computer command instructions.
- Preserve old command aliases only if the customer requires compatibility.

Output field changes:

- Update `formatOutput()` and all branches that call it.
- Update missed-trigger compensation output if field count/order changes.
- Update customer protocol examples.
- Confirm tab order and `\r\n` line endings.

Barcode classification changes:

- Update classification logic.
- Update `DisposalMark` logic.
- Update history storage and duplicate checks.
- Update any Maxicode extraction logic if it depends on the changed category.

## Variable Mapping Template

Use this in delivery notes for standard top-scan scripts:

| Required | Data source | JS variable name | Notes |
| --- | --- | --- | --- |
| Yes | `code_content` | `code` | Main barcode content list. |
| Yes | `code_center` | `center` | Must align with `code`. |
| Yes | `ROI_number` | `ROI_number` | One-based ROI number used by top-scan filtering. |
| Yes | `time` | `time` | Used by `Metadata.Time`. |
| Optional | device-number source | `device_number` | Used by logs or device metadata if enabled. |
| Optional | `code_type` | custom name | Diagnostics or custom classification. |
| Optional | `code_angle` | custom name | Diagnostics or custom metadata. |
| Optional | `code_coordinate` | custom name | Diagnostics or custom geometry. |
| Optional | `code_quality` | custom name | Quality output or diagnostics. |
| Optional | `PPM` | custom name | PPM output or diagnostics. |
| Optional | `algTime` | custom name | Algorithm timing diagnostics. |
| Optional | `taskTime` | custom name | Task timing diagnostics. |
| Optional | `deviceName` | custom name | Device-name output if required. |

If the script references a variable, it must be mapped or guarded with `typeof`.

## Safe Diagnostic Pattern

Use `VNLib.Log()` first:

```js
let msg = "";
msg += "=== SCRIPT DIAG ===\r\n";
msg += "code=" + (typeof code !== "undefined" ? code : "<undefined>") + "\r\n";
msg += "center=" + (typeof center !== "undefined" ? center : "<undefined>") + "\r\n";
msg += "ROI_number=" + (typeof ROI_number !== "undefined" ? ROI_number : "<undefined>") + "\r\n";
msg += "time=" + (typeof time !== "undefined" ? time : "<undefined>") + "\r\n";
VNLib.Log(msg);
```

Do not send each diagnostic value with `VNLib.SendOutput()`. If external diagnostic output is required, aggregate into one output line/string.

When debugging ROI/order complaints, include these fields in one log block:

- task/job identifier;
- input `code`, `center`, `ROI_number`;
- resolved ROI mode and target ROI index;
- filtered count vs original count;
- final chosen main code category and output branch.

## ROI Empty-Match Pattern

Current policy:

If ROI mode is valid and original barcodes exist, but no barcode matches the target ROI, the script should output barcode content as `????` rather than falling back to the original unfiltered barcode set. Keep available metadata and non-conflicting recognition context.

Pattern:

```js
const roiFiltered = filterCodesByRoi(code, center, typeof ROI_number !== "undefined" ? ROI_number : "");
if (roiFiltered.roiModeValid && roiFiltered.originalHadCodes && roiFiltered.noTargetRoiMatch) {
    sendOutput(formatOutput("PostScan", "????", "????", "????", "1", metadata));
    return;
}
```

Adapt field values to the script's actual `DisposalMark` requirement.

Field note:

- Temporary bypass of ROI equality checks is useful for debugging but must be clearly marked and reverted for production scripts.
- If bypass is enabled, multi-1Z collisions and `!!!!` output become expected side effects, not independent defects.

## JSON API Pattern

`VNLib.GetSlaveRoiIndex()`, `VNLib.GetRoiPoints()`, `VNLib.GetBoxCoordinates()`, and `VNLib.GetBoxLineCoordinates()` return JSON strings. Always parse defensively:

```js
function parseJsonOrFallback(text, fallback, label) {
    try {
        return JSON.parse(text);
    } catch (e) {
        VNLib.Log(label + " parse failed: " + e.message + "\r\n");
        return fallback;
    }
}
```

## Device Runtime Compatible Coding

Prefer conservative JavaScript:

- Use `var`, `let`, `const`, functions, arrays, and plain objects.
- Avoid module imports, `require`, filesystem access, network access, DOM APIs, and Node globals.
- Avoid relying on `console.log`; use `VNLib.Log`.
- Avoid `setTimeout`, `Promise`, async/await, and very new syntax unless verified on the target firmware.

`node --check` is useful for syntax only. Device validation is still required.

## Delivery Note Template

When returning a script change to the customer, include:

```text
Paste target:
[top-scan input / top-scan output / side-scan input-front / side-scan output-front]

Change summary:
[short description]

Upper-computer variable mapping:
- code_content -> code
- code_center -> center
- ROI_number -> ROI_number
- time -> time
- [optional mappings]

Validation:
1. Paste script and save configuration.
2. Trigger one package with expected barcode.
3. Check script log for [specific log].
4. Check output contains [expected output].

Risks:
[ROI numbering / history / output format / optional variables]
```

## Investigation Report Template (for customer support)

Use this structure when returning a diagnosis before code delivery:

```text
Problem statement:
[customer expected behavior] vs [actual behavior]

Evidence:
- Fault task/job ID: [...]
- Last correct task/job ID: [...]
- Key log markers: [Camera.PostScan / ROI filter / classification / angle]

First abnormal point:
[single branch decision that first diverges]

Root cause:
[configuration / ROI geometry / script logic / mixed]

Immediate action:
1. [setting change first]
2. [script update only if required]

Retest:
1. Trigger same test condition.
2. Verify next task/job ID output.
3. Confirm [specific expected code/order/skew/ROI behavior].
```
