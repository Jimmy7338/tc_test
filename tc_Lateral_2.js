 /******************************************************************************************
 * Device used: tc_out_front
 * Update date: 2026-04-01
*******************************************************************************************

 * Requirement: Select ROI based on whether the box crosses the virtual line (Side scan mode)
 * Description:
 *   - First get the motion direction
 *   - Based on the first box in the motion direction, check if it intersects with the virtual line
 *     * Has intersection → ROI2 (Tall box)
 *     * No intersection → ROI1 (Short box)
 * Version: V2.1
****************************************************************************************************/

// Callback function
function SetRoiIndex(isBoxPassLine) {
    try {
        VNLib.Log("isBoxPassLine: " + isBoxPassLine + "\n");
        
        // Calculate ROI area (using four point coordinates)
        function calculateROIArea(roi) {
            if (!roi || !roi.points || roi.points.length < 4) {
                return 0;
            }
            
            var p0 = roi.points[0]; // Top-left
            var p1 = roi.points[1]; // Top-right
            var p2 = roi.points[2]; // Bottom-left
            var p3 = roi.points[3]; // Bottom-right
            
            // Calculate width and height (using average method for better accuracy)
            var width = (Math.abs(p1.x - p0.x) + Math.abs(p3.x - p2.x)) / 2;
            var height = (Math.abs(p2.y - p0.y) + Math.abs(p3.y - p1.y)) / 2;
            
            return width * height;
        }
        
        //ROI
        var roiJsonStr = VNLib.GetRoiPoints();
        var roiData = JSON.parse(roiJsonStr);
        VNLib.Log("roi count:" + roiData.length + "\n" );
        for (var i = 0; i < roiData.length; i++) {
            var roi = roiData[i];
            VNLib.Log("roi index:" + roi.index + "\n" );
            // point0: Top-left corner; point1: Top-right corner; point2: Bottom-left corner; point3: Bottom-right corner
            for (var j = 0; j < roi.points.length; j++) {
                VNLib.Log("point" + j + ":x=" + roi.points[j].x + ", y=" + roi.points[j].y + "\n")
            }
        }
        
        // Box coordinates
        var boxCoorJsonStr = VNLib.GetBoxCoordinates();
        var boxData = JSON.parse(boxCoorJsonStr);
        VNLib.Log("box count:" + boxData.length + "\n");
        for(var i = 0; i < boxData.length; i++) {
            var boxPointsArray = boxData[i]; // Box coordinate array (4 vertex coordinates)
            VNLib.Log("box" + i + ":\n");
            for(var j = 0; j < boxPointsArray.length; j++) {
                var point = boxPointsArray[j];
                VNLib.Log("point" + j + ":" + "x " +  point.x + " y " + point.y + "\n");
            }
            VNLib.Log("\n");
        }
        
        VNLib.Log("\n");
        
        // Virtual line coordinates
        // var boxLineCoorJsonStr = VNLib.GetBoxLineCoordinates();
        // var boxLineData = JSON.parse(boxLineCoorJsonStr);
        // VNLib.Log("box line count:" + boxLineData.length + "\n");
        // for(var i = 0; i < boxLineData.length; i++) {
        //     var boxLinePointsArray = boxLineData[i]; // Virtual line coordinate array (2 endpoint coordinates)
        //     VNLib.Log("line" + i + ":\n");
        //     for(var j = 0; j < boxLinePointsArray.length; j++) {
        //         var point = boxLinePointsArray[j];
        //         VNLib.Log("point" + j + ":" +  "x " +  point.x + " y " + point.y + "\n");
        //     }
        //     VNLib.Log("\n");
        // }
        
        // VNLib.Log("\n");
        
        // Motion direction, 0: Left to right 1: Right to left 2: Top to bottom 3: Bottom to top
        var direction = VNLib.GetBoxDirection();
        VNLib.Log("direction:" + direction + "\n");
        
        // Check data validity
        if (!Array.isArray(roiData) || roiData.length < 2) {
            VNLib.Log("Error: ROI data format is incorrect or insufficient (at least 2 required)\n");
            return 0;
        }
        
        if (!Array.isArray(boxData) || boxData.length === 0) {
            VNLib.Log("Error: Box data is empty\n");
            return 0;
        }
        
        // if (!Array.isArray(boxLineData) || boxLineData.length === 0) {
        //     VNLib.Log("Error: Virtual line data is empty\n");
        //     return 0;
        // }
        
        // Calculate area for each ROI and filter invalid data
        var roiWithSize = [];
        for (var i = 0; i < roiData.length; i++) {
            var roi = roiData[i];
            if (!roi || typeof roi.index === 'undefined') {
                continue;
            }
            
            var area = calculateROIArea(roi);
            if (area > 0) {
                roiWithSize.push({
                    index: roi.index,
                    area: area
                });
            }
        }
        
        if (roiWithSize.length < 2) {
            VNLib.Log("Error: Insufficient valid ROIs (at least 2 required)\n");
            return 0;
        }
        
        // Sort by area (smallest first, largest last)
        roiWithSize.sort(function(a, b) {
            return a.area - b.area;
        });
        
        // Check if line segment intersects with rectangle
        function isLineIntersectBox(linePoints, boxPoints) {
            try {
                if (!linePoints || linePoints.length < 2 || !boxPoints || boxPoints.length < 4) {
                    return false;
                }
                
                var lineP1 = linePoints[0];
                var lineP2 = linePoints[1];
                
                // Check if line segment is valid (two points cannot be the same)
                if (!lineP1 || !lineP2 || 
                    (lineP1.x === lineP2.x && lineP1.y === lineP2.y)) {
                    return false;
                }
                
                // Check if coordinates are valid
                if (typeof lineP1.x !== 'number' || typeof lineP1.y !== 'number' ||
                    typeof lineP2.x !== 'number' || typeof lineP2.y !== 'number') {
                    return false;
                }
                
                // Calculate rectangle boundaries
                var minX = Math.min(boxPoints[0].x, boxPoints[1].x, boxPoints[2].x, boxPoints[3].x);
                var maxX = Math.max(boxPoints[0].x, boxPoints[1].x, boxPoints[2].x, boxPoints[3].x);
                var minY = Math.min(boxPoints[0].y, boxPoints[1].y, boxPoints[2].y, boxPoints[3].y);
                var maxY = Math.max(boxPoints[0].y, boxPoints[1].y, boxPoints[2].y, boxPoints[3].y);
                
                // Check if line segment endpoints are inside the rectangle
                function isPointInBox(point) {
                    if (!point || typeof point.x !== 'number' || typeof point.y !== 'number') {
                        return false;
                    }
                    return point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
                }
                
                if (isPointInBox(lineP1) || isPointInBox(lineP2)) {
                    return true;
                }
                
                // Check if line segment intersects with any of the four edges of the rectangle
                var boxEdges = [
                    [boxPoints[0], boxPoints[1]], // Top edge
                    [boxPoints[1], boxPoints[3]], // Right edge
                    [boxPoints[2], boxPoints[3]], // Bottom edge
                    [boxPoints[0], boxPoints[2]]  // Left edge
                ];
                
                for (var i = 0; i < boxEdges.length; i++) {
                    if (isLineSegmentIntersect(lineP1, lineP2, boxEdges[i][0], boxEdges[i][1])) {
                        return true;
                    }
                }
                
                return false;
            } catch (e) {
                VNLib.Log("Error checking line-rectangle intersection: " + e.message + "\n");
                return false;
            }
        }
        
        // Check if two line segments intersect
        function isLineSegmentIntersect(p1, p2, p3, p4) {
            function crossProduct(o, a, b) {
                return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
            }
            
            function onSegment(p, q, r) {
                return q.x <= Math.max(p.x, r.x) && q.x >= Math.min(p.x, r.x) &&
                       q.y <= Math.max(p.y, r.y) && q.y >= Math.min(p.y, r.y);
            }
            
            var d1 = crossProduct(p1, p2, p3);
            var d2 = crossProduct(p1, p2, p4);
            var d3 = crossProduct(p3, p4, p1);
            var d4 = crossProduct(p3, p4, p2);
            
            if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
                ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
                return true;
            }
            
            if (d1 === 0 && onSegment(p1, p3, p2)) return true;
            if (d2 === 0 && onSegment(p1, p4, p2)) return true;
            if (d3 === 0 && onSegment(p3, p1, p4)) return true;
            if (d4 === 0 && onSegment(p3, p2, p4)) return true;
            
            return false;
        }
        
        // Get box sort key based on motion direction (to determine "first" or "last")
        // Coordinate system: Top-left corner is (0,0), bottom-right corner is (width,height), all coordinates are positive
        function getBoxSortKey(boxPoints, direction) {
            // Calculate box center point
            var centerY = (boxPoints[0].y + boxPoints[1].y + boxPoints[2].y + boxPoints[3].y) / 4;
            var centerX = (boxPoints[0].x + boxPoints[1].x + boxPoints[2].x + boxPoints[3].x) / 4;
            
            // Determine sort key based on motion direction
            // 0: Left to right, 1: Right to left, 2: Top to bottom, 3: Bottom to top
            // "First" refers to the box encountered first in the motion direction
            switch(direction) {
                case 0: // Left to right, first = largest x value (rightmost, because rightmost is scanned first when moving left to right)
                    return -centerX; // Use negative value so larger values come first when sorting
                case 1: // Right to left, first = smallest x value (leftmost, because leftmost is scanned first when moving right to left)
                    return centerX;
                case 2: // Top to bottom, first = largest y value (bottommost, because bottommost is scanned first when moving top to bottom)
                    return -centerY; // Use negative value so larger values come first when sorting
                case 3: // Bottom to top, first = smallest y value (topmost, because topmost is scanned first when moving bottom to top)
                    return centerY;
                default:
                    return centerY;
            }
        }
        
        // Side scan mode: Check if the first box in motion direction intersects with virtual line
        VNLib.Log("Side scan mode: Check if first box intersects with virtual line\n");
        VNLib.Log("Motion direction: " + direction + " (0:Left to right, 1:Right to left, 2:Top to bottom, 3:Bottom to top)\n");
        
        // Sort boxes to find the first one (based on motion direction)
        // After sorting, the first element is the first box in the motion direction
        var sortedBoxes = boxData.slice().sort(function(a, b) {
            var keyA = getBoxSortKey(a, direction);
            var keyB = getBoxSortKey(b, direction);
            VNLib.Log("Sort comparison - boxA center: " + ((a[0].x + a[1].x + a[2].x + a[3].x) / 4).toFixed(2) + 
                      ", boxB center: " + ((b[0].x + b[1].x + b[2].x + b[3].x) / 4).toFixed(2) + 
                      ", keyA: " + keyA.toFixed(2) + ", keyB: " + keyB.toFixed(2) + "\n");
            return keyA - keyB;
        });
        
        var targetBox = sortedBoxes[0];
        var targetBoxCenterX = (targetBox[0].x + targetBox[1].x + targetBox[2].x + targetBox[3].x) / 4;
        VNLib.Log("Selected first box center X: " + targetBoxCenterX.toFixed(2) + "\n");
        VNLib.Log("Selected first box coordinates:\n");
        for (var j = 0; j < targetBox.length; j++) {
            VNLib.Log("point" + j + ": x=" + targetBox[j].x + ", y=" + targetBox[j].y + "\n");
        }

                // Construct four edges
        var edges = [
            [targetBox[0], targetBox[1]],
            [targetBox[1], targetBox[2]],
            [targetBox[2], targetBox[3]],
            [targetBox[3], targetBox[0]]
        ];

        var bestEdge = null;
        var bestScore = Infinity; // |dy| 越小越水平

        for (var i = 0; i < edges.length; i++) {
            var p1 = edges[i][0];
            var p2 = edges[i][1];

            var dx = p2.x - p1.x;
            var dy = p2.y - p1.y;

            var score = Math.abs(dy); // 越水平越小

            if (score < bestScore) {
                bestScore = score;
                bestEdge = [p1, p2];
            }
        }

        // Calculate Euclidean distance
        var a = bestEdge[0];
        var b = bestEdge[1];
        var edgeLength = Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y));

        // Output
        VNLib.Log("Most horizontal edge found between:\n");
        VNLib.Log("A: x=" + a.x + ", y=" + a.y + "\n");
        VNLib.Log("B: x=" + b.x + ", y=" + b.y + "\n");
        VNLib.Log("Edge length: " + edgeLength.toFixed(2) + "\n"); 

        var threshold = 2000;
        var hasIntersection = false;
        
        if (edgeLength > threshold) {
            hasIntersection = true;
        }
        
        // Check if the first box intersects with virtual line
        // var hasIntersection = false;
        // for (var i = 0; i < boxLineData.length; i++) {
        //     // Skip invalid virtual lines (two points are the same or empty)
        //     var line = boxLineData[i];
        //     if (!line || !Array.isArray(line) || line.length < 2) {
        //         VNLib.Log("Skip invalid virtual line " + i + "\n");
        //         continue;
        //     }
            
        //     var p1 = line[0];
        //     var p2 = line[1];
        //     if (!p1 || !p2 || (p1.x === p2.x && p1.y === p2.y)) {
        //         VNLib.Log("Skip invalid virtual line " + i + " (two points are the same)\n");
        //         continue;
        //     }
            
        //     if (isLineIntersectBox(line, targetBox)) {
        //         hasIntersection = true;
        //         VNLib.Log("Box intersects with virtual line " + i + "\n");
        //         break;
        //     }
        // }
        
        var selectedRoi;
        if (hasIntersection) {
            // Has intersection, use ROI2 (tall box, larger area)
            selectedRoi = roiWithSize[roiWithSize.length - 1];
            VNLib.Log("use ROI2 (tall box), index=" + selectedRoi.index + "\n");
        } else {
            // No intersection, use ROI1 (short box, smaller area)
            selectedRoi = roiWithSize[0];
            VNLib.Log("use ROI1 (short box), index=" + selectedRoi.index + "\n");
        }
    
        VNLib.Log("ROI1(Small, short box): index=" + roiWithSize[0].index + ", area=" + roiWithSize[0].area + "\n");
        VNLib.Log("ROI2(Large, tall box): index=" + roiWithSize[roiWithSize.length - 1].index + ", area=" + roiWithSize[roiWithSize.length - 1].area + "\n");
        VNLib.Log("Final selection: ROI index=" + selectedRoi.index + "\n");
        
        return parseInt(selectedRoi.index);
    } catch (e) {
        VNLib.Log("Callback function execution error: " + e.message + "\n");
        VNLib.Log("Error stack: " + (e.stack || "None") + "\n");
        // Return default value 0 (first ROI) on error
        return 0;
    }
}
    
    // Register callback function
    function RegisterCallback(){
     VNLib.RegisterCallback("SetRoiIndex",SetRoiIndex);
    }

