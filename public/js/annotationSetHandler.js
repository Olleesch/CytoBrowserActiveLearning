/**
 * Information about the representation of the different annotation sets 
 * //     specified in the defaultClassConfig.js file.
 * @namespace annotationSetHandler
 */
const annotationSetHandler = (function(){
    "use strict";

    function getCurrentTimeAsString() {
        return new Date().toISOString();
    }

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
     * Get the current class config.
     * @returns {Object} The active class config.
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
     * Information for a specific set from the set configuration, including
     * information about its visual representation in the user interface.
     * @typedef {Object} AnnotationSet
     * @property {string} name The name of the annotation set.
     * @property {string} description The extended description of the
     * annotation set.
     * @property {Object} classConfig The class configuration of the annotation 
     * set, array of MClass objects.
     */

    /**
     * Get the current annotation set config.
     * @returns {Object} The active annotation set config.
     */
    function getAnnotationSetConfig() {
        return _annotationSetConfig;
    }

    /**
     * Set the annotation set config.
     * @param {Object} updatedAnnotationSetConfig The new annotation set config.
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
            _annotationSetConfig[0].createdOn = getCurrentTimeAsString();
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
     * @param {string} annotationSetName The name of the annotation set.
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
     * Get a set based on its id.
     * @param {number} id The id of the sought set.
     * @returns {AnnotationSet} The set with the corresponding id.
     */
    function getAnnotationSetFromID(id) {
        return _annotationSetConfig[id];
    }

    /**
     * Get the id of a set based on its name.
     * @param {string} name The name of the set.
     * @returns {number} The id of the set.
     */
    function getIDFromAnnotationSetName(name) {
        return _annotationSetConfig.findIndex((entry) => name == entry.name);
    }

    /**
     * Execute a function with each annotation set as an argument.
     * @param {Function} f The function to be executed with the sets.
     */
    function forEachAnnotationSet(f) {
        _annotationSetConfig.forEach(f);
    }


    // ==== Collaborative functions ====

    let _annotationSetConfig = defaultAnnotationSetConfig;
    let _activeAnnotationSet = defaultAnnotationSetConfig[0];
    let _activeClassConfig = defaultClassConfig;
    let _lockedAnnotationSets = [];

    function isLockedAnnotationSet(annotationSetName) {
        return _lockedAnnotationSets.includes(annotationSetName);
    }

    function lockAnnotationSet(annotationSetName) {
        if (!isLockedAnnotationSet(annotationSetName)) {
            _lockedAnnotationSets.push(annotationSetName);
            htmlHelper.updateLockedAnnotationSetButtonDisplays();
        } else {
            console.log(`Tried to lock already locked annotation set ${annotationSetName}, ignoring`);
        }
    }

    function unlockAnnotationSet(annotationSetName) {
        if (isLockedAnnotationSet(annotationSetName)) {
            _lockedAnnotationSets = _lockedAnnotationSets.filter(a => a !== annotationSetName);
            htmlHelper.updateLockedAnnotationSetButtonDisplays();
        } else {
            console.log(`Tried to unlock already unlocked annotation set ${annotationSetName}, ignoring`);
        }
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
            createdOn: getCurrentTimeAsString()
        });
        update(_annotationSetConfig, transmit);
    }

    /**
     * Rename an annotation set.
     * @param {*} prevAnnotationSet The annotation set to be renamed.
     * @param {*} newName The new name.
     * @param {*} newDescription The new description.
     * @param {*} [transmit=true] Any collaborators should also be
     * told to rename the annotation set.
     */
    function renameAnnotationSet(prevAnnotationSet, newName, newDescription, transmit = true) {
        const prevName = prevAnnotationSet.name;
        const prevDescription = prevAnnotationSet.description;

        if (isLockedAnnotationSet(prevName)) {
            console.warn("Cannot rename a locked annotation set, skipping");
            return;
        }

        if (prevName === newName && prevDescription === newDescription) {
            console.log("No updated annotation set information detected, skipping.");
            return;
        }

        if (_annotationSetConfig.some(s => newName === s.name)) {
            console.warn("Cannot rename an annotation set to the same name as previously existing set");
            return;
        }

        const renamedIndex = getIDFromAnnotationSetName(prevAnnotationSet.name);
        if (renamedIndex === -1) {
            console.warn("The annotation set to update was not found");
            return;
        }

        // If the name of the annotation set is changed, we need to rename the mclass key of 
        // the set in all annotations in addition to updating the annotation set config. Note 
        // that this has to happen before we update the annotation set config to ensure correct
        // counting and interface updates.
        if (prevName !== newName) {
            annotationHandler.renameAssignmentKey(prevName, newName, transmit);
        }

        // Update the annotation set config.
        _annotationSetConfig[renamedIndex].name = newName;
        _annotationSetConfig[renamedIndex].description = newDescription;
        update(_annotationSetConfig, transmit);
    }

    /**
     * Remove the currently active annotation set from the config.
     * @param {boolean} [transmit=true] Any collaborators should also be
     * told to remove the annotation set.
     */
    function removeAnnotationSet(transmit = true) {
        // Ask user if they are sure that they want to remove the annotation set (and all included annotations) first.
        const title = "Are you sure you want to remove the currently selected annotation set and all its annotations?"
        const choices = [{
            label: "Yes",
            click: () => {
                if (isLockedAnnotationSet(_activeAnnotationSet.name)) {
                    console.warn("Cannot remove a locked annotation set, skipping");
                    return;
                }
                // Clear all annotations in the annotation set.
                annotationHandler.clear(_activeAnnotationSet.name, transmit);
                // Update annotation set config.
                _annotationSetConfig = _annotationSetConfig.filter(annotationSet => {
                    return annotationSet.name !== _activeAnnotationSet.name;
                });
                update(_annotationSetConfig, transmit);
            }
        }];
        tmappUI.choice(title, null, choices);
    }

    /**
     * Update the annotation set config.
     * @param {Object} annotationSetConfig The new annotation set config.
     * @param {boolean} [transmit=true] Any collaborators should also be
     * told to update the annotation set config.
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
        
        addAnnotationSet,
        renameAnnotationSet,
        removeAnnotationSet,
        update
    }
})();
