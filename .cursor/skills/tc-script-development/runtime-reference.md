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

For task-level confirmation, prefer this micro-sequence:

1. Find reported `Camera.PostScan <JobId>`.
2. Verify whether output content matches customer complaint.
3. Move up to nearest `js log: Debug` lines.
4. Mark first abnormal branch (ROI filter, classification, history, angle, or command).
5. Check one immediately previous correct task for contrast.

## Side-Scan ROI Runtime Chain

1. Side-scan package and ROI data are prepared by the device.
2. The side-scan script registers `SetRoiIndex`.
3. The device invokes `SetRoiIndex` and receives a numeric ROI index.
4. In group mode, the side-scan ROI result is sent to the host-side task state.
5. The top-scan script reads the slave ROI state through `VNLib.GetSlaveRoiIndex()`.
6. The top-scan script maps `Tall` / `Short` to one-based `ROI_number` filtering.

If ROI does not take effect, inspect side-scan return value, group ROI log lines, top-scan ROI mode logs, and `ROI_number` mapping.

Practical mapping reminder:

- Script-side ROI expectations can differ from software ROI labels due to legacy numbering conventions.
- Validate with coordinates and centers from logs, not name assumptions.
- If decoded centers consistently land in one software ROI while script targets another, prefer ROI geometry adjustment and retest first.

## Output and Compensation Chain

`VNLib.SendOutput()` is formal customer output. It should not be used for repeated debug lines.

For missed-trigger compensation:

1. The device records missed-trigger count during the task.
2. The script reads the count through `VNLib.GetMissedTriggerCountDuringTask()`.
3. The script appends compensation `Camera.PostScan` lines after normal output.
4. Each compensation line consumes a new `JobId`.

If compensation output count is wrong, first inspect customer trigger timing, missed-trigger count logs, and whether the normal output path was executed more than once.

## Skewness/Angle Debug Chain

When customer reports skewness value anomalies:

1. Confirm reported skew value in `Camera.PostScan` metadata.
2. Locate angle debug block (vertex list, selected edge, final angle).
3. Verify selected vertices and reference edge are physically correct for conveyor direction.
4. If edge selection is wrong, treat as angle-calculation logic defect; otherwise treat as upstream coordinate issue.

Do not conclude "algorithm bug" only from final skew number. The selected-edge logs are the decisive evidence.
