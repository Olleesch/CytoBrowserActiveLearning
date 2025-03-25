import sys

from flask import Flask, request, Response, jsonify

from detection import detect_nuclei
from classification import classify_nuclei
from utils import get_methods


app = Flask(__name__)

@app.errorhandler(Exception)
def handle_exception(e):
    print("In exception handler")
    print(e)
    response = jsonify({
        "success": False,
        "error": type(e).__name__,
        "message": str(e)
    })
    response.status_code = 500
    response.headers["Content-Type"] = "application/json"
    return response

@app.errorhandler(FileNotFoundError)
def handle_file_not_found_error(e):
    print("In exception handler")
    print(e)
    response = jsonify({
        "success": False,
        "error": "FileNotFoundError",
        "message": str(e)
    })
    response.status_code = 404
    response.headers["Content-Type"] = "application/json"
    return response


@app.route("/api/analysis/get-nuclei-detection-methods", methods=["GET"])
def analysis_get_detection_methods():
    try:
        res = get_methods(dir="./detection_methods/")
        return jsonify(res)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/analysis/get-nuclei-classification-methods", methods=["GET"])
def analysis_get_classification_methods():
    try:
        res = get_methods(dir="./classification_methods/")
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


if __name__=="__main__":
    port = int(sys.argv[1])     # Read port from NodeJS as argument
    print(f"Python backend running on port: {port}")
    app.run(host="127.0.0.1", port=port)
