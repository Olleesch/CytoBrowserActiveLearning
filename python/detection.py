import os
import argparse
import json
import torch
import numpy as np
from tqdm import tqdm

from torch.utils.data import DataLoader
from FocusEstimate import focus_estimate
from data_utils import get_z_levels, ZStackSingleInstanceDataset
from utils import get_free_gpu

from NucleusDetection import predict_img, load_network


def detect_nuclei(image_ID, method):
    try:
        with open(f"./detection_methods/{method}.json", "r") as method_json:
            method_path = json.load(method_json)["path"]
    except Exception as e:
        print(f"Error occurred in nucleus detection: {str(e)}. Check that method {method} is valid.")

    if method == "load-csv":
        # Load pre-detected nuclei from csv file
        csv_file_path = f'./../temp/nuclei_detection_results/nuclei_{image_ID}.csv'
        if not os.path.exists(csv_file_path):
            raise FileNotFoundError(f"Nuclei detection csv file not found.")
        try:
            detections = np.loadtxt(csv_file_path, delimiter=',')
            print(f"Loaded {len(detections)} detected nuclei.")
        except Exception as e:
            print(f"Error occurred: {str(e)}")

    elif method == "regression-based-UNet":
        # Run regression-based UNet inference to detect nuclei
        try:
            print("Running nucleus detection model inference...")
            data_path = [f"./../data/{image_ID}_z{z}.dzi" for z in [0,-2000,2000]]
            # Select device based on available GPU memory (approx 3x the required memory)
            min_free_mem = 1500
            free_gpu = get_free_gpu(min_free_mem)
            if free_gpu == -1:
                device = torch.device("cpu")    # No free GPU found
            else:
                device = torch.device(f"cuda:{free_gpu}")
            args = argparse.Namespace(
                input=data_path,
                level=2,
                threshold=0.4,
                min_dist=5,
                workers=4,
                save_masks=False,
                save_tile_csv=False,
                savedir=None,
                verbose=False   # TODO: Add in NucleusDetection? 
            )
            net = load_network(device, method_path)
            detections, _ = predict_img(net, device, args)
            print(f"Detected {len(detections)} nuclei.")
        except Exception as e:
            print(f"Error occurred: {str(e)}")

    else:
        raise ValueError(f"Nuclei detection method '{method}' not implemented!")
    
    # Focus selection
    print("Running focus selection on detected nuclei...")
    dataset = ZStackSingleInstanceDataset(detections, image_ID, 56)
    dataloader = DataLoader(dataset, 1, shuffle=False, num_workers=4, collate_fn=lambda x: x)

    # Chunk size 100 is suitable since focus estimation is still quite slow. If the chunk size 
    # is increased or reduced significantly, there may occur issues in server/collaboration.js 
    # due to chunks being merged or split up in the stream. To handle this, look at the classification
    # code in server/collaboration.js (which deals with this issue due to large chunks being returned). 
    chunk_size = 100
    chunk = []

    patch_focus_estimates = np.zeros(len(get_z_levels(image_ID)), dtype=float)
    for i, patch in tqdm(enumerate(dataloader)):
        patch = patch[0]
        for z in range(len(patch)):
            patch_focus_estimates[z] = focus_estimate(patch[z])
        chunk.append([detections[i,0], 
                      detections[i,1], 
                      int(np.argmax(patch_focus_estimates)) - patch_focus_estimates.shape[0]//2])
        if len(chunk) == chunk_size or i == len(dataset) - 1:
            yield json.dumps(chunk) + "\n"
            chunk = []
