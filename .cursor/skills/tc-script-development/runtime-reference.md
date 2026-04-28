# Runtime Reference

This reference is customer-safe. It describes runtime stages and log clues without exposing internal source paths or implementation details.

## Runtime Stage Index

| Problem area | Runtime stage | What to inspect from logs/settings |
| --- | --- | --- |
| Variables are missing | Upper-computer variable mapping and script startup | Confirm each script variable name is mapped exactly as used, especially `code`, `center`, `ROI_number`, and `time`. |
| Script does not run | Script enable state and script entry | Confirm the correct script slot is enabled and top-scan scripts still call `processCodes()` once. |
| Debug causes abnormal behavior | Device output pipeline | Confirm diagnostic text uses `VNLib.Log()` and not many repeated `VNLib.SendOutput()` calls. |
| ROI mode is wrong | Side-scan ROI decision and host-side ROI state | Confirm side-scan returns expected ROI index and top-scan logs show expected `Tall` / `Short` mode. |
| ROI filtering is wrong | Top-scan ROI filtering | Confirm `ROI_number` is one-based and aligned with `code` / `center`. |
| Output content is wrong | Barcode classification and output branch | Inspect logs around classification, duplicate history, `DisposalMark`, and final `Camera.PostScan`. |
| Duplicate suppression is wrong | Script persistent history | Inspect `lastTaskCodes`, `codeTimes`, and timeout cleanup logs if present. |
| Extra compensation output appears | Missed-trigger compensation | Inspect missed-trigger count and whether compensation is appended once per normal output. |
| Command does not work | Serial/TCP command handling | Confirm command arrives in `strStored` or `strTcpStored`, and command name matches the script exactly. |

## Top-Scan Runtime Chain

1. The device receives recognition results for the task.
2. The upper-computer variable mapping determines which values become JavaScript variables.
3. The device script runtime injects those values into the top-scan script.
4. The top-scan script executes and calls `processCodes()`.
5. The script filters ROI if needed, classifies barcodes, handles history, builds metadata, and sends output.

If a variable is `undefined`, inspect upper-computer mapping first. This is more common than a script runtime defect.

## Side-Scan ROI Runtime Chain

1. Side-scan package and ROI data are prepared by the device.
2. The side-scan script registers `SetRoiIndex`.
3. The device invokes `SetRoiIndex` and receives a numeric ROI index.
4. In group mode, the side-scan ROI result is sent to the host-side task state.
5. The top-scan script reads the slave ROI state through `VNLib.GetSlaveRoiIndex()`.
6. The top-scan script maps `Tall` / `Short` to one-based `ROI_number` filtering.

If ROI does not take effect, inspect side-scan return value, group ROI log lines, top-scan ROI mode logs, and `ROI_number` mapping.

## Output and Compensation Chain

`VNLib.SendOutput()` is formal customer output. It should not be used for repeated debug lines.

For missed-trigger compensation:

1. The device records missed-trigger count during the task.
2. The script reads the count through `VNLib.GetMissedTriggerCountDuringTask()`.
3. The script appends compensation `Camera.PostScan` lines after normal output.
4. Each compensation line consumes a new `JobId`.

If compensation output count is wrong, first inspect customer trigger timing, missed-trigger count logs, and whether the normal output path was executed more than once.
