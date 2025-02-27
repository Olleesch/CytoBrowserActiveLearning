import os
import json


def detect_nuclei(image_ID, method):
    if method == "load-json":
        json_file_path = f'./../temp/nuclei_detection_results/nuclei_{image_ID}.json'

        if not os.path.exists(json_file_path):
            raise FileNotFoundError(f"Nuclei detection file not found.")

        try:
            with open(json_file_path, 'r') as json_data:
                data = json.load(json_data)
            # Temporary to remove fields not expected/replaced later
            for annotation in data["annotations"]:
                del annotation["mclass"]
                del annotation["author"]
                del annotation["id"]
            print(f"Detected {len(data["annotations"])} nuclei.")
            return data
        except Exception as e:
            print(f"Error occurred: {str(e)}")
    
    else:
        raise ValueError(f"Nuclei detection method '{method}' not implemented yet!")
