/**
 * @module activeLearningManager
 * @desc Contains necessary server-side logic for active learning
 * processes connected to CytoBrowser.
 */

const fs = require('fs');

// Module initialized in export
let _collaboration;

// Keep track of running active learning processes
const activeLearningProcesses = [];
let prevId = 0;

// For communication with the python backend
let pythonHost;
let pythonPort;
let callbackURL;

// Set-function for the python backend location
function setPythonLocation(host, port) {
    pythonHost = host;
    pythonPort = port;
}

// Set-function for the callback URL (to be passed to the python backend)
function setCallbackURL(url) {
    callbackURL = url;
}

/**
 * Handle messages to the active learning manager.
 * @param {Object} msg The message containing the request.
 * @returns {Object} A return message (depends on the specific request).
 */
async function handleRequest(msg) {
    switch (msg.type) {
        case "getSetup": 
            return getActiveLearningSetup();
        case "startProcess":
            return startActiveLearningProcess(msg.parameters);
        case "getProcesses":
            return getActiveLearningProcesses();
        case "updateProcess":
            return updateActiveLearningProcess(msg.id, msg.status, msg.round, msg.query);
        case "annotateQuery":
            return annotateActiveLearningQuery(msg.id);
        default:
            console.log("Received an active learning message with an unknown type, ignoring.");
            return;
    }
}

/**
 * Get the available active learning methods.
 * @returns {Object} A dictionary with the methods.
 */
function getActiveLearningSetup() {
    // This should probably not be hardcoded here in the future.
    // Better idea would be to get these from the python backend.
    // Active learning methods are split into informativeness function and sampling strategies. Each method
    // have both a name (to display in the interface) and a value (to identify the method in code).
    const setup = {
        informativenessFunctions: [
            {
                name: "Uncertainty (aggr. det. peak)",
                value: "uncertainty"
            }, 
            {
                name: "Representativeness (cluster)",
                value: "representativeness"
            }, 
            {
                name: "None",
                value: null
            }
        ],
        samplingStrategies: [
            {
                name: "Top-K",
                value: "topk"
            }, 
            {
                name: "Diversity (cluster)",
                value: "diversity"
            }, 
            {
                name: "Random",
                value: "random"
            }
        ]
    };
    return setup;
}

/**
 * Start a new active learning process/experiment in the python backend.
 * @param {Object} parameters A dictionary containing the parameters of the experiment.
 */
function startActiveLearningProcess(parameters) {
    // Get a new process id
    const id = prevId+1;
    prevId = id;

    // Send a request to the python backend to start the active learning process
    fetch(`http://${pythonHost}:${pythonPort}/api/activeLearning/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            id: id,
            parameters: parameters,
            callbackURL: callbackURL
        })
    }).then(response => {
        // If an error occurs in the python backend, return an error code and message
        if (!response.ok) {
            return response.json().then(data => {
                const errorMessage = data.error;
                throw new Error(`Error in active learning python backend: ${errorMessage}`);
            });
        }
        // Log successful launch message in server terminal
        response.json().then(data => {
            console.log(data.message);
        });
        // Construct the state of the launched process and add it to the list of running processes
        const activeLearningProcess = {
            id: id,
            name: parameters.name,
            status: "init",
            author: parameters.author,
            parameters: parameters,
            annotationRound: 0,
            query: null,
            createdOn: parameters.createdOn
        };
        activeLearningProcesses.push(activeLearningProcess);
    }).catch((err) => {
        // Log error message
        console.log(`Error starting active learning process: ${err.message}`);
    });
}

/**
 * Add annotations of the active learning query to the active learning process running in the python backend.
 * @param {number} id The identifier of the process.
 */
function annotateActiveLearningQuery(id) {
    // Get the process
    const processInfo = activeLearningProcesses.find(process => process.id === id);

    // Extract the annotations from the queried samples and format correctly
    processInfo.query.samples.forEach(sample =>{
        // Get annotations from the collab storage. This can be done in a better way, but this simple method will do for now. 
        const data = JSON.parse(fs.readFileSync(`./collab_storage/${sample.name}/${sample.name}_${sample.collab}.json`))

        // Find and extract annotation coordinates and classes
        const activeAnnotationSetName = "Queried tile"
        sample.annotations = [];
        data.annotations.forEach(annotation => {
            if (annotation.assignments.some(a => a.annotationSet === activeAnnotationSetName)) {
                const assignment = annotation.assignments.find(a => a.annotationSet === activeAnnotationSetName);
                sample.annotations.push({
                    points: annotation.points,
                    mclass: assignment.mclass,
                });
            }
        });
    });

    // Send annotations to the python backend so they can be added to the datasets of the active learning process in question.
    fetch(`http://${pythonHost}:${pythonPort}/api/activeLearning/annotate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            id: id,
            samples: processInfo.query.samples
        })
    }).then(response => {
        if (!response.ok) {
            return response.json().then(data => {
                const errorMessage = data.error;
                throw new Error(`Error in active learning python backend: ${errorMessage}`);
            });
        }
        response.json().then(data => {
            console.log(data.message);
        });
    }).catch((err) => {
        console.log(`Error annotating query of active learning process: ${err.message}`);
    });
}

/**
 * Update the status of a running active learning process.
 * @param {number} id The identifier of the process.
 * @param {string} status The current status of the process.
 * @param {number} round The current annotation round of the process.
 * @param {Object} query If the process is at the query stage, this contains a dictionary specifying the queried samples. 
 * The dictionary should contain: 
 *      samples     - an array of dictionaries defining the queried samples. Each dictionary should contain: 
 *                          name      - A string with name of the image the sample is from. 
 *                          thumbnail - A string with the thumbnail to display in the queried sample selection window (the 
 *                                      location of the image tile of the queried sample).
 *                          zLevels   - An array of the z-offsets the sample includes. 
 *                          tile_x    - The tile x-coordinate of the queried sample. 
 *                          tile_y    - The tile y-coordinate of the queried sample. 
 *                          collab    - The collaboration id of the session prepared to annotate the queried sample. 
 *      queriedOn   - a string specifying the time the query was sent to the server. 
 */
function updateActiveLearningProcess(id, status, round, query) {
    const activeLearningProcess = activeLearningProcesses.find(process => process.id === id);
    activeLearningProcess.status = status;
    activeLearningProcess.annotationRound = round;
    activeLearningProcess.query = query;

    // If there is a query, construct collaborations for each queried sample and add a region annotation to indicate the queried tile.
    // TODO: Currently creates a new collaboration per sample, even if two samples are in the same image. This can be improved. 
    if (query) {
        for (const sample of query.samples) {
            // Initialize a new collaboration for the image the queried tile belongs to.
            const collabID = _collaboration.getId();
            const image = sample.name;
            const author = activeLearningProcess.author;
            const collab = _collaboration.getCollab(collabID, image, author, pythonHost, pythonPort);

            // Replace the default annotation set configuration with one suitable for nucleus detection annotation.
            collab.annotationSetConfig = [
                {
                    "name": "Queried tile",
                    "description": "Queried tile of the active learning process",
                    "classConfig": [
                        {
                            "name": "Normal",
                            "description": "Confident annotation of a normal nucleus",
                            "color": "#346d2e"
                        },
                        {
                            "name": "Immune",
                            "description": "Confident annotation of an immune cell nucleus",
                            "color": "#67b5da"
                        },
                        {
                            "name": "Bacteria",
                            "description": "Possibly bacteria",
                            "color": "#ad6a10"
                        },
                        {
                            "name": "Out-of-focus",
                            "description": "Some type of nucleus, but too out of focus to be detected in plane z=0",
                            "color": "#f0b500"
                        },
                        {
                            "name": "Uncertain",
                            "description": "Not sure what class is suitable",
                            "color": "#919191"
                        },
                        {
                            "name": "Unknown",
                            "description": "Does not fit other classes (confidently do not know what it is, not unsure if it's this or that)",
                            "color": "#f03c3c"
                        },
                        {
                            "name": "ROI",
                            "description": "Region of interest, annotated region of image",
                            "color": "#346d2e"
                        },
                        {
                            "name": "TODO",
                            "description": "To be annotated",
                            "color": "#9c2792"
                        }
                    ]
                }
            ];
            collab.name = "Active Learning Annotation";
            // Add the collaboration ID to the queried sample dictionary for later access.
            sample.collab = collabID;
        }
    }
}

/**
 * Get-function for the running active learning processes states.
 * @returns {Object} The list of running active learning processes.
 */
function getActiveLearningProcesses() {
    return activeLearningProcesses;
}

module.exports = function(collaboration) {
    _collaboration = collaboration;
    return {
        setPythonLocation,
        setCallbackURL,
        handleRequest
    };
}