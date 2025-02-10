import os
import json
import random


def classify_nuclei(image_ID, collab_ID, method):
    collab_json_path = f'./../collab_storage/{image_ID}/{image_ID}_{collab_ID}.json'

    if not os.path.exists(collab_json_path):
        raise FileNotFoundError(f"Collaboration file not found.")

    if method == "random":
        try:
            with open(collab_json_path, 'r') as json_data:
                data = json.load(json_data)
            classes = [c["name"] for c in data["classConfig"]]
            for i, annotation in enumerate(data["annotations"]):
                if annotation["mclass"] == "Other":
                    new_class = classes[random.randint(0, len(classes)-2)]
                    data["annotations"][i]["mclass"] = new_class
            return data
        except Exception as e:
            print(f"Error occurred: {str(e)}")
    
    else:
        raise ValueError(f"Nuclei classification method '{method}' not implemented yet!")
