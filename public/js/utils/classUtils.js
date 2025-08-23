/**
 * Information about the representation of the different classes specified
 * in the defaultClassConfig.js file.
 * @namespace classUtils
 */
const classUtils = (function(){
    "use strict";

    /**
     * Get a sorted array containing the name of each class in a given class system.
     * @param {Object} class_system the input class system
     * @returns {Array<string>} the sorted class system
     */
    function getSortedNames(class_system) {
        let classesNames = [];
        class_system.forEach((entry) => classesNames.push(entry.name));
        return classesNames.sort();
    }

    /**
     * Check whether a class system corresponds to the default system.
     * @param {Object} class_system the input class system
     * @returns {Boolean} indicates whether the argument class_system is the default system.
     */
    function isDefaultClassSystem(class_system) {
        return (compareTwoClassSystems(class_system, defaultClassConfig) || class_system.length === 0);
    }

    /**
     * Compare two class systems by name of classes, ignoring the class order
     * @param {Object} class_system_a the first class system
     * @param {Object} class_system_b the second class system
     * @returns {Boolean} indication whether the given class sytems have the same classes
     */
    function compareTwoClassSystems(class_system_a, class_system_b) {
        let sorted_classNames_a = getSortedNames(class_system_a);
        let sorted_classNames_b = getSortedNames(class_system_b);

        let sameClassLenghts = class_system_a.length === class_system_b.length;

        let sameClassNames = sorted_classNames_a.every(function(value, index) {
            return value === sorted_classNames_b[index];
        });

        return (sameClassLenghts && sameClassNames);
    }

    return {
        getSortedNames,
        isDefaultClassSystem,
        compareTwoClassSystems,
    }
})();
