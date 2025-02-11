/**
 * Information about the representation of the different annotation sets 
 * //     specified in the defaultClassConfig.js file.
 * @namespace annotationSetUtils
 */
const annotationSetUtils = (function(){
    "use strict";

    /**
     * Information for a specific set from the set configuration, including
     * information about its visual representation in the user interface.
     * @typedef {Object} AnnotationSet
     * @property {string} name The abbreviated name of the set.
     * @property {string} description The extended description of the
     * set name.
     */
    let _annotationSets = defaultAnnotationSetConfig;

    // /**
    //  * Get a sorted array containing the name of each class in a given class system.
    //  * @returns {Array<string>}
    //  */
    // function getSortedNames(class_system) {
    //     let classesNames = [];
    //     class_system.forEach((entry) => classesNames.push(entry.name));
    //     return classesNames.sort();
    // }

    // /**
    //  * Check whether a class system corresponds to the default system.
    //  * @param {Object} class_system
    //  * @returns {Boolean} indicates whether the argument class_system is the default system.
    //  */
    // function isDefaultClassSystem(class_system) {
    //     return (compareTwoClassSystems(class_system, defaultClassConfig) || class_system.length === 0);
    // }

    // /**
    //  * Compare two class systems by name of classes, ignoring the class order
    //  * @param {Object} class_system_a the first class system
    //  * @param {Object} class_system_b the second class system
    //  * @returns {Boolean} indication whether the given class sytems have the same classes
    //  */
    // function compareTwoClassSystems(class_system_a, class_system_b) {
    //     let sorted_classNames_a = getSortedNames(class_system_a);
    //     let sorted_classNames_b = getSortedNames(class_system_b);

    //     let sameClassLenghts = class_system_a.length === class_system_b.length;

    //     let sameClassNames = sorted_classNames_a.every(function(value, index) {
    //         return value === sorted_classNames_b[index];
    //     });

    //     return (sameClassLenghts && sameClassNames);
    // }

    /**
     * Get the current set system.
     * @returns {Object}
     */
    function getAnnotationSetConfig() {
        return _annotationSets;
    }

    /**
     * Set the annotation set system based on a new configuration.
     * @param {Object} annotationSetConfig 
     */
    function setAnnotationSetConfig(updatedAnnotationSetConfig) {
        if (updatedAnnotationSetConfig !== undefined && updatedAnnotationSetConfig.length >= 1) {
            _annotationSets = updatedAnnotationSetConfig;
        }
        else {
            _annotationSets = updatedAnnotationSetConfig;
        }
    }
    // function setClassConfig(updatedClassConfig) {
    //     if (updatedClassConfig !== undefined && updatedClassConfig.length >= 1) {
    //         _classes = updatedClassConfig;
    //     }
    //     else {
    //         _classes = defaultClassConfig;
    //     }
    // }

    // /**
    //  * Get the color assigned for a given set.
    //  * @param {number|string} idOrName Either the id of the given set
    //  * or its name.
    //  * @returns {string} An RGB hex representation of the color.
    //  */
    // function annotationSetColor(idOrName) {
    //     let id = idOrName;
    //     if (typeof(id) === "string") {
    //         id = annotationSetUtils.getIDFromName(idOrName);
    //     }
    //     return _annotationSets[id].color;
    // }

    /**
     * Get a set based on its id.
     * @param {number} id The id of the sought set.
     * @returns {AnnotationSet} The set with the corresponding id.
     */
    function getAnnotationSetFromID(id) {
        return _annotationSets[id];
    }

    /**
     * Get the id of a set based on its name.
     * @param {string} name The name of the set.
     * @returns {number} The id of the set.
     */
    function getIDFromName(name) {
        return _annotationSets.findIndex((entry) => name == entry.name);
    }

    /**
     * Execute a function with each set as an argument.
     * @param {Function} f The function to be executed with the sets.
     */
    function forEachAnnotationSet(f) {
        _annotationSets.forEach(f);
    }

    return {
        count: () => _annotationSets.length,
        // getSortedNames,
        // isDefaultClassSystem,
        // compareTwoClassSystems,
        getAnnotationSetConfig,
        setAnnotationSetConfig,
        // annotationSetColor,
        getAnnotationSetFromID,
        getIDFromName,
        forEachAnnotationSet
    }
})();
