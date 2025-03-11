import os
import sys
import argparse
import json
import torch
import numpy as np

sys.path.insert(1, os.path.join(sys.path[0], '../..'))
from NucleusDetection import predict_img, load_network


def detect_nuclei(image_ID, method):
    with open(f"./detection_methods/{method}.json", "r") as method_json:
        method_path = json.load(method_json)["path"]

    if method == "load-csv":
        # Load pre-detected nuclei from csv file
        csv_file_path = f'./../temp/nuclei_detection_results/nuclei_{image_ID}.csv'
        if not os.path.exists(csv_file_path):
            raise FileNotFoundError(f"Nuclei detection csv file not found.")
        try:
            detections = np.loadtxt(csv_file_path, delimiter=',')
            print(f"Loaded {len(detections)} detected nuclei.")
            return detections.tolist()
        except Exception as e:
            print(f"Error occurred: {str(e)}")

    elif method == "regression-based-UNet":
        # Run regression-based UNet inference to detect nuclei
        try:
            print("Running nucleus detection model inference...")
            data_path = [f"/cytodata/Compilations/LetItShine/dzi_o8/BF/{image_ID}_z{z}.dzi" for z in [0,-2000,2000]]
            device = torch.device("cuda:1") # How should the device be set in cytobrowser? 
            args = argparse.Namespace(
                input=data_path,
                level=2,
                stack_size=1,   # Not used?
                threshold=0.4,
                min_dist=5,     # Not used? 
                workers=4,
                save_masks=False,
                save_tile_csv=False,
                savedir=None,
                verbose=False   # TODO: Add in NucleusDetection? 
            )
            net = load_network(method_path, device)
            detections, _ = predict_img(net, device, args)
            print(f"Detected {len(detections)} nuclei.")
            return detections.tolist()
        except Exception as e:
            print(f"Error occurred: {str(e)}")

    else:
        raise ValueError(f"Nuclei detection method '{method}' not implemented!")
