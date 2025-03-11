/**
 * Functions for generating different HTML components needed in other
 * parts of the code, to avoid making a mess elsewhere.
 * @namespace htmlHelper
 */
const htmlHelper = (function() {

    function _scaleRGB(color, scale) {
        return '#' + color.replace(/^#/, '').replace(/../g, color =>
          ('0' + Math.min(255, Math.max(0, Math.round(parseInt(color, 16) * scale))).toString(16)).substr(-2));
    }

    /**
     * @param {*} viewer 
     * @param {array} zLevels 
     * @returns element for OSD.addControl
     * Doc: https://seiyria.com/bootstrap-slider/
     */
    function buildFocusSlider(viewer,zLevels) {
        if (zLevels.length<2) return; //Nothing to focus
        const divElem = document.createElement("span");
        viewer.addControl(divElem, {anchor: OpenSeadragon.ControlAnchor.ABSOLUTE});
        
        divElem.id="focus_slider_div";
        divElem.style.position = "absolute";
        divElem.style.left = "0px";
        divElem.style.top = "45px";
        divElem.style.height = "100%";
        divElem.style.margin = "7px";

        const slider = `<input class="focus_slider" id="focus_slider_${viewer.id}" data-slider-id="focus_slider_${viewer.id}_internal" type="text" data-slider-orientation="vertical"/>`
        divElem.innerHTML=slider;
         
        $(`#focus_slider_${viewer.id}`).slider({
                reversed:true,
                focus: true,
                min:0,
                max:zLevels.length-1,
                value:tmapp.getFocusIndex(viewer),
                formatter: (val) => zLevels[val]
            })
            .on('change', (data) => {
                tmapp.setFocusIndex(data.value.newValue,viewer);
            });
    
        $(`#focus_slider_${viewer.id}_internal`)
            .addClass("focus_slider_internal")
            .css("height","max(100px,10%)");
    }

    function updateFocusSlider(viewer,val0) {
        const obj=$(`#focus_slider_${viewer.id}`);
        if (!obj) return;
        obj.slider('setValue', val0);
        viewer.setControlsEnabled(); //Show controls, similar as for panning using keyboard
    }

    function _annotationButtonRow(id, closeFun) {
        const activeAnnotationSetName = annotationSetHandler.getActiveAnnotationSet().name;
        const row = $(`
                <div class="row mt-4">
                </div>
            `);
        const delCol = $(`
                <div class="col-6">
                    <a class="card-link" href="javascript:void(0);">
                        <svg class="mr-1" style="fill: currentColor;height: 1.3em;width: 1.3em;vertical-align: text-bottom" viewBox="0 0 23 23">
                            <path d="M 3 9 H 20 V 6 Q 20 5 19 5 H 4 Q 3 5 3 6 z M 4 10 H 19 V 20 Q 19 22 17 22 H 6 Q 4 22 4 20 z M 7 5 V 4.5 Q 7 2 9.5 2 H 13.5 Q 16 2 16 4.5 V 5 H 14 V 4.5 Q 14 4 13.5 4 H 9.5 Q 9 4 9 4.5 V 5 z"></path>
                        </svg>
                        Delete
                    </a>
                </div>
            `);
        const bookmarkCol = $(`
                <div class="col-6">
                    <a class="card-link" href="javascript:void(0);">
                        <svg class="mr-1" style="fill: currentColor;height: 1.3em;width: 1.3em;vertical-align: text-bottom" viewBox="0 0 23 23">
                            <path></path>
                        </svg>
                        Bookmark
                    </a>
                </div>
            `);
        function setBookmarkPath() {
            const annotation = annotationHandler.getAnnotationById(id);
            const isBookmarked = annotation.assignments.find(a => a.annotationSet === activeAnnotationSetName).bookmarked;
            const path = bookmarkCol.find("svg path");
            if (isBookmarked) {
                path.attr("d", "M 6 2 V 21 L 12 15 L 18 21 V 2 z");
            }
            else {
                path.attr("d", "M 6 2 V 21 L 12 15 L 18 21 V 2 z M 8 4 H 16 V 16 L 12 12 L 8 16 z");
            }
        }
        setBookmarkPath();
        delCol.find("a").click(() => {
            closeFun();
            annotationHandler.remove(id, activeAnnotationSetName);
        });
        bookmarkCol.find("a").click(() => {
            annotationHandler.setBookmarked(id, activeAnnotationSetName);
            setBookmarkPath();
        });
        row.append(delCol, bookmarkCol);
        return row;
    }

    function _annotationValueRow(label, value) {
        const row = $(`
            <div class="form-group row">
                <label class="col-4 col-form-label">
                    ${label}
                </label>
                <div class="col-8">
                    <input type="text" readonly class="form-control">
                </div>
            </div>
        `);
        row.find("input").attr("value", value);
        return row;
    }

    function _annotationMclassOptions(annotation, updateFun) {
        const container = $(`
            <div class="form-group row">
                <label class="col-4 col-form-label">
                    Class
                </label>
                <div class="col-8">
                    <select class="form-control">
                    </select>
                </div>
            </div>
        `);
        const select = container.find("select");
        // Q: Used to build annotation settings menu, this way only allows 
        // modifying the class in the current annotation set. Ok or should 
        // we be able to change the class in different annotation sets in
        // one place?
        const activeAnnotationSetName = annotationSetHandler.getActiveAnnotationSet().name;
        const assignment = annotation.assignments.find(a => a.annotationSet === activeAnnotationSetName);
        annotationSetHandler.forEachClass(mclass => {
            const selected = assignment.mclass === mclass.name;
            const option = $(`
                <option ${selected ? "selected='selected'" : ""}>
                </option>
            `);
            option.attr("value", mclass.name);
            option.text(mclass.name);
            select.append(option);
        });
        select.change(() => {
            // The clone is necessary since the saveFun calls annotationHandler.update(), which expects the updated
            // annotation to not be a reference to an existing entry in the annotation data since it finds the
            // corresponding id and processes the differences between the existing and updated annotation. In the
            // cases of focus and comments below, this doesn't cause any issues, but in the case of the annotation 
            // class, not using a clone temporarily messes up the class counts. Thus, we use a clone below. 
            const modifiedAnnotation = JSON.parse(JSON.stringify(annotation));  // Q: Use _cloneAnnotation from annotationHandler instead?
            modifiedAnnotation.assignments.find(a => a.annotationSet === activeAnnotationSetName).mclass = select.val();
            updateFun(modifiedAnnotation);
        });
        return container;
    }

    function _annotationFocus(annotation, updateFun) {
        const container = $(`
            <div class="form-group row">
                <label class="col-4 col-form-label">
                    z level
                </label>
                <div class="col-8">
                    <select class="form-control">
                    </select>
                </div>
            </div>
        `);
        const select = container.find("select");
        const activeAnnotationSetName = annotationSetHandler.getActiveAnnotationSet().name;
        const assignment = annotation.assignments.find(a => a.annotationSet === activeAnnotationSetName);
        const zLevels = tmapp.getZLevels(); //of _viewer
        zLevels.forEach(z => {
            const selected = assignment.z === z;
            const option = $(`
                <option ${selected ? "selected='selected'" : ""}>
                </option>
            `);
            option.attr("value", z);
            option.text(z);
            select.append(option);
        });
        select.change(() => {
            assignment.z = Number(select.val());
            updateFun(annotation);
        });
        return container;
    }

    function _commentAlt(comment, removeFun) {
        const entry = $(`
            <li class="list-group-item">
                <p class="text-break comment_body" style="white-space: pre-line"></p>
                <div class="small d-flex justify-content-between">
                    <span class="text-muted">
                        Added by <span class="comment_author"></span>
                    </span>
                    <a href="javascript:void(0)">
                        Remove
                    </a>
                </div>
            </li>
        `);
        entry.find(".comment_body").text(comment.content);
        entry.find(".comment_author").text(comment.author);
        const removeBtn = entry.find("a");
        removeBtn.click(() => removeFun(comment.id));
        return entry;
    }

    function _comment(comment, removeFun) {
        const entry = $(`
            <li class="list-group-item">
                <p class="text-break comment_body" style="white-space: pre-line"></p>
                <div class="small d-flex justify-content-between">
                    <span class="text-muted">
                        Added by <span class="comment_author"></span>
                    </span>
                    <a href="javascript:void(0)">
                        Remove
                    </a>
                </div>
            </li>
        `);
        entry.find(".comment_body").text(comment.body);
        entry.find(".comment_author").text(comment.author);
        const removeBtn = entry.find("a");
        removeBtn.click(removeFun);
        return entry;
    }

    function _commentListAlt() {
        const container = $(`
            <div class="card bg-secondary mb-2" style="height: 15vh; overflow-y: auto; resize: vertical;">
                <ul class="list-group list-group-flush position-absolute w-100">
                </ul>
            </div>
        `);
        return container;
    }

    function _addFunctionalityToCommentList(listContainer, removeFun) {
        const list = listContainer.find("ul");
        let stuckToBottom = false;
        const updateComments = (comments => {
            const shouldStickToBottom = stuckToBottom;
            list.empty();
            comments.forEach(comment => {
                const entry = _commentAlt(comment, removeFun);
                list.append(entry);
            });
            if (shouldStickToBottom) {
                listContainer.scrollTop(list.height() - listContainer.height());
            }
        });
        const stickState = (state => {
            const hasHeight = listContainer.height() !== 0 && list.height() !== 0;
            const fitsInContainer = listContainer.height() > list.height();
            const atBottom = list.height() - (listContainer.height() + listContainer.scrollTop()) < 20;
            if (hasHeight && (fitsInContainer || atBottom)) {
                stuckToBottom = true;
            }
            else if (state !== undefined) {
                stuckToBottom = state;
            }
            return stuckToBottom;
        });
        const commentSection = new CommentSection(stickState, updateComments);
        const tryStickingToBottom = () => {
            const distToBottom = list.height() - (listContainer.height() + listContainer.scrollTop());
            stuckToBottom = distToBottom < 20;
            if (stuckToBottom) {
                commentSection.allCommentsInView();
            }
        };
        listContainer.scroll(tryStickingToBottom);
        const heightObserver = new MutationObserver(tryStickingToBottom);
        heightObserver.observe(listContainer.get(0), {
            attributes: true,
            attributeFilter: ["style"]
        });
        return commentSection;
    }

    function _commentList(commentable, updateFun) {
        if (!commentable.comments)
            commentable.comments = [];
        const comments = commentable.comments;

        const container = $(`
            <div class="card bg-secondary mb-2" style="height: 15vh; overflow-y: auto;">
                <ul class="list-group list-group-flush">
                </ul>
            </div>
        `);
        container.appendComment = comment => {
            const entry = _comment(comment, event => {
                event.preventDefault();
                const index = comments.indexOf(comment);
                comments.splice(index, 1);
                entry.closest("[tabindex]").focus();
                entry.remove();
                updateFun(commentable);
            });
            list.append(entry);
            updateFun(commentable);
        };
        const list = container.find("ul");
        comments.forEach(container.appendComment);
        return container;
    }

    function _commentInputAlt(inputFun) {
        const container = $(`
            <div class="input-group">
                <textarea name="comment" class="form-control" rows="1" style="resize: vertical;"></textarea>
                <div class="input-group-append">
                    <button type="button" class="btn btn-primary">Add comment</button>
                </div>
            </div>
        `);
        const submitButton = container.find("button");
        submitButton.click(() => {
            const textarea = container.find("textarea");
            const body = textarea.val();
            if (body.length > 0) {
                    textarea.val("");
                    inputFun(body);
                }
            });
        container.keypress(e => e.stopPropagation());
        container.keyup(e => e.stopPropagation());
        container.keydown(e => {
            e.stopPropagation();
            if ((e.code === "Enter" || e.code === "NumpadEnter") && !e.shiftKey) {
                e.preventDefault();
                submitButton.click();
            }
            else if (e.code === "Escape") {
                $("#main_content").focus();
            }
        });
        return container;
    }

    function _commentInput(inputFun) {
        const container = $(`
            <div class="input-group">
                <textarea class="form-control" rows="1" style="resize: none;"></textarea>
                <div class="input-group-append">
                    <button type="button" class="btn btn-primary">Add comment</button>
                </div>
            </div>
        `);
	    const submitButton = container.find("button");
        submitButton.click(() => {
            const textarea = container.find("textarea");
            const body = textarea.val();
            textarea.val("");
            inputFun(body);
        });
        container.keypress(e => e.stopPropagation());
        container.keyup(e => e.stopPropagation());
        container.keydown(e => {
            e.stopPropagation();
            if ((e.code === "Enter" || e.code === "NumpadEnter") && !e.shiftKey) {
                e.preventDefault();
		        submitButton.click();
            }
            else if (e.code === "Escape") {
                container.parent().parent().focus();
            }
        });
        return container;
    }

    function _classSelectionButton(mclass, active) {
        const active_color=_scaleRGB(mclass.color,0.5);

        //To set 'style="background-color: ${mclass.color};"' works here, but se we cannot use
        //pseudo-selectors (e.g. hover) in inline style, we do all colors below with CSS
        const button = $(`
            <label id="class_${mclass.name}" class="btn px-0 px-md-1 px-lg-2" title="${mclass.description}">
                <input type="radio" name="class_options" autocomplete="off">${mclass.name}</input>
                <span class="badge badge-light mt-1 d-block" id="class_counter_${mclass.name}">0</span>
            </label>
        `);
        button.css("color", _getTextColorForBackground(mclass.color));
        button.css("border", "1px solid #343a40");

        if (active)
            button.addClass("active");
        button.click(() => {
            annotationTool.setMclass(mclass.name);
        });

        //Since we cannot set pseudo-selectors inline, we have to create CSS
        cssHelper.createCSSSelector(`#class_${mclass.name}`,`background-color: ${mclass.color};`);
        cssHelper.createCSSSelector(`#class_${mclass.name}:hover`,`background-color: ${active_color};`);
        cssHelper.createCSSSelector(`#class_${mclass.name}:active`,`background-color: ${active_color};`); //while pressed
        //Keep the select-box-shadow permanently (offset-x,offset-y,blur,width,color)
        cssHelper.createCSSSelector(`#class_${mclass.name}.active`,`background-color: ${mclass.color};box-shadow: 0 0 0.1rem .25rem rgba(0,0,0,0.5);`); //if enabled
        cssHelper.createCSSSelector(`#class_${mclass.name}:visited`,`background-color: ${active_color};`);
        cssHelper.createCSSSelector(`#class_${mclass.name}:focus`,`background-color: ${active_color};`);

        return button;
    }
    
    function _annotationSetSelectionButton(annotationSet, active) {
        const annotationSetID = annotationSetHandler.getIDFromAnnotationSetName(annotationSet.name);
        const button = $(`
            <label id="annotation_set_${annotationSetID}"
                   class="btn btn-primary position-relative d-inline-block text-center px-2 py-2"
                   style="min-width: 100px;" title="${annotationSet.description}">
                <input type="radio" name="annotation_set_options" autocomplete="off" class="d-none">
                <div>${annotationSet.name}</div>
                <span class="badge badge-light d-block mt-1" id="annotation_set_counter_${annotationSetID}">
                    0
                </span>
                <div class="position-absolute d-flex align-items-center"
                    style="top: 2px; right: 4px; gap: 4px;">
                    <span class="spinner-border spinner-border-sm d-none" role="status" aria-hidden="true"></span>
                    <span class="d-none" data-toggle="tooltip" title="">
                        <i class="fas fa-info-circle"></i>
                    </span>
                </div>
            </label>
        `);
        button.find("[data-toggle='tooltip']").tooltip();
        if (active)
            button.addClass("active");
        button.click(() => {
            annotationSetHandler.setActiveAnnotationSet(annotationSet.name);
        });
        return button;
    }

    function setSelectedAnnotationSetSelectionButton(selectedAnnotationSetName) {
        annotationSetHandler.forEachAnnotationSet(annotationSet => {
            const button = $(`#annotation_set_${annotationSetHandler.getIDFromAnnotationSetName(annotationSet.name)}`);
            if (annotationSet.name === selectedAnnotationSetName) {
                button.addClass("active");
            } else {
                button.removeClass("active");
            }
        });
    }

    function updateLockedAnnotationSetButtonDisplays() {
        const activeAnnotationSetName = annotationSetHandler.getActiveAnnotationSet().name;
        const lockedAnnotationSets = annotationSetHandler.getLockedAnnotationSets();
        if (annotationSetHandler.isLockedAnnotationSet(activeAnnotationSetName)) {
            $("#modify_annotation_set").prop("disabled", true);
            $("#remove_annotation_set").prop("disabled", true);
            $("#copy_annotation_set").prop("disabled", true);
        } else {
            $("#modify_annotation_set").prop("disabled", false);
            $("#remove_annotation_set").prop("disabled", false);
            $("#copy_annotation_set").prop("disabled", false);
        }
        annotationSetHandler.forEachAnnotationSet(a => {
            const button = $(`#annotation_set_${annotationSetHandler.getIDFromAnnotationSetName(a.name)}`);
            const infoIcon = button.find("[data-toggle='tooltip']");
            const lockedSetInfo = lockedAnnotationSets.find(lockedSet => lockedSet.annotationSetName === a.name);
            if (lockedSetInfo) {
                button.find(".spinner-border").removeClass("d-none");
                infoIcon.removeClass("d-none");
                infoIcon.attr("title", `Locked: ${lockedSetInfo.reason}`);
                infoIcon.tooltip('dispose').tooltip(); 
            } else {
                button.find(".spinner-border").addClass("d-none");
                infoIcon.addClass("d-none");
            }
        });
    }

    function _collaboratorListEntry(member, local, active, following) {
        const entry = $(`
            <a class="list-group-item list-group-item-action d-flex
            justify-content-between align-items-center" href="javascript:void(0)">
                <span>
                    <span class="badge badge-pill" style="background-color: ${member.color};">
                        &nbsp;
                    </span>
                    &nbsp;&nbsp;&nbsp;
                    <span class="collaborator-list-name"></span>
                </span>
                <span>
                    <input type="checkbox">
                </span>
            </a>
        `);
        entry.find(".collaborator-list-name").text(`${member.name}${local? " (me)" : following ? " (following)" : ""}`);
        const checkbox = entry.find("input");
        if (!active) {
            entry.addClass("disabled");
            checkbox.prop("disabled", true);
        }
        entry.click(event => {
            event.preventDefault();
            entry.closest(".modal").modal("hide");
            tmapp.moveTo(member.position);
        });
        checkbox.prop("checked", member.followed);
        checkbox.click(event => {
            event.stopPropagation();
            if (event.target.checked)
                collabClient.followView(member);
            else
                collabClient.stopFollowing();
        });
        return entry;
    }

    function _emptyImageBrowser() {
        return $(`
            <div class="col-12 text-center">
                <p class="m-4">No images were found on the server.</p>
            </div>
        `);
    }

    function _imageBrowserEntry(image) {
        let entry;
        if (image.thumbnails && image.thumbnails.overview && image.thumbnails.detail) {
            entry = $(`
            <div class="col-3 d-flex">
                <div class="card w-100">
                    <img src="${image.thumbnails.overview}" class="card-img-top position-absolute"
                    style="height: 130px; object-fit: cover;">
                    <img src="${image.thumbnails.detail}" class="card-img-top fade hide"
                    style="z-index: 9000; pointer-events: none; height: 130px; object-fit: cover;">
                    <div class="card-body text-center" style="padding:0;" >
                        <a class="card-link stretched-link" href="?image=${image.name}">
                            ${image.name}
                        </a>
                    </div>
                </div>
            </div>
            `);
            const anchor = entry.find("a");
            const detail = entry.find("img:eq(1)");
            anchor.click(event => {
                event.preventDefault();
                entry.closest(".modal").modal("hide");
                collabPicker.open(image.name);
            });
            anchor.hover(
                () => detail.addClass("show").removeClass("hide"),
                () => detail.addClass("hide").removeClass("show")
            );
        }
        else {
            entry = $(`
            <div class="col-3 d-flex">
                <div class="card w-100">
                    <img src="data:," alt="&nbsp;Broken image path" class="card-img-top position-absolute m-1 m-xl-4">
                    <div class="card-body text-center" style="padding:0;padding-top:130px;" >
                        <a class="card-link stretched-link" href="?image=${image.name}">
                            ${image.name}
                        </a>
                    </div>
                </div>
            </div>
            `);
        }
        return entry;
    }

    function _imageBrowserRow(images) {
        const row = $(`
            <div class="row mb-4">
            </div>
        `);
        images.forEach(image => row.append(_imageBrowserEntry(image)));
        return row;
    }

    function _annotationSetNameRow() {
        const nameRow = $(`
            <div class="form-row pb-4">
                <label class="col-3 col-form-label">Name</label>
                <div class="col-9">
                    <input type="text" name="name" class="form-control" placeholder="Annotation set name">
                    <div name="name_error_message" style="color: red; font-size: 14px; display: none;"></div>
                </div>
            </div>
        `);
        const nameField = nameRow.find("input[name='name']");
        const nameErrorLabel = nameRow.find("div[name='name_error_message']");
        return [nameRow, nameField, nameErrorLabel];
    }
    
    function _annotationSetDescriptionRow() {
        const descriptionRow = $(`
            <div class="form-row pb-4">
                <label class="col-3 col-form-label">Description</label>
                <div class="col-9">
                    <textarea name="description" class="form-control" placeholder="Annotation set description" rows="4"></textarea>
                </div>
            </div>
        `);
        const descriptionField = descriptionRow.find("textarea[name='description']");
        return [descriptionRow, descriptionField];
    }

    function _annotationSetClassConfigSelectRow(classData) {
        const classConfigRow = $(`
            <div class="form-row pb-5">
                <label class="col-3 col-form-label">Class config</label>
                <div class="col-9">
                    <select class="form-control"></select>
                    <div name="class_config_info" class="pt-2" style="font-size: 12px; font-style: italic; display: none;"></div>
                </div>
            </div>
        `);
        const classConfigSelect = classConfigRow.find("select");
        const classConfigInfoLabel = classConfigRow.find("[name='class_config_info']");
        // TODO: This should maybe be handled better than hard-coding the pre-made class configs. 
        // An idea is to make "defaultClassConfig.js" into a list of pre-made configs. In the rest of the app, 
        // we could use defaultClassConfigs[0] or something similar, here we could access different ones. 
        const defaultOption = $(`
            <option selected value="default">
                Bethesda system (default)
            </option>
        `);
        classConfigSelect.append(defaultOption);
        const abnormalityOption = $(`
            <option value="abnormality">
                Cell abnormality
            </option>
        `);
        classConfigSelect.append(abnormalityOption);
        const customOption = $(`
            <option value="custom">
                Custom configuration
            </option>
        `);
        classConfigSelect.append(customOption);
        classConfigSelect.change(() => {
            switch (classConfigSelect.val()) {
                case "default":
                    classData.classConfig = JSON.parse(JSON.stringify(defaultClassConfig));
                    break;
                case "abnormality":
                    classData.classConfig = [
                        {
                            name: "Normal",
                            description: "Normal-appearing nucleus",
                            color: "#346d2e"
                        },
                        {
                            name: "Abnormal",
                            description: "Abnormal-appearing nucleus",
                            color: "#f03c3c"
                        }
                    ];
                    break;
                case "custom":
                    classData.classConfig = [
                        {
                            name: "",
                            description: "",
                            color: "#346d2e"
                        }
                    ];
                    break;
                default:
                    console.warn("The class configuration selected in the annotation set menu is not a valid option.");
            }
            _createClassConfigButtonRow(classData, false);
        });
        return [classConfigRow, classConfigSelect, classConfigInfoLabel];
    }

    function _annotationSetCheckboxRow(label, id) {
        const checkboxWrapper = $(`
            <div class="form-row align-items-center mb-2">
                <div class="col-12 d-flex justify-content-center">
                    <div class="custom-control custom-switch">
                        <input type="checkbox" class="custom-control-input" id="${id}">
                        <label class="custom-control-label px-1" for="${id}">${label}</label>
                    </div>
                </div>
            </div>
        `);
        const checkbox = checkboxWrapper.find(`#${id}`);
        return [checkboxWrapper, checkbox];
    }

    function _annotationSetClassControlsHeader(){
        const classControlsHeader = $(`
            <div class="form-row">
                <div class="col-12 pb-1">
                    <h5>Class controls</h5>
                </div>
            </div>
            <hr class="mb-1 mt-0">
            <div class="form-row pb-0">
                <div class="col-12 text-center">
                    <h6 class="col-form-label">Current class configuration</h6>
                </div>
            </div>
        `);
        return classControlsHeader;
    }

    function _annotationSetClassConfigButtonRow() {
        const classConfigButtonRow = $(`
            <div class="d-flex flex-wrap align-items-center" name="class_buttons_row"></div>
        `);
        new Sortable(classConfigButtonRow.get(0), {
            animation: 150,
            draggable: "button:not(.add-class-btn)",
            filter: ".add-class-btn"
        });
        return classConfigButtonRow;
    }

    function _annotationSetClassControlFields(classData) {
        const classControlFieldsWrapper = $(`
            <div>
                <div name="class_config_error_message" style="color: red; font-size: 14px; display: none;"></div>
            </div>
            <div class="form-row pt-3 pb-2">
                <div class="col-5 d-flex flex-column">
                    <label class="col-form-label">Name</label>
                    <input type="text" name="class_name" class="form-control mb-0" placeholder="Class name">
                    <label class="col-form-label">Color</label>
                    <button type="button" class="btn btn-block btn-secondary" name="class_color" style="width:100%; height:100%; background-color:#346d2e;"></button>
                    <input type="color" name="hidden_class_color" style="height:1px;opacity:0;" value="#346d2e">
                </div>
                <div class="col-7">
                    <label class="col-form-label">Description</label>
                    <textarea name="class_description" class="form-control" placeholder="Class description" rows="4"></textarea>
                </div>
            </div>
        `);
        const classErrorLabel = classControlFieldsWrapper.find("div[name='class_config_error_message']");
        const classNameField = classControlFieldsWrapper.find("input[name='class_name']");
        const classColorButton = classControlFieldsWrapper.find("button[name='class_color']");
        const hiddenClassColorField = classControlFieldsWrapper.find("input[name='hidden_class_color']");
        const classDescriptionField = classControlFieldsWrapper.find("textarea[name='class_description']");

        classColorButton.on("click", () => hiddenClassColorField.click());

        classNameField.on("input", function() {
            const selected = classData.classConfigButtonRow.find(".class-btn.border-dark");
            if (selected.length) {
                selected.text($(this).val());
                selected.data("mclass").name = $(this).val();
            }
        });
        hiddenClassColorField.on("input", function() {
            const color = $(this).val();
            classColorButton.css("background-color", color);
            const selected = classData.classConfigButtonRow.find(".class-btn.border-dark");
            if (selected.length) {
                selected.css("background-color", color);
                selected.css("color", _getTextColorForBackground(color));
                selected.data("mclass").color = color;
            }
            classColorButton.css("background-color", color);
        });
        classDescriptionField.on("input", function() {
            const selected = classData.classConfigButtonRow.find(".class-btn.border-dark");
            if (selected.length) {
                selected.data("mclass").description = $(this).val();
            }
        });
        return [classControlFieldsWrapper, classErrorLabel, classNameField];
    }

    function _annotationSetSaveButton(buttonText, saveFun) {
        const saveButtonWrapper = $(`
            <hr class="mb-3">
            <div class="form-row pb-2">
                <div class="col-12">
                    <button name="save_button" type="button" class="btn btn-block btn-primary">
                        ${buttonText}
                    </button>
                </div>
            </div>
        `);
        const saveButton = saveButtonWrapper.find("button[name='save_button']");

        saveButton.off("click").click(saveFun);

        return saveButtonWrapper;
    }

    function _isValidAnnotationSetName(name, mode) {
        if (name === "") {
            return "Annotation set name must not be empty";
        }
        if (["points", "id", "x", "y", "originalauthor", "assignments", "z", "mclass", "author", 
             "bookmarked", "prediction", "originalid", "comments"].includes(name.toLowerCase())) {
            return "Annotation set name must not be the same as an internal key name of the \
                annotation storage format to avoid confusion."
        }
        if (mode === "rename") {
            const activeAnnotationSet = annotationSetHandler.getActiveAnnotationSet();
            if (annotationSetHandler.getAnnotationSetConfig().some(annotationSet => {
                return annotationSet.name === name && annotationSet.name !== activeAnnotationSet.name;
            })) {
                return "Annotation set name must not be the same as a previously existing annotation set name";
            }
        } else if (mode === "add") {
            if (annotationSetHandler.getAnnotationSetConfig().some(annotationSet => {
                return annotationSet.name === name;
            })) {
                return "Annotation set name must not be the same as a previously existing annotation set name";
            }
        } else {
            throw new Error("Unrecognized mode in annotation set menu isValidName.");
        }
        return undefined;
    }

    function _isValidClassConfig(classConfig) {
        const seenNames = new Set();
        // const seenColors = new Set();
        if (classConfig.length === 0) {
            return "Class config may not be empty! Try adding some classes with the '+' button to the far right above.";
        }
        for (const mclass of classConfig) {
            if (mclass.name === "") {
                return "Class name must not be empty for any class! Check each class above and make sure they all have a name.";
            }
            if (!(/^[A-Za-z0-9_-]+$/.test(mclass.name))) {
                return "Class names must only contain letters (A-Z, a-z), digits (0-9), hyphens (-), and underscores (_)! \
                        check all classes above and make sure they all have a valid name.";
            }
            if (seenNames.has(mclass.name)) return "Class config may not contain two classes with the same name";
            seenNames.add(mclass.name);
            // if (seenColors.has(mclass.color)) return "Class config may not contain two classes with the same color";
            // seenColors.add(mclass.color);
        }
        return undefined;
    }

    function _getTextColorForBackground(hexColor) {
        const bigint = parseInt(hexColor.slice(1), 16);
        const r = (bigint >> 16) & 255;
        const g = (bigint >> 8) & 255;
        const b = bigint & 255;
        const rgb = [r, g, b];
        const brightness = (rgb[0]*299 + rgb[1]*587 + rgb[2]*114)/1000;
        return brightness > 186 ? "#000000" : "#ffffff";
    }

    function _createClassConfigButtonRow(classData, createAddButton=false) {

        const classNameField = classData.classControlFieldsWrapper.find("[name='class_name']");
        const classColorButton = classData.classControlFieldsWrapper.find("[name='class_color']");
        const hiddenClassColorField = classData.classControlFieldsWrapper.find("[name='hidden_class_color']");
        const classDescriptionField = classData.classControlFieldsWrapper.find("[name='class_description']");

        function _createClassButton(mclass) {
            const btn = $(`
                <button type="button" class="btn btn-sm mr-1 mb-1 class-btn" 
                        style="background-color:${mclass.color}; color:${_getTextColorForBackground(mclass.color)}; position: relative;">
                    ${mclass.name}
                </button>
            `);
            btn.data("mclass", mclass);
            btn.on("click", function() {
                classData.classConfigButtonRow.find(".class-btn").removeClass("border border-dark").css("box-shadow", "");
                $(this).addClass("border border-dark").css("box-shadow", "0 0 3.75px 1.5px rgba(0,0,0,0.8)");
                classNameField.val(mclass.name);
                classColorButton.css("background-color", mclass.color);
                hiddenClassColorField.val(mclass.color);
                classDescriptionField.val(mclass.description);
            });
            const popup = $(`
                <div class="popup border rounded shadow-sm" 
                    style="position: absolute; top: 102%; left: 0; z-index: 1050; display: none; cursor: pointer; background-color: #ffffff;">
                    <div class="text-danger px-2 py-1">Delete class</div>
                </div>
            `);
            popup.on("click", function() {
                if (classData.controlsDisabled) return;
                popup.remove();
                btn.remove();
                const remaining = classData.classConfigButtonRow.find(".class-btn").first();
                if (remaining.length) remaining.click();
            });
            btn.append(popup);
            popup.find("div").hover(
                function() { popup.css("background-color", "#e0e0e0"); },
                function() { popup.css("background-color", "#ffffff"); }
            );
            btn.on("contextmenu", function(e) {
                if (classData.controlsDisabled) return;
                e.preventDefault();
                classData.classConfigButtonRow.find(".popup").hide();
                popup.show();
                e.stopPropagation();
                $(document).one("mousedown", function(e) {
                    if (!popup.is(e.target) && popup.has(e.target).length === 0) {
                        popup.hide();
                    }
                });
            });
            return btn;
        }

        function _createAddClassButton() {
            const addBtn = $(`
                <button type="button" class="btn btn-sm btn-secondary mb-1 add-class-btn">+</button>
            `);
            addBtn.on("click", function() {
                const newClass = {
                    name: "",
                    description: "",
                    color: "#346d2e"
                };
                const btn = _createClassButton(newClass);
                btn.insertBefore(addBtn);
                btn.click();
            });
            return addBtn;
        }

        if (createAddButton) {
            const addBtn = _createAddClassButton();
            classData.classConfigButtonRow.append(addBtn);
        }

        classData.classConfigButtonRow.find("button").not(".add-class-btn").remove();
        classData.classConfig.forEach(mclass => {
            const btn = _createClassButton(mclass);
            btn.insertBefore(classData.classConfigButtonRow.find(".add-class-btn"));
        });
        classData.classConfigButtonRow.find(".class-btn").first().click();
    }

    // Seemingly not in use (not up to date)
    // /**
    //  * Fill a jquery selection with a comment section.
    //  * @param {Object} container The selection that should contain the
    //  * comment section.
    //  * @param {Object} commentable The object that will store the
    //  * comments. The comments will be added to an array in the `comments`
    //  * field of the object, which will be created if no such field
    //  * already exists.
    //  * @param {Object} updateFun The function that should be run when
    //  * pressing the save button in the menu.
    //  */
    // function buildCommentSection(container, commentable, updateFun) {
    //     const list = _commentList(commentable, updateFun);
    //     const input = _commentInput(body => {
    //         const comment = {
    //             author: userInfo.getName(),
    //             body: body
    //         };
    //         list.appendComment(comment);
    //         commentable.comments.push(comment);
    //         updateFun();
    //     });
    //     container.append(list, input);
    // }

    /**
     * Fill a jquery selection with a comment section.
     * @param {Object} container The selection that should contain the
     * comment section.
     * @param {Function} inputFun The function to which the comment text
     * should be passed when the submit button is pressed.
     * @param {Function} removeFun The function to which the comment id
     * should be passed when the remove button is pressed.
     * @returns {CommentSection} CommentSection object that can be used
     * to interface with the comment section HTML.
     */
    function buildCommentSectionAlt(container, inputFun, removeFun) {
        // TODO: Change the other comment section to use this
        const listContainer = _commentListAlt();
        const commentSection = _addFunctionalityToCommentList(listContainer, removeFun);
        const input = _commentInputAlt(inputFun);
        container.append(listContainer, input);
        return commentSection;
    }

    /**
     * Fill a jquery selection with the nodes for editing an annotation.
     * @param {Object} container The selection that should contain the
     * annotation editing menu.
     * @param {annotationHandler.AnnotationPoint} annotation The annotation
     * that should be editable through the created menu.
     * @param {Function} closeFun A function that can be called to close
     * the annotation menu.
     * @param {Function} saveFun The function that should be run when
     * pressing the save button in the menu.
     */
    function buildAnnotationSettingsMenu(container, annotation, closeFun, saveFun) {
        const activeAnnotationSetName = annotationSetHandler.getActiveAnnotationSet().name;
        const updateFun = saveFun;
        const id = _annotationValueRow("Id", annotation.id);
        const author = _annotationValueRow("Created by", annotation.assignments.find(a => a.annotationSet === activeAnnotationSetName).author);
        const classes = _annotationMclassOptions(annotation, updateFun);
        const focus = _annotationFocus(annotation, updateFun);
        const list = _commentList(annotation, updateFun);
        const input = _commentInput(body => {
            const comment = {
                author: userInfo.getName(),
                body: body
            };
            list.appendComment(comment);
            annotation.comments.push(comment);
            updateFun(annotation);
        });
        const buttonRow = _annotationButtonRow(annotation.id, closeFun);
        container.append(id, author, classes, focus, list, input, buttonRow);
    }

    /**
     * Fill a jquery selection with the nodes for selecting a class.
     * @param {Object} container The selection that should contain the
     * class selection buttons.
     * @param {number} activeIndex The index of the initially selected
     * class.
     */
    function buildClassSelectionButtons(container, activeIndex) {
        container.html('');
        annotationSetHandler.forEachClass((mclass, index) => {
            const active = activeIndex === index;
            const button = _classSelectionButton(mclass, active);
            container.append(button);
        });
    }
    
    /**
     * Fill a jquery selection with the nodes for selecting an annotation set.
     * @param {Object} container The selection that should contain the
     * set selection buttons.
     * @param {number} activeIndex The index of the initially selected
     * set.
     */
    function buildAnnotationSetSelectionButtons(container, activeIndex) {
        container.html('');
        annotationSetHandler.forEachAnnotationSet((annotationSet, index) => {
            const active = activeIndex === index;
            const button = _annotationSetSelectionButton(annotationSet, active);
            container.append(button);
        });
    }

    /**
     * Fill a jquery selection with the menu for adding an annotation set.
     * @param {Object} container The selection that should contain the 'add annotation
     * set menu' modal.
     */
    function buildAddAnnotationSetMenu(container) {
        const body = container.find(".modal-body");

        const [nameRow, nameField, nameErrorLabel] = _annotationSetNameRow();
        const [descriptionRow, descriptionField] = _annotationSetDescriptionRow();
        const classControlsHeader = _annotationSetClassControlsHeader();
        const classConfigButtonRow = _annotationSetClassConfigButtonRow();
        const [classControlFieldsWrapper, classErrorLabel, classNameField] = _annotationSetClassControlFields(
            {classConfigButtonRow: classConfigButtonRow}
        );

        const classData = {
            classConfig: JSON.parse(JSON.stringify(defaultClassConfig)), 
            classConfigButtonRow: classConfigButtonRow, 
            classControlFieldsWrapper: classControlFieldsWrapper,
            disabledControls: false
        };
        const [classConfigRow, classConfigSelect, classConfigInfoLabel] = _annotationSetClassConfigSelectRow(classData);
        const saveButtonWrapper = _annotationSetSaveButton("Add annotation set", () => {
            // Get name and check that it's valid
            const name = nameField.val();
            const nameErrorMessage = _isValidAnnotationSetName(name, "add");
            if (nameErrorMessage) {
                nameErrorLabel.text(nameErrorMessage).show();
            }
            else nameErrorLabel.text("").hide();
            // Get class config and check that it's valid
            classData.classConfig = classConfigButtonRow.find(".class-btn").map(function() {
                return $(this).data("mclass");
            }).get();
            const classConfigErrorMessage = _isValidClassConfig(classData.classConfig);
            if (classConfigErrorMessage) {
                classErrorLabel.text(classConfigErrorMessage).show();
            }
            else classErrorLabel.text("").hide();
            // If no error messages, continue to add the new annotation set
            if (!nameErrorMessage && !classConfigErrorMessage) {
                annotationSetHandler.addAnnotationSet(name, descriptionField.val(), classData.classConfig, true);
                container.modal("hide");
            }
        });
        
        body.append(
            nameRow, 
            descriptionRow, 
            classConfigRow, 
            classControlsHeader, 
            classConfigButtonRow, 
            classControlFieldsWrapper, 
            saveButtonWrapper
        );

        // Initialize the class config button row
        _createClassConfigButtonRow(classData, true);

        // Make help text pop up when the help button is pressed
        container.find("[name='help_button']").popover({placement: 'bottom', trigger: 'focus'});
        
        // When the add annotation set menu is opened
        $("#add_annotation_set").click(() => {
            // Open add annotation set menu modal
            container.modal("show");
            // Reset fillable fields and error message labels
            nameField.val("");
            descriptionField.val("");
            nameErrorLabel.text("").hide();
            classErrorLabel.text("").hide();
            // Reset class config tracker, the default class config selection, and the class config button row
            classData.classConfig = JSON.parse(JSON.stringify(defaultClassConfig));
            classConfigSelect.val("default");
            _createClassConfigButtonRow(classData, false);
        });
    }

    
    /**
     * Fill a jquery selection with the menu for modifying an annotation set.
     * @param {Object} container The selection that should contain the 'modify annotation
     * set menu' modal.
     */
    function buildModifyAnnotationSetMenu(container) {
        const body = container.find(".modal-body");

        const [nameRow, nameField, nameErrorLabel] = _annotationSetNameRow();
        const [descriptionRow, descriptionField] = _annotationSetDescriptionRow();
        const classControlsHeader = _annotationSetClassControlsHeader();
        const classConfigButtonRow = _annotationSetClassConfigButtonRow();
        const [classControlFieldsWrapper, classErrorLabel, classNameField] = _annotationSetClassControlFields(
            {classConfigButtonRow: classConfigButtonRow}
        );

        const classData = {
            classConfig: [], 
            classConfigButtonRow: classConfigButtonRow, 
            classControlFieldsWrapper: classControlFieldsWrapper,
            disabledControls: false
        };
        const [classConfigRow, classConfigSelect, classConfigInfoLabel] = _annotationSetClassConfigSelectRow(classData);
        const saveButtonWrapper = _annotationSetSaveButton("Update annotation set", () => {
            // Get name and check that it's valid
            const name = nameField.val();
            const nameErrorMessage = _isValidAnnotationSetName(name, "rename");
            if (nameErrorMessage) {
                nameErrorLabel.text(nameErrorMessage).show();
            }
            else nameErrorLabel.text("").hide();
            // Get class config and check that it's valid
            classData.classConfig = classConfigButtonRow.find(".class-btn").map(function() {
                return $(this).data("mclass");
            }).get();
            const classConfigErrorMessage = _isValidClassConfig(classData.classConfig);
            if (classConfigErrorMessage) {
                classErrorLabel.text(classConfigErrorMessage).show();
            }
            else classErrorLabel.text("").hide();
            // If no error messages, continue to add the new annotation set
            if (!nameErrorMessage && !classConfigErrorMessage) {
                const activeAnnotationSet = annotationSetHandler.getActiveAnnotationSet();
                const description = descriptionField.val();
                annotationSetHandler.modifyAnnotationSet(activeAnnotationSet, name, description, classData.classConfig, true);
                container.modal("hide");
            }
        });
        
        body.append(
            nameRow, 
            descriptionRow, 
            classConfigRow, 
            classControlsHeader, 
            classConfigButtonRow, 
            classControlFieldsWrapper, 
            saveButtonWrapper
        );

        // Initialize the class config button row
        _createClassConfigButtonRow(classData, true);

        // Make help text pop up when the help button is pressed
        container.find("[name='help_button']").popover({placement: 'bottom', trigger: 'focus'});

        container.on('shown.bs.modal', function () {
            const activeAnnotationSet = annotationSetHandler.getActiveAnnotationSet();
            const prevLocked = annotationSetHandler.isLockedAnnotationSet(activeAnnotationSet.name);
            // If the modify menu is opened, we lock the annotation set to prevent collaborators 
            // from altering the set while we modify annotation set properties. 
            annotationSetHandler.lockAnnotationSet(
                activeAnnotationSet.name, 
                `${userInfo.getName()} is modifying the annotation set properties`,
                true
            );
            // Make sure the annotation set is unlocked when we close the modal if the set was not 
            // previously locked. Note that the set should atm never be previously locked as we shouldn't
            // be allowed to modify a previously locked set. But this check was added for robustness. 
            if (!prevLocked) {
                container.one('hidden.bs.modal', function () {
                    annotationSetHandler.unlockAnnotationSet(activeAnnotationSet.name, true);
                });
            }
        });
        
        // When the add annotation set menu is opened
        $("#modify_annotation_set").click((e) => {
            const activeAnnotationSet = annotationSetHandler.getActiveAnnotationSet();

            // Just in case, but the button should already be disabled if the annotation set is locked
            if (annotationSetHandler.isLockedAnnotationSet(activeAnnotationSet.name)) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }

            // Open modify annotation set menu modal
            container.modal("show");

            try {
                // Reset fillable fields and error message labels
                nameField.val(activeAnnotationSet.name);
                descriptionField.val(activeAnnotationSet.description);
                nameErrorLabel.text("").hide();
                classErrorLabel.text("").hide();

                // Reset class config tracker, the default class config selection, and the class config button row
                classData.classConfig = annotationSetHandler.getActiveClassConfig();
                // TODO: Temporary solution to compare to the anomaly option, should be handled better (see comment
                // in _annotationSetClassConfigSelectRow)
                const anomalyConfig = [
                    {
                        name: "Normal",
                        description: "Normal-appearing nucleus",
                        color: "#346d2e"
                    },
                    {
                        name: "Abnormal",
                        description: "Abnormal-appearing nucleus",
                        color: "#f03c3c"
                    }
                ];
                if (JSON.stringify(defaultClassConfig) === JSON.stringify(classData.classConfig)) {
                    classConfigSelect.val("default");
                }
                else if (JSON.stringify(anomalyConfig) === JSON.stringify(classData.classConfig)) {
                    classConfigSelect.val("abnormality");
                }
                else {
                    classConfigSelect.val("custom");
                }
                _createClassConfigButtonRow(classData, false);

                // Disable some class config controls if there are annotations in the set. 
                if (!annotationHandler.isEmptySet(activeAnnotationSet.name)) {
                    classConfigSelect.prop("disabled", true);
                    classConfigButtonRow.find(".add-class-btn").prop("disabled", true);
                    classConfigButtonRow.find(".add-class-btn").hide();
                    classData.controlsDisabled = true;
                    classNameField.prop("disabled", true);
                    classConfigInfoLabel.text("Class config controls are limited due to non-empty annotation set.").show();
                } else {
                    classConfigSelect.prop("disabled", false);
                    classConfigButtonRow.find(".add-class-btn").prop("disabled", false);
                    classConfigButtonRow.find(".add-class-btn").show();
                    classData.controlsDisabled = false;
                    classNameField.prop("disabled", false);
                    classConfigInfoLabel.text("").hide();
                }
            }
            catch (e) {
                // Q: I added this to make sure that we unlock the annotation set if something goes wrong, 
                // not fully sure it's needed though
                annotationSetHandler.unlockAnnotationSet(activeAnnotationSet, true);
                container.modal("hide");
                console.error(`Error occurred while modifying an annotation set: ${e}.`);
            }
        });
    }

    /**
     * Fill a jquery selection with the menu for copying an annotation set.
     * @param {Object} container The selection that should contain the 'copy annotation
     * set menu' modal.
     */
    function buildCopyAnnotationSetMenu(container) {
        const body = container.find(".modal-body");

        const [nameRow, nameField, nameErrorLabel] = _annotationSetNameRow();
        const [copyAnnotationsRow, copyAnnotationsCheckbox] = _annotationSetCheckboxRow(
            "Copy annotations to the new annotation set?", 
            "copyAnnotationsCheckbox"
        );

        // Add something like a radio button of whether to copy over annotations too

        const saveButtonWrapper = _annotationSetSaveButton("Add annotation set copy", () => {
            const name = nameField.val();
            const nameErrorMessage = _isValidAnnotationSetName(name, "add");
            if (nameErrorMessage) {
                nameErrorLabel.text(nameErrorMessage).show();
            }
            else {
                nameErrorLabel.text("").hide();
                const activeAnnotationSet = annotationSetHandler.getActiveAnnotationSet();
                if (annotationSetHandler.isLockedAnnotationSet(activeAnnotationSet.name)) {
                    console.warn("Cannot copy a locked annotation set, skipping");
                } else {
                    if (copyAnnotationsCheckbox.is(":checked")) annotationSetHandler.copyAnnotationSet(name, activeAnnotationSet, true);
                    else annotationSetHandler.addAnnotationSet(name, activeAnnotationSet.description, activeAnnotationSet.classConfig, true);
                }
                container.modal("hide");
            }
        });
        
        body.append(
            nameRow, 
            copyAnnotationsRow,
            saveButtonWrapper
        );

        // Make help text pop up when the help button is pressed
        container.find("[name='help_button']").popover({placement: 'bottom', trigger: 'focus'});
        
        // When the add annotation set menu is opened
        $("#copy_annotation_set").click(() => {
            const activeAnnotationSet = annotationSetHandler.getActiveAnnotationSet();

            // Just in case, but the button should already be disabled if the annotation set is locked
            if (annotationSetHandler.isLockedAnnotationSet(activeAnnotationSet.name)) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }

            // Open add annotation set menu modal
            container.modal("show");

            // Reset fillable fields and error message labels
            nameField.val(`${activeAnnotationSet.name} - Copy`);
            nameErrorLabel.text("").hide();
            copyAnnotationsCheckbox.prop("checked", true);
        });
    }

    /**
     * Fill a jquery selection with a list of collaborators.
     * @param {Object} container The selection that should contain the
     * collaborators.
     * @param {Object} localMember The collaborator local to the client.
     * @param {Array<Object>} members All members present in the collaboration.
     */
    function buildCollaboratorList(container, localMember, members) {
        members.forEach(member => {
            const isLocal = localMember === member;
            const isActive = !isLocal && member.ready;
            const isFollowing = member.following === localMember.id;
            const entry = _collaboratorListEntry(member, isLocal, isActive, isFollowing);
            container.append(entry);
        });
    }

    /**
     * Fill a jquery selection with an image browser.
     * @param {Object} container The selection that should contain the
     * images.
     * @param {Array<Object>} images The images that should be browsable.
     */
    function buildImageBrowser(container, images) {
        if (images.length > 0) {
            let rowNumber = 0;
            while (rowNumber * 4 < images.length) {
                const start = rowNumber * 4;
                const end = start + 4;
                const rowContent = images.slice(start, end);
                const row = _imageBrowserRow(rowContent);
                container.append(row);
                rowNumber++;
            }
        }
        else {
            const message = _emptyImageBrowser();
            container.append(message);
        }
    }

    function _setDropdownMenu(options, buttonID, defaultOption) {
        const dropdown = document.querySelector(buttonID);
        const button = dropdown.querySelector('.dropdown-toggle');
        const content = dropdown.querySelector('.dropdown-menu');
        content.innerHTML = "";

        if (!options.includes(defaultOption)) {
            console.error("Error, default method not found: ", defaultOption);
        }

        options.forEach(option => {
            const listItem = document.createElement("li");
            const link = document.createElement("a");

            link.classList.add('dropdown-item');
            link.textContent = option;
            link.setAttribute('href', "#");
            link.setAttribute('value', option);

            link.addEventListener('click', () => {
                button.textContent = link.textContent;
                button.setAttribute('value', link.getAttribute('value'));
                dropdown.classList.remove('show');
                content.classList.remove('show');
            });

            if (option === defaultOption) {
                link.textContent = `${option} (default)`;
                listItem.appendChild(link);
                content.insertBefore(listItem, content.firstChild);
            } else {
                listItem.appendChild(link);
                content.appendChild(listItem);
            }
        })

        const contentItems = dropdown.querySelectorAll('.dropdown-item');
        if (contentItems.length > 0) {
            button.textContent = contentItems[0].textContent;
            button.setAttribute('value', contentItems[0].getAttribute('value'));
        }
    }

    function buildDetectionMethodSelector(methods) {
        _setDropdownMenu(methods, "#dropdown_detect_nuclei", "load-csv");
    }

    function buildClassificationMethodSelector(methods) {
        _setDropdownMenu(methods, "#dropdown_classify_nuclei", "random");
    }

    return {
        //buildCommentSection,  //Seemingly not in use 
        buildCommentSectionAlt,
        buildAnnotationSettingsMenu,
        buildClassSelectionButtons,
        buildAnnotationSetSelectionButtons,
        buildAddAnnotationSetMenu,
        buildModifyAnnotationSetMenu,
        buildCopyAnnotationSetMenu,
        setSelectedAnnotationSetSelectionButton,
        updateLockedAnnotationSetButtonDisplays,
        buildCollaboratorList,
        buildImageBrowser,
        buildDetectionMethodSelector,
        buildClassificationMethodSelector,

        buildFocusSlider,
        updateFocusSlider
    };
})();
