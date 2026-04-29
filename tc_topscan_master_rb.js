/******************************************************************************************
 * Device: tc_in | Update: 2026-04-27 — 多包判定前先去重历史；special 1D + 1Z > 1 视为多包。
 * Variables: code, center, ROI_number, time, device_number
 *******************************************************************************************/
// 串口应答调试
const enableSerialResponse = true; // true: enable serial port response, false: disable serial port response
const debugmode = 0;
const enableTimeoutClear = true;
const timeoutSeconds = 10;
const enableNoBarcodeOutput = false;
const endStr = "\r\n";
const sep = VNLib.getSeparator();
const CODE_PLACEHOLDER = "????";
const CONFLICT_PLACEHOLDER = "!!!!";
const DISPOSAL_NORMAL = "0";
const DISPOSAL_INCOMPLETE = "1";
const DISPOSAL_MULTI_PACKAGE = "2";
const DISPOSAL_SPECIAL_1D = "3";
const CODE_TYPE_1Z = "1Z";
const CODE_TYPE_MAXICODE = "Maxicode";
let lastTaskForwardedOutput = "";
// 与 tc_before.js 一致：GlobalString.load("bypassMode") === "false"
let bypassMode = GlobalString.load("bypassMode") === "false";
function serialReply(text) {
    if (enableSerialResponse) {
        VNLib.SendOutput(text + endStr + "\n");
        logDebug("Serial response: " + text);
    }
}
function handleSerialMessage(message) {
    const t = message.trim().toLowerCase();
    if (t === "bypass on") {
        bypassMode = true;
        GlobalString.store("bypassMode", "true");
        logDebug("Bypass mode enabled");
        serialReply("bypass mode set to on");
    } else if (t === "bypass off") {
        bypassMode = false;
        GlobalString.store("bypassMode", "false");
        logDebug("Bypass mode disabled");
        serialReply("bypass mode set to off");
    } else if (t === "resetnum") {
        GlobalString.store("jobIdCounter", "0");
        logDebug("JobId counter has been reset");
        serialReply("jobId counter has been reset");
    }
}
const useTimeInMetadata = true;        // Whether to include time in metadata
const useAngleInMetadata = true;       // Whether to include angle in metadata
const useDeviceInMetadata = false;      // Whether to include device information in metadata
const useBoxPassLineInMetadata = true;  // Whether to include box pass line information in metadata
const useCameraStatusInMetadata = true; // Whether to include device status in metadata
const useSideRoiModeInMetadata = true; // Whether to include side ROI mode in metadata
const useParcelEdgeLengthInMetadata = true; // Whether to include parcel edge length in metadata
function createRuntimeContext() {
    const context = {
        input: {
            code: typeof code !== 'undefined' ? code : undefined,
            center: typeof center !== 'undefined' ? center : undefined,
            ROI_number: typeof ROI_number !== 'undefined' ? ROI_number : undefined,
            time: typeof time !== 'undefined' ? time : undefined,
            strStored: typeof strStored !== 'undefined' ? strStored : undefined,
            strTcpStored: typeof strTcpStored !== 'undefined' ? strTcpStored : undefined,
            box_coordinate: typeof box_coordinate !== 'undefined' ? box_coordinate : undefined,
            is_box_pass_line: typeof is_box_pass_line !== 'undefined' ? is_box_pass_line : undefined
        },
        deviceNumbers: (typeof device_number !== 'undefined' && device_number && typeof device_number === 'string' && device_number.trim() !== '') ? device_number.split(sep) : ['DEFAULT'],
        boxAngle: undefined,
        metadata: "",
        filteredCodeStr: "",
        filteredCenterStr: "",
        codes: [],
        centerArr: [],
        previousOutput: [],
        classified: null,
        codePositions: {},
        disposalMark: "1",
        historyCleared: false
    };
    return context;
}
function safeCall(getter, fallback) {
    try {
        const value = getter();
        return value === undefined ? fallback : value;
    } catch (e) {
        return fallback;
    }
}
function buildRunnerStyleInputSnapshot(context) {
    const input = context.input;
    const snapshot = {
        timeoutMs: 5000,
        injected: {
            code: input.code !== undefined ? String(input.code) : "",
            center: input.center !== undefined ? String(input.center) : "",
            ROI_number: input.ROI_number !== undefined ? String(input.ROI_number) : "",
            time: input.time !== undefined ? String(input.time) : "",
            device_number: Array.isArray(context.deviceNumbers) ? context.deviceNumbers.join(sep) : "",
            strStored: input.strStored !== undefined ? String(input.strStored) : "",
            strTcpStored: input.strTcpStored !== undefined ? String(input.strTcpStored) : "",
            box_coordinate: input.box_coordinate !== undefined ? String(input.box_coordinate) : "",
            is_box_pass_line: input.is_box_pass_line !== undefined ? String(input.is_box_pass_line) : ""
        },
        vnlib: {
            separator: safeCall(function() { return VNLib.getSeparator(); }, "|"),
            missedTriggerCountDuringTask: Number(safeCall(function() { return VNLib.GetMissedTriggerCountDuringTask(); }, 0)) || 0,
            boxCoordinates: safeCall(function() { return VNLib.GetBoxCoordinates(); }, "[]"),
            boxLineCoordinates: safeCall(function() { return VNLib.GetBoxLineCoordinates(); }, "[]"),
            boxDirection: Number(safeCall(function() { return VNLib.GetBoxDirection(); }, 0)) || 0,
            onlineSlaveCount: Number(safeCall(function() { return VNLib.GetOnlineSlaveCount(); }, 0)) || 0,
            slaveRoiIndex: safeCall(function() { return VNLib.GetSlaveRoiIndex(); }, "{}"),
            roiPoints: safeCall(function() { return VNLib.GetRoiPoints(); }, "[]")
        },
        globalStringStore: {},
        globalNumericStore: {}
    };
    return JSON.stringify(snapshot, null, 2);
}
function logRunnerStyleInputSnapshot(context) {
    const snapshotText = buildRunnerStyleInputSnapshot(context);
    VNLib.Log("RunnerInputSnapshot:\r\n" + snapshotText + endStr);
}
function logInitialInputSnapshot(context) {
    const input = context.input;
    const parts = [
        "InputSnapshot",
        "version=2026-04-27",
        "code=" + (input.code !== undefined ? input.code : "undefined"),
        "center=" + (input.center !== undefined ? input.center : "undefined"),
        "ROI_number=" + (input.ROI_number !== undefined ? input.ROI_number : "undefined"),
        "time=" + (input.time !== undefined ? input.time : "undefined"),
        "strStored=" + (input.strStored !== undefined ? input.strStored : "undefined"),
        "strTcpStored=" + (input.strTcpStored !== undefined ? input.strTcpStored : "undefined"),
        "box_coordinate=" + (input.box_coordinate !== undefined ? input.box_coordinate : "undefined"),
        "device_number=" + context.deviceNumbers,
        "box_angle=" + (context.boxAngle !== undefined ? context.boxAngle : "undefined"),
        "is_box_pass_line=" + (input.is_box_pass_line !== undefined ? input.is_box_pass_line : "undefined")
    ];
    VNLib.Log(parts.join(" | ") + endStr);
}
function handleConfiguredCommand(context) {
    const hasStrStored = context.input.strStored && String(context.input.strStored).trim() !== '';
    const hasStrTcpStored = context.input.strTcpStored && String(context.input.strTcpStored).trim() !== '';
    if (hasStrStored) {
        if (hasStrTcpStored) {
            logDebug("Both strStored and strTcpStored have values, using strStored");
        }
        handleSerialMessage(String(context.input.strStored));
    } else if (hasStrTcpStored) {
        handleSerialMessage(String(context.input.strTcpStored));
    }
}
function buildMetadata(context) {
    // 与 tc_before.js 一致：仅当四元开关之一为真时才进入 metadata 组装（否则 Camera/侧 ROI/边长等也不写入）
    if (!(useTimeInMetadata || useAngleInMetadata || useDeviceInMetadata || useBoxPassLineInMetadata)) {
        context.metadata = "";
        return;
    }
    let metadataParts = [];
    if (useAngleInMetadata) {
        const angleValue = (context.boxAngle !== undefined ? context.boxAngle : 'undefined');
        metadataParts.push(`Metadata.Skewness=${angleValue}`);
    }
    if (useTimeInMetadata) {
        const timeValue = (context.input.time !== undefined ? convertToISO8601Zulu(context.input.time) : 'undefined');
        metadataParts.push(`Metadata.Time=${timeValue}`);
    }
    if (useDeviceInMetadata) {
        const deviceValue = (Array.isArray(context.deviceNumbers) ? context.deviceNumbers.join('') : (context.deviceNumbers || 'undefined'));
        metadataParts.push(`Metadata.Device=${deviceValue}`);
    }
    if (useBoxPassLineInMetadata) {
        const is_box_pass_line = checkBoxAndLineIntersection();
        const boxPassLineValue = (typeof is_box_pass_line !== 'undefined' ? is_box_pass_line : 'undefined');
        metadataParts.push(`Metadata.Distance=${boxPassLineValue}`);
    }
    if (useCameraStatusInMetadata) {
        const Camera_status = GetDeviceStatus();
        const CameraStatusValue = (typeof Camera_status !== 'undefined' ? Camera_status : 'undefined');
        metadataParts.push(`Metadata.Camera.Status=Online${CameraStatusValue}`);
    }
    if (useSideRoiModeInMetadata) {
        const RoiMode = judgeRoiMode();
        const SideRoiMode = (typeof RoiMode !== 'undefined' ? RoiMode : 'undefined');
        metadataParts.push(`Metadata.Box=${SideRoiMode}`);
    }
    if (useParcelEdgeLengthInMetadata) {
        const parcelEdgeLength = getParcelEdgeLength();
        const ParcelEdgeLengthValue = (typeof parcelEdgeLength !== 'undefined' ? parcelEdgeLength : 'undefined');
        metadataParts.push(`Metadata.boxlength=${ParcelEdgeLengthValue}`);
    }
    context.metadata = metadataParts.length > 0 ? metadataParts.join('  ') : "";
}
function convertToISO8601Zulu(timeValue) {
    if (!timeValue || timeValue === "undefined") {
        return new Date().toISOString();
    }
    try {
        if (timeValue.includes('/') && timeValue.includes(':')) {
            const parts = timeValue.split(' ');
            if (parts.length >= 2) {
                const dateParts = parts[0].split('/');
                const timeParts = parts[1].split(':');
                if (dateParts.length >= 3 && timeParts.length >= 3) {
                    const ms = timeParts.length >= 4 ? timeParts[3].padStart(3, '0') : "000";
                    return `${dateParts[0]}-${dateParts[1].padStart(2, '0')}-${dateParts[2].padStart(2, '0')}T${timeParts[0].padStart(2, '0')}:${timeParts[1].padStart(2, '0')}:${timeParts[2].padStart(2, '0')}.${ms}Z`;
                }
            }
        } else if (timeValue.includes('-')) {
            return timeValue.endsWith('Z') ? timeValue : timeValue + 'Z';
        }
        return new Date().toISOString();
    } catch (error) {
        logDebug("Time conversion error: " + error.message);
        return new Date().toISOString();
    }
}
function getNextJobId() {
    if (bypassMode) {
        logDebug("Bypass mode enabled, returning task ID: 00-1");
        return "00-1";
    }
    const currentId = GlobalString.load("jobIdCounter") || "0";
    let nextId = (parseInt(currentId) + 1) % 9996;
    if (nextId === 0) nextId = 1; // Ensure starting from 1
    GlobalString.store("jobIdCounter", nextId.toString());
    const result = nextId.toString().padStart(4, '0');
    logDebug("Using cumulative logic, returning task ID: " + result);
    return result;
}
function logDebug(msg) {
    if (debugmode == 0) {
        VNLib.Log("Debug: " + msg + endStr);
    } else if (debugmode == 1) {
        sendOutput("Debug: " + msg + endStr);
    } else if (debugmode == 2) {
        VNLib.Log("Debug: " + msg + endStr);
        sendOutput("Debug: " + msg + endStr);   
    }
}
function sendOutput(str) {
    const mainOutput = str + endStr;
    VNLib.SendOutput(mainOutput);
    let finalOutput = mainOutput;
    if (typeof str === 'string' && str.startsWith("Camera.PostScan\t")) {
        const compensationOutput = buildMissedTriggerCompensationOutput(str);
        if (compensationOutput) {
            VNLib.SendOutput(compensationOutput);
            finalOutput = mainOutput + compensationOutput;
        }
        lastTaskForwardedOutput = finalOutput;
    }
}
function filterCodesByRoi(codeStr, centerStr, roiNumberStr) {
    try {
        if (typeof codeStr !== 'string' || codeStr === '') {
            return { codeStr, centerStr };
        }
        if (typeof roiNumberStr !== 'string' || roiNumberStr.trim() === '') {
            logDebug("ROI filter - ROI_number is empty or not string, skip filtering");
            return { codeStr, centerStr };
        }
        const roiMode = judgeRoiMode();
        logDebug("ROI filter - roiMode: " + roiMode);
        if (roiMode !== 'Tall' && roiMode !== 'Short') {
            logDebug("ROI filter - unknown roiMode, skip filtering");
            return { codeStr, centerStr };
        }
        const targetIndex = roiMode === 'Tall' ? 2 : 1;
        logDebug("ROI filter - target ROI index: " + targetIndex);
        const codeArr = codeStr.split(sep);
        const centerArr = (typeof centerStr === 'string' && centerStr !== '') ? centerStr.split(sep) : [];
        const roiArr = roiNumberStr.split(sep);
        const filteredCodes = [];
        const filteredCenters = [];
        for (let i = 0; i < codeArr.length; i++) {
            const rawRoi = (roiArr[i] !== undefined && roiArr[i] !== null) ? String(roiArr[i]).trim() : undefined;
            logDebug("ROI filter - codeArr[i]: " + codeArr[i]);
            if (!rawRoi) {
                continue;
            }
            const roiIdx = parseInt(rawRoi, 10);
            logDebug("ROI filter - roiIdx: " + roiIdx);
            if (!isFinite(roiIdx)) {
                continue;
            }
            if (roiIdx === -1) {
                continue;
            }
            if (roiIdx === targetIndex) {
                filteredCodes.push(codeArr[i]);
                filteredCenters.push(centerArr[i]);
            }
        }
        if (filteredCodes.length === 0) {
            logDebug("ROI filter - no code matched target ROI, return empty to trigger no-barcode flow");
            return { codeStr: "", centerStr: "" };
        }
        const newCodeStr = filteredCodes.join(sep);
        const newCenterStr = centerArr.length > 0 ? filteredCenters.join(sep) : centerStr;
        logDebug("ROI filter - original code count: " + codeArr.length + ", filtered count: " + filteredCodes.length);
        return {
            codeStr: newCodeStr,
            centerStr: newCenterStr
        };
    } catch (e) {
        logDebug("ROI filter - exception: " + e.message);
        return { codeStr, centerStr };
    }
}
function parseMaxicode(maxicodeData) {
    if (!maxicodeData || maxicodeData === "") return "";
    logDebug("Maxicode data (original): " + maxicodeData);
    return maxicodeData;
}
function getDisposalMark(oneZCodes, specialOneDCodes, maxiCodes, postalCodes) {
    const oneDLikeCount = oneZCodes.length + specialOneDCodes.length;
    if (oneDLikeCount > 1 || maxiCodes.length > 1) return "2";
    if (oneDLikeCount === 0 && maxiCodes.length === 0) return "1";
    if ((oneDLikeCount === 1 && maxiCodes.length === 0) || (oneDLikeCount === 0 && maxiCodes.length === 1)) return "1";
    if (oneDLikeCount === 0 && maxiCodes.length === 0 && postalCodes.length > 0) return "1";
    return "0";
}
function formatOutput(messageType, oneZCode, maxicodeData, postalCode, disposalMark, metadata) {
    const jobId = getNextJobId();
    logDebug("Generated task ID: " + jobId);
    const cleanMaxicodeData = parseMaxicode(maxicodeData);
    return [
        "Camera." + messageType,
        jobId,
        oneZCode || "",
        cleanMaxicodeData,
        postalCode || "",
        disposalMark,
        "0",
        metadata
    ].join('\t') + endStr;
}
function buildCompensationMetadata() {
    return [
        "Metadata.Skewness=????",
        "Metadata.Time=????",
        "Metadata.Distance=????",
        "Metadata.Camera.Status=????",
        "Metadata.Box=????",
        "Metadata.boxlength=????"
    ].join('  ');
}
function buildMissedTriggerCompensationOutput(lastPostScanLine) {
    let missNum = 0;
    try {
        missNum = parseInt(VNLib.GetMissedTriggerCountDuringTask(), 10) || 0;
    } catch (error) {
        logDebug("Failed to get missed trigger count: " + error.message);
        missNum = 0;
    }
    logDebug("Missed trigger compensation count: " + missNum);
    if (missNum <= 0) {
        return "";
    }
    const compensationMetadata = buildCompensationMetadata();
    const lines = [];
    for (let i = 0; i < missNum; i++) {
        const compensationJobId = getNextJobId();
        lines.push([
            "Camera.PostScan",
            compensationJobId,
            "????",
            "????",
            "????",
            "0",
            "0",
            compensationMetadata
        ].join('\t'));
    }
    return lines.join(endStr) + endStr;
}
function checkAndClearTimeoutHistory() {
    if (!enableTimeoutClear) {
        logDebug("Timeout clear function disabled");
        return false;
    }
    const currentTime = Date.now();
    let historyCleared = false;
    try {
        const historyData = GlobalString.load("lastTaskCodes");
        if (!historyData) {
            logDebug("No history records to check");
            return false;
        }
        const history = JSON.parse(historyData);
        if (!Array.isArray(history) || history.length === 0) {
            logDebug("History records are empty");
            return false;
        }
        logDebug("Start checking timeout, history record count: " + history.length);
        const codeTimesData = GlobalString.load("codeTimes");
        const codeTimes = codeTimesData ? JSON.parse(codeTimesData) : {};
        logDebug("Barcode time records: " + JSON.stringify(codeTimes));
        const validHistory = [];
        const validCodeTimes = {};
        for (let i = 0; i < history.length; i++) {
            const record = history[i];
            const codes = Array.isArray(record) ? record : [record];
            let recordValid = true;
            for (const code of codes) {
                const codeTime = codeTimes[code];
                if (codeTime) {
                    const timeDiff = (currentTime - codeTime) / 1000;
                    logDebug(`Check barcode ${code}, recognition time: ${new Date(codeTime).toISOString()}, survival time: ${timeDiff.toFixed(2)}s, timeout threshold: ${timeoutSeconds}s`);
                    if (timeDiff >= timeoutSeconds) {
                        logDebug(`Barcode ${code} has timed out ${timeDiff.toFixed(2)}s, removing from history records`);
                        recordValid = false;
                        historyCleared = true;
                    } else {
                        validCodeTimes[code] = codeTime;
                        logDebug(`Barcode ${code} not timed out, keeping in history records`);
                    }
                } else {
                    logDebug(`Barcode ${code} has no time record, skipping timeout check`);
                }
            }
            if (recordValid) {
                validHistory.push(record);
            }
        }
        if (historyCleared) {
            GlobalString.store("lastTaskCodes", JSON.stringify(validHistory));
            GlobalString.store("codeTimes", JSON.stringify(validCodeTimes));
            logDebug(`Timeout clear completed, remaining history record count: ${validHistory.length}`);
        }
    } catch (error) {
        logDebug("Error checking timeout history records: " + error.message);
    }
    return historyCleared;
}
function storeHistory(codes) {
    checkAndClearTimeoutHistory();
    const history = GlobalString.load("lastTaskCodes")
        ? JSON.parse(GlobalString.load("lastTaskCodes"))
        : [];
    history.push(codes);
    if (history.length > 4) {
        history.shift();
    }
    const currentTime = Date.now();
    const codeTimesData = GlobalString.load("codeTimes");
    const codeTimes = codeTimesData ? JSON.parse(codeTimesData) : {};
    for (const code of codes) {
        codeTimes[code] = currentTime;
        logDebug(`Record barcode ${code} recognition time: ${new Date(currentTime).toISOString()}`);
    }
    GlobalString.store("lastTaskCodes", JSON.stringify(history));
    GlobalString.store("codeTimes", JSON.stringify(codeTimes));
    logDebug("Updated history records, current record count: " + history.length);
}
function isDuplicate(code) {
    const history = GlobalString.load("lastTaskCodes")
        ? JSON.parse(GlobalString.load("lastTaskCodes"))
        : [];
    for (const record of history) {
        if (Array.isArray(record)) {
            if (record.includes(code)) {
                return true;
            }
        } else if (record === code) {
            return true;
        }
    }
    return false;
}
function calculateDistance(x, y) {
    return Math.sqrt(x * x + y * y);
}
function getBoxCenter(boxPoints) {
    if (!boxPoints || boxPoints.length < 4) return { x: 0, y: 0 };
    var x = (boxPoints[0].x + boxPoints[1].x + boxPoints[2].x + boxPoints[3].x) / 4;
    var y = (boxPoints[0].y + boxPoints[1].y + boxPoints[2].y + boxPoints[3].y) / 4;
    return { x: x, y: y };
}
function getBoxSortKey(boxPoints, dir) {
    var center = getBoxCenter(boxPoints);
    switch (dir) {
        case 0: return center.x;
        case 1: return -center.x;
        case 2: return center.y;
        case 3: return -center.y;
        default: return center.y;
    }
}
function isSpecialOneDCode(code) {
    return code.startsWith('B') || code.startsWith('1B');
}
function extractSpecialOneDFromMaxicode(maxicode) {
    if (!maxicode || maxicode === "") {
        logDebug("Maxicode is empty, cannot extract special 1D barcode");
        return null;
    }
    logDebug("Checking Maxicode for special 1D barcode using structured parsing");
    logDebug("Maxicode content: " + maxicode);
    try {
        const GS_ASCII = String.fromCharCode(0x1D);
        const RS_ASCII = String.fromCharCode(0x1E);
        const GS_VISUAL = "␝";
        const RS_VISUAL = "␞";
        let maxicodeData = maxicode.startsWith("[)>") ? maxicode.substring(3) : maxicode;
        maxicodeData = maxicodeData.replace(new RegExp(RS_VISUAL, 'g'), RS_ASCII).replace(new RegExp(GS_VISUAL, 'g'), GS_ASCII);
        const fields = maxicodeData.split(new RegExp(`[${GS_ASCII}${RS_ASCII}]`, 'g'));
        const nonEmptyFields = fields.filter(field => field.trim() !== "");
        logDebug(`Maxicode parsed into ${nonEmptyFields.length} fields`);
        logDebug("Fields: " + nonEmptyFields.map((f, i) => `[${i}]:${f}`).join(", "));
        if (nonEmptyFields.length > 4) {
            const field5 = nonEmptyFields[4];
            logDebug(`Field 5 (barcode field): "${field5}"`);
            if (field5.startsWith('B') || field5.startsWith('1B')) {
                logDebug(`Found special 1D barcode in Maxicode field 5: ${field5}`);
                return field5;
            }
            logDebug(`Field 5 does not start with B or 1B, it starts with: ${field5.substring(0, Math.min(5, field5.length))}`);
        } else {
            logDebug(`Maxicode has only ${nonEmptyFields.length} fields, cannot access field 5`);
        }
        logDebug("No special 1D barcode found in Maxicode field 5");
        return null;
    } catch (error) {
        logDebug("Error parsing Maxicode for special 1D barcode: " + error.message);
        return null;
    }
}
function validateRuntimeInput(context) {
    const inputCode = context.input.code;
    const inputCenter = context.input.center;
    if (typeof inputCode === 'undefined' || inputCode === null || typeof inputCode !== 'string' ||
        typeof inputCenter === 'undefined' || inputCenter === null || typeof inputCenter !== 'string') {
        logDebug("Warning: code or center is invalid (undefined/null/not string), treating as no barcodes");
        logDebug(`code type: ${typeof inputCode}, value: ${inputCode}, center type: ${typeof inputCenter}, value: ${inputCenter}`);
        if (!enableNoBarcodeOutput) {
            sendOutput(formatOutput("PostScan", "????", "????", "????", "1", context.metadata));
            logDebug("Invalid code/center detected, output ???? format (same as no barcodes)");
        } else {
            logDebug("Invalid code/center detected, no barcode output switch enabled, no output");
        }
        return false;
    }
    return true;
}
function applyRoiFiltering(context) {
    const roiFiltered = filterCodesByRoi(
        context.input.code,
        context.input.center,
        context.input.ROI_number !== undefined ? context.input.ROI_number : ""
    );
    context.filteredCodeStr = roiFiltered.codeStr;
    context.filteredCenterStr = roiFiltered.centerStr;
}
function splitFilteredCodes(context) {
    context.codes = (context.filteredCodeStr === "" ? [] : context.filteredCodeStr.split(sep))
        .map(c => c.trim())
        .filter(c => c !== "");
    context.centerArr = context.filteredCenterStr === "" ? [] : context.filteredCenterStr.split(sep);
    logDebug("Input barcode count: " + context.codes.length);
}
function flattenHistory(arr) {
    return arr.reduce(function(flat, item) {
        return flat.concat(Array.isArray(item) ? flattenHistory(item) : item);
    }, []);
}
function loadPreviousOutput(context) {
    let previousOutput = [];
    try {
        const historyData = GlobalString.load("lastTaskCodes");
        if (historyData) {
            const parsedData = JSON.parse(historyData);
            previousOutput = Array.isArray(parsedData) ? flattenHistory(parsedData) : [];
        }
    } catch (error) {
        logDebug("Error reading history records: " + error.message);
        previousOutput = [];
    }
    context.previousOutput = previousOutput;
    if (context.historyCleared) {
        logDebug("History records have been cleared by timeout, restart processing");
    }
    logDebug("History barcode count: " + context.previousOutput.length);
    logDebug("History barcodes: " + context.previousOutput.join(","));
}
function classifyCodes(context) {
    const codes = context.codes;
    const qrCodes = codes.filter(code => code.startsWith('[)'));
    const oneZCodes = codes.filter(code => code.startsWith('1Z'));
    const postalCodes = codes.filter(code => code.length === 8);
    const specialOneDCodes = codes.filter(code => isSpecialOneDCode(code));
    context.classified = {
        qrCodes: qrCodes,
        oneZCodes: oneZCodes,
        postalCodes: postalCodes,
        specialOneDCodes: specialOneDCodes
    };
    logDebug("Maxicode count: " + qrCodes.length);
    logDebug("1Z barcode count: " + oneZCodes.length);
    logDebug("Postal code count: " + postalCodes.length);
    logDebug("Special 1D barcode count: " + specialOneDCodes.length);
    logDebug("Special 1D barcode list: " + specialOneDCodes.join(","));
    codes.forEach(code => {
        logDebug(`Barcode "${code}" is special 1D barcode: ${isSpecialOneDCode(code)}`);
    });
}
function calculateDisposalMarkForContext(context) {
    const previousOutput = context.previousOutput;
    const classified = context.classified;
    const newOneZCodes = classified.oneZCodes.filter(code => !previousOutput.includes(code));
    const newSpecialOneDCodes = classified.specialOneDCodes.filter(code => !previousOutput.includes(code));
    const newQrCodes = classified.qrCodes.filter(code => !previousOutput.includes(code));
    logDebug("History-filtered Maxicode count: " + newQrCodes.length);
    logDebug("History-filtered 1Z count: " + newOneZCodes.length);
    logDebug("History-filtered special 1D count: " + newSpecialOneDCodes.length);
    context.disposalMark = getDisposalMark(newOneZCodes, newSpecialOneDCodes, newQrCodes, classified.postalCodes);
    logDebug("Disposal mark: " + context.disposalMark);
}
function buildCodePositions(context) {
    const codePositions = {};
    context.codes.forEach((code, index) => {
        if (index < context.centerArr.length) {
            const coordStr = context.centerArr[index].replace(/[{}]/g, '');
            const [x, y] = coordStr.split(',').map(Number);
            if (!isNaN(x) && !isNaN(y)) {
                codePositions[code] = { x, y };
            }
        }
    });
    context.codePositions = codePositions;
}
function getDecisionData(context) {
    return {
        metadata: context.metadata,
        previousOutput: context.previousOutput,
        codePositions: context.codePositions,
        disposalMark: context.disposalMark,
        qrCodes: context.classified.qrCodes,
        oneZCodes: context.classified.oneZCodes,
        postalCodes: context.classified.postalCodes,
        specialOneDCodes: context.classified.specialOneDCodes
    };
}
function firstOrPlaceholder(codes) {
    return codes.length > 0 ? codes[0] : CODE_PLACEHOLDER;
}
function emitPostScan(metadata, oneZCode, maxicodeData, postalCode, disposalMark) {
    sendOutput(formatOutput("PostScan", oneZCode, maxicodeData, postalCode, disposalMark, metadata));
}
function emitPlaceholderPostScan(metadata, disposalMark, logMessage) {
    if (!enableNoBarcodeOutput) {
        emitPostScan(metadata, CODE_PLACEHOLDER, CODE_PLACEHOLDER, CODE_PLACEHOLDER, disposalMark);
        logDebug(logMessage);
    } else {
        logDebug(logMessage + ", no barcode output switch enabled, no output");
    }
}
function storeHistoryAndLog(codes) {
    storeHistory(codes);
    logDebug("Updated stored barcodes: " + codes.join(","));
}
function findClosestCode(codes, codePositions, skipFn) {
    let closestCode = null;
    let minDistance = Infinity;
    for (const item of codes) {
        if (skipFn && skipFn(item)) {
            continue;
        }
        const position = codePositions[item];
        if (!position) {
            continue;
        }
        const distance = calculateDistance(position.x, position.y);
        if (distance < minDistance) {
            minDistance = distance;
            closestCode = item;
        }
    }
    return closestCode;
}
function findClosestPostal(data, skipHistory) {
    return findClosestCode(data.postalCodes, data.codePositions, function(postal) {
        if (skipHistory && data.previousOutput.includes(postal)) {
            logDebug(`Postal code ${postal} already in history records, skipping`);
            return true;
        }
        return false;
    });
}
function findClosestMaxicode(data, skipHistory) {
    return findClosestCode(data.qrCodes, data.codePositions, function(qr) {
        if (skipHistory && data.previousOutput.includes(qr)) {
            logDebug(`Maxicode ${qr} already in history records, skipping`);
            return true;
        }
        return false;
    });
}
function hasMaxicodeHistoryContainment(qr, previousOutput) {
    for (const prevCode of previousOutput) {
        if (prevCode.startsWith('[)') && (qr.includes(prevCode) || prevCode.includes(qr))) {
            logDebug(`Maxicode ${qr} has containment relationship with history barcode ${prevCode}, skipping`);
            return true;
        }
        if (prevCode.startsWith('B') && qr.includes(prevCode)) {
            logDebug(`Maxicode ${qr} contains history special 1D barcode ${prevCode}, skipping`);
            return true;
        }
    }
    return false;
}
function oneZBlockedByHistory(oneZ, previousOutput) {
    for (const prevCode of previousOutput) {
        if (prevCode.startsWith('1Z') && (oneZ.includes(prevCode) || prevCode.includes(oneZ))) {
            logDebug(`1Z barcode ${oneZ} has containment relationship with history barcode ${prevCode}, skipping`);
            return true;
        }
        if (prevCode.startsWith('[)') && prevCode.includes(oneZ)) {
            logDebug(`1Z barcode ${oneZ} contained in history Maxicode ${prevCode}, skipping`);
            return true;
        }
        if (prevCode.startsWith('[)')) {
            const maxicodeOneZ = prevCode.match(/1Z\d+/);
            if (maxicodeOneZ && oneZ.includes(maxicodeOneZ[0])) {
                logDebug(`1Z barcode ${oneZ} contains 1Z code ${maxicodeOneZ[0]} from history Maxicode, skipping`);
                return true;
            }
        }
    }
    return false;
}
function maxicodeBlockedByHistoryOneZ(qr, previousOutput) {
    for (const prevCode of previousOutput) {
        if (prevCode.startsWith('[)') && (qr.includes(prevCode) || prevCode.includes(qr))) {
            logDebug(`Maxicode ${qr} has containment relationship with history barcode ${prevCode}, skipping`);
            return true;
        }
        if (prevCode.startsWith('1Z')) {
            const maxicodeOneZ = qr.match(/1Z\d+/);
            if (maxicodeOneZ && (prevCode.includes(maxicodeOneZ[0]) || maxicodeOneZ[0].includes(prevCode))) {
                logDebug(`1Z code ${maxicodeOneZ[0]} in Maxicode ${qr} has containment relationship with history 1Z barcode ${prevCode}, skipping`);
                return true;
            }
        }
    }
    return false;
}
function maxicodeContainsHistoryOneZ(qr, previousOutput) {
    for (const prevCode of previousOutput) {
        logDebug(`Check relationship between Maxicode ${qr} and history barcode ${prevCode}`);
        if (prevCode.startsWith('1Z')) {
            logDebug(`History barcode is 1Z code, check if Maxicode contains this 1Z code`);
            const maxicodeOneZ = qr.match(/1Z\d+/);
            if (maxicodeOneZ) {
                logDebug(`Extracted 1Z code from Maxicode: ${maxicodeOneZ[0]}`);
                const prevCodeDigits = prevCode.replace('1Z', '');
                const maxicodeOneZDigits = maxicodeOneZ[0].replace('1Z', '');
                logDebug(`Compare numeric parts: ${prevCodeDigits} and ${maxicodeOneZDigits}`);
                if (prevCodeDigits.includes(maxicodeOneZDigits) || maxicodeOneZDigits.includes(prevCodeDigits)) {
                    logDebug(`1Z code ${maxicodeOneZ[0]} in Maxicode has containment relationship with history 1Z code ${prevCode}, skipping`);
                    return true;
                }
                logDebug(`1Z code ${maxicodeOneZ[0]} in Maxicode has no containment relationship with history 1Z code ${prevCode}`);
            } else {
                logDebug(`No 1Z code extracted from Maxicode`);
            }
        }
    }
    return false;
}
function oneZContainedInHistoryMaxicode(oneZ, previousOutput) {
    for (const prevCode of previousOutput) {
        logDebug(`Check relationship between 1Z code ${oneZ} and history barcode ${prevCode}`);
        if (prevCode.startsWith('[)')) {
            logDebug(`History barcode is Maxicode, check if it contains 1Z code`);
            const maxicodeOneZ = prevCode.match(/1Z\d+/);
            if (maxicodeOneZ) {
                logDebug(`Extracted 1Z code from Maxicode: ${maxicodeOneZ[0]}`);
                const oneZDigits = oneZ.replace('1Z', '');
                const maxicodeOneZDigits = maxicodeOneZ[0].replace('1Z', '');
                logDebug(`Compare numeric parts: ${oneZDigits} and ${maxicodeOneZDigits}`);
                if (oneZDigits.includes(maxicodeOneZDigits) || maxicodeOneZDigits.includes(oneZDigits)) {
                    logDebug(`1Z code ${oneZ} has containment relationship with 1Z code ${maxicodeOneZ[0]} in Maxicode, skipping`);
                    return true;
                }
                logDebug(`1Z code ${oneZ} has no containment relationship with 1Z code ${maxicodeOneZ[0]} in Maxicode`);
            } else {
                logDebug(`No 1Z code extracted from Maxicode`);
            }
        }
    }
    return false;
}
function handleSpecialOneDOutput(data) {
    if (data.specialOneDCodes.length === 0) {
        return false;
    }
    logDebug("Start processing special 1D barcodes, count: " + data.specialOneDCodes.length);
    const closestSpecialOneD = findClosestCode(data.specialOneDCodes, data.codePositions, function(specialCode) {
        if (data.previousOutput.includes(specialCode)) {
            logDebug(`Special 1D barcode ${specialCode} already in history records, skipping`);
            return true;
        }
        return false;
    });
    if (!closestSpecialOneD) {
        return false;
    }
    logDebug("Found closest special 1D barcode: " + closestSpecialOneD);
    const closestPostal = findClosestPostal(data, true);
    const closestQR = findClosestMaxicode(data, true);
    const postalOutput = closestPostal || CODE_PLACEHOLDER;
    const qrOutput = closestQR || CODE_PLACEHOLDER;
    emitPostScan(data.metadata, closestSpecialOneD, qrOutput, postalOutput, DISPOSAL_SPECIAL_1D);
    logDebug(`Output special 1D barcode combination: special 1D barcode=${closestSpecialOneD}, postal=${postalOutput}, Maxicode=${qrOutput}, disposal mark=3`);
    const storedCodes = [closestSpecialOneD];
    if (closestQR) {
        storedCodes.push(closestQR);
    }
    storeHistoryAndLog(storedCodes);
    return true;
}
function handleSingleSpecialOneD(data) {
    return handleSingleIncompleteMainCode(data, {
        typeLabel: "Special 1D barcode",
        value: data.specialOneDCodes[0],
        outputOneZ: function(v) { return v; },
        outputQr: function() { return CODE_PLACEHOLDER; },
        disposalMarkWhenOutput: function() { return DISPOSAL_SPECIAL_1D; },
        successLog: function(v) {
            return "Only found special 1D barcode, other fields use ???? to represent: " + v + ", disposal mark=3";
        }
    });
}
function handleSingleOneZ(data) {
    return handleSingleIncompleteMainCode(data, {
        typeLabel: "1Z barcode",
        value: data.oneZCodes[0],
        outputOneZ: function(v) { return v; },
        outputQr: function() { return CODE_PLACEHOLDER; },
        disposalMarkWhenOutput: function() { return data.disposalMark; },
        successLog: function(v) {
            return "Only found 1Z barcode, Maxicode uses ???? to represent: " + v;
        }
    });
}
function handleSingleMaxicode(data) {
    return handleSingleIncompleteMainCode(data, {
        typeLabel: "Maxicode",
        value: data.qrCodes[0],
        outputOneZ: function() { return CODE_PLACEHOLDER; },
        outputQr: function(v) { return v; },
        disposalMarkWhenOutput: function(v) {
            const extractedSpecialOneD = extractSpecialOneDFromMaxicode(v);
            if (!extractedSpecialOneD) {
                return data.disposalMark;
            }
            if (data.previousOutput.includes(extractedSpecialOneD)) {
                logDebug(`Extracted special 1D barcode ${extractedSpecialOneD} from Maxicode is already in history records, skipping`);
                return null;
            }
            logDebug(`Maxicode contains special 1D barcode ${extractedSpecialOneD} in field 5, changing disposal mark from ${data.disposalMark} to 3`);
            return DISPOSAL_SPECIAL_1D;
        },
        skipReason: function(v) {
            if (hasMaxicodeHistoryContainment(v, data.previousOutput)) {
                return "contained";
            }
            return null;
        },
        successLog: function(v, finalDisposalMark) {
            return "Only found Maxicode, 1Z uses ???? to represent: " + v + ", disposal mark: " + finalDisposalMark;
        }
    });
}
function handleSingleIncompleteMainCode(data, options) {
    const value = options.value;
    if (data.previousOutput.includes(value)) {
        logDebug(`${options.typeLabel} ${value} already in history records, skipping`);
        emitPostScan(data.metadata, CODE_PLACEHOLDER, CODE_PLACEHOLDER, CODE_PLACEHOLDER, data.disposalMark);
        logDebug(`${options.typeLabel} in history records, output ????`);
        return true;
    }
    if (typeof options.skipReason === "function") {
        const reason = options.skipReason(value);
        if (reason) {
            emitPostScan(data.metadata, CODE_PLACEHOLDER, CODE_PLACEHOLDER, CODE_PLACEHOLDER, data.disposalMark);
            logDebug(`${options.typeLabel} in history records, output ????`);
            return true;
        }
    }
    const finalDisposalMark = options.disposalMarkWhenOutput(value);
    if (finalDisposalMark === null) {
        emitPostScan(data.metadata, CODE_PLACEHOLDER, CODE_PLACEHOLDER, CODE_PLACEHOLDER, data.disposalMark);
        logDebug("Extracted special 1D barcode in history records, output ????");
        return true;
    }
    const firstPostal = firstOrPlaceholder(data.postalCodes);
    emitPostScan(
        data.metadata,
        options.outputOneZ(value),
        options.outputQr(value),
        firstPostal,
        finalDisposalMark
    );
    logDebug(options.successLog(value, finalDisposalMark));
    storeHistoryAndLog([value]);
    return true;
}
function handleIncompleteOutput(data) {
    logDebug("Disposal mark is 1, start processing incomplete barcode scenarios");
    if (data.oneZCodes.length === 0 && data.qrCodes.length === 0 && data.specialOneDCodes.length === 1) {
        return handleSingleSpecialOneD(data);
    }
    if (data.oneZCodes.length === 1 && data.qrCodes.length === 0) {
        return handleSingleOneZ(data);
    }
    if (data.oneZCodes.length === 0 && data.qrCodes.length === 1) {
        return handleSingleMaxicode(data);
    }
    if (data.oneZCodes.length === 0 && data.qrCodes.length === 0 && data.postalCodes.length > 0) {
        emitPlaceholderPostScan(data.metadata, data.disposalMark, "Only found postal codes, all fields use ???? to represent");
        return true;
    }
    emitPlaceholderPostScan(data.metadata, data.disposalMark, "No barcodes read, all fields use ???? to represent");
    return true;
}
function findContainedPairInCurrentTask(data) {
    for (const oneZ of data.oneZCodes) {
        if (data.previousOutput.includes(oneZ)) {
            logDebug(`1Z barcode ${oneZ} already in history records, skipping`);
            continue;
        }
        if (oneZBlockedByHistory(oneZ, data.previousOutput)) {
            continue;
        }
        for (const qr of data.qrCodes) {
            if (data.previousOutput.includes(qr)) {
                logDebug(`Maxicode ${qr} already in history records, skipping`);
                continue;
            }
            if (maxicodeBlockedByHistoryOneZ(qr, data.previousOutput)) {
                continue;
            }
            if (qr.length >= 37) {
                const key = qr.substring(29, 37);
                if (oneZ.includes(key)) {
                    logDebug(`Found containment relationship between 1Z and Maxicode in current task: ${oneZ} with ${qr}`);
                    return { oneZ: oneZ, qr: qr };
                }
            }
        }
    }
    return null;
}
function logHistoryContainmentEvidence(data) {
    for (const oneZ of data.oneZCodes) {
        if (data.previousOutput.includes(oneZ)) {
            logDebug(`1Z barcode ${oneZ} already in history records, skipping`);
            continue;
        }
        for (const prevCode of data.previousOutput) {
            if (prevCode.startsWith('1Z') && (oneZ.includes(prevCode) || prevCode.includes(oneZ))) {
                logDebug(`Found 1Z barcode containment relationship: ${oneZ} with ${prevCode}`);
                break;
            }
            if (prevCode.startsWith('[)') && prevCode.includes(oneZ)) {
                logDebug(`Found 1Z barcode contained in history Maxicode: ${oneZ} contained in ${prevCode}`);
                break;
            }
            if (prevCode.startsWith('[)')) {
                const maxicodeOneZ = prevCode.match(/1Z\d+/);
                if (maxicodeOneZ && oneZ.includes(maxicodeOneZ[0])) {
                    logDebug(`Found 1Z barcode contains 1Z code ${maxicodeOneZ[0]} from history Maxicode: ${oneZ} contains ${maxicodeOneZ[0]}`);
                    break;
                }
            }
        }
    }
    for (const qr of data.qrCodes) {
        if (data.previousOutput.includes(qr)) {
            logDebug(`Maxicode ${qr} already in history records, skipping`);
            continue;
        }
        for (const prevCode of data.previousOutput) {
            if (prevCode.startsWith('[)') && (qr.includes(prevCode) || prevCode.includes(qr))) {
                logDebug(`Found Maxicode containment relationship: ${qr} with ${prevCode}`);
                break;
            }
            if (prevCode.startsWith('1Z')) {
                const maxicodeOneZ = qr.match(/1Z\d+/);
                if (maxicodeOneZ && (prevCode.includes(maxicodeOneZ[0]) || maxicodeOneZ[0].includes(prevCode))) {
                    logDebug(`Found Maxicode contains 1Z code from history barcodes: ${qr} contains ${maxicodeOneZ[0]}`);
                    break;
                }
            }
        }
    }
}
function handleContainedPairOutput(data) {
    logDebug("Start checking containment relationships between barcodes");
    const pair = findContainedPairInCurrentTask(data);
    if (!pair) {
        logHistoryContainmentEvidence(data);
        return false;
    }
    logDebug("Found containment relationship, 1Z: " + pair.oneZ + ", Maxicode: " + pair.qr);
    const closestPostal = findClosestPostal(data, false);
    emitPostScan(data.metadata, pair.oneZ, pair.qr, closestPostal || CODE_PLACEHOLDER, DISPOSAL_NORMAL);
    logDebug(`Output barcode combination with containment relationship: 1Z=${pair.oneZ}, postal=${closestPostal || CODE_PLACEHOLDER}, Maxicode=${pair.qr}`);
    storeHistoryAndLog([pair.oneZ, pair.qr]);
    return true;
}
function findClosestUnoutputMainCode(data) {
    let closestCode = null;
    let closestType = null;
    let minDistance = Infinity;
    for (const oneZ of data.oneZCodes) {
        if (data.previousOutput.includes(oneZ)) {
            continue;
        }
        if (oneZContainedInHistoryMaxicode(oneZ, data.previousOutput)) {
            continue;
        }
        const oneZPos = data.codePositions[oneZ];
        if (oneZPos) {
            const distance = calculateDistance(oneZPos.x, oneZPos.y);
            if (distance < minDistance) {
                minDistance = distance;
                closestCode = oneZ;
                closestType = CODE_TYPE_1Z;
            }
        }
    }
    for (const qr of data.qrCodes) {
        if (data.previousOutput.includes(qr)) {
            continue;
        }
        if (maxicodeContainsHistoryOneZ(qr, data.previousOutput)) {
            continue;
        }
        const qrPos = data.codePositions[qr];
        if (qrPos) {
            const distance = calculateDistance(qrPos.x, qrPos.y);
            if (distance < minDistance) {
                minDistance = distance;
                closestCode = qr;
                closestType = CODE_TYPE_MAXICODE;
            }
        }
    }
    return closestCode ? { code: closestCode, type: closestType } : null;
}
function handleClosestMainCodeOutput(data) {
    logDebug("Start finding closest unoutput barcode to origin");
    const result = findClosestUnoutputMainCode(data);
    if (!result) {
        return false;
    }
    logDebug("Found closest barcode, type: " + result.type + ", content: " + result.code);
    if (result.type === CODE_TYPE_1Z) {
        emitPostScan(data.metadata, result.code, CODE_PLACEHOLDER, CODE_PLACEHOLDER, DISPOSAL_NORMAL);
        logDebug("Output 1Z barcode: " + result.code);
    } else if (result.type === CODE_TYPE_MAXICODE) {
        emitPostScan(data.metadata, CODE_PLACEHOLDER, result.code, CODE_PLACEHOLDER, DISPOSAL_NORMAL);
        logDebug("Output Maxicode: " + result.code);
    }
    storeHistory([result.code]);
    return true;
}
function areAllMainCodesInHistory(data) {
    const mainCodeGroups = [data.oneZCodes, data.qrCodes, data.specialOneDCodes];
    for (const group of mainCodeGroups) {
        for (const item of group) {
            if (!data.previousOutput.includes(item)) {
                return false;
            }
        }
    }
    return true;
}
function handlePostalFallbackOutput(data) {
    logDebug("No new main barcodes found, start checking postal codes");
    const closestPostal = findClosestPostal(data, false);
    if (!closestPostal) {
        return false;
    }
    if (areAllMainCodesInHistory(data)) {
        emitPlaceholderPostScan(data.metadata, DISPOSAL_NORMAL, "All main barcodes in history records, equivalent to only postal codes detected, output ????");
        return true;
    }
    emitPostScan(data.metadata, CODE_PLACEHOLDER, CODE_PLACEHOLDER, closestPostal, DISPOSAL_NORMAL);
    logDebug("Output postal code: " + closestPostal);
    return true;
}
function decideAndEmitOutput(context) {
    const data = getDecisionData(context);
    if (handleSpecialOneDOutput(data)) {
        return;
    }
    logDebug("Start processing based on disposal mark, current disposal mark: " + data.disposalMark);
    if (data.disposalMark === DISPOSAL_INCOMPLETE) {
        handleIncompleteOutput(data);
        return;
    }
    if (data.disposalMark === DISPOSAL_MULTI_PACKAGE) {
        logDebug("Disposal mark is 2, multiple barcodes of the same type detected");
        emitPostScan(data.metadata, CONFLICT_PLACEHOLDER, CONFLICT_PLACEHOLDER, CONFLICT_PLACEHOLDER, data.disposalMark);
        logDebug("Multiple barcodes of the same type detected, all fields use !!!! to represent");
        return;
    }
    if (handleContainedPairOutput(data)) {
        return;
    }
    if (handleClosestMainCodeOutput(data)) {
        return;
    }
    if (handlePostalFallbackOutput(data)) {
        return;
    }
    emitPlaceholderPostScan(data.metadata, DISPOSAL_NORMAL, "No new barcodes found, output ????");
    return;
}
function checkBoxAndLineIntersection() {
    let boxCoorJsonStr = VNLib.GetBoxCoordinates();
    let boxLineCoorJsonStr = VNLib.GetBoxLineCoordinates();
    if (!boxCoorJsonStr || !boxLineCoorJsonStr) {
        logDebug(`Raw data exception: boxCoorJsonStr:${boxCoorJsonStr}, boxLineCoorJsonStr:${boxLineCoorJsonStr}`);
        return undefined;
    }
    let boxData, boxLineData;
    try {
        boxData = JSON.parse(boxCoorJsonStr);
        boxLineData = JSON.parse(boxLineCoorJsonStr);
    } catch (e) {
        logDebug(`JSON parse error: ${e.message}, boxCoorJsonStr:${boxCoorJsonStr}, boxLineCoorJsonStr:${boxLineCoorJsonStr}`);
        return undefined;
    }
    if (boxData === undefined || boxData === null || !Array.isArray(boxData) || boxData.length === 0 ||
        boxLineData === undefined || boxLineData === null || !Array.isArray(boxLineData) || boxLineData.length === 0) {
        logDebug(`Parsed data exception: boxData:${boxData}, boxLineData:${boxLineData}`);
        return undefined;
    }
    logDebug("package: " + JSON.stringify(boxData) + (typeof endStr !== 'undefined' ? endStr : ''));
    logDebug("test line: " + JSON.stringify(boxLineData) + (typeof endStr !== 'undefined' ? endStr : ''));
    const getRectEdges = (rect) => {
        const xs = rect.map(pt => pt.x);
        const ys = rect.map(pt => pt.y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        const topLeft = { x: minX, y: minY };
        const topRight = { x: maxX, y: minY };
        const bottomRight = { x: maxX, y: maxY };
        const bottomLeft = { x: minX, y: maxY };
        return [
            { p1: topLeft, p2: topRight },
            { p1: topRight, p2: bottomRight },
            { p1: bottomRight, p2: bottomLeft },
            { p1: bottomLeft, p2: topLeft }
        ];
    };
    const isSegmentsIntersect = (p1, p2, q1, q2) => {
        const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
        const ccw1 = cross(p1, p2, q1);
        const ccw2 = cross(p1, p2, q2);
        const ccw3 = cross(q1, q2, p1);
        const ccw4 = cross(q1, q2, p2);
        if ((ccw1 * ccw2 < 0) && (ccw3 * ccw4 < 0)) return true;
        const isPointOnSegment = (p, a, b) => {
            const inBound = (Math.min(a.x, b.x) - 1e-6 <= p.x && p.x <= Math.max(a.x, b.x) + 1e-6) &&
                (Math.min(a.y, b.y) - 1e-6 <= p.y && p.y <= Math.max(a.y, b.y) + 1e-6);
            return inBound && Math.abs(cross(a, b, p)) < 1e-6;
        };
        if (ccw1 === 0 && isPointOnSegment(q1, p1, p2)) return true;
        if (ccw2 === 0 && isPointOnSegment(q2, p1, p2)) return true;
        if (ccw3 === 0 && isPointOnSegment(p1, q1, q2)) return true;
        if (ccw4 === 0 && isPointOnSegment(p2, q1, q2)) return true;
        return false;
    };
    const isPointInRect = (point, rect) => {
        const xs = rect.map(pt => pt.x);
        const ys = rect.map(pt => pt.y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        if (point.x < minX - 1e-6 || point.x > maxX + 1e-6 ||
            point.y < minY - 1e-6 || point.y > maxY + 1e-6) {
            return false;
        }
        let inside = false;
        const n = rect.length;
        for (let i = 0, j = n - 1; i < n; j = i++) {
            const xi = rect[i].x, yi = rect[i].y;
            const xj = rect[j].x, yj = rect[j].y;
            const yiGreater = yi > point.y + 1e-6;
            const yjGreater = yj > point.y + 1e-6;
            if (yiGreater === yjGreater) continue;
            const denominator = yj - yi;
            if (Math.abs(denominator) < 1e-6) continue;
            const intersectX = (xj - xi) * (point.y - yi) / denominator + xi;
            if (point.x < intersectX - 1e-6) inside = !inside;
        }
        return inside;
    };
    let rectCount = 0;
    const validRects = [];
    boxData.forEach((rect) => {
        if (Array.isArray(rect) && rect.length === 4 && rect.every(pt => pt.hasOwnProperty('x') && pt.hasOwnProperty('y'))) {
            rectCount++;
            validRects.push(rect);
        }
    });
    let lineCount = 0;
    const validLines = [];
    boxLineData.forEach((line) => {
        if (Array.isArray(line) && line.length === 2 &&
            line.every(pt => pt.hasOwnProperty('x') && pt.hasOwnProperty('y')) &&
            !(Math.abs(line[0].x - line[1].x) < 1e-6 && Math.abs(line[0].y - line[1].y) < 1e-6)) {
            lineCount++;
            validLines.push(line);
        }
    });
    logDebug(`Parsed ${rectCount} rectangles and ${lineCount} line segments in total`);
    const rectsWithEdges = validRects.map(function(rect) {
        return {
            rect: rect,
            edges: getRectEdges(rect)
        };
    });
    let intersectLineCount = 0;
    validLines.forEach(line => {
        const lineP1 = line[0];
        const lineP2 = line[1];
        let isIntersect = false;
        for (let i = 0; i < rectsWithEdges.length; i++) {
            if (isIntersect) break;
            const rect = rectsWithEdges[i].rect;
            const rectEdges = rectsWithEdges[i].edges;
            for (let edge of rectEdges) {
                if (isSegmentsIntersect(lineP1, lineP2, edge.p1, edge.p2)) {
                    isIntersect = true;
                    break;
                }
            }
            if (!isIntersect) {
                if (isPointInRect(lineP1, rect) || isPointInRect(lineP2, rect)) {
                    isIntersect = true;
                }
            }
        }
        if (isIntersect) {
            intersectLineCount++;
        }
    });
    if (intersectLineCount === 0) {
        logDebug("The package did not touch the detection lines");
        return false;
    } else {
        logDebug(`The package has touched ${intersectLineCount} detection lines`);
        return true;
    }
}
function GetDeviceStatus() {
    let d = VNLib.GetOnlineSlaveCount();
    if (d === undefined || d === null || d === '') d = undefined;
    else if (typeof d !== 'number' || !isFinite(d)) {
        var n = Number(d);
        d = (!isNaN(n) && isFinite(n)) ? n : undefined;
    }
    return d + 1;
}
function judgeRoiMode() {
    let sideRoiModeStr = VNLib.GetSlaveRoiIndex();
    let sideRoiMode;
    try {
        sideRoiMode = JSON.parse(sideRoiModeStr);
    } catch (e) {
        return undefined;
    }
    if (!sideRoiMode || Object.prototype.toString.call(sideRoiMode) !== "[object Object]" ||
        Object.keys(sideRoiMode).length === 0) {
        return undefined;
    }
    return Object.values(sideRoiMode).some(v => v === 1) ? 'Tall' : 'Short';
}
function buildRectangleEdgesWithMetrics(vertices) {
    var rawEdges = [
        { name: "E0(V0->V1)", p1: vertices[0], p2: vertices[1] },
        { name: "E1(V1->V2)", p1: vertices[1], p2: vertices[2] },
        { name: "E2(V2->V3)", p1: vertices[2], p2: vertices[3] },
        { name: "E3(V3->V0)", p1: vertices[3], p2: vertices[0] }
    ];
    return rawEdges.map(function(edge) {
        var dx = edge.p2.x - edge.p1.x;
        var dy = edge.p2.y - edge.p1.y;
        return {
            name: edge.name,
            p1: edge.p1,
            p2: edge.p2,
            dx: dx,
            dy: dy,
            midX: (edge.p1.x + edge.p2.x) / 2,
            midY: (edge.p1.y + edge.p2.y) / 2,
            length: Math.sqrt(dx * dx + dy * dy)
        };
    });
}
function getTargetParcelWithEdges() {
    var boxData = JSON.parse(VNLib.GetBoxCoordinates());
    var direction = VNLib.GetBoxDirection();
    if (!Array.isArray(boxData) || boxData.length === 0) {
        return undefined;
    }
    var sortedBoxes = boxData.slice().sort(function(a, b) {
        return getBoxSortKey(a, direction) - getBoxSortKey(b, direction);
    });
    var targetBox = sortedBoxes[0];
    return {
        boxData: boxData,
        direction: direction,
        targetBox: targetBox,
        targetBoxCenter: getBoxCenter(targetBox),
        edges: buildRectangleEdgesWithMetrics(targetBox)
    };
}
function getParcelAngle() {
    try {
        var parcelData = getTargetParcelWithEdges();
        logDebug("===== Parcel Skew Angle Calculation Started (Origin: Top-Left) =====" + endStr);
        logDebug("Current Conveyor Movement Direction: " + (parcelData ? parcelData.direction : undefined) + " (0:Left→Right, 1:Right→Left, 2:Top→Bottom, 3:Bottom→Top)" + endStr);
        logDebug("Detected parcel quantity in view: " + (parcelData ? parcelData.boxData.length : 0) + endStr);
        logDebug("Coordinate Rule: X→Right(+), Y→Down(+) (Industrial Vision Standard)" + endStr);
        if (!parcelData) {
            logDebug("Error: No valid parcel coordinate data detected" + endStr);
            return undefined;
        }
        var direction = parcelData.direction;
        var targetBox = parcelData.targetBox;
        var targetBoxCenter = parcelData.targetBoxCenter;
        logDebug("Selected calculation target: Last parcel in movement path, center point X=" + targetBoxCenter.x.toFixed(2) + ", Y=" + targetBoxCenter.y.toFixed(2) + endStr);
        logDebug("4 vertex coordinates of target parcel: " + endStr);
        for (var j = 0; j < targetBox.length; j++) {
            logDebug("Vertex " + j + ": X=" + targetBox[j].x + ", Y=" + targetBox[j].y + endStr);
        }
        function pickTargetEdge(edges, dir) {
            let candidates = [];
            if (dir === 2 || dir === 3) {
                const minAbsDy = Math.min.apply(null, edges.map(function(e) { return Math.abs(e.dy); }));
                candidates = edges.filter(function(e) { return Math.abs(Math.abs(e.dy) - minAbsDy) < 1e-6; });
                if (dir === 2) candidates.sort(function(a, b) { return b.midY - a.midY; });
                else candidates.sort(function(a, b) { return a.midY - b.midY; });
            } else {
                const minAbsDx = Math.min.apply(null, edges.map(function(e) { return Math.abs(e.dx); }));
                candidates = edges.filter(function(e) { return Math.abs(Math.abs(e.dx) - minAbsDx) < 1e-6; });
                if (dir === 0) candidates.sort(function(a, b) { return b.midX - a.midX; });
                else candidates.sort(function(a, b) { return a.midX - b.midX; });
            }
            const picked = (candidates.length > 0) ? candidates[0] : edges[0];
            logDebug("Edge selection candidates: " + candidates.map(function(c) { return c.name; }).join(", ") + endStr);
            logDebug("Picked target edge: " + picked.name +
                     ", p1=(" + picked.p1.x + "," + picked.p1.y + ")" +
                     ", p2=(" + picked.p2.x + "," + picked.p2.y + ")" +
                     ", dx=" + picked.dx.toFixed(2) + ", dy=" + picked.dy.toFixed(2) + endStr);
            return picked;
        }
        function calcSkewAngle(p1, p2, dir) {
            const dx1 = p2.x - p1.x;
            const dy1 = p2.y - p1.y;
            if (dx1 === 0 && dy1 === 0) return 0;
            let refDx = 0, refDy = 0;
            switch(dir) {
                case 0: case 1: refDx = 0; refDy = 1; break;
                case 2: case 3: refDx = 1; refDy = 0; break;
            }
            const mod1 = Math.sqrt(dx1*dx1 + dy1*dy1);
            const mod2 = Math.sqrt(refDx*refDx + refDy*refDy);
            const dotProduct = dx1 * refDx + dy1 * refDy;
            let cosTheta = Math.abs(dotProduct) / (mod1 * mod2);
            cosTheta = Math.max(Math.min(cosTheta, 1), -1);
            const radian = Math.acos(cosTheta);
            const angle = (radian * 180) / Math.PI;
            return Math.round(angle * 100) / 100;
        }
        const targetEdge = pickTargetEdge(parcelData.edges, direction);
        const parcelSkewAngle = calcSkewAngle(targetEdge.p1, targetEdge.p2, direction);
        const finalResult = parcelSkewAngle + "°";
        logDebug("\n===== Final Parcel Skew Angle Result (Valid & Precise) =====" + endStr);
        logDebug("Target Edge (real rectangle edge only): " + targetEdge.name + endStr);
        logDebug("Reference Edge: Perpendicular to Conveyor Movement Direction" + endStr);
        logDebug("Parcel Skew Angle = " + finalResult + endStr);
        return finalResult;
    } catch (error) {
        logDebug("[Fatal Error] Parcel skew angle calculation callback failed: " + error.message + endStr);
        logDebug("Error stack trace: " + (error.stack || "No stack information") + endStr);
        return undefined;
    }
}
function getParcelEdgeLength() {
    try {
        var parcelData = getTargetParcelWithEdges();
        logDebug("===== Parcel Edge Length Calculation Started =====" + endStr);
        if (!parcelData) {
            logDebug("Error: No valid parcel coordinate data detected" + endStr);
            return undefined;
        }
        var targetBox = parcelData.targetBox;
        var targetBoxCenter = parcelData.targetBoxCenter;
        logDebug("Selected calculation target: Last parcel in movement path, center point X=" + targetBoxCenter.x.toFixed(2) + ", Y=" + targetBoxCenter.y.toFixed(2) + endStr);
        logDebug("4 vertex coordinates of target parcel: " + endStr);
        for (var j = 0; j < targetBox.length; j++) {
            logDebug("Vertex " + j + ": X=" + targetBox[j].x + ", Y=" + targetBox[j].y + endStr);
        }
        var edges = parcelData.edges;
        var bestEdge = null;
        var bestScore = Infinity;
        logDebug("Using default logic: Finding most horizontal edge (min |dy|)" + endStr);
        for (var i = 0; i < edges.length; i++) {
            var p1 = edges[i].p1, p2 = edges[i].p2;
            var dx = edges[i].dx, dy = edges[i].dy;
            var score = Math.abs(dy);
            logDebug("Edge " + i + ": dx=" + dx.toFixed(2) + ", dy=" + dy.toFixed(2) + ", score=|dy|=" + score.toFixed(2) + endStr);
            if (score < bestScore) {
                bestScore = score;
                bestEdge = edges[i];
            }
        }
        if (!bestEdge) {
            logDebug("Error: Failed to find valid edge" + endStr);
            return undefined;
        }
        var a = bestEdge.p1, b = bestEdge.p2;
        var edgeLength = bestEdge.length;
        logDebug("===== Edge Selection Result =====" + endStr);
        logDebug("Selected edge: Point A (x=" + a.x.toFixed(2) + ", y=" + a.y.toFixed(2) + ") → Point B (x=" + b.x.toFixed(2) + ", y=" + b.y.toFixed(2) + ")" + endStr);
        logDebug("Edge length: " + edgeLength.toFixed(2) + " pixels" + endStr);
        logDebug("Logic used: Default (most horizontal)" + endStr);
        return edgeLength;
    } catch (error) {
        logDebug("[Fatal Error] Parcel edge length calculation failed: " + error.message + endStr);
        logDebug("Error stack trace: " + (error.stack || "No stack information") + endStr);
        return undefined;
    }
}
function processCodes() {
    lastTaskForwardedOutput = "";
    const context = createRuntimeContext();
    // 与 tc_before.js 一致：命令 → getParcelAngle → buildMetadata
    handleConfiguredCommand(context);
    context.boxAngle = getParcelAngle();
    buildMetadata(context);
    logRunnerStyleInputSnapshot(context);
    logInitialInputSnapshot(context);
    logDebug("=== Start processing barcodes ===");
    logDebug(`Input parameters - code: "${context.input.code}", center: "${context.input.center}", box_angle: "${context.boxAngle !== undefined ? context.boxAngle : 'undefined'}"`);
    if (context.input.ROI_number !== undefined) {
        logDebug(`Input parameter - ROI_number: "${context.input.ROI_number}"`);
    }
    if (!validateRuntimeInput(context)) {
        return;
    }
    logDebug("Device information check - devicenumber: " + JSON.stringify(context.deviceNumbers) + ", length: " + context.deviceNumbers.length);
    logDebug("Device information check - box_angle: " + (context.boxAngle !== undefined ? context.boxAngle : 'undefined'));
    logDebug("Bypass mode status: " + (bypassMode ? "Enabled" : "Disabled"));
    if (bypassMode) {
        logDebug("Bypass mode enabled, will use task ID 00-1 for output");
    }
    context.historyCleared = checkAndClearTimeoutHistory();
    applyRoiFiltering(context);
    splitFilteredCodes(context);
    loadPreviousOutput(context);
    classifyCodes(context);
    calculateDisposalMarkForContext(context);
    buildCodePositions(context);
    decideAndEmitOutput(context);
    VNLib.Log("LastTaskOutputToAssistant: " + (lastTaskForwardedOutput || "<empty>") + endStr);
}
try {
    processCodes();
} catch (error) {
    logDebug("Processing error: " + error.message);
}