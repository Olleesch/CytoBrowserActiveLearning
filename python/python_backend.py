import sys

from flask import Flask, request, jsonify

from detection import detect_nuclei
from classification import classify_nuclei
from utils import get_methods


app = Flask(__name__)


@app.route("/api/analysis/get-nuclei-detection-methods", methods=["GET"])
def analysis_get_detection_methods():
    try:
        res = get_methods(dir="./detection_models/")
        return jsonify(res)
    except Exception as e:
        return jsonify({"error": "Internal server error", "details": str(e)}), 500


@app.route("/api/analysis/get-nuclei-classification-methods", methods=["GET"])
def analysis_get_classification_methods():
    try:
        res = get_methods(dir="./classification_models/")
        return jsonify(res)
    except Exception as e:
        return jsonify({"error": "Internal server error", "details": str(e)}), 500


@app.route("/api/analysis/detect-nuclei", methods=["POST"])
def analysis_detect_nuclei():
    data = request.json
    image_ID = data.get("image_ID", 0)
    method = data.get("method", 0)

    try:
        if image_ID is None:
            return jsonify({"error": "Missing image name parameter"}), 400
        if method is None:
            return jsonify({"error": "Missing method parameter"}), 400
        res = detect_nuclei(image_ID, method)
        return jsonify(res)
    
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    
    except FileNotFoundError as e:
        return jsonify({"error": "Data file not found", "details": str(e)}), 404
    
    except Exception as e:
        return jsonify({"error": "Internal Server Error", "details": str(e)}), 500


@app.route("/api/analysis/classify-nuclei", methods=["POST"])
def analysis_classify_nuclei():
    data = request.json
    image_ID = data.get("image_ID", None)
    method = data.get("method", None)
    nuclei = data.get("nuclei", None)

    try:
        if image_ID is None:
            return jsonify({"error": "Missing image name parameter"}), 400
        if method is None:
            return jsonify({"error": "Missing method parameter"}), 400
        if nuclei is None:
            return jsonify({"error": "Missing nuclei parameter"}), 400
        res = classify_nuclei(image_ID, method, nuclei)
        return jsonify(res)
    
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    
    except FileNotFoundError as e:
        return jsonify({"error": "Data file not found", "details": str(e)}), 404
    
    except Exception as e:
        return jsonify({"error": "Internal Server Error", "details": str(e)}), 500


if __name__=="__main__":
    port = int(sys.argv[1])     # Read port from NodeJS as argument
    print(f"Python backend running on port: {port}")
    app.run(host="127.0.0.1", port=port)
