import sys
import torch    # I don't know why but I get an error if torch is not imported here even though it is not used in this file
import threading

from flask import Flask, request, Response, jsonify

from detection import detect_nuclei
from classification import classify_nuclei
from utils import get_methods

from active_learning import active_learning_experiment

app = Flask(__name__)


@app.route("/api/analysis/get-nuclei-detection-methods", methods=["GET"])
def analysis_get_detection_methods():
    """ Retrieves available nuclei detection methods.
    
    This API endpoint scans the ./analysis_methods/detection/ directory and
    returns a list of available nuclei detection methods. 

    GET /api/analysis/get-nuclei-detection-methods
    
    Returns: 
        Response: A JSON object containing a list of nuclei detection methods.
        Example: 
            [
                {
                    "name": "IFCRN",
                    "description": "Improved Fully Convolutional Regression Network (IFCRN): 
                                    Custom regression-based U-Net detection model trained on 
                                    the OC dataset."
                },
                ...
            ]
    
    Raises:
        500 Internal Server Error: If an error occurs retrieving the methods.
    """
    try:
        res = get_methods(dir="./analysis_methods/detection/")
        return jsonify(res)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/analysis/get-nuclei-classification-methods", methods=["GET"])
def analysis_get_classification_methods():
    """ Retrieves available nuclei classification methods.
    
    This API endpoint scans the ./analysis_methods/classification/ directory and
    returns a list of available nuclei classification methods. 

    GET /api/analysis/get-nuclei-classification-methods
    
    Returns: 
        Response: A JSON object containing a list of nuclei classification methods.
        Example: 
            [
                {
                    "name": "transfer-ResNet50",
                    "description": "ImageNet pre-trained ResNet50 neural network fine-tuned 
                                    on the OC dataset for binary classification of patient 
                                    diagnosis."
                },
                ...
            ]
    
    Raises:
        500 Internal Server Error: If an error occurs retrieving the methods.
    """
    try:
        res = get_methods(dir="./analysis_methods/classification/")
        return jsonify(res)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/analysis/detect-nuclei", methods=["POST"])
def analysis_detect_nuclei():
    """ Runs nuclei detection.

    This API enpoint runs a pipeline for detecting nuclei in a selected dzi WSI using a selected 
    nuclei detection method.

    POST /api/analysis/detect-nuclei

    Expects a JSON payload containing:
        image_ID (str): The name/id of the image to process.
        method (str): The name of the nuclei detection method to use.

    Returns:
        Response: Streamed chunks of the detection results in JSON format.

    Raises:
        400 Bad Request: If required parameters are missing.
        500 Internal Server Error: If an error occurs in the detection pipeline.
    """
    data = request.json
    image_ID = data.get("image_ID", 0)
    method = data.get("method", 0)

    if image_ID is None:
        return jsonify({"error": "Missing image name parameter"}), 400
    if method is None:
        return jsonify({"error": "Missing method parameter"}), 400

    return Response(
        detect_nuclei(image_ID, method),
        content_type="application/json"
    )


@app.route("/api/analysis/classify-nuclei", methods=["POST"])
def analysis_classify_nuclei():
    """ Runs nuclei classification.

    This API enpoint runs a pipeline for classifying a set of nuclei in a selected 
    dzi WSI using a selected nuclei classificaiton method.

    POST /api/analysis/classify-nuclei

    Expects a JSON payload containing:
        image_ID (str): The name/id of the image to process.
        method (str): The name of the nuclei classification method to use.
        nuclei (dict): The coordinates of the nuclei to classify.

    Returns:
        Response: Streamed chunks of the classification results in JSON format.

    Raises:
        400 Bad Request: If required parameters are missing.
        500 Internal Server Error: If an error occurs in the classification pipeline.
    """
    data = request.json
    image_ID = data.get("image_ID", None)
    method = data.get("method", None)
    nuclei = data.get("nuclei", None)

    if image_ID is None:
        return jsonify({"error": "Missing image name parameter"}), 400
    if method is None:
        return jsonify({"error": "Missing method parameter"}), 400
    if nuclei is None:
        return jsonify({"error": "Missing nuclei parameter"}), 400

    return Response(
        classify_nuclei(image_ID, method, nuclei),
        content_type="application/json"
    )


# To keep track of running active learning processes and pass new data to them when queried samples have been annotated.
active_learning_process_events = {}
active_learning_process_annotations = {}

@app.route("/api/activeLearning/start", methods=["POST"])
def run_active_learning_experiment():
    """ Launches a new active learning experiment process.

    This API enpoint runs a pipeline for nuclei detection active learning
    experiments. 

    POST /api/activeLearning/start

    Expects a JSON payload containing:
        experiment_id (int): The id of the process (for communication between the CytoBrowser
                             active learning manager and this python backend).
        parameters (dict): Experimental parameters defining the experiment, including
                                informativenessFunction - The name of the informativeness method to use,
                                samplingStrategy        - The name of the sampling strategy to use,
                                annotationRounds        - The total number of annotation rounds,
                                annotationBudget        - The total annotation budget (total number of 
                                                          samples to annotate throughout the process)
        callback_url (str): The callback URL to send process updates back to the CytoBrowser server.

    Returns:
        Response: A successful process launch message in JSON format. 

    Raises:
        400 Bad Request: If required parameters are missing.
        500 Internal Server Error: If an error occurs launching the process.
    """
    data = request.json
    experiment_id = data.get("id", None)
    parameters = data.get("parameters", None)
    callback_url = data.get("callbackURL", None)
    
    if experiment_id is None:
        return jsonify({"error": "Missing experiment ID parameter"}), 400
    if parameters is None:
        return jsonify({"error": "Missing experiment parameters"}), 400
    if callback_url is None:
        return jsonify({"error": "Missing callback URL parameter"}), 400

    # Launch active learning process in background thread.
    proceed_query = threading.Event()
    active_learning_process_events[experiment_id] = proceed_query
    active_learning_process_annotations[experiment_id] = {}
    threading.Thread(
        target=active_learning_experiment, 
        args=(experiment_id, callback_url, parameters, proceed_query, active_learning_process_annotations[experiment_id])
    ).start()
    return jsonify({"message": f"Successfully launched active learning process {experiment_id}"}), 200


@app.route("/api/activeLearning/annotate", methods=["POST"])
def annotate_query():
    """ Annotates queried data of a running active learning experiment process.

    This API enpoint adds annotated data from the oracle as a response to a query in the active learning
    pipeline. The annotations are added to the annotation data dictionary of the specified process, where 
    the process then can access the annotations and add them to the labeled data of the active learning
    pipeline. 

    POST /api/activeLearning/annotate

    Expects a JSON payload containing:
        experiment_id (int): The id of the process.

    Returns:
        Response: A successful annotation query message in JSON format. 

    Raises:
        400 Bad Request: If required parameters are missing.
        404 Not Found: If the active learning process specified by the experiment id could not be found.
        500 Internal Server Error: If an unexpected error occurs adding annotated data to the shared dictionary.
    """
    data = request.json
    experiment_id = data.get("id", None)
    event = active_learning_process_events.get(experiment_id)
    active_learning_process_annotations[experiment_id]["samples"] = data.get("samples")
    if event:
        event.set()
        return jsonify({"message": f"Successfully annotated query by active learning process {experiment_id}"}), 200
    else:
        return jsonify({"error": f"Error: Could not find active learning process {experiment_id}"}), 404


if __name__=="__main__":
    port = int(sys.argv[1])     # Read port from NodeJS as argument
    print(f"Python backend running on port: {port}")
    app.run(host="127.0.0.1", port=port)
