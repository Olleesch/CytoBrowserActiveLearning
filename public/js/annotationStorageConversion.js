/**
 * Deals with converting between annotation storage objects and placed annotation
 * data. Functions in this namespace can either be used to get the
 * currently placed annotations as a storage object, which can be used for
 * local storage in a JSON file, or to add annotations from
 * an already existing annotation storage object.
 * @namespace annotationStorageConversion
 */
const annotationStorageConversion = (function() {
    "use strict";

    /**
     * A JSON representation of currently placed annotations.
     * @typedef {Object} AnnotationStorage
     * @param {number} version The specific version of the annotation storage
     * object, for back-compatibility reasons.
     * @param {string} name The name of the image where the annotations were
     * initially placed.
     * @param {Array<annotationHandler.Annotation>} annotations The actual data for
     * the annotations.
     */

    /**
     * Add annotations from an annotation storage object. The user is prompted
     * for whether or not the existing points should be replaced or
     * added to with the loaded annotations.
     * @param {Object} data The storage object containing annotation
     * information.
     */
    function addAnnotationStorageData(data, ignoreMismatch=false) {
        if (data.version === "1.0" || data.version === "1.1" || data.version === "1.2") {

            // Find new annotation set name "Imported set [num]" based on existing sets
            let importedAnnotationSetName = "Imported set";

            // TODO: Figure out what to do with existing annotations if we load a set the name of which
            // already exists in the current collaboration. 

            const loadAnnotationSetConfig = () => {
                if (data.version === "1.0" || data.version === "1.1") {
                    data.annotationSetConfig = [
                        {
                            name: importedAnnotationSetName,
                            description: "Imported annotation set from older data version",
                            classConfig: data.classConfig ?? [],
                            author: data.author ?? "Unknown",
                            createdOn: data.createdOn ?? annotationSetHandler.getCurrentTimeAsString()
                        }
                    ];
                }
                return data.annotationSetConfig;
            }

            const addAnnotationSetConfig = () => {
                const newAnnotationSetConfig = loadAnnotationSetConfig();
                const annotationSetConfig = annotationSetHandler.getAnnotationSetConfig();
                console.log(JSON.stringify(newAnnotationSetConfig, null, 2));
                // Add new annotation sets to end of existing annotation set config and send to collaborators
                annotationSetConfig.push(...newAnnotationSetConfig);
                annotationSetHandler.update(annotationSetConfig, true);
            }

            const replaceAnnotationSetConfig = () => {
                const newAnnotationSetConfig = loadAnnotationSetConfig();
                // Replace existing annotation set config with new annotation set config and send to collaborators
                annotationSetHandler.update(newAnnotationSetConfig, true);
            }

            const loadAnnotations = () => {
                if (data.version === "1.0" || data.version === "1.1") {
                    data.annotations.forEach(a => {
                        a.originalAuthor = a.author ?? (data.author ?? "Unknown");
                        a.assignments = [
                            {
                                annotationSet: importedAnnotationSetName,
                                z: a.z,
                                mclass: a.mclass,
                                author: a.author ?? (data.author ?? "Unknown"),
                                bookmarked: a.bookmarked ?? false,
                                prediction: a.prediction ?? null
                            }
                        ];
                        delete a.author;
                        delete a.mclass;
                        delete a.z;
                    });
                }
                return data.annotations;
            }

            const addAnnotations = () => {
                const newAnnotations = loadAnnotations();
                annotationHandler.add(newAnnotations, "image", true);
                if (data.version === "1.1" || data.version === "1.2") {
                    data.comments.forEach(comment => {
                        globalDataHandler.sendCommentToServer(comment);
                    });
                }
            }

            // Change to a collab on the right image if we're on the wrong one
            if (!ignoreMismatch && data.image !== tmapp.getImageName()) {
                tmappUI.choice("Warning: Selected data is for another image", 
                    `<p>This image: <b><tt>${escapeHtml(tmapp.getImageName())}</tt></b>` +
                    `<br>Data from: <b><tt>${escapeHtml(data.image)}</tt></b>` +
                    `</p>Any annotations outside the image will be discarded.<p>`,
                    [{
                        label: "Import anyway!",
                        click: () => { 
                            addAnnotationStorageData(data, true); 
                        }
                    }
                ]);
            } else {
                tmappUI.choice("What should be done with the current annotations?", null, [
                    {
                        label: "Add loaded annotation sets to existing ones",
                        click: () => {
                            addAnnotationSetConfig();
                            addAnnotations();
                        }
                    },
                    {
                        label: "Replace existing annotation sets with loaded ones",
                        click: () => {
                            annotationSetHandler.forEachAnnotationSet(s => annotationHandler.clear(s.name));
                            globalDataHandler.clear(true);
                            replaceAnnotationSetConfig();
                            addAnnotations();
                        }
                    }
                ]);
            }
        }
        else {
            throw new Error(`Data format version ${data.version} not implemented.`);
        }
    }

    /**
     * Convert the currently placed annotations to an annotation storage object.
     * @returns {Object} The annotation storage representation of the annotations.
     */
    function getAnnotationStorageData() {
        const data = {
            version: "1.2", // Version of the formatting
            image: tmapp.getImageName(),
            author: userInfo.getName(),
            updatedOn: new Date().toISOString(),
            annotationSetConfig: annotationSetHandler.getAnnotationSetConfig(),
            annotations: [],
            comments: []
        };
        annotationHandler.forEachAnnotation(annotation => {
            data.annotations.push(annotation)
        }, false); //don't copy computables (centroid, diameter,...) or defaults (bookmarked=false,...)
        globalDataHandler.forEachComment(comment => {
            data.comments.push(comment)
        });
        
        let nAnnotations = 0;
        data.annotations.forEach(annotation => {
            nAnnotations += annotation.assignments.length;
        })
        data.nAnnotations = nAnnotations;
        data.nComments = data.comments.length;
        return data;
    }

    return {
        addAnnotationStorageData,
        getAnnotationStorageData
    }
})();
