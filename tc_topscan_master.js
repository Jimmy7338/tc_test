      
/******************************************************************************************
 * Device used: tc_in
 * Update date: 2026-04-27
 * Update content:
 * Modified the multi-package detection logic: if the number of special 1D barcodes plus 1Z codes is greater than 1, 
 * it is regarded as multiple packages. Before calculating multiple packages, deduplicate historical barcodes first and then perform the calculation.
 * Variables to be set:code,center,ROI_number，time,device_number
 * 
*******************************************************************************************/

// 调试开关：控制是否输出串口命令应答 / Debug switch: controls serial command response output
const enableSerialResponse = true; // true: enable serial port response, false: disable serial port response

const debugmode = 0; // 0: VNlib.Log, 1: sendOutput, 2: VNlib.Log + sendOutput

// 历史超时清理开关 / Timeout cleanup switch for stored history
const enableTimeoutClear = true; // true: enable timeout clear, false: disable timeout clear
const timeoutSeconds = 10; // Timeout time (seconds)

// 无码输出控制开关 / No-barcode output control switch
const enableNoBarcodeOutput = false; // true: no output when no barcodes, false: output ???? when no barcodes

const endStr = "\r\n";
// 多码分隔符 / Barcode separator
const sep = VNLib.getSeparator();

// 协议占位符和 DisposalMark 集中定义，后续改输出格式时不需要逐个业务分支搜索。
// Protocol placeholders and DisposalMark values are centralized here so future output-format changes do not require searching every business branch.
const CODE_PLACEHOLDER = "????";
const CONFLICT_PLACEHOLDER = "!!!!";
const DISPOSAL_NORMAL = "0";
const DISPOSAL_INCOMPLETE = "1";
const DISPOSAL_MULTI_PACKAGE = "2";
const DISPOSAL_SPECIAL_1D = "3";
const CODE_TYPE_1Z = "1Z";
const CODE_TYPE_MAXICODE = "Maxicode";
let lastTaskForwardedOutput = "";

// bypass 模式状态：通过全局变量跨任务保存 / Bypass mode state: persisted across tasks by global storage
let bypassMode = GlobalString.load("bypassMode") === "true"; // false: normal mode, true: bypass mode

// 串口/TCP 命令处理函数 / Serial/TCP command handler
function handleSerialMessage(message) {
    const trimmedMessage = message.trim().toLowerCase();
    
    if (trimmedMessage === "bypass on") {
        bypassMode = true;
        GlobalString.store("bypassMode", "true"); // Save to global variable
        logDebug("Bypass mode enabled");
        
        if (enableSerialResponse) {
            const response = "bypass mode set to on";
            VNLib.SendOutput(response + endStr + "\n");
            logDebug("Serial response: " + response);
        }
    } else if (trimmedMessage === "bypass off") {
        bypassMode = false;
        GlobalString.store("bypassMode", "false"); // Save to global variable
        logDebug("Bypass mode disabled");
        
        if (enableSerialResponse) {
            const response = "bypass mode set to off";
            VNLib.SendOutput(response + endStr + "\n");
            logDebug("Serial response: " + response );
        }
    } else if (trimmedMessage === "resetnum") {
        GlobalString.store("jobIdCounter", "0");
        logDebug("JobId counter has been reset");
        
        if (enableSerialResponse) {
            const response = "jobId counter has been reset";
            VNLib.SendOutput(response + endStr + "\n");
            logDebug("Serial response: " + response);
        }
    }
}

// Metadata 配置开关，可按现场需求裁剪 / Metadata switches, optional per site requirement
const useTimeInMetadata = true;        // Whether to include time in metadata
const useAngleInMetadata = true;       // Whether to include angle in metadata
const useDeviceInMetadata = false;      // Whether to include device information in metadata
const useBoxPassLineInMetadata = true;  // Whether to include box pass line information in metadata
const useCameraStatusInMetadata = true; // Whether to include device status in metadata
const useSideRoiModeInMetadata = true; // Whether to include side ROI mode in metadata
const useParcelEdgeLengthInMetadata = true; // Whether to include parcel edge length in metadata

function createRuntimeContext() {
    // RuntimeContext 是单次脚本执行的数据载体，集中保存输入、中间结果和决策状态。
    // RuntimeContext is the data carrier for one script execution: inputs, intermediate values, and decision state.
    // 这样可以减少 helper 之间的隐式依赖，也方便根据日志排查问题。
    // This reduces hidden dependencies between helpers and makes log-driven troubleshooting easier.
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
        boxAngle: getParcelAngle(),
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
    // Metadata 构建与输出决策隔离，后续改 metadata 字段时不影响条码分类和历史规则。
    // Metadata building is intentionally isolated from output decisions, so future metadata changes do not touch barcode classification or history rules.
    if (!(useTimeInMetadata || useAngleInMetadata || useDeviceInMetadata || useBoxPassLineInMetadata ||
          useCameraStatusInMetadata || useSideRoiModeInMetadata || useParcelEdgeLengthInMetadata)) {
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

// 时间转换函数：转换为 ISO8601 ZULU 格式 / Time conversion: convert to ISO8601 ZULU format
function convertToISO8601Zulu(timeValue) {
    if (!timeValue || timeValue === "undefined") {
        return new Date().toISOString();
    }
    
    try {
        let dateObj;
        
        // 兼容不同时间格式 / Handle different time formats
        if (timeValue.includes('/') && timeValue.includes(':')) {
            // 格式示例："2025/06/19 17:15:11:195" 或 "2025/06/19 17:15:11" / Format example: "2025/06/19 17:15:11:195" or "2025/06/19 17:15:11"
            const parts = timeValue.split(' ');
            if (parts.length >= 2) {
                const datePart = parts[0]; // "2025/06/19"
                const timePart = parts[1]; // "17:15:11:195"
                
                const dateParts = datePart.split('/');
                const timeParts = timePart.split(':');
                
                if (dateParts.length >= 3 && timeParts.length >= 3) {
                    const year = dateParts[0];
                    const month = dateParts[1].padStart(2, '0');
                    const day = dateParts[2].padStart(2, '0');
                    const hour = timeParts[0].padStart(2, '0');
                    const minute = timeParts[1].padStart(2, '0');
                    const second = timeParts[2].padStart(2, '0');
                    
                    // 处理毫秒字段（如果存在）/ Handle milliseconds part if present
                    let millisecond = "000";
                    if (timeParts.length >= 4) {
                        millisecond = timeParts[3].padStart(3, '0');
                    }
                    
                    // 生成 ISO8601 ZULU 格式：YYYY-MM-DDTHH:mm:ss.sssZ / Create ISO8601 ZULU format: YYYY-MM-DDTHH:mm:ss.sssZ
                    return `${year}-${month}-${day}T${hour}:${minute}:${second}.${millisecond}Z`;
                }
            }
        } else if (timeValue.includes('-')) {
            // 已是 ISO 格式时，只确保以 Z 结尾 / Already ISO-like, only ensure it ends with Z
            if (timeValue.endsWith('Z')) {
                return timeValue;
            } else {
                return timeValue + 'Z';
            }
        }
        
        // 解析失败则使用当前时间兜底 / If parsing fails, fall back to current time
        dateObj = new Date();
        return dateObj.toISOString();
        
    } catch (error) {
        logDebug("Time conversion error: " + error.message);
        // 返回当前 ISO8601 ZULU 时间作为兜底 / Return current time in ISO8601 ZULU format as fallback
        return new Date().toISOString();
    }
}

// 获取全局任务号 JobId / Get global JobId
function getNextJobId() {
    // 检查 bypass 模式 / Check bypass mode
    if (bypassMode) {
        logDebug("Bypass mode enabled, returning task ID: 00-1");
        return "00-1";
    }
    
    // Check if box_angle information is missing (device_number can be empty)
    // if (typeof box_angle === 'undefined' || 
    //     (typeof box_angle !== 'undefined' && String(box_angle).trim() === "")) {
    //     logDebug("box_angle information missing, returning task ID: 00-1");
    //     return "00-1";
    // }
    
    const currentId = GlobalString.load("jobIdCounter") || "0";
    let nextId = (parseInt(currentId) + 1) % 9996;
    if (nextId === 0) nextId = 1; // Ensure starting from 1
    GlobalString.store("jobIdCounter", nextId.toString());
    const result = nextId.toString().padStart(4, '0');
    logDebug("Using cumulative logic, returning task ID: " + result);
    return result;
}

// 调试日志函数 / Debug log helper
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

function normalizeOutputForLog(text) {
    return String(text).replace(/\r/g, "\\r").replace(/\n/g, "\\n");
}

// 输出封装函数 / Output helper
function sendOutput(str) {
    const mainOutput = str + endStr;
    VNLib.SendOutput(mainOutput);
    let finalOutput = mainOutput;
    
    // 普通 PostScan 输出后立即追加漏触发补偿行。
    // Append missed-trigger compensation lines right after a normal PostScan output.
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

        // Use ROI mode which returns 'Tall' or 'Short'
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

            // undefined / empty ROI_number -> treat as no ROI, skip
            if (!rawRoi) {
                continue;
            }

            const roiIdx = parseInt(rawRoi, 10);
            logDebug("ROI filter - roiIdx: " + roiIdx);
            if (!isFinite(roiIdx)) {
                continue;
            }

            // -1 means ROI not enabled -> skip
            if (roiIdx === -1) {
                continue;
            }

            if (roiIdx === targetIndex) {
            filteredCodes.push(codeArr[i]);
            filteredCenters.push(centerArr[i]);
            }
        }

        if (filteredCodes.length === 0) {
            // ROI is enabled and no barcode falls into target ROI:
            // return empty result so downstream follows "no barcode" output flow.
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

// 解析 Maxicode 数据：保留原始控制字符 / Parse Maxicode data: preserve original control characters
function parseMaxicode(maxicodeData) {
    if (!maxicodeData || maxicodeData === "") return "";
    
    // 保持原始数据不变，包括所有控制字符 / Keep original data unchanged, including all control characters
    let cleanData = maxicodeData;
    
    logDebug("Maxicode data (original): " + cleanData);
    
    // Directly return original data, no processing
    return cleanData;
}


// 根据条码读取情况判断 DisposalMark / Determine DisposalMark based on barcode reading conditions
function getDisposalMark(oneZCodes, specialOneDCodes, maxiCodes, postalCodes) {
    // 1Z and special 1D are treated as one 1D-like category for multi-code conflicts.
    const oneDLikeCount = oneZCodes.length + specialOneDCodes.length;
    if (oneDLikeCount > 1 || maxiCodes.length > 1) {
        return "2"; // Multiple barcodes in one category detected
    }
    
    // Check if only postal codes exist (considered as unread)
    if (oneDLikeCount === 0 && maxiCodes.length === 0) {
        return "1"; // No valid barcodes read (even if postal codes exist)
    }
    
    // Check if only one type of barcode exists (incomplete)
    if ((oneDLikeCount === 1 && maxiCodes.length === 0) || 
        (oneDLikeCount === 0 && maxiCodes.length === 1)) {
        return "1"; // Incomplete barcode set (only 1Z or only Maxicode)
    }
    
    // Check if only postal codes exist (incomplete)
    if (oneDLikeCount === 0 && maxiCodes.length === 0 && postalCodes.length > 0) {
        return "1"; // Only postal codes exist (incomplete)
    }
    
    return "0"; // Single package detected (including one 1Z + one Maxicode)
}

// 格式化协议输出 / Format protocol output
function formatOutput(messageType, oneZCode, maxicodeData, postalCode, disposalMark, metadata) {
    const jobId = getNextJobId();
    logDebug("Generated task ID: " + jobId);
    
    // Use Maxicode data directly, no splitting processing
    const cleanMaxicodeData = parseMaxicode(maxicodeData);
    
    return [
        "Camera." + messageType,
        jobId,
        oneZCode || "",
        cleanMaxicodeData,
        postalCode || "",
        disposalMark,
        "0", // Additional field, according to example
        metadata
    ].join('\t') + endStr;
}

function extractMetadataValue(metadataText, key) {
    if (typeof metadataText !== 'string' || metadataText === '') {
        return null;
    }
    const regex = new RegExp(`${key}=([^\\s]+)`);
    const match = metadataText.match(regex);
    return match ? match[1] : null;
}

function buildCompensationMetadata(baseMetadata) {
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
    
    const columns = String(lastPostScanLine).replace(/\r?\n$/, '').split('\t');
    const baseMetadata = columns.length >= 8 ? columns[7] : "";
    const compensationMetadata = buildCompensationMetadata(baseMetadata);
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

// 检查并清理超时历史记录 / Check and clear timeout history records
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
        
        // Get barcode time records
        const codeTimesData = GlobalString.load("codeTimes");
        const codeTimes = codeTimesData ? JSON.parse(codeTimesData) : {};
        logDebug("Barcode time records: " + JSON.stringify(codeTimes));
        
        // Check if each barcode is timeout
        const validHistory = [];
        const validCodeTimes = {};
        
        for (let i = 0; i < history.length; i++) {
            const record = history[i];
            const codes = Array.isArray(record) ? record : [record];
            
            let recordValid = true;
            for (const code of codes) {
                const codeTime = codeTimes[code];
                if (codeTime) {
                    const timeDiff = (currentTime - codeTime) / 1000; // Convert to seconds
                    logDebug(`Check barcode ${code}, recognition time: ${new Date(codeTime).toISOString()}, survival time: ${timeDiff.toFixed(2)}s, timeout threshold: ${timeoutSeconds}s`);
                    if (timeDiff >= timeoutSeconds) {
                        logDebug(`Barcode ${code} has timed out ${timeDiff.toFixed(2)}s, removing from history records`);
                        recordValid = false;
                        historyCleared = true;
                    } else {
                        // Keep non-timeout barcode time records
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
        
        // Update history records and time records
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

// 存储历史记录 / Store history records
function storeHistory(codes) {
    // Check timeout and clear history records
    checkAndClearTimeoutHistory();
    
    // Read current history records
    const history = GlobalString.load("lastTaskCodes") 
        ? JSON.parse(GlobalString.load("lastTaskCodes")) 
        : [];
    
    // Add new record
    history.push(codes);
    
    // If more than 4 records, remove the oldest
    if (history.length > 4) {
        history.shift();
    }
    
    // Record recognition time for each barcode
    const currentTime = Date.now();
    const codeTimesData = GlobalString.load("codeTimes");
    const codeTimes = codeTimesData ? JSON.parse(codeTimesData) : {};
    
    // Record current time for each barcode
    for (const code of codes) {
        codeTimes[code] = currentTime;
        logDebug(`Record barcode ${code} recognition time: ${new Date(currentTime).toISOString()}`);
    }
    
    // Save updated history records and time records
    GlobalString.store("lastTaskCodes", JSON.stringify(history));
    GlobalString.store("codeTimes", JSON.stringify(codeTimes));
    logDebug("Updated history records, current record count: " + history.length);
}

// 检查历史记录中是否已有重复码 / Check whether a duplicate exists in history records
function isDuplicate(code) {
    const history = GlobalString.load("lastTaskCodes") 
        ? JSON.parse(GlobalString.load("lastTaskCodes")) 
        : [];
    
    // Check all history records
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

// 计算到坐标原点的距离 / Calculate distance to origin
function calculateDistance(x, y) {
    return Math.sqrt(x * x + y * y);
}

// 判断是否为特殊一维码（B 或 1B 开头）/ Check whether it is a special 1D barcode (starts with B or 1B)
function isSpecialOneDCode(code) {
    // Barcode starting with B or 1B
    const startsWithBor1B = code.startsWith('B') || code.startsWith('1B');
    return startsWithBor1B;
}

function extractSpecialOneDFromMaxicode(maxicode) {
    if (!maxicode || maxicode === "") {
        logDebug("Maxicode is empty, cannot extract special 1D barcode");
        return null;
    }
    
    logDebug("Checking Maxicode for special 1D barcode using structured parsing");
    logDebug("Maxicode content: " + maxicode);
    
    try {
        // Define ASCII control characters (true separators)
        // GS (Group Separator) = 0x1D = 29
        // RS (Record Separator) = 0x1E = 30
        const GS_ASCII = String.fromCharCode(0x1D);  // ASCII 29
        const RS_ASCII = String.fromCharCode(0x1E);  // ASCII 30
        
        // Define visual symbols (Unicode symbols that may appear in strings)
        // These are Unicode symbols U+241D and U+241E, not the actual control characters
        const GS_VISUAL = "␝";  // Unicode U+241D
        const RS_VISUAL = "␞";  // Unicode U+241E
        
        // Remove the leading "[)>" if present
        let maxicodeData = maxicode;
        if (maxicodeData.startsWith("[)>")) {
            maxicodeData = maxicodeData.substring(3);
        }
        
        // Key step: Replace visual symbols with actual ASCII control characters
        // This handles cases where the string contains Unicode symbols instead of control chars
        maxicodeData = maxicodeData.replace(new RegExp(RS_VISUAL, 'g'), RS_ASCII)
                                   .replace(new RegExp(GS_VISUAL, 'g'), GS_ASCII);
        
        // Split by both GS and RS separators using actual ASCII control characters
        const separatorPattern = `[${GS_ASCII}${RS_ASCII}]`;
        const separators = new RegExp(separatorPattern, 'g');
        const fields = maxicodeData.split(separators);
        
        // Filter out empty strings from split
        const nonEmptyFields = fields.filter(field => field.trim() !== "");
        
        logDebug(`Maxicode parsed into ${nonEmptyFields.length} fields`);
        logDebug("Fields: " + nonEmptyFields.map((f, i) => `[${i}]:${f}`).join(", "));
        
        
        if (nonEmptyFields.length > 4) {
            const field5 = nonEmptyFields[4];
            logDebug(`Field 5 (barcode field): "${field5}"`);
            
            // Check if field 5 starts with B or 1B
            if (field5.startsWith('B') || field5.startsWith('1B')) {
                logDebug(`Found special 1D barcode in Maxicode field 5: ${field5}`);
                return field5;
            } else {
                logDebug(`Field 5 does not start with B or 1B, it starts with: ${field5.substring(0, Math.min(5, field5.length))}`);
            }
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
    // 下位机会按上位机变量映射注入变量，缺失映射时应走无码输出兜底，而不是任务中途 ReferenceError。
    // The lower computer injects variables according to upper-computer mapping; missing mappings should degrade to the normal no-barcode output path instead of throwing a ReferenceError mid-task.
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
    // ROI 过滤必须在拆分条码前执行，确保 code/center/ROI_number 三组数据保持对齐。
    // ROI filtering must happen before splitting so code/center/ROI_number stay aligned.
    // 当 ROI 模式有效但目标 ROI 没有码时，返回空 code/center 触发无码分支。
    // When ROI mode is valid but no barcode matches the target ROI, the filter returns empty code/center to trigger the no-barcode branch.
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

function loadPreviousOutput(context) {
    let previousOutput = [];
    try {
        const historyData = GlobalString.load("lastTaskCodes");
        if (historyData) {
            const parsedData = JSON.parse(historyData);
            function flattenArray(arr) {
                return arr.reduce((flat, item) => {
                    return flat.concat(Array.isArray(item) ? flattenArray(item) : item);
                }, []);
            }
            previousOutput = Array.isArray(parsedData) ? flattenArray(parsedData) : [];
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
    // 条码分类只基于内容前缀/长度，保持简单；后续 DisposalMark 和历史逻辑依赖这四组数组。
    // Classification is content-based and deliberately simple; downstream DisposalMark and history logic depend on these four arrays.
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

function processCodes() {
    lastTaskForwardedOutput = "";
    const context = createRuntimeContext();
    logRunnerStyleInputSnapshot(context);
    logInitialInputSnapshot(context);
    logDebug("=== Start processing barcodes ===");

    // 流水线顺序属于业务行为：命令、metadata、ROI、分类、历史、最终决策需保持当前顺序。
    // Pipeline order is part of business behavior: command, metadata, ROI, classification, history, and final decision should stay in this order unless requirements change.
    handleConfiguredCommand(context);
    buildMetadata(context);

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
    VNLib.Log("LastTaskOutputToAssistant: " + (lastTaskForwardedOutput ? normalizeOutputForLog(lastTaskForwardedOutput) : "<empty>") + endStr);
}

function getDecisionData(context) {
    // 决策 handler 只接收精简视图，避免直接依赖完整 context，保持每条输出规则聚焦。
    // Decision handlers receive a compact view instead of the entire context, keeping each output rule focused on barcode decisions.
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
    // 统一正式输出入口；漏触发补偿仍由 sendOutput() 负责，保证所有 PostScan 分支路径一致。
    // Single formal output wrapper; missed-trigger compensation remains in sendOutput(), so every PostScan branch shares the same compensation path.
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

// 从候选码中选择距离图像原点最近的码。
// Pick the nearest barcode to the image origin from a candidate list.
// skip 回调用于把各分支特有的历史/包含关系规则隔离在通用距离 helper 外。
// The skip callback keeps branch-specific history/containment rules outside this generic distance helper.
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

    // 特殊一维码优先级最高：选择最近的未输出特殊一维码，并匹配最近可用的 Postal/Maxicode。
    // Special 1D has the highest priority: select the closest new special barcode and pair it with the closest available Postal/Maxicode values.
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
    const specialCode = data.specialOneDCodes[0];
    if (data.previousOutput.includes(specialCode)) {
        logDebug(`Special 1D barcode ${specialCode} already in history records, skipping`);
        emitPostScan(data.metadata, CODE_PLACEHOLDER, CODE_PLACEHOLDER, CODE_PLACEHOLDER, data.disposalMark);
        logDebug("Special 1D barcode in history records, output ????");
        return true;
    }

    const firstPostal = firstOrPlaceholder(data.postalCodes);
    emitPostScan(data.metadata, specialCode, CODE_PLACEHOLDER, firstPostal, DISPOSAL_SPECIAL_1D);
    logDebug("Only found special 1D barcode, other fields use ???? to represent: " + specialCode + ", disposal mark=3");
    storeHistoryAndLog([specialCode]);
    return true;
}

function handleSingleOneZ(data) {
    const oneZ = data.oneZCodes[0];
    if (data.previousOutput.includes(oneZ)) {
        logDebug(`1Z barcode ${oneZ} already in history records, skipping`);
        emitPostScan(data.metadata, CODE_PLACEHOLDER, CODE_PLACEHOLDER, CODE_PLACEHOLDER, data.disposalMark);
        logDebug("1Z barcode in history records, output ????");
        return true;
    }

    const firstPostal = firstOrPlaceholder(data.postalCodes);
    emitPostScan(data.metadata, oneZ, CODE_PLACEHOLDER, firstPostal, data.disposalMark);
    logDebug("Only found 1Z barcode, Maxicode uses ???? to represent: " + oneZ);
    storeHistoryAndLog([oneZ]);
    return true;
}

function handleSingleMaxicode(data) {
    const qr = data.qrCodes[0];
    if (data.previousOutput.includes(qr)) {
        logDebug(`Maxicode ${qr} already in history records, skipping`);
        emitPostScan(data.metadata, CODE_PLACEHOLDER, CODE_PLACEHOLDER, CODE_PLACEHOLDER, data.disposalMark);
        logDebug("Maxicode in history records, output ????");
        return true;
    }

    if (hasMaxicodeHistoryContainment(qr, data.previousOutput)) {
        emitPostScan(data.metadata, CODE_PLACEHOLDER, CODE_PLACEHOLDER, CODE_PLACEHOLDER, data.disposalMark);
        logDebug("Maxicode in history records, output ????");
        return true;
    }

    // 某些 Maxicode 的第 5 个字段会携带特殊一维码；保持原规则：解析到特殊一维码时 DisposalMark 改为 3。
    // Some Maxicode payloads carry a special 1D value in field 5; preserve the rule that extracted special 1D changes DisposalMark to 3.
    const extractedSpecialOneD = extractSpecialOneDFromMaxicode(qr);
    let finalDisposalMark = data.disposalMark;

    if (extractedSpecialOneD) {
        if (data.previousOutput.includes(extractedSpecialOneD)) {
            logDebug(`Extracted special 1D barcode ${extractedSpecialOneD} from Maxicode is already in history records, skipping`);
            emitPostScan(data.metadata, CODE_PLACEHOLDER, CODE_PLACEHOLDER, CODE_PLACEHOLDER, data.disposalMark);
            logDebug("Extracted special 1D barcode in history records, output ????");
            return true;
        }
        finalDisposalMark = DISPOSAL_SPECIAL_1D;
        logDebug(`Maxicode contains special 1D barcode ${extractedSpecialOneD} in field 5, changing disposal mark from ${data.disposalMark} to 3`);
    }

    const firstPostal = firstOrPlaceholder(data.postalCodes);
    emitPostScan(data.metadata, CODE_PLACEHOLDER, qr, firstPostal, finalDisposalMark);
    logDebug("Only found Maxicode, 1Z uses ???? to represent: " + qr + ", disposal mark: " + finalDisposalMark);
    storeHistoryAndLog([qr]);
    return true;
}

function handleIncompleteOutput(data) {
    // DisposalMark=1 表示当前任务没有完整的普通 1Z + Maxicode 组合。
    // DisposalMark=1 means the current task does not contain a complete normal 1Z + Maxicode pair.
    // 下方子规则分别保留各类不完整场景的旧业务行为。
    // The sub-rules below preserve the previous customer behavior for each incomplete shape.
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
    // 该诊断遍历保留旧脚本行为：记录跨任务包含关系证据，但本身不触发组合输出。
    // This diagnostic pass mirrors the old script: it records cross-task containment evidence but does not by itself produce a combined output.
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
    // PostalCode 是辅助数据，按现有业务规则不写入历史。
    // Postal codes are auxiliary data and are intentionally not stored.
    return true;
}

function decideAndEmitOutput(context) {
    const data = getDecisionData(context);

    // 输出决策顺序显式保留，用于说明业务优先级，避免后续维护时把高优先级规则挪到兜底之后。
    // Output decision order is intentionally explicit: it documents business priority and prevents higher-priority rules from being moved below a generic fallback.
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

    // ------------------- Internal Helper Function: Get Rectangular Four Edges (Independent of Vertex Order, Automatically Generate Standard Edges) -------------------
    const getRectEdges = (rect) => {
        // Extract x and y coordinates of all rectangular vertices, calculate boundary values, and generate four vertices of the standard rectangle (clockwise: top-left, top-right, bottom-right, bottom-left)
        const xs = rect.map(pt => pt.x);
        const ys = rect.map(pt => pt.y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        
        // Four vertices of the standard rectangle (ensure edges are ordered and real boundaries)
        const topLeft = { x: minX, y: minY };
        const topRight = { x: maxX, y: minY };
        const bottomRight = { x: maxX, y: maxY };
        const bottomLeft = { x: minX, y: maxY };
        
        return [
            { p1: topLeft, p2: topRight }, // Top edge
            { p1: topRight, p2: bottomRight }, // Right edge
            { p1: bottomRight, p2: bottomLeft }, // Bottom edge
            { p1: bottomLeft, p2: topLeft }  // Left edge
        ];
    };

    // ------------------- Internal Helper Function: Determine if Two Line Segments Intersect -------------------
    const isSegmentsIntersect = (p1, p2, q1, q2) => {
        // Calculate vector cross product
        const cross = (a, b, c) => {
            return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
        };

        // Straddle judgment
        const ccw1 = cross(p1, p2, q1);
        const ccw2 = cross(p1, p2, q2);
        const ccw3 = cross(q1, q2, p1);
        const ccw4 = cross(q1, q2, p2);

        // Normal intersection (non-collinear)
        if ((ccw1 * ccw2 < 0) && (ccw3 * ccw4 < 0)) {
            return true;
        }

        // Handle endpoint coincidence or collinear cases (judge if the point is on the line segment)
        const isPointOnSegment = (p, a, b) => {
            // First judge if it is within the bounding box, then judge if the cross product is 0 (collinear)
            const inBound = (Math.min(a.x, b.x) - 1e-6 <= p.x && p.x <= Math.max(a.x, b.x) + 1e-6) &&
                (Math.min(a.y, b.y) - 1e-6 <= p.y && p.y <= Math.max(a.y, b.y) + 1e-6);
            if (!inBound) return false;
            return Math.abs(cross(a, b, p)) < 1e-6; // Floating point error tolerance
        };

        // Check if each endpoint is on the other line segment
        if (ccw1 === 0 && isPointOnSegment(q1, p1, p2)) return true;
        if (ccw2 === 0 && isPointOnSegment(q2, p1, p2)) return true;
        if (ccw3 === 0 && isPointOnSegment(p1, q1, q2)) return true;
        if (ccw4 === 0 && isPointOnSegment(p2, q1, q2)) return true;

        return false;
    };

    // ------------------- Internal Helper Function: Determine if a Point is Inside the Rectangle (Using Standard Rectangle, with Floating Point Error Tolerance) -------------------
    const isPointInRect = (point, rect) => {
        // First quickly judge through boundaries (exclude points obviously outside)
        const xs = rect.map(pt => pt.x);
        const ys = rect.map(pt => pt.y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        
        // Floating point error tolerance
        if (point.x < minX - 1e-6 || point.x > maxX + 1e-6 ||
            point.y < minY - 1e-6 || point.y > maxY + 1e-6) {
            return false;
        }

        // Ray casting algorithm (compatible with any polygon, used for rectangles here; vertex order does not affect but standard vertices are more stable)
        let inside = false;
        const n = rect.length;

        for (let i = 0, j = n - 1; i < n; j = i++) {
            const xi = rect[i].x, yi = rect[i].y;
            const xj = rect[j].x, yj = rect[j].y;

            // Floating point error tolerance to avoid judgment errors caused by precision issues
            const yiGreater = yi > point.y + 1e-6;
            const yjGreater = yj > point.y + 1e-6;
            if (yiGreater === yjGreater) continue;

            // Calculate the x-coordinate of the intersection point, with tolerance for division precision issues
            const denominator = yj - yi;
            if (Math.abs(denominator) < 1e-6) continue;
            const intersectX = (xj - xi) * (point.y - yi) / denominator + xi;

            if (point.x < intersectX - 1e-6) {
                inside = !inside;
            }
        }

        return inside;
    };

    // ------------------- Main Logic Starts -------------------
    let rectCount = 0;
    const validRects = [];
    // Verify and filter valid rectangles (must contain 4 vertices, and each vertex has x and y properties)
    boxData.forEach((rect) => {
        if (Array.isArray(rect) && rect.length === 4 && rect.every(pt => pt.hasOwnProperty('x') && pt.hasOwnProperty('y'))) {
            rectCount++;
            validRects.push(rect);
        }
    });

    let lineCount = 0;
    const validLines = [];
    // Verify and filter valid line segments (must contain 2 endpoints with x and y properties, and endpoints are not coincident)
    boxLineData.forEach((line) => {
        if (Array.isArray(line) && line.length === 2 &&
            line.every(pt => pt.hasOwnProperty('x') && pt.hasOwnProperty('y')) &&
            !(Math.abs(line[0].x - line[1].x) < 1e-6 && Math.abs(line[0].y - line[1].y) < 1e-6)) { // Floating point error tolerance
            lineCount++;
            validLines.push(line);
        }
    });

    logDebug(`Parsed ${rectCount} rectangles and ${lineCount} line segments in total`);

    let intersectLineCount = 0; // Record the number of intersecting line segments

    // Traverse each valid line segment
    validLines.forEach(line => {
        const lineP1 = line[0];
        const lineP2 = line[1];
        let isIntersect = false;

        // Traverse each valid rectangle to judge if the current line segment intersects with the rectangle (optimization: terminate rectangle traversal immediately once intersecting)
        for (let i = 0; i < validRects.length; i++) {
            if (isIntersect) break; // Already determined to intersect, terminate rectangle traversal
            const rect = validRects[i];

            // Check if the line segment intersects with any edge of the rectangle
            const rectEdges = getRectEdges(rect);
            for (let edge of rectEdges) {
                if (isSegmentsIntersect(lineP1, lineP2, edge.p1, edge.p2)) {
                    isIntersect = true;
                    break;
                }
            }

            // If no intersection with edges, check if the two endpoints of the line segment are inside the rectangle
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

    // Return the number of intersections (optional, convenient for external calls)
    //return intersectLineCount;
}

function GetDeviceStatus() {
  let deviceCount = VNLib.GetOnlineSlaveCount();
  if (deviceCount === undefined || deviceCount === null || deviceCount === '') {
    deviceCount = undefined;
    }
    else if (typeof deviceCount === 'number' && isFinite(deviceCount)) {
    }
    else {
    var n = Number(deviceCount);
    deviceCount = (!isNaN(n) && isFinite(n)) ? n : undefined;
    }
    return deviceCount + 1;
    }

function judgeRoiMode() {
    let sideRoiModeStr = VNLib.GetSlaveRoiIndex();
    let sideRoiMode;
    try {
        sideRoiMode = JSON.parse(sideRoiModeStr);
    }  catch (e) {
        return undefined;
    }
    if(!sideRoiMode || Object.prototype.toString.call(sideRoiMode) !== "[object Object]" ||
       Object.keys(sideRoiMode).length === 0) {
        return undefined;
    }
    const hasOne = Object.values(sideRoiMode).some(v => v === 1);
    return hasOne ? 'Tall' : 'Short';
}


function getParcelAngle() {
    try {
        /* ===== 1. Read core engine data: parcel coordinates, movement direction and print debug logs ===== */
        var boxCoorJsonStr = VNLib.GetBoxCoordinates();
        var boxData = JSON.parse(boxCoorJsonStr);
        var direction = VNLib.GetBoxDirection();

        logDebug("===== Parcel Skew Angle Calculation Started (Origin: Top-Left) =====" + endStr);
        logDebug("Current Conveyor Movement Direction: " + direction + " (0:Left→Right, 1:Right→Left, 2:Top→Bottom, 3:Bottom→Top)" + endStr);
        logDebug("Detected parcel quantity in view: " + boxData.length + endStr);
        logDebug("Coordinate Rule: X→Right(+), Y→Down(+) (Industrial Vision Standard)" + endStr);

        // Basic data validity check: return 0 if no parcel data, exception fallback
        if (!Array.isArray(boxData) || boxData.length === 0) {
            logDebug("Error: No valid parcel coordinate data detected" + endStr);
            return undefined;
        }

        /* ===== 2. Tool function: Calculate parcel center point (for sorting by movement direction) ===== */
        function getBoxCenter(boxPoints) {
            if (!boxPoints || boxPoints.length < 4) return {x:0, y:0};
            var x = (boxPoints[0].x + boxPoints[1].x + boxPoints[2].x + boxPoints[3].x) / 4;
            var y = (boxPoints[0].y + boxPoints[1].y + boxPoints[2].y + boxPoints[3].y) / 4;
            return {x: x, y: y};
        }

        /* ===== 3. Tool function: Generate sorting KEY by movement direction, Core: Get the last parcel ===== */
        function getBoxSortKey(boxPoints, dir) {
            var center = getBoxCenter(boxPoints);
            switch(dir) {
                case 0: return center.x;    // Left→Right: larger x = later position → take last parcel
                case 1: return -center.x;   // Right→Left: smaller x = later position → take last parcel
                case 2: return center.y;    // Top→Bottom: larger y = later position → take last parcel
                case 3: return -center.y;   // Bottom→Top: smaller y = later position → take last parcel
                default: return center.y;
            }
        }

        /* ===== 4. Core sorting: Sort parcels by movement direction, filter the last parcel as target ===== */
        var sortedBoxes = boxData.slice().sort(function(a, b) {
            var keyA = getBoxSortKey(a, direction);
            var keyB = getBoxSortKey(b, direction);
            return keyA - keyB;
        });
        var targetBox = sortedBoxes[0] ;
        var targetBoxCenter = getBoxCenter(targetBox);
        logDebug("Selected calculation target: Last parcel in movement path, center point X=" + targetBoxCenter.x.toFixed(2) + ", Y=" + targetBoxCenter.y.toFixed(2) + endStr);
        logDebug("4 vertex coordinates of target parcel: " + endStr);
        for(var j=0; j<targetBox.length; j++){
            logDebug("Vertex "+j+": X="+targetBox[j].x+", Y="+targetBox[j].y + endStr);
        }

        /* ===== 5. Core Tool Func 1: Build real rectangle edges only (avoid diagonal selection) ===== */
        function buildRectangleEdges(vertices) {
            return [
                { name: "E0(V0->V1)", p1: vertices[0], p2: vertices[1] },
                { name: "E1(V1->V2)", p1: vertices[1], p2: vertices[2] },
                { name: "E2(V2->V3)", p1: vertices[2], p2: vertices[3] },
                { name: "E3(V3->V0)", p1: vertices[3], p2: vertices[0] }
            ];
        }

        /* ===== 6. Core Tool Func 2: Select target edge from real edges with stable tie-break ===== */
        function pickTargetEdge(vertices, dir) {
            const edges = buildRectangleEdges(vertices).map(function(edge) {
                const dx = edge.p2.x - edge.p1.x;
                const dy = edge.p2.y - edge.p1.y;
                const mx = (edge.p1.x + edge.p2.x) / 2;
                const my = (edge.p1.y + edge.p2.y) / 2;
                const len = Math.sqrt(dx * dx + dy * dy);
                return {
                    name: edge.name,
                    p1: edge.p1,
                    p2: edge.p2,
                    dx: dx,
                    dy: dy,
                    midX: mx,
                    midY: my,
                    len: len
                };
            });

            let candidates = [];
            // For vertical conveyor directions, use horizontal-like edge.
            // For horizontal conveyor directions, use vertical-like edge.
            if (dir === 2 || dir === 3) {
                const minAbsDy = Math.min.apply(null, edges.map(function(e) { return Math.abs(e.dy); }));
                candidates = edges.filter(function(e) { return Math.abs(Math.abs(e.dy) - minAbsDy) < 1e-6; });
                // Stable tie-break: choose forward-most edge by movement direction.
                if (dir === 2) { // Top -> Bottom: larger y is forward
                    candidates.sort(function(a, b) { return b.midY - a.midY; });
                } else { // Bottom -> Top: smaller y is forward
                    candidates.sort(function(a, b) { return a.midY - b.midY; });
                }
            } else {
                const minAbsDx = Math.min.apply(null, edges.map(function(e) { return Math.abs(e.dx); }));
                candidates = edges.filter(function(e) { return Math.abs(Math.abs(e.dx) - minAbsDx) < 1e-6; });
                // Stable tie-break: choose forward-most edge by movement direction.
                if (dir === 0) { // Left -> Right: larger x is forward
                    candidates.sort(function(a, b) { return b.midX - a.midX; });
                } else { // Right -> Left: smaller x is forward
                    candidates.sort(function(a, b) { return a.midX - b.midX; });
                }
            }

            const picked = (candidates.length > 0) ? candidates[0] : edges[0];

            logDebug("Edge selection candidates: " + candidates.map(function(c) { return c.name; }).join(", ") + endStr);
            logDebug("Picked target edge: " + picked.name +
                     ", p1=(" + picked.p1.x + "," + picked.p1.y + ")" +
                     ", p2=(" + picked.p2.x + "," + picked.p2.y + ")" +
                     ", dx=" + picked.dx.toFixed(2) + ", dy=" + picked.dy.toFixed(2) + endStr);

            return picked;
        }

        /* ===== 7. Core Tool Func 3: Calculate Skew Angle from chosen real edge ===== */
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

        const targetEdge = pickTargetEdge(targetBox, direction);
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
        var boxCoorJsonStr = VNLib.GetBoxCoordinates();
        var boxData = JSON.parse(boxCoorJsonStr);
        var direction = VNLib.GetBoxDirection();

        logDebug("===== Parcel Edge Length Calculation Started =====" + endStr);

        if (!Array.isArray(boxData) || boxData.length === 0) {
            logDebug("Error: No valid parcel coordinate data detected" + endStr);
            return undefined;
        }

        function getBoxCenter(boxPoints) {
            if (!boxPoints || boxPoints.length < 4) return {x:0, y:0};
            var x = (boxPoints[0].x + boxPoints[1].x + boxPoints[2].x + boxPoints[3].x) / 4;
            var y = (boxPoints[0].y + boxPoints[1].y + boxPoints[2].y + boxPoints[3].y) / 4;
            return {x: x, y: y};
        }

        function getBoxSortKey(boxPoints, dir) {
            var center = getBoxCenter(boxPoints);
            switch(dir) {
                case 0: return center.x;    // Left→Right: larger x = later position → take last parcel
                case 1: return -center.x;   // Right→Left: smaller x = later position → take last parcel
                case 2: return center.y;    // Top→Bottom: larger y = later position → take last parcel
                case 3: return -center.y;   // Bottom→Top: smaller y = later position → take last parcel
                default: return center.y;
            }
        }

        var sortedBoxes = boxData.slice().sort(function(a, b) {
            var keyA = getBoxSortKey(a, direction);
            var keyB = getBoxSortKey(b, direction);
            return keyA - keyB;
        });
        var targetBox = sortedBoxes[0];
        var targetBoxCenter = getBoxCenter(targetBox);
        logDebug("Selected calculation target: Last parcel in movement path, center point X=" + targetBoxCenter.x.toFixed(2) + ", Y=" + targetBoxCenter.y.toFixed(2) + endStr);
        logDebug("4 vertex coordinates of target parcel: " + endStr);
        for(var j=0; j<targetBox.length; j++){
            logDebug("Vertex "+j+": X="+targetBox[j].x+", Y="+targetBox[j].y + endStr);
        }

        var edges = [
            [targetBox[0], targetBox[1]], 
            [targetBox[1], targetBox[2]], 
            [targetBox[2], targetBox[3]],  
            [targetBox[3], targetBox[0]]   
        ];

        var useDirectionBasedLogic = false;  

        var bestEdge = null;
        var bestScore = Infinity;

        if (useDirectionBasedLogic) {
            logDebug("Using direction-based logic: Finding edge perpendicular to movement direction" + endStr);
            
            for (var i = 0; i < edges.length; i++) {
                var p1 = edges[i][0];
                var p2 = edges[i][1];
                
                var dx = p2.x - p1.x;
                var dy = p2.y - p1.y;
                
                var score;
                if (direction === 0 || direction === 1) {
                    score = Math.abs(dy);
                    logDebug("Edge " + i + ": dx=" + dx.toFixed(2) + ", dy=" + dy.toFixed(2) + ", score=|dy|=" + score.toFixed(2) + endStr);
                } else if (direction === 2 || direction === 3) {
                    score = Math.abs(dx);
                    logDebug("Edge " + i + ": dx=" + dx.toFixed(2) + ", dy=" + dy.toFixed(2) + ", score=|dx|=" + score.toFixed(2) + endStr);
                } else {
                    score = Math.abs(dy);
                    logDebug("Edge " + i + ": dx=" + dx.toFixed(2) + ", dy=" + dy.toFixed(2) + ", score=|dy|=" + score.toFixed(2) + " (default)" + endStr);
                }
                
                if (score < bestScore) {
                    bestScore = score;
                    bestEdge = [p1, p2];
                }
            }
        } else {
            logDebug("Using default logic: Finding most horizontal edge (min |dy|)" + endStr);
            
            for (var i = 0; i < edges.length; i++) {
                var p1 = edges[i][0];
                var p2 = edges[i][1];
                
                var dx = p2.x - p1.x;
                var dy = p2.y - p1.y;
                
                var score = Math.abs(dy); 
                logDebug("Edge " + i + ": dx=" + dx.toFixed(2) + ", dy=" + dy.toFixed(2) + ", score=|dy|=" + score.toFixed(2) + endStr);
                
                if (score < bestScore) {
                    bestScore = score;
                    bestEdge = [p1, p2];
                }
            }
        }

        if (!bestEdge || bestEdge.length < 2) {
            logDebug("Error: Failed to find valid edge" + endStr);
            return undefined;
        }

        var a = bestEdge[0];
        var b = bestEdge[1];
        var edgeLength = Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y));

        logDebug("===== Edge Selection Result =====" + endStr);
        logDebug("Selected edge: Point A (x=" + a.x.toFixed(2) + ", y=" + a.y.toFixed(2) + ") → Point B (x=" + b.x.toFixed(2) + ", y=" + b.y.toFixed(2) + ")" + endStr);
        logDebug("Edge length: " + edgeLength.toFixed(2) + " pixels" + endStr);
        logDebug("Logic used: " + (useDirectionBasedLogic ? "Direction-based" : "Default (most horizontal)") + endStr);

        return edgeLength;

    } catch (error) {
        logDebug("[Fatal Error] Parcel edge length calculation failed: " + error.message + endStr);
        logDebug("Error stack trace: " + (error.stack || "No stack information") + endStr);
        return undefined;
    }
}

// 执行顶扫输出处理入口 / Execute top-scan output processing
try {
    processCodes();
} catch (error) {
    logDebug("Processing error: " + error.message);
} 

// 清空所有全局变量（默认禁用，现场谨慎使用）/ Clear all global variables (disabled by default; use carefully on site) 
// GlobalString.clearAll();

    