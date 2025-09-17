/**
 * Module for handling the visuals and logic of the active learning picker.
 * @namespace activeLearningPicker
 */


const activeLearningPicker = (function() {
    "use strict";

    /**
     * Data representation of an active learning process running on the server 
     * that should be used when adding or updating information about it. 
     * @typedef {Object} ActiveLearningProcess
     * @property {number} id The id of the process
     * @property {string} status The status of the process ("init", "train", 
     * "eval", "query", "finalizing")
     * @property {string} name The name of the process.
     * @property {string} author The author of the process.
     * @property {string} annotationRound The current annotation round of the 
     * process. 
     * @property {string} createdOn The time the process was created. 
     * @property {ActiveLearningQuery} [query] The current annotation query if 
     * the process is at the query stage of the active learning pipeline.
     */

    /**
     * Data representation of an active learning query that should be used when 
     * receiving queries from active learning queries running on the server. 
     * @typedef {Object} ActiveLearningQuery
     * @property {Array<ActiveLearningQueriedSample>} samples An array of queried
     * samples. 
     * @property {string} queriedOn The time the annotation query was sent to
     * the server. 
     */

    /**
     * Data representation of a queried sample that in active learning queries. 
     * @typedef {Object} ActiveLearningQueriedSample
     * @property {string} name The name of the image the sample is from. 
     * @property {string} thumbnail Thumbnail to display in the queried sample 
     * selection window (a string specifying the location of the image tile of 
     * the queried sample).
     * @property {Array<number>} zLevels An array of the z-offsets the sample includes. 
     * @property {number} tile_x The tile x-coordinate of the queried sample. 
     * @property {number} tile_y The tile y-coordinate of the queried sample. 
     * @property {string} collab The collaboration id of the session prepared to annotate
     * the queried sample. 
     */

    // The fields of the list of running active learning processes in the interface.
    const _tableFields = [
        {
            name: "Name",
            title: "Experiment name",
            key: "name",
            sortable: true
        },
        {
            name: "Status",
            title: "Experiment status",
            key: "status",
            sortable: true
        },
        {
            name: "Started by",
            title: "Experiment was started by user",
            key: "author",
            sortable: true
        },
        {
            name: "Annotation round",
            title: "Current annotation round",
            key: "annotationRound",
            sortable: true
        },
        {
            name: "# Queried samples",
            title: "Number of queried sampels to annotate",
            key: "nQueried",
            sortable: true,
            selectFun: d => {
                return d.query ? d.query.samples.length : "-";
            }
        },
        {
            name: "Time of query",
            title: "Time of annotation query",
            key: "queriedOn",
            sortable: true,
            selectFun: d => {
                return d.query ? dateUtils.formatReadableDate(d.query.queriedOn) : "-";
            }
        },
    ];

    // To keep track of the elements of the list.
    let _ALProcessesList = null;
    let _currentSelection = null;
    let _availableProcesses = [];

    /**
     * Update the currently selected active learning process in the list when a new process is selected.
     * @param {ActiveLearningProcess} selectedProcess The selected active learning process list element.
     */
    function _selectActive(selectedProcess) {
        _ALProcessesList.unhighlightAllRows();
        _ALProcessesList.highlightRow(selectedProcess.id);
        _currentSelection = selectedProcess;
        if (selectedProcess.status === "query") {
            $("#active-learning-open").prop("disabled", false);
        }
        else {
            $("#active-learning-open").prop("disabled", true);
        }
    }

    /**
     * Update the currently selected active learning process in the list when all processes are unselected.
     */
    function _unselectActive() {
        _ALProcessesList.unhighlightAllRows();
        _currentSelection = null;
        $("#active-learning-open").prop("disabled", true);
    }

    /**
     * Try retaining the currently selected active learning process, otherwise unselect all processes.
     * @param {Array<ActiveLearningProcess>} displayedProcesses A list of displayed active learning processes.
     */
    function _tryRetainingCurrentSelection(displayedProcesses) {
        if (_currentSelection) {
            const selectionRemains = displayedProcesses.some(process => {
                return process.id === _currentSelection.id;
            }); 
            if (selectionRemains) {
                _selectActive(_currentSelection);
            }
            else {
                _unselectActive();
            }
        }
    }

    /**
     * Update the active learning list in the interface.
     */
    function _updateActiveLearningList() {
        if (!_ALProcessesList) {
            throw new Error("Tried to refresh AL picker before initialization.");
        }
        const displayedProcesses = _availableProcesses;
        _ALProcessesList.updateData(displayedProcesses);
        _tryRetainingCurrentSelection(displayedProcesses);
    }

    /**
     * Handle logic of clicking an entry in the running active learning processes list.
     * @param {ActiveLearningProcess} d The clicked active learning process.
     */
    function _handleALClick(d) {
        if (!_currentSelection) {
            _selectActive(d);
        }
        else if (d.id === _currentSelection.id) {
            _unselectActive();
        }
        else {
            _selectActive(d);
        }
    }

    /**
     * Handle logic of double-clicking an entry in the running active learning processes list.
     * @param {ActiveLearningProcess} d The double-clicked active learning process.
     */
    function _handleALDoubleClick(d) {
        _handleALClick(d);
        if (_currentSelection && d.status === "query") {
            _openActiveLearningQuery();
        }
    }

    /**
     * Send a request to the active learning manager on the server.
     * @param {Object} msg The dictionary with the request message.
     * @returns {XMLHttpRequest} The request object used to send the request.
     */
    function _sendRequest(msg) {
        const req = new XMLHttpRequest();
        req.open("POST", window.location.api + "/activeLearning", true)
        req.setRequestHeader("Content-Type", "application/json");
        // Turn off caching of response
        req.setRequestHeader("Cache-Control", "no-cache, no-store, must-revalidate, max-age=0"); // HTTP 1.1
        req.setRequestHeader("Pragma", "no-cache"); // HTTP 1.0
        req.setRequestHeader("Expires", "0"); // Proxies
        req.send(JSON.stringify(msg));
        return req;
    }

    /**
     * Request annotations from the oracle (by sending a message to the active learning
     * manager on the server).
     * @param {number} id The id of the process the request concerns.
     */
    function _requestSendAnnotations(id) {
        const msg = {
            type: "annotateQuery",
            id: id
        };
        _sendRequest(msg);
    }

    /**
     * Open the query of an active learning process.
     */
    function _openActiveLearningQuery() {
        _returnModal = false;
        const activeModal = $(".modal.show");
        activeModal.modal("hide");
        $("#AL_image_browser").modal("show");
        $("#AL_image_browser").one("hide.bs.modal", () => {
            activeModal.modal("show");
            _returnModal = true;
            activeModal.one("hide.bs.modal", () => {
                if (_returnModal) {
                    _prevModal.modal("show");
                }
            });
        });

        $("#send-annotations-active-learning").off("click").click(function(event) {
            const currentID = _currentSelection.id;
            _requestSendAnnotations(currentID);
            _unselectActive();
            $("#AL_image_browser").modal("hide");
        });

        // Select queried images based on current selection
        tmappUI.updateALQueryBrowser(_currentSelection.rawRef.query.samples);
    }

    /**
     * Get the status of all running active learning processes from the active learning 
     * manager on the server.
     * @returns {Promise} A promise that resolves to an array of active learning processes
     * if the server request is successful. 
     */
    function _retrieveActiveLearningInfo() {
        let resolveLoad, rejectLoad;
        const loadPromise = new Promise((resolve, reject) => {
            resolveLoad = resolve;
            rejectLoad = reject;
        });
        const msg = {
            type: "getProcesses"
        };
        const req = _sendRequest(msg);
        req.onreadystatechange = function() {
            if (req.readyState === 4 && req.status === 200) {
                const response = JSON.parse(req.responseText);
                resolveLoad(response.response);
            }
            else if (req.readyState === 4) {
                rejectLoad();
            }
        };
        return loadPromise;
    }

    /**
     * Refreshes the list of running active learning processes. 
     * @returns {Promise} A Promise that resolves when the refresh is complete.
     */
    function refresh() {
        return _retrieveActiveLearningInfo().then(data => {
            _availableProcesses = data;
            _updateActiveLearningList();
        });
    }


    /**
     * Initialize the active learning picker. Should be called before any other
     * functions in the module are called.
     */
    function init() {
        _ALProcessesList = new SortableList(
            "#active-learning-list",
            "#active-learning-list-container",
            "id",
            _tableFields,
            _handleALClick,
            _handleALDoubleClick
        );
        $("#active-learning-list-refresh").click(() => refresh());
        $("#active-learning-open").click(_openActiveLearningQuery);
        $('#active-learning-picker').on('shown.bs.modal', () => refresh());
    }

    let _returnModal = true;
    let _prevModal;
    async function open() {
        await refresh();
        _prevModal = $(".modal.show");
        _prevModal.modal("hide");
        $("#active-learning-close-button").show();
        $("#active-learning-picker").modal("show");
        $("#active-learning-picker").one("hide.bs.modal", () => {
            if (_returnModal) {
                _prevModal.modal("show");
            }
        });
    }

    /**
     * Create a promise that resolves once the image has been loaded in the interface
     * and the user has been connected to the collaboration specified by the queried
     * sample. 
     * @param {ActiveLearningQueriedSample} sample The dictionary of the queried sample. 
     * @returns {Promise} The promise. 
     */
    function openImagePromise(sample) {
        return new Promise((resolve, reject) => {
            tmapp.openImage(sample.name, () => {});

            const viewer = tmapp.getViewer();
            if (!viewer) {
                reject(new Error("Viewer not available"));
                return;
            }
            viewer.addOnceHandler('open', () => {
                collabClient.connect(sample.collab, undefined, false, false, () => {
                    $('.modal').off('hide.bs.modal');
                    $("#active-learning-picker").modal("hide");
                    resolve();
                }, true);
            });
        });
    }

    /**
     * Open the image and connect the user to the collaboration of the queried sample. First
     * wait for the image to load and the user to connect to the collaboration, then add a 
     * rectangular annotation region to indicate the queried tile in the image. 
     * @param {ActiveLearningQueriedSample} sample The dictionary of the queried sample. 
     */
    async function openQueriedSample(sample) {
        let _errorDisplayTimeout = null;
        _errorDisplayTimeout = setTimeout(() => {tmappUI.displayImageError("waitingapi");_errorDisplayTimeout=null;},1000);
        if (_errorDisplayTimeout) {
            clearTimeout(_errorDisplayTimeout);
        }
        else {
            tmappUI.clearImageError();
        }
        await openImagePromise(sample);
        annotationHandler.add({
            "points": [
                {
                    "x": 4*256*sample.tile_x,
                    "y": 4*256*sample.tile_y
                },
                {
                    "x": 4*256*(sample.tile_x+1),
                    "y": 4*256*sample.tile_y
                },
                {
                    "x": 4*256*(sample.tile_x+1),
                    "y": 4*256*(sample.tile_y+1)
                },
                {
                    "x": 4*256*(sample.tile_x),
                    "y": 4*256*(sample.tile_y+1)
                }
            ],
            "assignments": [
                {
                    "annotationSet": "Queried tile",
                    "z": 0,
                    "mclass": "ROI",
                    "bookmarked": false,
                    "prediction": null
                }
            ]
        }, "image");
    }

    /**
     * Get the active learning setup from the active learning manager on the server (the 
     * setup includes available active learning methods).
     * @returns {Promise} A promise that resolves to a dictionary with the available active 
     * learning methods if the server request is successful. 
     */
    function _retrieveActiveLearningSetup() {
        let resolveLoad, rejectLoad;
        const loadPromise = new Promise((resolve, reject) => {
            resolveLoad = resolve;
            rejectLoad = reject;
        });
        const msg = {
            type: "getSetup"
        };
        const req = _sendRequest(msg);
        req.onreadystatechange = function() {
            if (req.readyState === 4 && req.status === 200) {
                const response = JSON.parse(req.responseText);
                resolveLoad(response.response);
            }
            else if (req.readyState === 4) {
                rejectLoad();
            }
        };
        return loadPromise;
    }

    /**
     * Send a request to the active learning manager to start a new active learning process
     * with the specified experiment parameters. 
     * @param {Object} parameters The experiment parameters of the new active learning process. 
     */
    function _requestNewActiveLearningProcess(parameters) {
        const msg = {
            type: "startProcess",
            parameters: parameters
        };
        _sendRequest(msg);
    }

    /**
     * Open the active learning process configuration window from which a new process can be 
     * launched. 
     */
    async function openConfiguration() {
        // Handle modals when closing the window.
        _returnModal = false;
        const activeModal = $(".modal.show");
        activeModal.modal("hide");
        $("#active-learning-configuration").modal("show");
        $("#active-learning-configuration").one("hide.bs.modal", () => {
            activeModal.modal("show");
            _returnModal = true;
            activeModal.one("hide.bs.modal", () => {
                if (_returnModal) {
                    _prevModal.modal("show");
                }
            });
        });

        // Reset fillable fields in the configuration window.
        $("#active-learning-configuration [name='name_ALConfig']").val("");
        $("#active-learning-configuration [name='annotation_rounds_ALConfig']").val("");
        $("#active-learning-configuration [name='budget_ALConfig']").val("");

        // Help function to initialize method selection buttons.
        function _initSelectButton(button, options) {
            button.empty();
            options.forEach(option => {
                const addOption = $(`<option ${""}></option>`);
                addOption.attr("value", option.value);
                addOption.text(option.name);
                button.append(addOption);
            });
        }
        
        // Get available active learning methods from the server.
        let setup;
        await _retrieveActiveLearningSetup().then(data => setup = data);

        // Set up informativeness function and sampling strategy selection buttons.
        const selectInfFunButton = $("#informativeness_function_ALConfig");
        const selectSamStrButton = $("#sampling_strategy_ALConfig");
        _initSelectButton(selectInfFunButton, setup.informativenessFunctions)
        _initSelectButton(selectSamStrButton, setup.samplingStrategies)

        // Help function to check if the entered string is valid.
        function _isValidField(field, mode) {
            if (field.trim() === "") {
                return "Field must not be empty";
            }
            if (mode === "rounds") {
                if (!/^\s*\d+\s*$/.test(field)) {
                    return "Field must contain a positive integer";
                }
            }
            else if (mode === "budget") {
                if (!/^\s*\d+\s*$/.test(field) && field.toLowerCase().trim() !== "all") {
                    return "Field must contain either a positive integer or the keyword 'all'";
                }
            }
            else if (mode !== "name") {
                throw new Error("Unrecognized mode in active learning config field validation function.");
            }
            return undefined;
        }

        // Set up launch process button click
        $("#launch_ALConfig").off("click").click(function(event) {
            const name = $("#active-learning-configuration [name='name_ALConfig']").val();
            const rounds = $("#active-learning-configuration [name='annotation_rounds_ALConfig']").val();
            const budget = $("#active-learning-configuration [name='budget_ALConfig']").val();
            const nameErrorMessage = _isValidField(name, "name");
            const roundsErrorMessage = _isValidField(rounds, "rounds");
            const budgetErrorMessage = _isValidField(budget, "budget");

            if (nameErrorMessage) {
                $("#name_ALConfig_error_message").text(nameErrorMessage).show();
            }
            else {
                $("#name_ALConfig_error_message").hide();
            }
            if (roundsErrorMessage) {
                $("#annotaion_rounds_ALConfig_error_message").text(roundsErrorMessage).show();
            }
            else {
                $("#annotaion_rounds_ALConfig_error_message").hide();
            }
            if (budgetErrorMessage) {
                $("#budget_ALConfig_error_message").text(budgetErrorMessage).show();
            }
            else {
                $("#budget_ALConfig_error_message").hide();
            }
            if (!nameErrorMessage && !roundsErrorMessage && !budgetErrorMessage) {
                const informativenessFunction = selectInfFunButton.val();
                const samplingStrategy = selectSamStrButton.val();
                _requestNewActiveLearningProcess({
                    name: name.trim(),
                    // author: userInfo.getName() ?? "Unnamed",
                    author: "CyBr",
                    informativenessFunction: informativenessFunction,
                    samplingStrategy: samplingStrategy,
                    annotationRounds: rounds.toLowerCase().trim(),
                    annotationBudget: budget.toLowerCase().trim(),
                    createdOn: dateUtils.getCurrentTimeAsString()
                });
                $("#active-learning-configuration").modal("hide");
                console.log(`Launched new active learning process: ${name}`);
            }
        });
    }

    return {
        refresh: refresh,
        open: open,
        openQueriedSample: openQueriedSample,
        openConfiguration: openConfiguration,
        init: init
    };
})();
