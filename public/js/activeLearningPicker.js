/**
 * Module for handling the visuals and logic of the al picker.
 * @namespace activeLearningPicker
 */
const activeLearningPicker = (function() {
    "use strict";

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
            sortable: true
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
    let _ALProcessesList = null;
    let _currentSelection = null;
    let _availableProcesses = [];

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

    function _unselectActive() {
        _ALProcessesList.unhighlightAllRows();
        _currentSelection = null;
        $("#active-learning-open").prop("disabled", true);
    }

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

    function _updateActiveLearningList() {
        if (!_ALProcessesList) {
            throw new Error("Tried to refresh AL picker before initialization.");
        }
        const displayedProcesses = _availableProcesses;
        _ALProcessesList.updateData(displayedProcesses);
        _tryRetainingCurrentSelection(displayedProcesses);
    }

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

    function _handleALDoubleClick(d) {
        _handleALClick(d);
        if (_currentSelection && d.status === "query") {
            _openActiveLearningQuery();
        }
    }

    function _requestSendAnnotations(id) {
        const req = new XMLHttpRequest();
        req.open("POST", window.location.api + "/activeLearning", true)
        req.setRequestHeader("Content-Type", "application/json");
        // Turn off caching of response
        req.setRequestHeader("Cache-Control", "no-cache, no-store, must-revalidate, max-age=0"); // HTTP 1.1
        req.setRequestHeader("Pragma", "no-cache"); // HTTP 1.0
        req.setRequestHeader("Expires", "0"); // Proxies
        const msg = {
            type: "annotateQuery",
            id: id
        };
        req.send(JSON.stringify(msg));
    }

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

    function _retrieveActiveLearningInfo() {
        let resolveLoad, rejectLoad;
        const loadPromise = new Promise((resolve, reject) => {
            resolveLoad = resolve;
            rejectLoad = reject;
        });
        const req = new XMLHttpRequest();
        req.open("POST", window.location.api + "/activeLearning", true)
        req.setRequestHeader("Content-Type", "application/json");
        // Turn off caching of response
        req.setRequestHeader("Cache-Control", "no-cache, no-store, must-revalidate, max-age=0"); // HTTP 1.1
        req.setRequestHeader("Pragma", "no-cache"); // HTTP 1.0
        req.setRequestHeader("Expires", "0"); // Proxies
        const msg = {
            type: "getProcesses"
        };
        req.send(JSON.stringify(msg));
        req.onreadystatechange = function() {
            if (req.readyState === 4 && req.status === 200) {
                const response = JSON.parse(req.responseText);
                resolveLoad(response.response.map(process => {
                    process.nQueried = process.query ? process.query.samples.length : "-";
                    process.queriedOn = process.query ? process.query.time : "-";
                    return process;
                }));
            }
            else if (req.readyState === 4) {
                rejectLoad();
            }
        };
        return loadPromise;
    }

    function refresh() {
        return _retrieveActiveLearningInfo().then(data => {
            _availableProcesses = data;
            _updateActiveLearningList();
        });
    }


    /**
     * Initialize the al picker. Should be called before any other
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

    
    function _retrieveActiveLearningSetup() {
        let resolveLoad, rejectLoad;
        const loadPromise = new Promise((resolve, reject) => {
            resolveLoad = resolve;
            rejectLoad = reject;
        });
        const req = new XMLHttpRequest();
        req.open("POST", window.location.api + "/activeLearning", true)
        req.setRequestHeader("Content-Type", "application/json");
        // Turn off caching of response
        req.setRequestHeader("Cache-Control", "no-cache, no-store, must-revalidate, max-age=0"); // HTTP 1.1
        req.setRequestHeader("Pragma", "no-cache"); // HTTP 1.0
        req.setRequestHeader("Expires", "0"); // Proxies
        const msg = {
            type: "getSetup"
        };
        req.send(JSON.stringify(msg));
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

    function _requestNewActiveLearningProcess(parameters) {
        const req = new XMLHttpRequest();
        req.open("POST", window.location.api + "/activeLearning", true)
        req.setRequestHeader("Content-Type", "application/json");
        // Turn off caching of response
        req.setRequestHeader("Cache-Control", "no-cache, no-store, must-revalidate, max-age=0"); // HTTP 1.1
        req.setRequestHeader("Pragma", "no-cache"); // HTTP 1.0
        req.setRequestHeader("Expires", "0"); // Proxies
        const msg = {
            type: "startProcess",
            parameters: parameters
        };
        req.send(JSON.stringify(msg));
    }

    async function openConfiguration() {
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

        $("#active-learning-configuration [name='name_ALConfig']").val("");
        $("#active-learning-configuration [name='annotation_rounds_ALConfig']").val("");
        $("#active-learning-configuration [name='budget_ALConfig']").val("");

        function _initSelectButton(button, options) {
            button.empty();
            options.forEach(option => {
                const addOption = $(`<option ${""}></option>`);
                addOption.attr("value", option.value);
                addOption.text(option.name);
                button.append(addOption);
            });
        }
        
        let setup;
        await _retrieveActiveLearningSetup().then(data => setup = data);

        // Set up informativeness function selection button
        const selectInfFunButton = $("#informativeness_function_ALConfig");
        const selectSamStrButton = $("#sampling_strategy_ALConfig");
        _initSelectButton(selectInfFunButton, setup.informativenessFunctions)
        _initSelectButton(selectSamStrButton, setup.samplingStrategies)

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
