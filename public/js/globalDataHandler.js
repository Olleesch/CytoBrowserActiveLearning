/**
 * Namespace for handling the global data of a collaboration.
 * @namespace globalDataHandler
 */
const globalDataHandler = (function() {
   const _comments = [];
   let _updateFun = null;

   // Help function to get a shortened string of a number (used to display annotation 
   // counts, etc in an abbreviated way).
   function _shortenInt(x) {
       if (x < 1000) {
           return x;
       }
       else if (x < 100_000) {
           return (x / 1000).toFixed(1) + "k";
       }
       else if (x < 1_000_000) {
           return Math.floor(x / 1000) + "k";
       }
       else if (x < 1_000_000_000) {
           return Math.floor(x / 1_000_000) +  "M";
       }
       else {
           console.warn("Tried to shorten a very large integer, not accounted for");
           return x;
       }
   }

   function _updateCommentSection() {
       if (!_updateFun) {
           console.warn("Could not handle comment as there is no update function set.");
       }
       else {
           _updateFun(_comments);
       }
   }

   /**
    * Update all displayed information about the number of annotations of the active annotation set.
    * @param {number} nMarkers The number of markers.
    * @param {number} nRegions The number of regions.
    * @param {Object} classCounts The number of annotations for each class. The object contains 
    * key-value pairs where the keys are the class names and the values are the number of annotation 
    * for the corresponding class.
    * 
    * No change when objects are not visible (e.g. in FullScreen mode)
    */
   function updateAnnotationCounts(nMarkers, nRegions, classCounts) {
       $("#global_data_nmarkers").text(Object.values(nMarkers).reduce((a, b) => a + b, 0));
       $("#global_data_nregions").text(Object.values(nRegions).reduce((a, b) => a + b, 0));
       annotationSetHandler.forEachClass(c => {
           const id = `#class_counter_${c.name}`;
           $(id).text(_shortenInt(classCounts[c.name]));
       });
   }

   /**
    * Update all displayed information about the number of annotations per annotation set.
    * @param {Object} annotationSetCounts The number of annotation for each annotation set.
    * @param {Object} nMarkers The number of markers for each annotation set.
    * @param {Object} nRegions The number of regions for each annotation set.
    * @param {Object} classCounts The number of annotations for each class. The object contains 
    * key-value pairs where the keys are the class names and the values are the number of annotation 
    * for the corresponding class.
    */
   function updateAnnotationSetCounts(annotationSetCounts, nMarkers, nRegions, classCounts) {
       annotationSetHandler.forEachAnnotationSet(s => {
           $(`#${annotationSetHandler.getIDFromAnnotationSetName(s.name)}_nmarkers`).text(nMarkers[s.name]);
           $(`#${annotationSetHandler.getIDFromAnnotationSetName(s.name)}_nregions`).text(nRegions[s.name]);
           $(`#${annotationSetHandler.getIDFromAnnotationSetName(s.name)}_nclasses`).text(Object.keys(classCounts[s.name]).length);

        //    $(`#${s.name}_nmarkers`).text(nMarkers[s.name]);
        //    $(`#${s.name}_nregions`).text(nRegions[s.name]);
        //    $(`#${s.name}_nclasses`).text(Object.keys(classCounts[s.name]).length);
           const id = `#annotation_set_counter_${annotationSetHandler.getIDFromAnnotationSetName(s.name)}`;
           $(id).text(_shortenInt(annotationSetCounts[s.name]));
       });
   }

   /**
    * Submit a comment that should be added to the global comments of
    * the current session.
    * @param {string} commentText The text of the comment being submitted.
    */
   function sendCommentToServer(commentText) {
       collabClient.addComment(commentText);
   }

   /**
    * Tell the server that a comment should be deleted.
    * @param {number} id The id of the comment to be removed.
    */
   function sendCommentRemovalToServer(id) {
       collabClient.removeComment(id);
   }

   /**
    * Receive a comment from the server and display it in the global
    * comment section.
    * @param {Object} comment The new comment to be added.
    */
   function handleCommentFromServer(comment) {
       _comments.push(comment);
       _updateCommentSection();
   }

   /**
    * Receive a comment removal instruction from the server.
    * @param {number} id The id of the comment to be removed.
    */
   function handleCommentRemovalFromServer(id) {
       const commentIndex = _comments.findIndex(comment =>
           comment.id === id
       );
       if (commentIndex >= 0) {
           _comments.splice(commentIndex, 1);
           _updateCommentSection();
       }
       else {
           throw Error("Server tried to delete a comment that doesn't exist locally.");
       }
   }

   /**
    * Set the function that should be called with the comment list
    * whenever the comments are updated.
    * @param {Function} updateFun The new update function.
    */
   function setCommentUpdateFun(updateFun) {
       _updateFun = updateFun;
   }

   /**
    * Iterate some function over copies of all global comments.
    * @param {Function} f The function to be called on all comments.
    */
   function forEachComment(f) {
       _comments.forEach(comment => f(Object.assign({}, comment)));
   }

   /**
    * Clear the currently set metadata.
    **/
   function clear(transmit = false) {
       if (transmit) {
          _comments.forEach(c => sendCommentRemovalToServer(c.id));
       } else {
          _comments.length = 0;
          _updateCommentSection();
       }
   }

   return {
       updateAnnotationCounts: updateAnnotationCounts,
       updateAnnotationSetCounts: updateAnnotationSetCounts,
       sendCommentToServer: sendCommentToServer,
       sendCommentRemovalToServer: sendCommentRemovalToServer,
       handleCommentFromServer: handleCommentFromServer,
       handleCommentRemovalFromServer: handleCommentRemovalFromServer,
       setCommentUpdateFun: setCommentUpdateFun,
       forEachComment: forEachComment,
       clear: clear
   };
})();
