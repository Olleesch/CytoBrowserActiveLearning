"use strict";
/**
 * Class for the rectangle annotation overlay.
 **/

class RectangleLayer extends RegionLayer {
    _isMine(annotation) {
        return annotation.type === "rectangle";
    }

    // TODO: constrain to stay axis-aligned
    _applyVertexDrag(points, index, newPos) {
        Object.assign(points[index], newPos);
    }
}
