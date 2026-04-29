/******************************************************************************************
 * Device used: tc_in
 * Update date: 2026-04-27
 * Update content:
 * Modified the multi-package detection logic: if the number of special 1D barcodes plus 1Z codes is greater than 1, 
 * it is regarded as multiple packages. Before calculating multiple packages, deduplicate historical barcodes first and then perform the calculation.
 * Variables to be set:code,center,ROI_number，time,device_number
 * 
*******************************************************************************************/

// Debug switch - controls serial port response output
const enableSerialResponse = true; // true: enable serial port response, false: disable serial port response

const debugmode = 0; // 0: VNlib.Log, 1: sendOutput, 2: VNlib.Log + sendOutput

// Timeout clear storage function switch
const enableTimeoutClear = true; // true: enable timeout clear, false: disable timeout clear
const timeoutSeconds = 10; // Timeout time (seconds)

// No barcode output control switch
const enableNoBarcodeOutput = false; // true: no output when no barcodes, false: output ???? when no barcodes

const endStr = "\r\n";
// Separator
const sep = VNLib.getSeparator();
let lastTaskForwardedOutput = "";

// bypass mode control - use global variable to remember state
let bypassMode = GlobalString.load("bypassMode") === "false"; // false: normal mode, true: bypass mode
VNLib.Log("version: 2026-03-27" + endStr);
VNLib.Log("strStored: " + (typeof strStored !== 'undefined' ? strStored : 'undefined') + endStr);
VNLib.Log("strTcpStored: " + (typeof strTcpStored !== 'undefined' ? strTcpStored : 'undefined') + endStr);
// Serial message processing function
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

// Check command message with priority: strStored > strTcpStored
const hasStrStored = typeof strStored !== 'undefined' && strStored && String(strStored).trim() !== '';
const hasStrTcpStored = typeof strTcpStored !== 'undefined' && strTcpStored && String(strTcpStored).trim() !== '';

if (hasStrStored) {
    if (hasStrTcpStored) {
        logDebug("Both strStored and strTcpStored have values, using strStored");
    }
    handleSerialMessage(String(strStored));
} else if (hasStrTcpStored) {
    handleSerialMessage(String(strTcpStored));
}

const bypass = "bypass on";
// Box information log record
VNLib.Log("box_coordinate: " + (typeof box_coordinate !== 'undefined' ? box_coordinate : 'undefined') + endStr);
// Device number - use safe default values to avoid undefined errors
const devicenumber = (typeof device_number !== 'undefined' && device_number && typeof device_number === 'string' && device_number.trim() !== '') ? device_number.split(sep) : ['DEFAULT'];
VNLib.Log("device_number: " + devicenumber + endStr);
// Directly use box_angle to get angle
const box_angle = getParcelAngle();
VNLib.Log("box_angle: " + (typeof box_angle !== 'undefined' ? box_angle : 'undefined') + endStr);
// Record is_box_pass_line value
VNLib.Log("is_box_pass_line: " + (typeof is_box_pass_line !== 'undefined' ? is_box_pass_line : 'undefined') + endStr);

// Metadata configuration - optional configuration
const useTimeInMetadata = true;        // Whether to include time in metadata
const useAngleInMetadata = true;       // Whether to include angle in metadata
const useDeviceInMetadata = false;      // Whether to include device information in metadata
const useBoxPassLineInMetadata = true;  // Whether to include box pass line information in metadata
const useCameraStatusInMetadata = true; // Whether to include device status in metadata
const useSideRoiModeInMetadata = true; // Whether to include side ROI mode in metadata
const useParcelEdgeLengthInMetadata = true; // Whether to include parcel edge length in metadata

// Metadata - generated based on configuration
let metadata = "";
if (useTimeInMetadata || useAngleInMetadata || useDeviceInMetadata || useBoxPassLineInMetadata) {
    // Build formatted metadata
    let metadataParts = [];
    
    if (useAngleInMetadata) {
        const angleValue = (typeof box_angle !== 'undefined' ? box_angle : 'undefined');
        metadataParts.push(`Metadata.Skewness=${angleValue}`);
    }
    
    if (useTimeInMetadata) {
        const timeValue = (typeof time !== 'undefined' ? convertToISO8601Zulu(time) : 'undefined');
        metadataParts.push(`Metadata.Time=${timeValue}`);
    }
    
    if (useDeviceInMetadata) {
        const deviceValue = (Array.isArray(devicenumber) ? devicenumber.join('') : (devicenumber || 'undefined'));
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

    if (metadataParts.length > 0) {
        metadata = metadataParts.join('  '); // Use two spaces as separator
    }
}

// Time conversion function - convert time to ISO8601 ZULU format
function convertToISO8601Zulu(timeValue) {
    if (!timeValue || timeValue === "undefined") {
        return new Date().toISOString();
    }
    
    try {
        let dateObj;
        
        // Handle different time formats
        if (timeValue.includes('/') && timeValue.includes(':')) {
            // Format: "2025/06/19 17:15:11:195" or "2025/06/19 17:15:11"
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
                    
                    // Handle milliseconds part (if exists)
                    let millisecond = "000";
                    if (timeParts.length >= 4) {
                        millisecond = timeParts[3].padStart(3, '0');
                    }
                    
                    // Create ISO8601 ZULU format: YYYY-MM-DDTHH:mm:ss.sssZ
                    return `${year}-${month}-${day}T${hour}:${minute}:${second}.${millisecond}Z`;
                }
            }
        } else if (timeValue.includes('-')) {
            // Already in ISO format, just ensure it ends with Z
            if (timeValue.endsWith('Z')) {
                return timeValue;
            } else {
                return timeValue + 'Z';
            }
        }
        
        // If parsing fails, use current time
        dateObj = new Date();
        return dateObj.toISOString();
        
    } catch (error) {
        logDebug("Time conversion error: " + error.message);
        // Return current time in ISO8601 ZULU format as fallback
        return new Date().toISOString();
    }
}

// Get global task ID
function getNextJobId() {
    // Check bypass mode
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

// Debug log function
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

// Output helper function
function sendOutput(str) {
    if (typeof str === 'string' && str.startsWith("Camera.PostScan\t")) {
        lastTaskForwardedOutput = str;
    }
    VNLib.SendOutput(str + endStr);
    
    // Append missed trigger compensation lines right after a normal PostScan output.
    if (typeof str === 'string' && str.startsWith("Camera.PostScan\t")) {
        const compensationOutput = buildMissedTriggerCompensationOutput(str);
        if (compensationOutput) {
            VNLib.SendOutput(compensationOutput);
        }
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
            logDebug("ROI filter - no code matched target ROI, replace barcode content with ????");
            return { codeStr: "????", centerStr };
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

// Parse Maxicode data - convert Unicode control characters to ASCII characters
function parseMaxicode(maxicodeData) {
    if (!maxicodeData || maxicodeData === "") return "";
    
    // Keep original data unchanged, including all control characters
    let cleanData = maxicodeData;
    
    logDebug("Maxicode data (original): " + cleanData);
    
    // Directly return original data, no processing
    return cleanData;
}


// Determine disposal mark based on barcode reading conditions
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

// Format output
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

// Check and clear timeout history records
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

// Store history records
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

// Check if duplicate exists in history records
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

// Calculate distance to origin
function calculateDistance(x, y) {
    return Math.sqrt(x * x + y * y);
}

// Check if it's a special 1D barcode (starts with B, 1B)
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

// Main processing logic
function processCodes() {   
    logDebug("=== Start processing barcodes ===");
    logDebug(`Input parameters - code: "${code}", center: "${center}", box_angle: "${typeof box_angle !== 'undefined' ? box_angle : 'undefined'}"`);
    if (typeof ROI_number !== 'undefined') {
        logDebug(`Input parameter - ROI_number: "${ROI_number}"`);
    }
    
    // Defense check: If code or center is undefined/null/not string, treat as no barcodes and output ????
    if (typeof code === 'undefined' || code === null || typeof code !== 'string' ||
        typeof center === 'undefined' || center === null || typeof center !== 'string') {
        logDebug("Warning: code or center is invalid (undefined/null/not string), treating as no barcodes");
        logDebug(`code type: ${typeof code}, value: ${code}, center type: ${typeof center}, value: ${center}`);
        
        // Output same format as completely no barcodes (disposalMark = "1")
        const disposalMark = "1";
        if (!enableNoBarcodeOutput) {
            sendOutput(formatOutput("PostScan", "????", "????", "????", disposalMark, metadata));
            logDebug("Invalid code/center detected, output ???? format (same as no barcodes)");
        } else {
            logDebug("Invalid code/center detected, no barcode output switch enabled, no output");
        }
        return;
    }
    
    // Check device information - devicenumber can be empty, but box_angle cannot be empty
    logDebug("Device information check - devicenumber: " + JSON.stringify(devicenumber) + ", length: " + devicenumber.length);
    logDebug("Device information check - box_angle: " + (typeof box_angle !== 'undefined' ? box_angle : 'undefined'));
    logDebug("Bypass mode status: " + (bypassMode ? "Enabled" : "Disabled"));
    
    // Check timeout and clear history records before processing barcodes
    const wasCleared = checkAndClearTimeoutHistory();
    
    if (bypassMode) {
        logDebug("Bypass mode enabled, will use task ID 00-1 for output");
    } 
    // else if (typeof box_angle === 'undefined' || 
    //     (typeof box_angle !== 'undefined' && String(box_angle).trim() === "")) {
    //     logDebug("No box_angle information found, will use task ID 00-1 for output");
    // }
    
    // Apply ROI-based filtering before splitting codes
    const roiFiltered = filterCodesByRoi(code, center, typeof ROI_number !== 'undefined' ? ROI_number : "");
    const filteredCodeStr = roiFiltered.codeStr;
    const filteredCenterStr = roiFiltered.centerStr;

    // Split all barcodes in current task (after ROI filtering)
    const codes = (filteredCodeStr === "" ? [] : filteredCodeStr.split(sep))
        .map(c => c.trim())      // Remove leading and trailing spaces
        .filter(c => c !== "");  // Filter empty strings

    logDebug("Input barcode count: " + codes.length);

    // Barcode center coordinates
    const centerArr = filteredCenterStr === "" ? [] : filteredCenterStr.split(sep);
    
    // Read barcodes output from last task
    let previousOutput = [];
    try {
        const historyData = GlobalString.load("lastTaskCodes");
        if (historyData) {
            const parsedData = JSON.parse(historyData);
            // Use recursion to safely flatten arrays
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
    
    if (wasCleared) {
        logDebug("History records have been cleared by timeout, restart processing");
    }
    
    logDebug("History barcode count: " + previousOutput.length);
    logDebug("History barcodes: " + previousOutput.join(","));

    // Current task output barcodes (auto deduplication)
    const currentOutput = [];
    
    // Group barcodes by type
    const qrCodes = codes.filter(code => code.startsWith('[)'));
    const oneZCodes = codes.filter(code => code.startsWith('1Z'));
    const postalCodes = codes.filter(code => code.length === 8);
    
    // New: Check barcodes starting with B, 1B
    const specialOneDCodes = codes.filter(code => isSpecialOneDCode(code));

    logDebug("Maxicode count: " + qrCodes.length);
    logDebug("1Z barcode count: " + oneZCodes.length);
    logDebug("Postal code count: " + postalCodes.length);
    logDebug("Special 1D barcode count: " + specialOneDCodes.length);
    logDebug("Special 1D barcode list: " + specialOneDCodes.join(","));
    
    // Debug: Check if each barcode is correctly identified
    codes.forEach(code => {
        logDebug(`Barcode "${code}" is special 1D barcode: ${isSpecialOneDCode(code)}`);
    });

    // Filter out barcodes already present in history before conflict checks.
    const newOneZCodes = oneZCodes.filter(code => !previousOutput.includes(code));
    const newSpecialOneDCodes = specialOneDCodes.filter(code => !previousOutput.includes(code));
    const newQrCodes = qrCodes.filter(code => !previousOutput.includes(code));
    
    logDebug("History-filtered Maxicode count: " + newQrCodes.length);
    logDebug("History-filtered 1Z count: " + newOneZCodes.length);
    logDebug("History-filtered special 1D count: " + newSpecialOneDCodes.length);

    // Determine disposal mark
    const disposalMark = getDisposalMark(newOneZCodes, newSpecialOneDCodes, newQrCodes, postalCodes);
    logDebug("Disposal mark: " + disposalMark);

    // Get coordinates for each barcode
    const codePositions = {};
    codes.forEach((code, index) => {
        if (index < centerArr.length) {
            // Handle coordinates with braces
            const coordStr = centerArr[index].replace(/[{}]/g, '');
            const [x, y] = coordStr.split(',').map(Number);
            if (!isNaN(x) && !isNaN(y)) {
                codePositions[code] = { x, y };
            }
        }
    });

    // Priority processing for special 1D barcodes (B-starting barcodes)
    if (specialOneDCodes.length > 0) {
        logDebug("Start processing special 1D barcodes, count: " + specialOneDCodes.length);
        // Find closest special 1D barcode to origin (using consistent duplicate filtering with original logic)
        let closestSpecialOneD = null;
        let minSpecialOneDDistance = Infinity;
        
        for (const specialCode of specialOneDCodes) {
            // Check if special 1D barcode is already in history records
            if (previousOutput.includes(specialCode)) {
                logDebug(`Special 1D barcode ${specialCode} already in history records, skipping`);
                continue;
            }
            
            const specialPos = codePositions[specialCode];
            if (specialPos) {
                const distance = calculateDistance(specialPos.x, specialPos.y);
                if (distance < minSpecialOneDDistance) {
                    minSpecialOneDDistance = distance;
                    closestSpecialOneD = specialCode;
                }
            }
        }
        
        if (closestSpecialOneD) {
            logDebug("Found closest special 1D barcode: " + closestSpecialOneD);
            // Find postal code closest to origin
            let closestPostal = null;
            let minPostalDistance = Infinity;
            for (const postal of postalCodes) {
                // Check if postal code is already in history records
                if (previousOutput.includes(postal)) {
                    logDebug(`Postal code ${postal} already in history records, skipping`);
                    continue;
                }
                
                const postalPos = codePositions[postal];
                if (postalPos) {
                    const distance = calculateDistance(postalPos.x, postalPos.y);
                    if (distance < minPostalDistance) {
                        minPostalDistance = distance;
                        closestPostal = postal;
                    }
                }
            }
            
            // Find Maxicode closest to origin
            let closestQR = null;
            let minQRDistance = Infinity;
            for (const qr of qrCodes) {
                // Check if Maxicode is already in history records
                if (previousOutput.includes(qr)) {
                    logDebug(`Maxicode ${qr} already in history records, skipping`);
                    continue;
                }
                
                const qrPos = codePositions[qr];
                if (qrPos) {
                    const distance = calculateDistance(qrPos.x, qrPos.y);
                    if (distance < minQRDistance) {
                        minQRDistance = distance;
                        closestQR = qr;
                    }
                }
            }
            
            // Output special 1D barcode, also output other types of barcodes
            const postalOutput = closestPostal || "????";
            const qrOutput = closestQR || "????";
            
            sendOutput(formatOutput("PostScan", closestSpecialOneD, qrOutput, postalOutput, "3", metadata));
            logDebug(`Output special 1D barcode combination: special 1D barcode=${closestSpecialOneD}, postal=${postalOutput}, Maxicode=${qrOutput}, disposal mark=3`);
            
            // Update storage (only store main barcodes, not postal codes)
            const storedCodes = [closestSpecialOneD];
            if (closestQR) storedCodes.push(closestQR);
            storeHistory(storedCodes);
            logDebug("Updated stored barcodes: " + storedCodes.join(","));
            return;
        }
    }

    // Handle different scenarios based on disposal mark
    logDebug("Start processing based on disposal mark, current disposal mark: " + disposalMark);
    if (disposalMark === "1") {
        logDebug("Disposal mark is 1, start processing incomplete barcode scenarios");
        // Check if only special 1D barcode exists
        if (oneZCodes.length === 0 && qrCodes.length === 0 && specialOneDCodes.length === 1) {
            // Only found special 1D barcode, check if duplicate
            if (previousOutput.includes(specialOneDCodes[0])) {
                logDebug(`Special 1D barcode ${specialOneDCodes[0]} already in history records, skipping`);
                // Special 1D barcode in history records
                sendOutput(formatOutput("PostScan", "????", "????", "????", disposalMark, metadata));
                logDebug("Special 1D barcode in history records, output ????");
                return;
            } else {
                // Only found special 1D barcode, output it, other fields use ???? to represent
                const firstPostal = postalCodes.length > 0 ? postalCodes[0] : "????";
                sendOutput(formatOutput("PostScan", specialOneDCodes[0], "????", firstPostal, "3", metadata));
                logDebug("Only found special 1D barcode, other fields use ???? to represent: " + specialOneDCodes[0] + ", disposal mark=3");
                // Store special 1D barcode to history records
                storeHistory([specialOneDCodes[0]]);
                logDebug("Updated stored barcodes: " + specialOneDCodes[0]);
                return;
            }
        }
        // Check if only 1Z barcode or only Maxicode exists
        else if (oneZCodes.length === 1 && qrCodes.length === 0) {
            // Only found 1Z barcode, check if duplicate
            if (previousOutput.includes(oneZCodes[0])) {
                logDebug(`1Z barcode ${oneZCodes[0]} already in history records, skipping`);
                // 1Z barcode in history records
                sendOutput(formatOutput("PostScan", "????", "????", "????", disposalMark, metadata));
                logDebug("1Z barcode in history records, output ????");
                return;
            } else {
                // Only found 1Z barcode, output it, Maxicode uses ???? to represent
                const firstPostal = postalCodes.length > 0 ? postalCodes[0] : "????";
                sendOutput(formatOutput("PostScan", oneZCodes[0], "????", firstPostal, disposalMark, metadata));
                logDebug("Only found 1Z barcode, Maxicode uses ???? to represent: " + oneZCodes[0]);
                // Store 1Z barcode to history records
                storeHistory([oneZCodes[0]]);
                logDebug("Updated stored barcodes: " + oneZCodes[0]);
                return;
            }
        } else if (oneZCodes.length === 0 && qrCodes.length === 1) {
            // Only found Maxicode, check if duplicate
            if (previousOutput.includes(qrCodes[0])) {
                logDebug(`Maxicode ${qrCodes[0]} already in history records, skipping`);
                // Maxicode in history records 
                sendOutput(formatOutput("PostScan", "????", "????", "????", disposalMark, metadata));
                logDebug("Maxicode in history records, output ????");
                return;
            }
            
            // Check if Maxicode has containment relationship with history barcodes
            let hasHistoryContainment = false;
            for (const prevCode of previousOutput) {
                if (prevCode.startsWith('[)') && (qrCodes[0].includes(prevCode) || prevCode.includes(qrCodes[0]))) {
                    hasHistoryContainment = true;
                    logDebug(`Maxicode ${qrCodes[0]} has containment relationship with history barcode ${prevCode}, skipping`);
                    break;
                }
                // Check if Maxicode contains special 1D barcode from history barcodes
                if (prevCode.startsWith('B')) {
                    if (qrCodes[0].includes(prevCode)) {
                        hasHistoryContainment = true;
                        logDebug(`Maxicode ${qrCodes[0]} contains history special 1D barcode ${prevCode}, skipping`);
                        break;
                    }
                }
            }
            
            if (hasHistoryContainment) {
                // Maxicode in history records 
                sendOutput(formatOutput("PostScan", "????", "????", "????", disposalMark, metadata));
                logDebug("Maxicode in history records, output ????");
                return;
            } else {
                // Check if Maxicode contains special 1D barcode (B or 1B) using structured parsing
                const extractedSpecialOneD = extractSpecialOneDFromMaxicode(qrCodes[0]);
                let finalDisposalMark = disposalMark;
                
                if (extractedSpecialOneD) {
                    // Check if extracted special 1D barcode is already in history records
                    if (previousOutput.includes(extractedSpecialOneD)) {
                        logDebug(`Extracted special 1D barcode ${extractedSpecialOneD} from Maxicode is already in history records, skipping`);
                        // Special 1D barcode in history records
                        sendOutput(formatOutput("PostScan", "????", "????", "????", disposalMark, metadata));
                        logDebug("Extracted special 1D barcode in history records, output ????");
                        return;
                    }
                    // Maxicode contains special 1D barcode, set disposal mark to 3
                    finalDisposalMark = "3";
                    logDebug(`Maxicode contains special 1D barcode ${extractedSpecialOneD} in field 5, changing disposal mark from ${disposalMark} to 3`);
                }
                
                // Only found Maxicode, output it, 1Z uses ???? to represent
                const firstPostal = postalCodes.length > 0 ? postalCodes[0] : "????";
                sendOutput(formatOutput("PostScan", "????", qrCodes[0], firstPostal, finalDisposalMark, metadata));
                logDebug("Only found Maxicode, 1Z uses ???? to represent: " + qrCodes[0] + ", disposal mark: " + finalDisposalMark);
                // Store Maxicode to history records
                storeHistory([qrCodes[0]]);
                logDebug("Updated stored barcodes: " + qrCodes[0]);
                return;
            }
        } else if (oneZCodes.length === 0 && qrCodes.length === 0 && postalCodes.length > 0) {
            // Only found postal codes, decide whether to output based on switch
            if (!enableNoBarcodeOutput) {
                sendOutput(formatOutput("PostScan", "????", "????", "????", disposalMark, metadata));
                logDebug("Only found postal codes, all fields use ???? to represent");
            } else {
                logDebug("Only found postal codes, no barcode output switch enabled, no output");
            }
            return;
        } else {
            // No barcodes read, decide whether to output based on switch
            if (!enableNoBarcodeOutput) {
                sendOutput(formatOutput("PostScan", "????", "????", "????", disposalMark, metadata));
                logDebug("No barcodes read, all fields use ???? to represent");
            } else {
                logDebug("No barcodes read, no barcode output switch enabled, no output");
            }
            return;
        }
    }

    if (disposalMark === "2") {
        logDebug("Disposal mark is 2, multiple barcodes of the same type detected");
        // Multiple barcodes of the same type detected - all fields use !!!! to represent
        sendOutput(formatOutput("PostScan", "!!!!", "!!!!", "!!!!", disposalMark, metadata));
        logDebug("Multiple barcodes of the same type detected, all fields use !!!! to represent");
        return;
    }

    // Check if containment relationship exists
    logDebug("Start checking containment relationships between barcodes");
    let hasContainment = false;
    let containedOneZ = null;
    let containedQR = null;

    // Check if containment relationship exists between 1Z and Maxicode in current task
    for (const oneZ of oneZCodes) {
        // First check if 1Z barcode is already in history records
        if (previousOutput.includes(oneZ)) {
            logDebug(`1Z barcode ${oneZ} already in history records, skipping`);
            continue;
        }

        // Check if 1Z barcode has containment relationship with history barcodes
        let hasHistoryContainment = false;
        for (const prevCode of previousOutput) {
            if (prevCode.startsWith('1Z') && (oneZ.includes(prevCode) || prevCode.includes(oneZ))) {
                hasHistoryContainment = true;
                logDebug(`1Z barcode ${oneZ} has containment relationship with history barcode ${prevCode}, skipping`);
                break;
            }
            // Check if 1Z barcode is contained in history Maxicode
            if (prevCode.startsWith('[)') && prevCode.includes(oneZ)) {
                hasHistoryContainment = true;
                logDebug(`1Z barcode ${oneZ} contained in history Maxicode ${prevCode}, skipping`);
                break;
            }
            // Check if 1Z barcode contains 1Z code from history Maxicode
            if (prevCode.startsWith('[)')) {
                const maxicodeOneZ = prevCode.match(/1Z\d+/);
                if (maxicodeOneZ && oneZ.includes(maxicodeOneZ[0])) {
                    hasHistoryContainment = true;
                    logDebug(`1Z barcode ${oneZ} contains 1Z code ${maxicodeOneZ[0]} from history Maxicode, skipping`);
                    break;
                }
            }
        }
        if (hasHistoryContainment) continue;

        for (const qr of qrCodes) {
            // Check if Maxicode is already in history records
            if (previousOutput.includes(qr)) {
                logDebug(`Maxicode ${qr} already in history records, skipping`);
                continue;
            }

            // Check if Maxicode has containment relationship with history barcodes
            let hasHistoryContainment = false;
            for (const prevCode of previousOutput) {
                if (prevCode.startsWith('[)') && (qr.includes(prevCode) || prevCode.includes(qr))) {
                    hasHistoryContainment = true;
                    logDebug(`Maxicode ${qr} has containment relationship with history barcode ${prevCode}, skipping`);
                    break;
                }
                // Check if Maxicode contains 1Z code from history barcodes
                if (prevCode.startsWith('1Z')) {
                    const maxicodeOneZ = qr.match(/1Z\d+/);
                    if (maxicodeOneZ && (prevCode.includes(maxicodeOneZ[0]) || maxicodeOneZ[0].includes(prevCode))) {
                        hasHistoryContainment = true;
                        logDebug(`1Z code ${maxicodeOneZ[0]} in Maxicode ${qr} has containment relationship with history 1Z barcode ${prevCode}, skipping`);
                        break;
                    }
                }
            }
            if (hasHistoryContainment) continue;

            if (qr.length >= 37) {
                const key = qr.substring(29, 37);
                if (oneZ.includes(key)) {
                    hasContainment = true;
                    containedOneZ = oneZ;
                    containedQR = qr;
                    logDebug(`Found containment relationship between 1Z and Maxicode in current task: ${oneZ} with ${qr}`);
                    break;
                }
            }
        }
        if (hasContainment) break;
    }

    // If no containment relationship found in current task, check with history barcodes
    if (!hasContainment) {
        for (const oneZ of oneZCodes) {
            if (previousOutput.includes(oneZ)) {
                logDebug(`1Z barcode ${oneZ} already in history records, skipping`);
                continue;
            }

            for (const prevCode of previousOutput) {
                if (prevCode.startsWith('1Z') && (oneZ.includes(prevCode) || prevCode.includes(oneZ))) {
                    hasContainment = true;
                    logDebug(`Found 1Z barcode containment relationship: ${oneZ} with ${prevCode}`);
                    break;
                }
                // Check if 1Z barcode is contained in history Maxicode
                if (prevCode.startsWith('[)') && prevCode.includes(oneZ)) {
                    hasContainment = true;
                    logDebug(`Found 1Z barcode contained in history Maxicode: ${oneZ} contained in ${prevCode}`);
                    break;
                }
                // Check if 1Z barcode contains 1Z code from history Maxicode
                if (prevCode.startsWith('[)')) {
                    const maxicodeOneZ = prevCode.match(/1Z\d+/);
                    if (maxicodeOneZ && oneZ.includes(maxicodeOneZ[0])) {
                        hasContainment = true;
                        logDebug(`Found 1Z barcode contains 1Z code ${maxicodeOneZ[0]} from history Maxicode: ${oneZ} contains ${maxicodeOneZ[0]}`);
                        break;
                    }
                }
            }
        }

        for (const qr of qrCodes) {
            if (previousOutput.includes(qr)) {
                logDebug(`Maxicode ${qr} already in history records, skipping`);
                continue;
            }

            for (const prevCode of previousOutput) {
                if (prevCode.startsWith('[)') && (qr.includes(prevCode) || prevCode.includes(qr))) {
                    hasContainment = true;
                    logDebug(`Found Maxicode containment relationship: ${qr} with ${prevCode}`);
                    break;
                }
                // Check if Maxicode contains 1Z code from history barcodes
                if (prevCode.startsWith('1Z')) {
                    const maxicodeOneZ = qr.match(/1Z\d+/);
                    if (maxicodeOneZ && (prevCode.includes(maxicodeOneZ[0]) || maxicodeOneZ[0].includes(prevCode))) {
                        hasContainment = true;
                        logDebug(`Found Maxicode contains 1Z code from history barcodes: ${qr} contains ${maxicodeOneZ[0]}`);
                        break;
                    }
                }
            }
        }
    }

    // If containment relationship exists in current task, output 1Z and Maxicode together
    if (containedOneZ && containedQR) {
        logDebug("Found containment relationship, 1Z: " + containedOneZ + ", Maxicode: " + containedQR);
        // Find postal code closest to origin
        let closestPostal = null;
        let minPostalDistance = Infinity;
        
        for (const postal of postalCodes) {
            const postalPos = codePositions[postal];
            if (postalPos) {
                const distance = calculateDistance(postalPos.x, postalPos.y);
                if (distance < minPostalDistance) {
                    minPostalDistance = distance;
                    closestPostal = postal;
                }
            }
        }

        // Output all barcodes
        sendOutput(formatOutput("PostScan", containedOneZ, containedQR, closestPostal || "????", "0", metadata));
        logDebug(`Output barcode combination with containment relationship: 1Z=${containedOneZ}, postal=${closestPostal || "????"}, Maxicode=${containedQR}`);
        
        // Update storage (append to history records)
        const storedCodes = [containedOneZ, containedQR];
        storeHistory(storedCodes);
        logDebug("Updated stored barcodes: " + storedCodes.join(","));
        return;
    }

    // Find closest unoutput barcode to origin
    logDebug("Start finding closest unoutput barcode to origin");
    let closestCode = null;
    let closestType = null;
    let minDistance = Infinity;

    // Check 1Z barcodes
    for (const oneZ of oneZCodes) {
        if (!previousOutput.includes(oneZ)) {
            // Check if 1Z code is contained in history Maxicode
            let containedInHistoryMaxicode = false;
            for (const prevCode of previousOutput) {
                logDebug(`Check relationship between 1Z code ${oneZ} and history barcode ${prevCode}`);
                if (prevCode.startsWith('[)')) {
                    logDebug(`History barcode is Maxicode, check if it contains 1Z code`);
                    const maxicodeOneZ = prevCode.match(/1Z\d+/);
                    if (maxicodeOneZ) {
                        logDebug(`Extracted 1Z code from Maxicode: ${maxicodeOneZ[0]}`);
                        // Extract numeric part for comparison
                        const oneZDigits = oneZ.replace('1Z', '');
                        const maxicodeOneZDigits = maxicodeOneZ[0].replace('1Z', '');
                        logDebug(`Compare numeric parts: ${oneZDigits} and ${maxicodeOneZDigits}`);
                        if (oneZDigits.includes(maxicodeOneZDigits) || maxicodeOneZDigits.includes(oneZDigits)) {
                            containedInHistoryMaxicode = true;
                            logDebug(`1Z code ${oneZ} has containment relationship with 1Z code ${maxicodeOneZ[0]} in Maxicode, skipping`);
                            break;
                        } else {
                            logDebug(`1Z code ${oneZ} has no containment relationship with 1Z code ${maxicodeOneZ[0]} in Maxicode`);
                        }
                    } else {
                        logDebug(`No 1Z code extracted from Maxicode`);
                    }
                }
            }
            if (containedInHistoryMaxicode) continue;

            const oneZPos = codePositions[oneZ];
            if (oneZPos) {
                const distance = calculateDistance(oneZPos.x, oneZPos.y);
                if (distance < minDistance) {
                    minDistance = distance;
                    closestCode = oneZ;
                    closestType = "1Z";
                }
            }
        }
    }
    
    // Check Maxicode
    for (const qr of qrCodes) {
        if (!previousOutput.includes(qr)) {
            // Check if Maxicode contains history 1Z code
            let containsHistoryOneZ = false;
            for (const prevCode of previousOutput) {
                logDebug(`Check relationship between Maxicode ${qr} and history barcode ${prevCode}`);
                if (prevCode.startsWith('1Z')) {
                    logDebug(`History barcode is 1Z code, check if Maxicode contains this 1Z code`);
                    const maxicodeOneZ = qr.match(/1Z\d+/);
                    if (maxicodeOneZ) {
                        logDebug(`Extracted 1Z code from Maxicode: ${maxicodeOneZ[0]}`);
                        // Extract numeric part for comparison
                        const prevCodeDigits = prevCode.replace('1Z', '');
                        const maxicodeOneZDigits = maxicodeOneZ[0].replace('1Z', '');
                        logDebug(`Compare numeric parts: ${prevCodeDigits} and ${maxicodeOneZDigits}`);
                        if (prevCodeDigits.includes(maxicodeOneZDigits) || maxicodeOneZDigits.includes(prevCodeDigits)) {
                            containsHistoryOneZ = true;
                            logDebug(`1Z code ${maxicodeOneZ[0]} in Maxicode has containment relationship with history 1Z code ${prevCode}, skipping`);
                            break;
                        } else {
                            logDebug(`1Z code ${maxicodeOneZ[0]} in Maxicode has no containment relationship with history 1Z code ${prevCode}`);
                        }
                    } else {
                        logDebug(`No 1Z code extracted from Maxicode`);
                    }
                }
            }
            if (containsHistoryOneZ) continue;

            const qrPos = codePositions[qr];
            if (qrPos) {
                const distance = calculateDistance(qrPos.x, qrPos.y);
                if (distance < minDistance) {
                    minDistance = distance;
                    closestCode = qr;
                    closestType = "Maxicode";
                }
            }
        }
    }

    // Output found closest barcode
    if (closestCode) {
        logDebug("Found closest barcode, type: " + closestType + ", content: " + closestCode);
        if (closestType === "1Z") {
            sendOutput(formatOutput("PostScan", closestCode, "????", "????", "0", metadata));
            logDebug("Output 1Z barcode: " + closestCode);
            // Update storage (append to history records)
            storeHistory([closestCode]);
        } else if (closestType === "Maxicode") {
            sendOutput(formatOutput("PostScan", "????", closestCode, "????", "0", metadata));
            logDebug("Output Maxicode: " + closestCode);
            // Update storage (append to history records)
            storeHistory([closestCode]);
        }
        return;
    }

    // If no new 1Z or Maxicode barcodes found, check postal codes
    logDebug("No new main barcodes found, start checking postal codes");
    let closestPostal = null;
    let minPostalDistance = Infinity;
    for (const postal of postalCodes) {
        const postalPos = codePositions[postal];
        if (postalPos) {
            const distance = calculateDistance(postalPos.x, postalPos.y);
            if (distance < minPostalDistance) {
                minPostalDistance = distance;
                closestPostal = postal;
            }
        }
    }

    if (closestPostal) {
        // Check if all main barcodes (1Z, Maxicode, special 1D barcodes) are in history records
        let allMainCodesInHistory = true;
        
        // Check 1Z barcodes
        for (const oneZ of oneZCodes) {
            if (!previousOutput.includes(oneZ)) {
                allMainCodesInHistory = false;
                break;
            }
        }
        
        // Check Maxicode
        if (allMainCodesInHistory) {
            for (const qr of qrCodes) {
                if (!previousOutput.includes(qr)) {
                    allMainCodesInHistory = false;
                    break;
                }
            }
        }
        
        // Check special 1D barcodes
        if (allMainCodesInHistory) {
            for (const special of specialOneDCodes) {
                if (!previousOutput.includes(special)) {
                    allMainCodesInHistory = false;
                    break;
                }
            }
        }
        
        if (allMainCodesInHistory) {
            // All main barcodes in history records, equivalent to only postal codes detected, decide whether to output based on switch
            if (!enableNoBarcodeOutput) {
                sendOutput(formatOutput("PostScan", "????", "????", "????", "0", metadata));
                logDebug("All main barcodes in history records, equivalent to only postal codes detected, output ????");
            } else {
                logDebug("All main barcodes in history records, equivalent to only postal codes detected, no barcode output switch enabled, no output");
            }
            return;
        } else {
            // New main barcodes exist, output postal code
            sendOutput(formatOutput("PostScan", "????", "????", closestPostal, "0", metadata));
            logDebug("Output postal code: " + closestPostal);
            // Note: Postal codes are not stored in history records
            return;
        }
    }
    
    // If no barcodes found, decide whether to output based on switch
    if (!enableNoBarcodeOutput) {
        sendOutput(formatOutput("PostScan", "????", "????", "????", "0", metadata));
        logDebug("No new barcodes found, output ????");
    } else {
        logDebug("No new barcodes found, no barcode output switch enabled, no output");
    }
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

        /* ===== 5. Core Tool Func 1: Get Forward Vertex (1st Point) - Correct for Top-Left Origin ===== */
        function getForwardVertex(vertices, dir) {
            let forwardVertex = vertices[0];
            for(let i = 1; i < vertices.length; i++){
                const currVertex = vertices[i];
                switch(dir) {
                    case 0: forwardVertex = currVertex.x > forwardVertex.x ? currVertex : forwardVertex; break;
                    case 1: forwardVertex = currVertex.x < forwardVertex.x ? currVertex : forwardVertex; break;
                    case 2: forwardVertex = currVertex.y > forwardVertex.y ? currVertex : forwardVertex; break;
                    case 3: forwardVertex = currVertex.y < forwardVertex.y ? currVertex : forwardVertex; break;
                }
            }
            return forwardVertex;
        }

        /* ===== 6. Core Tool Func 2: Get Rightmost Vertex (2nd Point)  ===== */
        function getRightmostVertexExcludeForward(vertices, forwardVertex, dir) {
            let rightmostVertex = null;
            for(let i = 0; i < vertices.length; i++){
                const currVertex = vertices[i];
                // Skip forward vertex, ensure two different points forever
                if(currVertex.x === forwardVertex.x && currVertex.y === forwardVertex.y){
                    continue;
                }
                if(rightmostVertex === null){
                    rightmostVertex = currVertex;
                    continue;
                }
                switch(dir) {
                    case 0: // Left → Right  : Physical Right = Y ↑ (More Down)
                        rightmostVertex = currVertex.y > rightmostVertex.y ? currVertex : rightmostVertex; break;
                    case 1: // Right → Left  : Physical Right = Y ↓ (More Up) 
                        rightmostVertex = currVertex.y < rightmostVertex.y ? currVertex : rightmostVertex; break;
                    case 2: // Top → Bottom  : Physical Right = X ↓ (More Left) 
                        rightmostVertex = currVertex.x < rightmostVertex.x ? currVertex : rightmostVertex; break;
                    case 3: // Bottom → Top  : Physical Right = X ↑ (More Right) 
                        rightmostVertex = currVertex.x > rightmostVertex.x ? currVertex : rightmostVertex; break;
                }
            }
            // Extreme fallback: avoid null return
            return rightmostVertex || vertices[0];
        }

        /* ===== 7. Core Tool Func 3: Calculate Skew Angle (Precision Fixed, No Change Needed) ===== */
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

        const forwardVertex = getForwardVertex(targetBox, direction);
        const rightmostVertex = getRightmostVertexExcludeForward(targetBox, forwardVertex, direction);
        
        logDebug("\n===== Two Core Vertices Selected (Physical Correct) =====" + endStr);
        logDebug("1. Forward Vertex (Movement Direction): X="+forwardVertex.x+", Y="+forwardVertex.y + endStr);
        logDebug("2. Rightmost Vertex (Physical Right Side, Excluded Forward): X="+rightmostVertex.x+", Y="+rightmostVertex.y + endStr);

        const parcelSkewAngle = calcSkewAngle(forwardVertex, rightmostVertex, direction);
        const finalResult = parcelSkewAngle + "°";

        logDebug("\n===== Final Parcel Skew Angle Result (Valid & Precise) =====" + endStr);
        logDebug("Target Edge: Forward Vertex -> Physical Right Vertex" + endStr);
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


// Execute processing
try {
    processCodes();
} catch (error) {
    logDebug("Processing error: " + error.message);
}
VNLib.Log("LastTaskOutputToAssistant: " + (lastTaskForwardedOutput || "<empty>") + endStr);

// Clear all global variables 
// GlobalString.clearAll();