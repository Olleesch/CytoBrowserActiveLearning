"use strict";
/**
 * Class for the oval annotation overlay.
 **/

class OvalLayer extends RegionLayer {
    _isMine(annotation) {
        return annotation.type === "oval";
    }

    _getRenderPoints(annotation) {
        return annotation.points;
    }

    // An oval is edited by modifying its three defining points: two major 
    // axis points and one minor axis point. The minor axis point (index 2)
    // is always constrained to the fixed center line between the major axis 
    // points. 
    _applyVertexDrag(points, index, newPos) {
        const [p0, p1, p2] = points;

        if (index === 2) {
            const center = {x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2};
            const ux = p1.x - p0.x, uy = p1.y - p0.y;
            const uLen = Math.hypot(ux, uy);
            if (uLen === 0) {
                Object.assign(p2, center);
                return;
            }
            const perpX = -uy / uLen, perpY = ux / uLen;
            const dist = (newPos.x - center.x) * perpX + (newPos.y - center.y) * perpY;
            p2.x = center.x + perpX * dist;
            p2.y = center.y + perpY * dist;
            return;
        }

        // Signed distance (and side) of the minor point relative to the
        // pre-drag axis, captured before the dragged endpoint moves.
        const oldCenter = {x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2};
        const oldUx = p1.x - p0.x, oldUy = p1.y - p0.y;
        const oldULen = Math.hypot(oldUx, oldUy);
        let minorDist = 0;
        if (oldULen !== 0) {
            const perpX = -oldUy / oldULen, perpY = oldUx / oldULen;
            minorDist = (p2.x - oldCenter.x) * perpX + (p2.y - oldCenter.y) * perpY;
        }

        Object.assign(points[index], newPos);

        const newCenter = {x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2};
        const newUx = p1.x - p0.x, newUy = p1.y - p0.y;
        const newULen = Math.hypot(newUx, newUy);
        if (newULen === 0) {
            Object.assign(p2, newCenter);
            return;
        }
        const perpX = -newUy / newULen, perpY = newUx / newULen;
        p2.x = newCenter.x + perpX * minorDist;
        p2.y = newCenter.y + perpY * minorDist;
    }

    // Renders the ellipse as two elliptical-arc (A) commands through the 2
    // major-axis endpoints (points[0]/points[1]) — a standard technique for
    // drawing a full ellipse boundary via SVG path arcs. large-arc-flag=1
    // is float-rounding insurance (both flag values are mathematically
    // equivalent here, since both arc endpoints are exact major-axis
    // vertices); sweep-flag must be the same value in both commands so the
    // two arcs trace complementary halves rather than retracing one half.
    _getRegionPath(annotation) {
        const pts = annotation.points.map(p => coordinateHelper.imageToOverlay(p));
        const [p0, p1] = pts;
        const {rx, ry, rotation} = mathUtils.ellipseParamsFromAxisPoints(pts);
        const rotDeg = rotation * 180 / Math.PI;
        return `M ${p0.x} ${p0.y} A ${rx} ${ry} ${rotDeg} 1 0 ${p1.x} ${p1.y} A ${rx} ${ry} ${rotDeg} 1 0 ${p0.x} ${p0.y} Z`;
    }
}
