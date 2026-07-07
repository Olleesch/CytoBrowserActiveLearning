"use strict";
/**
 * Class for the polygon annotation overlay.
 **/

class PolygonLayer extends RegionLayer {
    _isMine(annotation) {
        return annotation.type === "polygon";
    }

    _applyVertexDrag(points, index, newPos) {
        Object.assign(points[index], newPos);
    }
}
