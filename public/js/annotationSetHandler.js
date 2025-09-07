/**
 * Namespace for handling annotation sets. All manipulation of the annotation 
 * sets should go through this namespace's functions to ensure that all necessary 
 * steps are performed.
 * @namespace annotationSetHandler
 */
const annotationSetHandler = (function(){
    "use strict";

    // ==== Class config functions ====

    /**
     * Information for a specific class from the class configuration, including
     * information about its visual representation in the user interface.
     * @typedef {Object} MClass
     * @property {string} name The abbreviated name of the class.
     * @property {string} description The extended description of the
     * class name.
     * @property {string} color The color used to represent the class.
     */

    /**
     * Get the class config of the active annotation set (active class config).
     * @returns {Array<MClass>} The active class config.
     */
    function getActiveClassConfig() {
        return _activeClassConfig;
    }

    /**
     * Set the active class config based on the active annotation set.
     */
    function setActiveClassConfig() {
        const updatedClassConfig = _activeAnnotationSet.classConfig;
        if (updatedClassConfig !== undefined && updatedClassConfig.length >= 1) {
            _activeClassConfig = updatedClassConfig;
        }
        else {
            _activeClassConfig = defaultClassConfig;
        }
        tmappUI.updateClassSelectionButtons();
    }

    /**
     * Get an active class based on its id.
     * @param {number} id The id of the sought class.
     * @returns {MClass} The class with the corresponding id.
     */
    function getClassFromID(id) {
        return _activeClassConfig[id];
    }

    /**
     * Get the id of an active class based on its name.
     * @param {string} name The name of the class.
     * @returns {number} The id of the class.
     */
    function getIDFromClassName(name) {
        return _activeClassConfig.findIndex((entry) => name == entry.name);
    }

    /**
     * Get the color assigned for a given active class.
     * @param {number|string} idOrName Either the id of the given class
     * or its name.
     * @returns {string} An RGB hex representation of the color.
     */
    function classColor(idOrName) {
        let id = idOrName;
        if (typeof(id) === "string") {
            id = getIDFromClassName(idOrName);
        }
        return _activeClassConfig[id].color;
    }

    /**
     * Execute a function with each active class as an argument.
     * @param {Function} f The function to be executed with the classes.
     */
    function forEachClass(f) {
        _activeClassConfig.forEach(f);
    }


    // ==== Annotation set config functions ====

    /**
     * Information for a specific set from the annotation set configuration, including
     * its name, description, and class configuration. 
     * @typedef {Object} AnnotationSet
     * @property {string} name The name of the annotation set.
     * @property {string} description The extended description of the
     * annotation set.
     * @property {Array<MClass>} classConfig The class configuration of the annotation 
     * set.
     * @property {string} [author] The author of the annotation set.
     * @property {string} [createdOn] The time the annotation set was created. 
     */

    /**
     * Get the current annotation set config.
     * @returns {Array<AnnotationSet>} The active annotation set config.
     */
    function getAnnotationSetConfig() {
        return _annotationSetConfig;
    }

    /**
     * Set the annotation set config.
     * @param {Array<AnnotationSet>} updatedAnnotationSetConfig The new annotation set config.
     */
    function setAnnotationSetConfig(updatedAnnotationSetConfig) {
        // If the updated annotaion set config is not valid, use the default annotation set config
        if (updatedAnnotationSetConfig !== undefined && updatedAnnotationSetConfig.length >= 1) {
            _annotationSetConfig = updatedAnnotationSetConfig;
        }
        else {
            // Q: Better way?
            _annotationSetConfig = [];
            Object.assign(_annotationSetConfig, defaultAnnotationSetConfig);
            _annotationSetConfig[0].author = userInfo.getName();
            _annotationSetConfig[0].createdOn = dateUtils.getCurrentTimeAsString();
        }

        // If the active annotation set is not in the new annotation set config, 
        // set the first annotation set to active.
        if (!(_annotationSetConfig.some(annotationSet => annotationSet.name === _activeAnnotationSet.name))) {
            setActiveAnnotationSet(getAnnotationSetFromID(0).name);
        }

        // Update interface and counts
        tmappUI.updateAnnotationSetSelectionButtons(getIDFromAnnotationSetName(_activeAnnotationSet.name));
        tmappUI.updateAnnotationSetData();
        htmlHelper.updateLockedAnnotationSetButtonDisplays();
        annotationHandler.resetAnnotationCounts();
        annotationHandler.updateVisuals();
    }

    /**
     * Get the active annotation set.
     * @returns {AnnotationSet} The active annotation set.
     */
    function getActiveAnnotationSet() {
        return _activeAnnotationSet;
    }

    /**
     * Update the active annotation set to a specified one.
     * @param {string} annotationSetName The name of the new active annotation set.
     */
    function setActiveAnnotationSet(annotationSetName) {
        // Get the annotation set with the name of the new active set.
        const activeAnnotationSet = _annotationSetConfig.find(annotationSet => annotationSet.name === annotationSetName);
        if (activeAnnotationSet !== undefined) {
            // Update the active annotation set and class config.
            _activeAnnotationSet = activeAnnotationSet;
            setActiveClassConfig();
            // Update annotation list
            tmappUI.updateAnnotationList();
            // Update member to record active annotation set
            collabClient.updateMemberActiveAnnotationSet(_activeAnnotationSet.name);
            // Update annotation visuals and counts
            annotationHandler.resetAnnotationCounts();
            annotationHandler.updateVisuals();
            // Set the active annotation set as selected by the annotation set buttons (this is only required to display
            // the correct selection after things like reconnect, when the state is alive but the buttons are reset)
            htmlHelper.setSelectedAnnotationSetSelectionButton(_activeAnnotationSet.name);
            // If the new active set is locked, indicate that rename and remove options are disabled
            htmlHelper.updateLockedAnnotationSetButtonDisplays();
            console.log(`Switched active annotation set to ${_activeAnnotationSet.name}`);
        }
        else {
            console.warn(`Cannot switch active annotation set to undefined.`);
        }
    }

    /**
     * Get an annotation set based on its id.
     * @param {number} id The id of the sought annotation set.
     * @returns {AnnotationSet} The annotation set with the corresponding id.
     */
    function getAnnotationSetFromID(id) {
        return _annotationSetConfig[id];
    }

    /**
     * Get the id of an annotation set based on its name.
     * @param {string} name The name of the annotation set.
     * @returns {number} The id of the annotation set.
     */
    function getIDFromAnnotationSetName(name) {
        return _annotationSetConfig.findIndex((entry) => name == entry.name);
    }

    /**
     * Execute a function with each annotation set as an argument.
     * @param {Function} f The function to be executed with the annotation sets.
     */
    function forEachAnnotationSet(f) {
        _annotationSetConfig.forEach(f);
    }


    // ==== Collaborative functions ====

    // To keep track of annotation set configs
    let _annotationSetConfig = defaultAnnotationSetConfig;
    let _activeAnnotationSet = defaultAnnotationSetConfig[0];
    let _activeClassConfig = defaultClassConfig;
    let _lockedAnnotationSets = [];

    /**
     * Check if an annotation set is locked. 
     * @param {string} annotationSetName The name of the annotation set to check.
     * @returns {boolean} Whether the annotation set is locked or not. 
     */
    function isLockedAnnotationSet(annotationSetName) {
        return _lockedAnnotationSets.some(a => a.annotationSetName === annotationSetName);
    }

    /**
     * Lock a specified annotation set.
     * @param {string} annotationSetName The name of the annotation set to lock.
     * @param {string} reason The reason the annotation set was locked.
     * @param {boolean} [transmit=true] Any collaborators should also be
     * told to lock the annotation set.
     */
    function lockAnnotationSet(annotationSetName, reason, transmit = true) {
        if (isLockedAnnotationSet(annotationSetName)) {
            console.warn(`Tried to lock already locked annotation set ${annotationSetName}, ignoring`);
            return;
        }
        _lockedAnnotationSets.push({
            annotationSetName: annotationSetName,
            reason: reason
        });
        htmlHelper.updateLockedAnnotationSetButtonDisplays();
        transmit && collabClient.lockAnnotationSet(annotationSetName, reason);
    }

    /**
     * Unlock a specified annotation set. 
     * @param {string} annotationSetName The name of the annotation set to unlock. 
     * @param {boolean} [transmit=true] Any collaborators should also be
     * told to unlock the annotation set.
     */
    function unlockAnnotationSet(annotationSetName, transmit = true) {
        if (!isLockedAnnotationSet(annotationSetName)) {
            console.warn(`Tried to unlock already unlocked annotation set ${annotationSetName}, ignoring`);
            return;
        }
        _lockedAnnotationSets = _lockedAnnotationSets.filter(a => a.annotationSetName !== annotationSetName);
        htmlHelper.updateLockedAnnotationSetButtonDisplays();
        transmit && collabClient.unlockAnnotationSet(annotationSetName);
    }

    /**
     * Get the locked annotation sets of the session.
     * @returns {Array<Object>} The locked annotation sets of the session.
     */
    function getLockedAnnotationSets() {
        return _lockedAnnotationSets;
    }

    /**
     * Add a new annotation set to the annotation set config.
     * @param {string} name The name of the new annotation set.
     * @param {string} description The description of the new annotation set.
     * @param {Object} classConfig The class config of the new annotation set.
     * @param {boolean} [transmit=true] Any collaborators should also be
     * told to add the annotation set.
     */
    function addAnnotationSet(name, description, classConfig, transmit = true) {
        // Check if new annotation set name already exists.
        if (_annotationSetConfig.some(s => name === s.name)) {
            console.warn("Cannot add an annotation set with the same name as a previously existing set.");
            return;
        }
        // Add annotation set to config and update.
        _annotationSetConfig.push({
            name: name,
            description: description,
            classConfig: classConfig,
            author: userInfo.getName(),
            createdOn: dateUtils.getCurrentTimeAsString()
        });
        update(_annotationSetConfig, transmit);
    }

    /**
     * Modify the properties of an annotation set.
     * @param {AnnotationSet} prevAnnotationSet The annotation set to be modified.
     * @param {string} newName The new name.
     * @param {string} newDescription The new description.
     * @param {Array<MClass>} newClassConfig The new class configuration.
     * @param {boolean} [transmit=true] Any collaborators should also be
     * told to rename the annotation set.
     */
    function modifyAnnotationSet(prevAnnotationSet, newName, newDescription, newClassConfig, transmit = true) {
        const prevName = prevAnnotationSet.name;
        const prevDescription = prevAnnotationSet.description;
        const prevClassConfig = prevAnnotationSet.classConfig;

        if (prevName === newName && prevDescription === newDescription && 
            JSON.parse(JSON.stringify(prevClassConfig)) === JSON.parse(JSON.stringify(newClassConfig))) {
            console.log("No updated annotation set information detected, skipping.");
            return;
        }

        if (_annotationSetConfig.some(s => s.name !== _activeAnnotationSet.name && newName === s.name)) {
            console.warn("Cannot rename an annotation set to the same name as previously existing set");
            return;
        }

        const renamedIndex = getIDFromAnnotationSetName(prevName);
        if (renamedIndex === -1) {
            console.warn("The annotation set to update was not found");
            return;
        }

        // Q: In between the line with "renameAssignment()" and the final line with "update()", adding annotations would cause issues. 
        // Let's say a collaborator managed to add an annotation in this window, the added annotation would then end up with a new 
        // annotation in an annotation set that does not exist in the annotation set config. Therefore, we lock the annotation set first, 
        // making sure that no one can modify it or its contents. Then, we rename the assignments and update the annotation set config. 
        // Finally, we can unlock the annotation set. I don't know if this is the best approach in practice, but it's at least a working 
        // solution to an otherwise annoying problem. //Olle
        const previouslyLocked = isLockedAnnotationSet(prevName);
        if (!previouslyLocked) {
            lockAnnotationSet(
                prevName, 
                _lockedAnnotationSets.find(a => a.annotationSetName === prevName).reason,
                true
            );
        }

        if (prevName !== newName) {
            // If the name changes, and the annotation set was previously locked, we make sure the annotation set
            // will be locked after the name change. 
            if (previouslyLocked) {
                lockAnnotationSet(
                    newName, 
                    _lockedAnnotationSets.find(a => a.annotationSetName === prevName).reason,
                    true
                );
            }

            // If the name of the annotation set is changed, we need to rename the assignment of 
            // the set in all annotations in addition to updating the annotation set config. Note 
            // that this has to happen before we update the annotation set config to ensure correct
            // counting and interface updates.
            annotationHandler.renameAssignment(prevName, newName, transmit);
        }

        // Update the annotation set config.
        _annotationSetConfig[renamedIndex].name = newName;
        _annotationSetConfig[renamedIndex].description = newDescription;
        _annotationSetConfig[renamedIndex].classConfig = newClassConfig;
        update(_annotationSetConfig, transmit);

        // Now we remove the previous annotation set name from the list of locked annotation sets again. This should
        // happen both if the name of the annotation set was changed or if the annotation set was previously locked. 
        if (!previouslyLocked || (prevName !== newName)) {
            unlockAnnotationSet(prevName, true);
        }
    }

    /**
     * Remove an annotation set from the config. If no annotation set ID is 
     * provided, the currently active annotation set is removed. 
     * @param {boolean} [transmit=true] Any collaborators should also be
     * told to remove the annotation set.
     * @param {number} [removedAnnotationSetID=null] The ID of the annotation set 
     * to remove. 
     * @param {boolean} [force=false] Whether the removal is forced or not. If 
     * not forced, the user will be prompted to confirm the removal in the interface
     * before the remove function is triggered. 
     */
    function removeAnnotationSet(transmit = true, removedAnnotationSetID = null, force = false) {
        // Help function to remove an annotation set and associated annotations. 
        function _removeFn(removedAnnotationSetName) {
            if (isLockedAnnotationSet(removedAnnotationSetName)) {
                console.warn("Cannot remove a locked annotation set, skipping");
                return;
            }
            // Clear all annotations in the annotation set.
            annotationHandler.clear(removedAnnotationSetName, transmit);
            // Update annotation set config.
            _annotationSetConfig = _annotationSetConfig.filter(annotationSet => {
                return annotationSet.name !== removedAnnotationSetName;
            });
            update(_annotationSetConfig, transmit);
        }
        
        // Get the name of the annotation set to remove.
        let removedAnnotationSetName;
        if (removedAnnotationSetID) {
            removedAnnotationSetName = getAnnotationSetFromID(removedAnnotationSetID).name;
        }
        else {
            removedAnnotationSetName = _activeAnnotationSet.name;
        }

        // Either force removal or prompt the user for confirmation.
        if (force) {
            _removeFn(removedAnnotationSetName);
        }
        else {
            // Ask user if they are sure that they want to remove the annotation set (and all included annotations) first.
            const title = "Are you sure you want to remove the currently selected annotation set and all its annotations?"
            const choices = [{
                label: "Yes",
                click: () => {
                    _removeFn(removedAnnotationSetName);
                }
            }];
            tmappUI.choice(title, null, choices);
        }
    }

    function copyAnnotationSet(newName, copiedAnnotationSet, transmit = true) {
        // Check if annotation set is locked
        if (isLockedAnnotationSet(copiedAnnotationSet.name)) {
            console.warn("Cannot copy a locked annotation set, skipping");
            return;
        }
        // Check if new annotation set name already exists.
        if (_annotationSetConfig.some(s => newName === s.name)) {
            console.warn("Cannot add an annotation set with the same name as a previously existing set.");
            return;
        }
        // Add a copy of the annotation set to config and update.
        _annotationSetConfig.push({
            name: newName,
            description: copiedAnnotationSet.description,
            classConfig: JSON.parse(JSON.stringify(copiedAnnotationSet.classConfig)),
            author: copiedAnnotationSet.author,
            createdOn: copiedAnnotationSet.createdOn
        });
        update(_annotationSetConfig, transmit);
        // Add copies of the annotations to the target annotation set. 
        const annotations = [];
        annotationHandler.forEachAnnotation(a => {
            if (a.assignments.some(assignment => assignment.annotationSet === copiedAnnotationSet.name)) {
                a.assignments = a.assignments.filter(assignment => assignment.annotationSet === copiedAnnotationSet.name);
                a.assignments[0].annotationSet = newName;
                annotations.push(a);
            }
        });
        annotationHandler.add(annotations, "image", true);
    }

    /**
     * Update the annotation set config.
     * @param {Array<AnnotationSet>} annotationSetConfig The new annotation set config.
     * @param {boolean} [transmit=true] Any collaborators should also be told to update 
     * the annotation set config.
     */
    function update(annotationSetConfig, transmit = true) {
        setAnnotationSetConfig(annotationSetConfig);
        transmit && collabClient.updateAnnotationSetConfig(annotationSetConfig);
    }


    return {
        count: () => _annotationSetConfig.length,
        classCount: () => _activeClassConfig.length,

        getActiveClassConfig,
        setActiveClassConfig,
        classColor,
        getClassFromID,
        getIDFromClassName,
        forEachClass,

        getAnnotationSetConfig,
        setAnnotationSetConfig,
        getActiveAnnotationSet,
        setActiveAnnotationSet,
        getAnnotationSetFromID,
        getIDFromAnnotationSetName,
        forEachAnnotationSet,

        isLockedAnnotationSet,
        lockAnnotationSet,
        unlockAnnotationSet,
        getLockedAnnotationSets,
        
        addAnnotationSet,
        modifyAnnotationSet,
        removeAnnotationSet,
        copyAnnotationSet,
        update
    }
})();
