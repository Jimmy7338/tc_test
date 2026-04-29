# System Business Safe Guide

This guide is customer-safe. It helps customer engineers understand upper-computer, lower-computer, and script collaboration without exposing internal source code details.

## Audience and Scope

Use this guide when the customer asks:

- how top-scan and side-scan scripts cooperate;
- why script behavior differs from expected business rules;
- where to check first when field issues happen.

This document explains runtime responsibilities, business decision points, and troubleshooting boundaries only.

## How To Use This Guide

Use this sequence for every field issue:

1. Find the first wrong `taskid` or `JobId`.
2. Search the same time window for the exact log keywords listed below.
3. Identify the first abnormal log marker (not the last error).
4. Apply the corresponding action.
5. Retest with one fresh task and compare with one previous correct task.

## Three-Layer Responsibility Model

### Upper-computer

- Provides script text and variable mapping configuration.
- Enables or disables script slots.
- Sends runtime parameters and displays output logs.

Upper-computer usually controls "what variables exist in script runtime" and "which script is currently active".

### Lower-computer

- Executes recognition and device-side runtime pipeline.
- Injects configured variables into script runtime.
- Invokes script callbacks and handles formal output transport.

Lower-computer usually controls "when script runs" and "how output enters the device output pipeline".

### Script layer

- Implements customer business rules: filtering, classification, output formatting, deduplication, compensation, command response.
- Uses injected runtime APIs and mapped variables.

Script layer usually controls "how data is interpreted for customer business logic".

## Runtime Collaboration Chain

Use this chain to locate issue stage quickly:

1. Device trigger arrives and task starts.
2. Recognition data and runtime context are prepared.
3. Side-scan callback decides ROI mode signal for the task when applicable.
4. Upper-computer mapping defines final script variable names.
5. Top-scan business script processes codes and metadata.
6. Script sends formal output to output pipeline.
7. Upper-computer or external receiver gets final output text.

If an issue appears before any business log line, prioritize mapping/slot/config checks before script logic changes.

## Script-First Business Decision Points

Most customer-visible customization happens in script logic:

- ROI-related filtering strategy;
- barcode category extraction and priority;
- output field population and placeholder rules;
- duplicate/history suppression;
- missed-trigger compensation line generation;
- serial/TCP command behavior.

When these points conflict with expected behavior, script adjustments are often required after configuration checks are done.

## Safe Troubleshooting Boundaries

### Prefer configuration checks first

1. Correct script slot is enabled.
2. Required variable mappings exist and names match script usage.
3. ROI mode and group-device state are valid.
4. Commands actually arrive in script-visible variables.

### Move to script logic checks second

1. First abnormal decision branch in logs is identified.
2. Business rule mismatch is confirmed with one correct task and one wrong task comparison.
3. Fix targets a single rule block first, then retest.

### Escalate to platform internals only when

- script inputs are correct and stable;
- script branch behavior is proven correct by logs;
- output still diverges in transport/runtime stages.

This keeps customer support efficient and avoids unnecessary low-level debugging.

## Lower-Computer Log To Issue Mapping

This section maps real lower-computer log outputs to likely issue domains and actions.  
Use exact keyword matching in logs.

### A. Script callback extraction and registration (side-scan ROI chain)

- `script is empty`
  - Meaning: script text is empty when lower-computer tries to prepare callback.
  - Likely issue: wrong script slot, script not pasted, or script synchronization failed.
  - Action: re-paste full script in correct slot, save/apply, trigger again.

- `begin extract RegisterCallback function` then `callbackFuncStr is empty`
  - Meaning: runtime cannot extract `RegisterCallback` function body from script text.
  - Likely issue: function missing, renamed, or broken by syntax/format.
  - Action: restore standard `RegisterCallback` function signature and body.

- `begin extract SetRoiIndex function` then `setRoiIndexFuncStr is empty`
  - Meaning: runtime cannot extract `SetRoiIndex`.
  - Likely issue: function missing or renamed.
  - Action: restore `SetRoiIndex(isBoxPassLine)` with numeric return value.

- `JS script run err!!!!! Uncaught exception at line...`
  - Meaning: callback/script evaluation failed before normal logic execution.
  - Likely issue: syntax error, unsupported runtime syntax, or undefined variable usage.
  - Action: fix syntax first; then guard optional variables with `typeof`; avoid unsupported APIs.

- `RegisterCallback call failed: ...`
  - Meaning: `RegisterCallback` exists but throws at runtime call.
  - Likely issue: internal call to undefined symbol, wrong callback name, or runtime mismatch.
  - Action: ensure `VNLib.RegisterCallback("SetRoiIndex", SetRoiIndex)` is used exactly once.

- `RegisterCallback is not callable`
  - Meaning: global `RegisterCallback` is not a function.
  - Likely issue: overwritten variable name or wrong declaration pattern.
  - Action: keep `RegisterCallback` as function declaration; do not reassign it to non-function values.

- `RegisterCallback call success`
  - Meaning: callback registration stage is healthy.
  - Next step: if ROI still wrong, continue to callback return logs below.

### B. Side-scan callback execution and ROI apply stage

- `callback SetRoiIndex returned roiIndex:<n>`
  - Meaning: script callback executed and returned numeric ROI index.
  - Likely issue when output still wrong: ROI numbering/mapping mismatch (zero-based vs one-based), or top-scan filter rule mismatch.
  - Action: verify ROI mapping consistency: side callback index policy vs top-scan `ROI_number` policy.

- `callback SetRoiIndex returned null`
  - Meaning: callback did not produce valid numeric output.
  - Likely issue: missing return path, exception branch, or invalid parse.
  - Action: add safe default return (for example `0`) in all branches; wrap JSON parse in `try/catch`.

- `set roi index:<n>`
  - Meaning: lower-computer applied single ROI for this task.
  - If wrong results remain: likely wrong callback decision rule or wrong ROI geometry.
  - Action: compare decoded center points with configured ROI coordinates; adjust rule/geometry first.

- `set all roi`
  - Meaning: lower-computer did not lock to one ROI and used all ROI areas.
  - Likely issue: callback returned invalid index or callback path not active for this task.
  - Action: trace back to `callback SetRoiIndex returned ...` and registration logs.

### C. Trigger and missed-trigger stage

- `task start trigger missed, taskid:...`
  - Meaning: trigger event arrived while task trigger state was not ready for a new start.
  - Likely issue: trigger timing overlap, noisy input, or start/end signal configuration mismatch.
  - Action: check trigger timing and debounce settings; verify start/end pairing; then review compensation behavior.

- `task start trigger:<...> orderType:<...> iRunMode_:<...> isCancelEndDuringEndDelay:<...>`
  - Meaning: trigger context snapshot for this task.
  - Use it to confirm whether incoming order type matches configured run mode.
  - Action: if mismatch exists, align run mode and trigger source configuration first.

- `recv start signal in end delay`
  - Meaning: start signal arrived during end-delay window; previous end signal is canceled.
  - Likely issue: trigger interval too short for current end-delay.
  - Action: tune end-delay / trigger interval to prevent overlap.

- `group tryCountMissedTrigger, taskid:...`
  - Meaning: group-mode missed-trigger counting logic engaged.
  - Likely issue: host/slave trigger rhythm mismatch or network/coordination delay.
  - Action: compare host and slave task rhythm; check group synchronization first before script edits.

- `trigger forcibly end task`
  - Meaning: task forced to end due to trigger handling path.
  - Likely issue: cached trigger conditions or overlap policy triggered force-end.
  - Action: inspect nearby trigger logs and disable aggressive overlap path during diagnosis.

- `clear cached io trigger`
  - Meaning: cached IO trigger state was cleared.
  - Use as boundary marker when reconstructing trigger sequence.

### D. What this means for script issue ownership

- If logs fail in A/B stages first, fix script structure/runtime assumptions before business-rule tuning.
- If logs in A/B are healthy but output wrong, root cause is usually script business rule or mapping configuration.
- If C-stage logs are abnormal, prioritize trigger chain correction; script changes alone usually cannot solve it.

## Quick Symptom To Log Entry Path

### Symptom: ROI logic seems not effective

Check order:

1. `RegisterCallback call success`
2. `callback SetRoiIndex returned roiIndex:<n>` or `... returned null`
3. `set roi index:<n>` or `set all roi`
4. Final output behavior and ROI-related script logs

If any earlier step fails, do not jump to top-scan output logic edits.

### Symptom: Trigger compensation seems abnormal

Check order:

1. `task start trigger missed, taskid:...`
2. `group tryCountMissedTrigger, taskid:...` (group mode)
3. output and compensation lines around the same task window

First stabilize trigger sequence, then verify compensation script path.

### Symptom: Script pasted but side callback not active

Check order:

1. `script is empty`
2. `callbackFuncStr is empty`
3. `setRoiIndexFuncStr is empty`
4. `RegisterCallback call failed` / `is not callable`

Any one of these indicates callback preparation failure before business logic.

## Customer Communication Template

When reporting to customer, keep wording neutral and actionable:

- `Known facts`: confirmed from logs/settings.
- `First abnormal point`: first stage where behavior diverges.
- `Likely cause`: mapping/config/script rule.
- `Action now`: one concrete change.
- `Retest`: next task ID and expected observable output.

Avoid exposing internal source paths, private module names, or implementation details in customer-facing messages.

## Self-Service Workflow For Customer Engineers

1. Provide issue description, expected behavior, and first wrong task ID.
2. Extract and inspect task-level log context.
3. Match symptom to runtime stage (mapping, ROI, classification, history, output, compensation, command).
4. Apply minimal correction (settings first, script second).
5. Retest with one fresh trigger and compare against one previous correct task.
6. Repeat until first abnormal point disappears.

This workflow allows customer teams to solve most script issues without waiting for internal development support.
