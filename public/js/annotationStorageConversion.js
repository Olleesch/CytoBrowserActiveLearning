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
            
            // Help function to load annotation set config and deal with previous storage versions. 
            const loadAnnotationSetConfig = () => {
                if (data.version === "1.0" || data.version === "1.1") {
                    data.annotationSetConfig = [
                        {
                            name: importedAnnotationSetName,
                            description: "Imported annotation set from older data version",
                            classConfig: data.classConfig ?? [],
                            author: data.author ?? "Unknown",   // Q: Current user if missing? Or better to state unknown?
                            createdOn: data.createdOn ?? dateUtils.getCurrentTimeAsString()
                        }
                    ];
                }
                else if (data.version === "1.2") {
                    data.annotationSetConfig.forEach(annotationSet => {
                        if (!annotationSet.author) annotationSet.author = "Unknown"; // Q: Current user if missing? Or better to state unknown?
                        if (!annotationSet.createdOn) annotationSet.createdOn = dateUtils.getCurrentTimeAsString();
                    });
                }
                return data.annotationSetConfig;
            }
            
            // Help function to add the imported annotation sets to the existing annotation set config. 
            const addAnnotationSetConfig = () => {
                const newAnnotationSetConfig = loadAnnotationSetConfig();
                const annotationSetConfig = annotationSetHandler.getAnnotationSetConfig();
                // Add new annotation sets to end of existing annotation set config and send to collaborators
                annotationSetConfig.push(...newAnnotationSetConfig);
                annotationSetHandler.update(annotationSetConfig, true);
            }

            // Help function to replace the entire current annotation set config with the imported one. 
            const replaceAnnotationSetConfig = () => {
                const newAnnotationSetConfig = loadAnnotationSetConfig();
                // Replace existing annotation set config with new annotation set config and send to collaborators
                annotationSetHandler.update(newAnnotationSetConfig, true);
            }

            // Help function to load imported annotations and deal with previous storage versions. 
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
                // TODO: Any optional fields we should configure/ensure exist if the version is 1.2?
                return data.annotations;
            }

            // Help function to add new annotations to the existing annotation data. 
            const addAnnotations = () => {
                const newAnnotations = loadAnnotations();
                annotationHandler.add(newAnnotations, "image", true);
                if (data.version === "1.1" || data.version === "1.2") {
                    data.comments.forEach(comment => {
                        globalDataHandler.sendCommentToServer(comment);
                    });
                }
            }

            if (!ignoreMismatch && data.image !== tmapp.getImageName()) {
                // Warn the user if the imported data specifies another image than the current image
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
                // Ask the user if the imported data should be added to the existing data or replace the existing data. 
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
     * @param {string} version The storage version.
     * @returns {Object} The annotation storage representation of the annotations.
     */
    function getAnnotationStorageData(version) {
        const data = {
            version: version, // Version of the formatting
            image: tmapp.getImageName(),
            updatedOn: new Date().toISOString()
        };
        if (version === "1.1") {
            const activeAnnotationSetName = annotationSetHandler.getActiveAnnotationSet().name;
            data.classConfig = annotationSetHandler.getActiveClassConfig();
            data.annotations = [];
            annotationHandler.forEachAnnotation(annotation => {
                if (annotation.assignments.some(a => a.annotationSet === activeAnnotationSetName)) {
                    const assignment = annotation.assignments.find(a => a.annotationSet === activeAnnotationSetName);
                    data.annotations.push({
                        points: annotation.points,
                        z: assignment.z,
                        mclass: assignment.mclass,
                        author: assignment.author,
                        id: annotation.id,
                        bookmarked: assignment.bookmarked,
                        prediction: assignment.prediction
                    });
                }
            });
            data.nAnnotations = data.annotations.length;
        } else if (version === "1.2") {
            data.annotationSetConfig = annotationSetHandler.getAnnotationSetConfig();
            data.annotations = [];
            annotationHandler.forEachAnnotation(annotation => {
                data.annotations.push(annotation)
            }, false); //don't copy computables (centroid, diameter,...) or defaults (bookmarked=false,...)
            let nAnnotations = 0;
            data.annotations.forEach(annotation => {
                nAnnotations += annotation.assignments.length;
            });
            data.nAnnotations = nAnnotations;
        } else {
            console.warn("Data export version not supported, skipping");
            return;
        }
        data.comments = [];
        globalDataHandler.forEachComment(comment => {
            data.comments.push(comment)
        });
        data.nComments = data.comments.length;
        return data;
    }

    return {
        addAnnotationStorageData,
        getAnnotationStorageData
    }
})();
