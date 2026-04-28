# Troubleshooting Playbook

Use this playbook by symptom. Start with upper-computer variable mapping and script logs. Most field issues are configuration or usage problems, not script engine defects.

When the user pastes logs directly in chat, first run the pasted content through `scripts/extract_log_context.py` using stdin or a temporary file. Use the extracted task segment as the basis for the checks below.

## Log Marker Interpretation

The extraction script highlights log lines by runtime meaning. Use these tags to decide the next check:

- `CONFIG`: Most likely upper-computer variable mapping, script slot, optional variable guard, or callback registration setting issue.
- `ROI`: Check side-scan ROI selection, group ROI state, top-scan `ROI_number` mapping, and empty-match policy.
- `GROUP`: Check master/slave connection and whether the slave result for the reported task reached the host state.
- `OUTPUT`: Check output branch, output field values, and whether the result was changed to `????` by ROI or history logic.
- `HISTORY`: Check `lastTaskCodes`, `codeTimes`, timeout cleanup, and whether the barcode was treated as duplicate.
- `COMP`: Check missed-trigger count, trigger configuration, and whether compensation output was appended more than once.
- `CMD`: Check whether the command arrived through serial/TCP and whether the command name matches the script.
- `TRIGGER`: Check trigger timing, task state changes, forced end, and missed-trigger behavior.
- `DECODE`: Check whether recognition completed and produced barcode/package data before script processing.
- `ERROR`: Find the first error line in the task segment; later errors are often secondary.

Prefer configuration correction first. Only recommend script modification when the log proves the current customer rule cannot be achieved by settings.

## No Output

Check in order:

1. The script was pasted into the correct upper-computer script slot.
2. Script function is enabled in the upper-computer configuration.
3. Required variables are mapped, especially `code`, `center`, `ROI_number`, and `time`.
4. The script reaches its entry point, normally `processCodes()` for top-scan scripts.
5. `VNLib.SendOutput()` is called on the intended output path.
6. No earlier `ReferenceError` occurs from an unmapped variable.
7. `VNLib.SendOutput()` is not hidden behind a condition such as empty code, duplicate history, or ROI filtering.

Likely correction: enable the correct script slot, fix variable mapping, or restore the expected output branch.

## Variable Is `undefined`

Check in order:

1. Confirm whether the name is a data-source key or a JS variable name.
2. Confirm the upper-computer maps that data source to the exact JS name used by the script.
3. Use `typeof variable !== 'undefined'` guards for optional values.
4. Avoid direct diagnostic scripts that reference many unmapped names.

Example: if `code_content` is mapped to `code`, the script must read `code`.

## ROI Filtering Does Not Work

Check in order:

1. Side-scan scripts still define `SetRoiIndex()` and `RegisterCallback()`.
2. Side-scan callback returns the expected zero-based ROI index.
3. Group slave sends `RoiIndex`.
4. Host receives and stores the slave ROI map.
5. `VNLib.GetSlaveRoiIndex()` returns valid JSON in top-scan script.
6. `judgeRoiMode()` returns expected `Tall` or `Short`.
7. Top-scan `ROI_number` values are one-based and aligned with `code`.
8. Current empty-match policy is applied: valid ROI mode + original barcode exists + no target ROI match means output barcode content as `????`, not original unfiltered code.

Likely correction: fix side-scan ROI selection settings, group connection/state, or one-based `ROI_number` mapping in the upper-computer.

## Output Shows Raw Code Or `????` Unexpectedly

Check in order:

1. `filterCodesByRoi()` result and empty-match behavior.
2. Barcode classification rules for `1Z`, Maxicode, PostalCode, and special 1D.
3. Historical duplicate filtering from `lastTaskCodes`.
4. `DisposalMark` decision path.
5. Output branch that calls `formatOutput()`.
6. Whether Maxicode special 1D extraction changed the result.

If output fields changed, also inspect compensation output, because compensation may reuse or mirror output structure.

## Device Freezes Or Screen Stops After Trigger

Check in order:

1. The script is not sending many diagnostic lines through `VNLib.SendOutput()`.
2. Debug output uses `VNLib.Log()` or one aggregated `SendOutput()` at most.
3. Optional variables are guarded with `typeof`.
4. JSON parsing is wrapped with `try/catch`.
5. No infinite loop or heavy per-code/per-frame computation was introduced.
6. Side-scan callback returns quickly and always returns a number.

Most field diagnostic scripts should log once with `VNLib.Log()` instead of sending many formal output lines.

## History Deduplication Is Wrong

Check in order:

1. `lastTaskCodes` structure remains compatible with existing `storeHistory()` logic.
2. `codeTimes` structure remains compatible with timeout cleanup.
3. Timeout value is still appropriate for the customer.
4. New barcode categories are only stored as history when they should suppress future repeats.
5. Postal-only values are not accidentally stored as main barcode history unless required.

Common symptoms:

- Same package repeats: history not stored or key changed.
- New package suppressed: timeout too long or history matching too broad.
- Special 1D behavior wrong: special 1D and `1Z` are both part of 1D-like multi-package logic.

## Missed-Trigger Compensation Is Wrong

Check in order:

1. `VNLib.GetMissedTriggerCountDuringTask()` return value in logs.
2. Compensation builder creates exactly one line per missed trigger.
3. Compensation output consumes new `JobId` values.
4. Normal output path does not call compensation multiple times.
5. Lower-computer missed-trigger count is reset per task.

Likely correction: adjust trigger settings/timing, confirm missed-trigger count, or ensure compensation is appended only once.

## Command Does Not Work

Check in order:

1. Command arrives in `strStored` or `strTcpStored`.
2. Script trims and lowercases input before matching.
3. Serial input has priority over TCP input.
4. Command name matches the script exactly, such as `resetnum`.
5. If command name changes, update script comments, business docs, and upper-computer command instructions.

## Syntax Passes But Device Still Fails

`node --check` only validates syntax. It does not validate:

- device script runtime compatibility;
- availability of `VNLib`, `GlobalString`, or mapped variables;
- device output behavior;
- ROI callback extraction;
- group communication timing.

If a script passes syntax checks but fails on device, inspect runtime assumptions and injected variables first.
