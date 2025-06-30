import sys
import torch
import threading

from flask import Flask, request, Response, jsonify

from detection import detect_nuclei
from classification import classify_nuclei
from utils import get_methods

from active_learning import active_learning_experiment

app = Flask(__name__)


@app.route("/api/analysis/get-nuclei-detection-methods", methods=["GET"])
def analysis_get_detection_methods():
    try:
        res = get_methods(dir="./analysis_methods/detection/")
        return jsonify(res)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/analysis/get-nuclei-classification-methods", methods=["GET"])
def analysis_get_classification_methods():
    try:
        res = get_methods(dir="./analysis_methods/classification/")
        return jsonify(res)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/analysis/detect-nuclei", methods=["POST"])
def analysis_detect_nuclei():
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


active_learning_process_events = {}
active_learning_process_annotations = {}

@app.route("/api/activeLearning/start", methods=["POST"])
def run_active_learning_experiment():
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

    proceed_query = threading.Event()
    active_learning_process_events[experiment_id] = proceed_query
    active_learning_process_annotations[experiment_id] = {}
    threading.Thread(target=active_learning_experiment, args=(experiment_id, callback_url, parameters, proceed_query, active_learning_process_annotations[experiment_id])).start()
    return jsonify({"message": f"Successfully launched active learning process {experiment_id}"}), 200


@app.route("/api/activeLearning/annotate", methods=["POST"])
def annotate_query():
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
