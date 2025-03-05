import os
import json
import random


def classify_nuclei(image_ID, method, nuclei):
    if method == "random":
        try:
            classes = ["NILM", "ASC-US", "ASC-H", "LSIL", "HSIL", "SCC", "AdC"]
            for nucleus in nuclei:
                nucleus["mclass"] = classes[random.randint(0, len(classes)-1)]
            return {
                "classConfig": [],
                "annotations": nuclei
            }
        except Exception as e:
            print(f"Error occurred: {str(e)}")
    
    else:
        raise ValueError(f"Nuclei classification method '{method}' not implemented yet!")
