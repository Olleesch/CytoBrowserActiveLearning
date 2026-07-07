/**
 * Utility functions for useful mathematical computations.
 *
 * @namespace mathUtils
 */
 const mathUtils = (function() {
    "use strict";

    // Functions below are used for checking of a polygon intersects
    // itself. This is done by iterating through each pair of line segments
    // that makes up the polygon and checking if intersecting any other.

    /**
     * Check whether two line segments intersect
     */
    // Modified from https://jsfiddle.net/ferrybig/eokwL9mp/  
    // Via https://stackoverflow.com/questions/563198/how-do-you-detect-where-two-line-segments-intersect/1201356#1201356
    function _segsIntersect(a, b) {
        const h1 = _computeH(a[0],a[1],b[0],b[1]);
        if (h1 < 0 || h1 > 1) return false;
        const h2 = _computeH(b[0],b[1],a[0],a[1]);
        return h2 >= 0 && h2 <= 1;
    }
    // Subroutine of _segsIntersect
    function _computeH(a, b, c, d) {
        // E = B-A = ( Bx-Ax, By-Ay )
        const e = {x: b.x-a.x, y: b.y-a.y }
        // F = D-C = ( Dx-Cx, Dy-Cy ) 
        const f = {x: d.x-c.x, y: d.y-c.y }
        // P = ( -Ey, Ex )
        const p = {x: -e.y, y: e.x}
        
        // h = ( (A-C) * P ) / ( F * P )
        const intersection = f.x*p.x+f.y*p.y;
        if(intersection === 0) {
            // Parallel lines
            return NaN;
        }
        return ( (a.x - c.x) * p.x + (a.y - c.y) * p.y) / intersection;
    }

     /**
      * Check whether or not a 2D path intersects itself.
      * @param {Array<Object>} points An array of points that define
      * the path. Each point is an object that should have x and y
      * coordinates defined.
      * @param {boolean} [closed=true] Whether or not there is an edge
      * between the last and the first point of the path.
      * @returns Whether or not the path intersects itself.
      */
     function pathIntersectsSelf(points, closed=true) {
         const endpoints = closed ? [...points, points[0]] : [...points];
         const segs = endpoints.slice(0, -1).map((p, i) => {
             return [
                 {x: p.x, y: p.y},
                 {x: endpoints[i + 1].x, y: endpoints[i + 1].y}
             ];
         });
         const noIntersections = segs.every((p1, i) => { //Don't check consecutive segment (shared vertex)
            return segs.slice(i + 2, i+segs.length-closed).every(p2 => !_segsIntersect(p1, p2));
         });
         return !noIntersections;
     }

    function _sqrDist(a,b) {
        const x = a.x - b.x;
        const y = a.y - b.y;
        return x*x + y*y;
    }

    /**
     * Derive the 4 corners of a rectangle from its 2 diagonal points. 
     * @param {Array<Object>} points The 2 diagonal points, [start, end].
     * @returns {Array<Object>} The 4 corners (new objects, not references).
     */
    function rectangleCornersFromDiagonal(points) {
        // Not a supported dual-format, just a safety net for any pre-existing
        // local dev/test data with old-style 4-point rectangles.
        if (points.length === 4)
            return points;
        const [start, end] = points;
        return [
            {x: start.x, y: start.y},
            {x: start.x, y: end.y},
            {x: end.x, y: end.y},
            {x: end.x, y: start.y}
        ];
    }

    /**
     * Derive an ellipse's center, radii, and rotation from its 3 stored
     * points: 2 major-axis endpoints plus 1 minor-axis endpoint.
     * @param {Array<Object>} points [majorP0, majorP1, minorP].
     * @returns {Object} {center, rx, ry, rotation}. rotation is in radians.
     */
    function ellipseParamsFromAxisPoints(points) {
        const [A, B, M] = points;
        const center = {x: (A.x + B.x) / 2, y: (A.y + B.y) / 2};
        const ux = B.x - A.x, uy = B.y - A.y;
        const rx = Math.hypot(ux, uy) / 2;
        // Perpendicular distance from M to line AB, robust to any slight
        // off-axis drift in M rather than amplifying it (unlike |M-center|).
        const ry = rx === 0 ? 0 : Math.abs(ux * (M.y - A.y) - uy * (M.x - A.x)) / (2 * rx);
        const rotation = Math.atan2(uy, ux);
        return {center, rx, ry, rotation};
    }

    // Type-specific centroid/diameter implementations, one explicit entry
    // per known annotation type. A type without an entry here should throw
    // an error.
    const _centroidByType = {
        marker: points => points[0],
        rectangle: points => ({
            x: (points[0].x + points[1].x) / 2,
            y: (points[0].y + points[1].y) / 2
        }),
        // Oval's centroid is the midpoint of its 2 major-axis endpoints (the
        // true ellipse center); points[2] (the minor-axis point) is unused.
        oval: points => ({
            x: (points[0].x + points[1].x) / 2,
            y: (points[0].y + points[1].y) / 2
        }),
        // Wikipedia says this won't work with self-intersections
        // https://en.wikipedia.org/wiki/Centroid#Of_a_polygon
        polygon: points => {
            const loop = [...points, points[0]];
            let area = 0;
            let cx = 0;
            let cy = 0;
            loop.reduce((a, b) => {
                const areaTerm = (a.x * b.y) - (b.x * a.y);
                area += areaTerm;
                cx += (a.x + b.x) * areaTerm;
                cy += (a.y + b.y) * areaTerm;
                return b;
            });
            area /= 2;
            cx /= (6 * area);
            cy /= (6 * area);
            return {x: cx, y: cy};
        }
    };
    const _diameterByType = {
        marker: () => 0,
        rectangle: points => Math.sqrt(_sqrDist(points[0], points[1])),
        // Major-axis length (distance between the 2 major-axis endpoints);
        // points[2] (the minor-axis point) is unused.
        oval: points => Math.sqrt(_sqrDist(points[0], points[1])),
        //Approximate!
        polygon: points => {
            let changed;
            let sqrDiam=0;
            let newRef;
            let ref=points[0];
            do {
                changed=false;
                points.forEach(element => {
                    let d=_sqrDist(ref,element);
                    if (d>sqrDiam) {changed=true;sqrDiam=d;newRef=element;}
                });
                ref=newRef;
            } while (changed);
            return Math.sqrt(sqrDiam);
        }
    };

    /**
     * Compute the centroid of an annotation by its type.
     * @param {Object} annotation The annotation.
     * @returns {Object} The centroid.
     */
    function getAnnotationCentroid(annotation) {
        return _centroidByType[annotation.type](annotation.points);
    }

    /**
     * Compute the diameter of an annotation by its type.
     * @param {Object} annotation The annotation.
     * @returns {number} The diameter.
     */
    function getAnnotationDiameter(annotation) {
        return _diameterByType[annotation.type](annotation.points);
    }

    return {
        pathIntersectsSelf,
        rectangleCornersFromDiagonal,
        ellipseParamsFromAxisPoints,
        getAnnotationCentroid,
        getAnnotationDiameter
    };
})();
