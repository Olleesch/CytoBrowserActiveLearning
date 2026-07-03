/**
 * Module for handling the visuals and logic of the session browser. 
 * @namespace sessionBrowser
 */
const sessionBrowser = (function() {
    "use strict";

    const _tableFields = [
        {
            name: "Session",
            title: "Session name",
            key: "name",
            sortable: true
        },
        {
            name: "Image",
            key: "image",
            sortable: true
        },
        {
            name: "# Annotation sets",
            title: "Number of annotation sets",
            key: "nAnnotationSets",
            sortable: true
        },
        {
            name: "# Annotations",
            title: "Total number of annotations",
            key: "nAnnotations",
            sortable: true
        },
        {
            name: "# Active users",
            key: "nUsers",
            sortable: true
        },
        {
            name: "Updated",
            title: "Last edit",
            key: "updatedOn",
            sortable: true,
            selectFun: d => dateUtils.formatReadableDate(d.updatedOn)
        }
    ];
    let _sessionList = null;
    let _currentSelection = null;
    let _activeFilter = null;
    let _lastQueryWasValid = true;
    let _filterIsTrivial = true;
    let _availableSessions = [];

    function _setFilterError(error) {
        const input = $("#session-browser-filter-query-input");
        input.addClass("is-invalid");
        input.removeClass("is-valid");
        $("#session-browser-filter-query-error").text(error);
    }

    function _setFilterInfo(total, remaining) {
        const input = $("#session-browser-filter-query-input");
        const info = `Showing ${remaining} out of ${total} sessions`;
        input.removeClass("is-invalid");
        input.addClass("is-valid");
        $("#session-browser-filter-query-info").text(info);
    }

    function _clearFilterInfo() {
        const input = $("#session-browser-filter-query-input");
        input.removeClass("is-invalid");
        input.removeClass("is-valid");
    }

    function _setFilterWithQuery(query) {
        try {
            _activeFilter = filters.getFilterFromQuery(query);
            _filterIsTrivial = query.length === 0;
            _lastQueryWasValid = true;
            _updateSessionList();
            if (_filterIsTrivial) {
                _clearFilterInfo();
            }
        }
        catch (e) {
            _lastQueryWasValid = false;
            const error = e.message;
            _setFilterError(error);
        }
    }

    // A session passes the filter if its own fields match, or if any one of
    // its annotation sets (e.g. via a tag) matches.
    function _filterSessions(sessions) {
        if (!_activeFilter) {
            return sessions;
        }
        const filteredSessions = sessions.filter(session => {
            const sets = session.annotationSets && session.annotationSets.length > 0
                ? session.annotationSets
                : [null];
            return sets.some(set => {
                const filterableObject = set
                    ? filters.preprocessAnnotationSetBeforeFiltering(session, set)
                    : filters.preprocessSessionBeforeFiltering(session);
                return _activeFilter.evaluate(filterableObject);
            });
        });
        if (_lastQueryWasValid && !_filterIsTrivial) {
            _setFilterInfo(sessions.length, filteredSessions.length);
        }
        return filteredSessions;
    }

    function _initFilter() {
        // Repeated logic from the collab picker filter
        let keyUpTimeout = null;
        const keyUpTime = 3000;
        const input = $("#session-browser-filter-query-input");
        const initialQuery = input.val();
        _setFilterWithQuery(initialQuery);
        function updateQuery() {
            const query = input.val();
            _setFilterWithQuery(query);
        }
        input.keypress(e => e.stopPropagation());
        input.keyup(e => {
            e.stopPropagation();
            clearTimeout(keyUpTimeout);
            keyUpTimeout = setTimeout(updateQuery, keyUpTime);
        });
        input.keydown(e => {
            e.stopPropagation();
            if (e.code === "Escape" || e.code === "Enter" || e.code === "NumpadEnter") {
                updateQuery();
            }
        });
    }

    // Get session info from the server, across all images.
    // HttpRequest to 'api/collaboration/allAvailable'
    function _retrieveSessions() {
        let resolveLoad, rejectLoad;
        const loadPromise = new Promise((resolve, reject) => {
            resolveLoad = resolve;
            rejectLoad = reject;
        });
        const sessionReq = new XMLHttpRequest();
        sessionReq.open("GET", window.location.api + "/collaboration/allAvailable", true);
        // Turn off caching of response
        sessionReq.setRequestHeader("Cache-Control", "no-cache, no-store, must-revalidate, max-age=0"); // HTTP 1.1
        sessionReq.setRequestHeader("Pragma", "no-cache"); // HTTP 1.0
        sessionReq.setRequestHeader("Expires", "0"); // Proxies

        sessionReq.send(null);
        sessionReq.onreadystatechange = () => {
            if (sessionReq.readyState === 4 && sessionReq.status === 200) {
                const available = JSON.parse(sessionReq.responseText).available;
                resolveLoad(available);
            }
            else if (sessionReq.readyState === 4) {
                rejectLoad();
            }
        };
        return loadPromise;
    }

    function _updateSessionList() {
        if (!_sessionList) {
            throw new Error("Tried to refresh session browser before initialization.");
        }
        const displayedSessions = _filterSessions(_availableSessions);
        _sessionList.updateData(displayedSessions);
        _tryRetainingCurrentSelection(displayedSessions);
    }

    function _selectActive(id) {
        _sessionList.unhighlightAllRows();
        _sessionList.highlightRow(id);
        _currentSelection = id;
        $("#session-browser-open").prop("disabled", false);
    }

    function _unselectActive() {
        _sessionList.unhighlightAllRows();
        _currentSelection = null;
        $("#session-browser-open").prop("disabled", true);
    }

    function _tryRetainingCurrentSelection(displayedSessions) {
        if (_currentSelection) {
            const selectionRemains = displayedSessions.some(session => {
                return session.id === _currentSelection;
            });
            if (selectionRemains) {
                _selectActive(_currentSelection);
            }
            else {
                _unselectActive();
            }
        }
    }

    // Renders the dropdown content for a session's annotation sets: name,
    // annotation count and tags (displayed as static colored pills). 
    function _renderAnnotationSetSummary(container, session) {
        const wrapper = $(`<div class="pl-5 text-left d-flex align-items-start" style="font-size: 0.85rem;"></div>`);
        const label = $(`<div class="text-muted mr-5" style="flex-shrink:0;"></div>`).text("Annotation sets:");
        wrapper.append(label);
        if (!session.annotationSets || session.annotationSets.length === 0) {
            wrapper.append(`<div class="text-muted font-italic">None</div>`);
        }
        else {
            const sets = $(`<div class="flex-grow-1"></div>`);
            session.annotationSets.forEach(set => {
                const row = $(`<div class="d-flex align-items-baseline"></div>`);
                const setLabel = $(`<div class="d-flex flex-shrink-0 align-items-baseline mr-2"></div>`);
                setLabel.append($(`<span class="font-weight-bold mr-2"></span>`).text(set.name));
                setLabel.append($(`<span class="text-muted mr-2"></span>`).text(`${set.nAnnotations} annotations`));
                const tagsWrap = $(`<div class="d-flex flex-wrap align-items-baseline"></div>`);
                (set.tags || []).forEach(tag => {
                    const pill = $(`<span class="badge mr-1 mb-1"></span>`)
                        .text(tag.name)
                        .css("background-color", tag.color)
                        .css("color", htmlHelper.getTextColorForBackground(tag.color));
                    tagsWrap.append(pill);
                });
                row.append(setLabel, tagsWrap);
                sets.append(row);
            });
            wrapper.append(sets);
        }
        $(container).empty().append(wrapper);
    }

    /**
     * This function is called from the UI
     */
    function _openSession() {
        const session = _availableSessions.find(s => s.id === _currentSelection);
        if (!session) {
            return;
        }
        $("#session-browser").modal("hide");
        if (session.image === tmapp.getImageName()) {
            collabClient.connect(session.id);
        }
        else {
            tmapp.openImage(session.image, () => collabClient.connect(session.id));
        }
    }

    function _handleSessionClick(d) {
        if (!_currentSelection) {
            _selectActive(d.id);
        }
        else if (d.id === _currentSelection) {
            _unselectActive();
        }
        else {
            _selectActive(d.id);
        }
    }

    function _handleSessionDoubleClick(d) {
        _handleSessionClick(d);
        if (_currentSelection) {
            _openSession();
        }
    }

    /**
     * Clear the currently displayed list of sessions.
     */
    function clear() {
        _availableSessions = [];
        _updateSessionList();
    }

    /**
     * Refresh the list of sessions currently shown in the session browser.
     */
    function refresh() {
        return _retrieveSessions().then(sessionData => {
            _availableSessions = sessionData;
            _updateSessionList();
        });
    }

    /**
     * Open the session browser, refreshing its contents first.
     */
    function open() {
        return refresh().then(() => {
            $("#session-browser").modal("show");
        });
    }

    /**
     * Initialize the session browser. Should be called before any other
     * functions in the module are called.
     */
    function init() {
        _sessionList = new SortableList(
            "#session-browser-list",
            "#session-browser-list-container",
            "id",
            _tableFields,
            _handleSessionClick,
            _handleSessionDoubleClick,
            null,
            {renderContent: _renderAnnotationSetSummary}
        );
        $("#session-browser-refresh").click(() => refresh());
        $("#session-browser-open").click(_openSession);
        _initFilter();
    }

    return {
        clear,
        refresh,
        open,
        init
    };
})();
