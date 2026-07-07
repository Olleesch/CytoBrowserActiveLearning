"use strict";
/**
 * Class for the rectangle annotation overlay.
 **/

class RectangleLayer extends RegionLayer {
    _isMine(annotation) {
        return annotation.type === "rectangle";
    }

    // Axis-aligned rectangle edits. Rendering/edit handles use 4 derived corners
    // of the rectangle (see _getRenderPoints), 'index' refers to which corner is 
    // being dragged (not which point in the stored annotation is being modified). 
    _applyVertexDrag(points, index, newPos) {
        const [start, end] = points;
        switch (index) {
            case 0: Object.assign(start, newPos); break;
            case 1: start.x = newPos.x; end.y = newPos.y; break;
            case 2: Object.assign(end, newPos); break;
            case 3: end.x = newPos.x; start.y = newPos.y; break;
        }
    }

    _getRenderPoints(annotation) {
        return mathUtils.rectangleCornersFromDiagonal(annotation.points);
    }
}
