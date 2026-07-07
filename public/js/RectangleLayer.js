"use strict";
/**
 * Class for the rectangle annotation overlay.
 **/

class RectangleLayer extends RegionLayer {
    _isMine(annotation) {
        return annotation.type === "rectangle";
    }

    // Axis-constrained rectangle modification. Dragging a corner keeps the 
    // shape axis-aligned by leaving the diagonally opposite corner fixed and 
    // recomputing the other two corners from it and the new position.
    _applyVertexDrag(points, index, newPos) {
        const fixed = points[(index + 2) % 4];
        [(index + 1) % 4, (index + 3) % 4].forEach(j => {
            if (points[j].x === points[index].x) {
                Object.assign(points[j], {x: newPos.x, y: fixed.y});
            }
            else {
                Object.assign(points[j], {x: fixed.x, y: newPos.y});
            }
        });
        Object.assign(points[index], newPos);
    }
}
