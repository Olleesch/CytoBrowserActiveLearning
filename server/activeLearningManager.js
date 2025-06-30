/**
 * @module activeLearningManager
 * @desc Contains necessary server-side logic for active learning
 * processes connected to CytoBrowser.
 */

const fs = require('fs');

let _collaboration;

const activeLearningProcesses = [];

let pythonHost;
let pythonPort;
let callbackURL;

function setPythonLocation(host, port) {
    pythonHost = host;
    pythonPort = port;
}

function setCallbackURL(url) {
    callbackURL = url;
}

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

function getActiveLearningSetup() {
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

function startActiveLearningProcess(parameters) {
    const id = activeLearningProcesses.length+1;
    fetch(`http://${pythonHost}:${pythonPort}/api/activeLearning/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            id: id,
            parameters: parameters,
            callbackURL: callbackURL
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
        console.log(`Error starting active learning process: ${err.message}`);
    });
}

function annotateActiveLearningQuery(id) {
    const processInfo = activeLearningProcesses.find(process => process.id === id);
    processInfo.query.samples.forEach(sample =>{
        const data = JSON.parse(fs.readFileSync(`./collab_storage/${sample.name}/${sample.name}_${sample.collab}.json`))
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

function updateActiveLearningProcess(id, status, round, query) {
    const activeLearningProcess = activeLearningProcesses.find(process => process.id === id);
    activeLearningProcess.status = status;
    activeLearningProcess.annotationRound = round;
    activeLearningProcess.query = query;

    if (query) {
        for (const sample of query.samples) {
            const collabID = _collaboration.getId();
            const image = sample.name;
            const name = activeLearningProcess.author;
            const collab = _collaboration.getCollab(collabID, image, name, pythonHost, pythonPort);
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
            sample.collab = collabID;
        }
    }
}

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