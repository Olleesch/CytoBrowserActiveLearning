/**
 * Default annotation set configuration.
 * 
 * The annotationSetConfig object specified in this file describes the 
 * default annotation set configuration that can be used in the application. 
 * Each entry describes an annotation set's name, description, and class
 * configuration. Order of annotation sets matters for button order and 
 * sorting. 
 * 
 * If the classConfig field is an empty list (as in this default case), 
 * the default class configuration is used (see defaultClassConfig.js).
 */
const defaultAnnotationSetConfig = [
    {
        name: "Default",
        description: "Default annotation set for manual annotation",
        classConfig: []
    }
];
