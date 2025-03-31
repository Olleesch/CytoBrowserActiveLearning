/**
 * Namespace for handling annotations. Deals with both the data
 * representation of the annotations and the graphical representation. All
 * manipulation of the annotations should go through this namespace's
 * functions to ensure that all necessary steps are performed.
 * @namespace annotationHandler
 */
const annotationHandler = (function (){
    "use strict";

    const timingLog=false; //Log add/update times

    /**
     * Data representation of an annotation that should be used when adding or
     * updating information about it. While all annotations that have already
     * been added will have an id property, it can optionally be included
     * when adding information about the annotation to force an id. The
     * same applies to the centroid of the annotation.
     * @typedef {Object} Annotation
     * @property {Array<Object>} points The x and y positions of each
     * point in the annotation; a single point if marker, multiple
     * if region.
     * @property {number} z Z value when the annotation was placed.
     * @property {Array<Object>} mclass Dict with class names of the annotation.
     * @property {Object} centroid The centroid of the annotated point
     * or region.
     * @property {Object} diameter The diameter of the annotation
     * @property {boolean} [bookmarked] Whether or not the annotation has
     * been bookmarked.
     * @property {Array} [comments] Comments associated with the annotation.
     * @property {string} [author] The name of the person who originally
     * placed the annotation.
     * @property {number} [id] Hard-coded ID of the annotation.
     * @property {number} [originalId] Original ID of annotation, that
     * may have had to be changed if the annotation was added when the
     * id was already in use.
     * @property {number} [prediction] Optional prediction score indicating
     * cancer probability.
     */
    /**
     * Representation of the OpenSeadragon coordinate system used to
     * represent a point. Should take on the values of "web", "viewport"
     * or "image". See more information about the different coordinate
     * systems {@link https://openseadragon.github.io/examples/viewport-coordinates/ |here.}
     * @typedef {string} CoordSystem
     */
    const _annotations = [];
    let _nMarkers = {};
    let _nRegions = {};
    let _annotationSetCounts = {};
    let _classCounts = {};
    let _hasPrediction = {};

    // Updates visuals with new annotation counts
    function updateAnnotationCounts() {
        // We only want to include annotations in the currently active annotation set
        const activeAnnotationSet = annotationSetHandler.getActiveAnnotationSet().name;
        globalDataHandler.updateAnnotationCounts(
            _nMarkers, 
            _nRegions, 
            _classCounts[activeAnnotationSet]
        );
        globalDataHandler.updateAnnotationSetCounts(_annotationSetCounts, _nMarkers, _nRegions, _classCounts);
    }

    // Restart annotation counts
    function _restartAnnotationCounts() {
        _nMarkers = {};
        _nRegions = {};
        _annotationSetCounts = {};
        _classCounts = {};

        // Set all counts to 0
        annotationSetHandler.forEachAnnotationSet(s => {
            _nMarkers[s.name] = 0;
            _nRegions[s.name] = 0;
            _annotationSetCounts[s.name] = 0;
            _classCounts[s.name] = {};
            if (s.classConfig.length === 0) {
                defaultClassConfig.forEach(c => _classCounts[s.name][c.name] = 0);
            }
            else {
                s.classConfig.forEach(c => _classCounts[s.name][c.name] = 0);
            }
        })

        // Count each annotation for each annotation
        _annotations.forEach(annotation => {
            const isMarker = annotation.points.length === 1;
            Object.entries(annotation.assignments).forEach(([s, a]) => {
                if (isMarker) {
                    _nMarkers[s]++;
                }
                else {
                    _nRegions[s]++;
                }
                _annotationSetCounts[s]++;
                _classCounts[s][a.mclass]++;
            });
        });

        // Update visuals with new annotation counts
        updateAnnotationCounts();
    }

    // Low-res array of arrays
    const _annotationGrid = []; 
    const _gridShift = 10; //2^n sized grid squares
    const _gridMax = 20-_gridShift; //at most (2^n)^2 grid squares
    // Add to _annotations and to _annotationGrid
    function _getGridIdx(annotation) {
        if (!annotation.points || !annotation.points.length) {
            console.error('Annotation without points[0]');
            return 0;
        }
        const p=annotation.points[0];
        if ((p.x>>_gridShift)>>_gridMax) {
            alert(`Too large x-coord ${p.x}, increase _gridMax`); 
        }
        return (p.y>>_gridShift)<<_gridMax | (p.x>>_gridShift);
    }
    function _addAnnotation(annotation) {
        const idx=_annotations.push(annotation);
        _addGridAnnotation(annotation);
        return idx;
    }
    function _addGridAnnotation(annotation) {
        const grid=_getGridIdx(annotation);
        _annotationGrid[grid] ?? (_annotationGrid[grid]=[]); //allow node<15.x
        _annotationGrid[grid].push(annotation);
    }
    //array of annotations in grid (not to be written to)
    function _getGridAnnotations(annotation) {
        const grid=_getGridIdx(annotation);
        return _annotationGrid[grid] ?? [];
    }
    function _removeGridAnnotation(annotation) {
        const grid = _getGridAnnotations(annotation);
        const gridIndex = grid.findIndex(x => x.id === annotation.id);
        grid.splice(gridIndex,1);
    }

    function _generateId() {
        const order = Math.ceil(Math.log10((1 + _annotations.length) * 100));
        const multiplier = Math.pow(10, order);
        let id;
        do {
            let seed = Math.random();
            id = Math.round(multiplier * seed);
        } while(getAnnotationById(id) !== undefined);
        return id;
    }

    function _cloneAnnotation(annotation, include_computables=true) {
        // A deep clone could also be done with jQuery.extend(true, {}, annotation)
        // But this explicit clone was over 10 times faster when tested
        // Make sure to remember to update it if fields are changed
        const clone = {
            points: annotation.points && annotation.points.map(point => {
                return {
                    x: point.x,
                    y: point.y
                };
            }),
            assignments: Object.fromEntries(Object.entries(annotation.assignments)),    // Q: Do this manually instead?
            comments: annotation.comments && annotation.comments.map(comment => {
                return {
                    author: comment.author,
                    body: comment.body
                };
            }),
            originalAuthor: annotation.originalAuthor,
            id: annotation.id,
            originalId: annotation.originalId
        };

        if (include_computables) { //and defaults
            Object.assign(clone,{
                centroid: annotation.centroid && {x: annotation.centroid.x, y: annotation.centroid.y},
                diameter: annotation.diameter
            });
        }
        return clone;
    }

    // true if same geometry
    function _pointsAreDuplicate(pointsA, pointsB) {
        if (pointsA.length !== pointsB.length)
            return false;

        return pointsA.every((pointA, index) => {
            const pointB = pointsB[index];
            return pointA.x === pointB.x && pointA.y === pointB.y;
        });
    }

    // Find annotations with identical points
    function _findDuplicatePoints(annotation) {
        return _getGridAnnotations(annotation).find(existingAnnotation => {
            return _pointsAreDuplicate(annotation.points, existingAnnotation.points)
        });
    }

    /**
     * Get an object with a given point's location expressed in all OSD
     * coordinate systems.
     * @param {Object} point The point to check.
     * @param {number} point.x The x coordinate of the point.
     * @param {number} point.y The y coordinate of the point.
     * @param {CoordSystem} coordSystem The coordinate system the point
     * is originally expressed with.
     * @returns {Object} An object with the properties "web", "viewport"
     * and "image" that describe the point in each coordinate system.
     */
    function _getCoordSystems(point, coordSystem) {
        let webPoint, viewportPoint, imagePoint;
        switch(coordSystem) {
            case "web":
                viewportPoint = coordinateHelper.webToViewport(point);
                imagePoint = coordinateHelper.webToImage(point);
                return {
                    web: {x: point.x, y: point.y},
                    viewport: {x: viewportPoint.x, y: viewportPoint.y},
                    image: {x: imagePoint.x, y: imagePoint.y}
                };
            case "viewport":
                webPoint = coordinateHelper.viewportToWeb(point);
                imagePoint = coordinateHelper.viewportToImage(point, true);
                return {
                    web: {x: webPoint.x, y: webPoint.y},
                    viewport: {x: point.x, y: point.y},
                    image: {x: imagePoint.x, y: imagePoint.y}
                };
            case "image":
                webPoint = coordinateHelper.imageToWeb(point);
                viewportPoint = coordinateHelper.imageToViewport(point);
                return {
                    web: {x: webPoint.x, y: webPoint.y},
                    viewport: {x: viewportPoint.x, y: viewportPoint.y},
                    image: {x: point.x, y: point.y}
                };
            default:
                throw new Error("Invalid OSD coordinate system specified.");
        }
    }

    /**
     * Generates a single prediction score
     * @returns {Object} null
     */
    function _generatePrediction() {
        return null
    }

    // Update visuals with new annotations
    function updateVisuals() {
        annotationVisuals.update(_annotations);
    }

    /**
     * Add annotations to the data.
     * @param {Annotation|Array<Annotation>} annotations A data representation of the annotation.
     * @param {CoordSystem} [coordSystem="web"] Coordinate system used by the annotation.
     * @param {boolean} [transmit=true] Any collaborators should also be
     * told to add the annotation.
     */
    function add(annotations, coordSystem="web", transmit = true) {
        // let once=false;  //Q: Why once?
        if (!Array.isArray(annotations)) {
            annotations = [annotations];
        }

        console.log(`Adding ${annotations.length} annotations...`);
        timingLog && console.time('addAnnotation');
        
        annotations.forEach(annotation => {
            const addedAnnotation = _cloneAnnotation(annotation);
            
            if (Object.keys(addedAnnotation.assignments).length === 0) {
                console.warn("Cannot add annotation that does not belong to any annotation set (has no class).");
                return;
            }
            
            // Store the coordinates in all systems and set the image coordinates
            const coords = addedAnnotation.points.map(point =>
                _getCoordSystems(point, coordSystem)
            );
            if (coordSystem !== "image")
                addedAnnotation.points = coords.map(coord => coord.image);
            if (!addedAnnotation.points.every(coordinateHelper.pointIsInsideImage)) {
                console.warn("Cannot add an annotation with points outside the image.");
                return;
            }

            // Check if there exists an annotation at the same point
            const overlappingAnnotation = _findDuplicatePoints(addedAnnotation);
            
            // Check every assigned class for the new annotation
            for (const [annotationSetName, newAssignment] of Object.entries(addedAnnotation.assignments)) {
                // Get classes from annotationSetConfig
                let classes = Object.values(annotationSetHandler.getAnnotationSetConfig().find(annotationSet => {
                    return annotationSet.name === annotationSetName;
                }).classConfig.map(mclass => mclass.name));
                
                // If annotationSetConfig contains empty classConfig, we get the classes from the default config
                if (classes.length === 0) {
                    classes = defaultClassConfig.map(mclass => mclass.name);
                }
                
                // Make sure the new class is included in the classConfig for that annotation set
                if (!(classes.includes(newAssignment.mclass))) {
                    console.warn("Cannot add an annotation with unrecognised/incompatible class.");
                    return;
                }

                // Set the bookmark field of the annotation assignment
                if (newAssignment.bookmarked === undefined)
                    newAssignment.bookmarked = false;
                
                // Set the author of the annotation assignment
                if (newAssignment.author === undefined)
                    newAssignment.author = userInfo.getName();
                
                // Set the prediction score if the annotation assignment
                if (newAssignment.prediction === undefined) {
                    newAssignment.prediction = _generatePrediction();
                } 

                if (overlappingAnnotation) {
                    // Check if the overlapping annotation has a class in the annotation set of the new annotation
                    if (annotationSetName in overlappingAnnotation.assignments) {
                        console.warn(`Adding annotation(s) with identical properties as existing one in set \
                            ${annotationSetName}, ignoring.`);
                        // changed from update to ignore, since on fast updates we could run into partial updates
                        // update(replacedAnnotation.id, addedAnnotation, coordSystem, false, false);
                        // The choice to ignore a conflicting addition was there previously /Olle
                    }
                    // If the overlapping annotation does not have a class in the annotation set of the new annotation, add it
                    else {
                        overlappingAnnotation.assignments[annotationSetName] = Object.fromEntries(Object.entries(newAssignment));

                        // Update class/annotation set counts 
                        if (addedAnnotation.points.length === 1) {
                            _nMarkers[annotationSetName]++;
                        }
                        else {
                            _nRegions[annotationSetName]++;
                        }
                        _annotationSetCounts[annotationSetName]++;
                        _classCounts[annotationSetName][newAssignment.mclass]++;
                        updateAnnotationCounts();

                        // Update hasPrediction value
                        _hasPrediction[annotationSetName] = _hasPrediction[annotationSetName] || newAssignment.prediction != null;
                    }
                }
            }

            // If there does not already exist an annotation at the same point, we add the entire annotation
            if (!overlappingAnnotation) {
                // Make sure the annotation has an id
                if (addedAnnotation.id === undefined) {
                    addedAnnotation.id = _generateId();
                }
                else {
                    // If the id has been specified, check if it's not taken
                    const existingAnnotation = getAnnotationById(addedAnnotation.id);
                    if (existingAnnotation !== undefined) {
                        console.info("Tried to assign an already-used id, reassigning.");
                        addedAnnotation.originalId === undefined && (addedAnnotation.originalId = addedAnnotation.id);
                        addedAnnotation.id = _generateId();
                    }
                }

                // Set the centroid of the annotation
                if (!addedAnnotation.centroid)
                    addedAnnotation.centroid = mathUtils.getCentroid(addedAnnotation.points);

                // Set the diameter of the annotation
                if (!addedAnnotation.diameter)
                    addedAnnotation.diameter = mathUtils.getDiameter(addedAnnotation.points);

                // Set the original author of the annotation
                if (!addedAnnotation.originalAuthor)
                    addedAnnotation.originalAuthor = userInfo.getName();

                // Store a data representation of the annotation
                _addAnnotation(addedAnnotation);

                Object.entries(addedAnnotation.assignments).forEach(([annotationSetName, newAssignment]) => {
                    // Update class/annotation set counts (iterate through each annotation set of the added annotation classes)
                    if (addedAnnotation.points.length === 1) {
                        _nMarkers[annotationSetName]++;
                    }
                    else {
                        _nRegions[annotationSetName]++;
                    }
                    _annotationSetCounts[annotationSetName]++;
                    _classCounts[annotationSetName][newAssignment.mclass]++;

                    // Update hasPrediction value
                    _hasPrediction[annotationSetName] = _hasPrediction[annotationSetName] || newAssignment.prediction != null;
                });
                updateAnnotationCounts();
            }

            // Send the update to collaborators
            transmit && collabClient.addAnnotation(addedAnnotation);
        });
        timingLog && console.timeEnd('addAnnotation');

        // Add a graphical representation of the annotation
        updateVisuals();
    }

    /**
     * Update the parameters of an already existing annotation.
     * @param {number} id The initial id of the annotation to be updated.
     * @param {Annotation} annotation The new values for the annotation to be updated.
     * @param {CoordSystem} [coordSystem="web"] Coordinate system used by the annotation.
     * @param {boolean} [transmit=true] Any collaborators should also be
     * told to update their annotation.
     */
    function update(id, annotation, coordSystem="web", transmit = true, redraw = true) {
        console.log(`Updating 1 annotations...`);
        timingLog && console.time('updateAnnotation');

        const activeAnnotationSetName = annotationSetHandler.getActiveAnnotationSet().name;

        // Get the annotation to update
        const updatedAnnotation = getAnnotationById(id);

        // Check if the annotation being updated exists first
        if (updatedAnnotation === undefined) {
            throw new Error("Tried to update an annotation that doesn't exist.");
        }

        // If the id is being changed, check if it's not taken
        if (annotation.id !== undefined && annotation.id !== id) {
            const existingAnnotation = getAnnotationById(annotation.id);
            if (existingAnnotation !== undefined) {
                console.info("Tried to assign an already-used id, keeping old id.");
                annotation.originalId = annotation.id;
                annotation.id = id;
            }
        }

        // Make sure the data is stored in the image coordinate system
        const coords = updatedAnnotation.points.map(point =>
            _getCoordSystems(point, coordSystem)
        );
        if (coordSystem !== "image")
            updatedAnnotation.points = coords.map(coord => coord.image);

        // Keep the annotation inside the image
        if (annotation.points && !annotation.points.every(coordinateHelper.pointIsInsideImage)) {
            console.warn("Cannot move an annotation outside the image.");
            return;
        }

        // Don't edit a region to intersect itself
        if (mathUtils.pathIntersectsSelf(annotation.points)) {
            console.warn("Cannot make a region intersect itself.");
            return;
        }

        // At the moment, moving an annotation from one set to another in update() is not allowed. 
        // So, we check that the keys of the assignments are the same before and after update
        if (JSON.stringify(Object.keys(annotation.assignments).sort()) !== JSON.stringify(Object.keys(updatedAnnotation.assignments).sort())) {
            console.warn("Moving an annotation from one annotation set to another in the update function is currently not allowed.");
            return;
        }

        // Update class/annotation counts and hasPrediction
        // Q: Right now the annotation count is updated even if the annotation classes haven't changed, 
        // this is ok because it just adds then subtracts right?
        Object.entries(annotation.assignments).forEach(([annotationSetName, assignment]) => {
            _classCounts[annotationSetName][assignment.mclass]++;
            _hasPrediction[annotationSetName] = _hasPrediction[annotationSetName] || (assignment.prediction != null)
        });
        Object.entries(updatedAnnotation.assignments).forEach(([annotationSetName, assignment]) => {
            _classCounts[annotationSetName][assignment.mclass]--;
        });
        updateAnnotationCounts();

        // Check if changing grid square
        const oldGridIndex = _getGridIdx(updatedAnnotation);      

        // Copy over the updated properties
        Object.assign(updatedAnnotation, annotation);
        const newGridIndex = _getGridIdx(updatedAnnotation);

        // Set the centroid of the annotation
        updatedAnnotation.centroid = mathUtils.getCentroid(updatedAnnotation.points);

        // Set the diameter of the annotation
        updatedAnnotation.diameter = mathUtils.getDiameter(updatedAnnotation.points);

        // Store the annotation in data
        const updatedIndex = _annotations.findIndex(annotationx => annotationx.id === id);
        if (newGridIndex !== oldGridIndex) {
            // console.log(`Moving from idx ${oldGridIndex} to ${newGridIndex}`);
            _removeGridAnnotation(_annotations[updatedIndex]);
        }
        Object.assign(_annotations[updatedIndex], updatedAnnotation);
        if (newGridIndex !== oldGridIndex) {
            _addGridAnnotation(_annotations[updatedIndex]);
        }

        // Send the update to collaborators
        transmit && collabClient.updateAnnotation(id, updatedAnnotation);

        // Update the annotation in the graphics
        redraw && updateVisuals();
        timingLog && console.timeEnd('updateAnnotation');
    }

    /**
     * Set the bookmark state of a given annotation.
     * @param {number} id The id of the annotation to set the bookmark state of.
     * @param {boolean} [state] The bookmark state to set the annotation
     * to. If left undefined, the bookmark state will be changed to whichever
     * value it does not currently have.
     * @returns {boolean} Whether or not the annotation is now bookmarked.
     */
    function setBookmarked(id, annotationSetName, state) {
        const annotation = getAnnotationById(id);
        if (annotation) {
            if (state === undefined) {
                annotation.assignments[annotationSetName].bookmarked = !annotation.assignments[annotationSetName].bookmarked;
            }
            else {
                annotation.assignments[annotationSetName].bookmarked = state;
            }
            update(id, annotation, "image");
            return annotation.assignments[annotationSetName].bookmarked;
        }
        else {
            throw new Error("Tried to bookmark an annotation that doesn't exist.");
        }
    }

    /**
     * Remove an, or a list of, annotation(s) from the data.
     * @param {number|Array<number>} ids The id(s) of the annotation to be removed.
     * @param {string} annotationSetName The name of the annotation set to remove the annotation from.
     * @param {boolean} [transmit=true] Any collaborators should also be
     * told to remove the annotation.
     */
    function remove(ids, annotationSetName, transmit = true) {
        if (!Array.isArray(ids)) {
            ids = [ids];
        }
        // console.log('rmv: ',ids);
        ids.forEach(id => {
            const annotations = _annotations;
            const deletedIndex = annotations.findIndex(annotation => annotation.id === id);
            let removedAnnotation;

            // Check if the annotation exists first (annotation with ID exists and 
            // has an annotation in the annotation set)
            if (deletedIndex === -1 || !(annotationSetName in annotations[deletedIndex].assignments)) {
                throw new Error("Tried to remove an annotation that doesn't exist");
            }

            // Get the class of the removed annotation (only to update annotation counts)
            const removedAssignment = annotations[deletedIndex].assignments[annotationSetName];
            
            // Check if the annotation contains classes in multiple annotation sets
            // If the annotation is only included in one annotation set, remove the entire annotation
            if (Object.keys(annotations[deletedIndex].assignments).length === 1) {
                // Remove the annotation from the data
                removedAnnotation = annotations.splice(deletedIndex, 1)[0];
                // Remove from gridd
                _removeGridAnnotation(removedAnnotation);
            } 
            // If the annotation contains classes in multiple sets, only remove the class entry 
            // for the annotation set in question, keep the rest of it
            else {
                // Remove the entry of the annotation set in question from mclass
                removedAnnotation = annotations[deletedIndex];
                delete annotations[deletedIndex].assignments[annotationSetName];
            }
            
            // Update the class/annotation counts
            if (removedAnnotation.points.length === 1) {
                _nMarkers[annotationSetName]--;
            }
            else {
                _nRegions[annotationSetName]--;
            }
            _annotationSetCounts[annotationSetName]--;
            _classCounts[annotationSetName][removedAssignment.mclass]--;
            updateAnnotationCounts();

            // Send the update to collaborators
            transmit && collabClient.removeAnnotation(id, annotationSetName);
            regionEditor.stopEditingRegionIfBeingEdited(id);
        });

        // Remove the annotation from the graphics
        updateVisuals();
    }

    /**
     * Remove all annotations from an annotation set.
     * @param {string} annotationSetName The name of the annotation set to clear.
     * @param {boolean} [transmit=true] Any collaborators should also
     * be told to clear their annotations.
     */
    function clear(annotationSetName, transmit = true) {
        const annotations = _annotations;

        // Get ids of annotations in the annotation set in question
        const ids = annotations.filter(annotation => annotationSetName in annotation.assignments)
            .map(annotation => annotation.id);

        // Remove the annotation from the annotation set for all annotation ids found
        remove(ids, annotationSetName, false);

        // Send the update to collaborators
        transmit && collabClient.clearAnnotations(annotationSetName);
    }

    /**
     * Remove all annotations from the data. 
     */
    function clearAll() {
        _annotations.length = 0;
        _annotationGrid.length = 0;
        _restartAnnotationCounts();
        annotationVisuals.clear();
    }

    /**
     * Rename a specific mclass key (annotation set name).
     * @param {string} prevName The previous class key name.
     * @param {string} newName The new class key name.
     * @param {boolean} [transmit=true] Any collaborators should also
     * be told to rename the class key.
     */
    function renameAssignmentKey(prevName, newName, transmit = true) {
        // Update key in counts (Right now this first step is completely unnecessary 
        // as the annoation counts are reset after regardless, but in the future this
        // should be fixed)
        _nMarkers[newName] = _nMarkers[prevName];
        delete _nMarkers[prevName];
        _nRegions[newName] = _nRegions[prevName];
        delete _nRegions[prevName];
        _annotationSetCounts[newName] = _annotationSetCounts[prevName];
        delete _annotationSetCounts[prevName];
        _classCounts[newName] = _classCounts[prevName];
        delete _classCounts[prevName];
        _hasPrediction[newName] = _hasPrediction[prevName];
        delete _hasPrediction[prevName];
        
        // Update key in each annotation
        _annotations.forEach(annotation => {
            if (prevName in annotation.assignments) {
                annotation.assignments[newName] = Object.fromEntries(Object.entries(annotation.assignments[prevName]));
                delete annotation.assignments[prevName];
            }
        });
        
        // Notify collaborators
        transmit && collabClient.renameAnnotationAssignmentKey(prevName, newName);
    }

    /**
     * Iterate a function for each annotation. The function will not change
     * the values of the annotation, and will instead work on clones of them,
     * effectively making them read-only. If the annotation values should be
     * updated, update() can be run in the passed function.
     * @param {function} f Function to be called with each annotation.
     */
    function forEachAnnotation(f, include_computable=true) {
        _annotations.map((elem) => _cloneAnnotation(elem,include_computable)).forEach(f);
    }

    /**
     * Get a copy of a specified annotation by its id.
     * @param {number} id The id used for looking up the annotation.
     * @returns {Object} A clone of the annotation with the specified id,
     * or undefined if not in use.
     * 
     * Currently O(N) slow, so don't overuse!
     */
    //let gaid=0; 
    function getAnnotationById(id) {
        const annotation = _annotations.find(annotation => annotation.id === id);
        if (annotation === undefined) {
            return undefined;
        }
        const annotationClone = _cloneAnnotation(annotation);
    //    console.log(`gaid: ${gaid++}`);
        return annotationClone;
    }

    /**
     * Check whether or not the list of annotations is empty.
     * @returns {boolean} Whether or not the list is empty.
     */
    function isEmpty() {
        return _annotations.length === 0;
    }

    /**
     * Check whether or not the an annotation set is empty.
     * @param {string} annotationSetName The name of the annotation set to check.
     * @returns {boolean} Whether or not the annotation set is empty.
     */
    function isEmptySet(annotationSetName) {
        return _annotations.some(annotation => annotationSetName in annotation.assignments);
    }

    /**
     * Called for each row, so should be fast
     */
    function hasPrediction(annotationSetName) {
        return _hasPrediction[annotationSetName];
    }

    /**
     * Restart the annotation counts
     */
    function resetAnnotationCounts() {
        _restartAnnotationCounts();
    }

    // Return public members of the closure
    return {
        updateVisuals,
        add,
        update,
        setBookmarked,
        remove,
        clear,
        clearAll,
        renameAssignmentKey,
        forEachAnnotation,
        getAnnotationById,
        isEmpty,
        isEmptySet,
        hasPrediction,
        resetAnnotationCounts,
        updateAnnotationCounts
    };
})();
