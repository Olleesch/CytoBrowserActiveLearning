import random
import numpy as np
import torch
import tqdm
import json
from torch.utils.data import DataLoader

from data_utils import SingleInstanceDataset


def classify_nuclei(image_ID, method, nuclei):
    try:
        with open(f"./classification_methods/{method}.json", "r") as method_json:
            method_dict = json.load(method_json)
            path = method_dict["path"]
            class_config = method_dict["classConfig"]
            crop = method_dict["crop"]
            imagenet_normalize = method_dict["imagenetNormalize"]
            bs = method_dict["bs"]
    except Exception as e:
        print(f"Error occurred in nucleus classification: {str(e)}. Check that method {method} is valid.")
    
    # First return the class config of the model
    yield json.dumps({"classConfig": class_config}) + "\n"

    chunk_size = 1000
    
    if method == "random":
        try:
            chunk = []
            classes = ["NILM", "ASC-US", "ASC-H", "LSIL", "HSIL", "SCC", "AdC"]
            for i, nucleus in enumerate(nuclei):
                nucleus["mclass"] = classes[random.randint(0, len(classes)-1)]
                chunk.append(nucleus)
                if len(chunk) == chunk_size or i == len(nuclei) - 1:
                    yield json.dumps({"annotations": chunk}) + "\n"
                    chunk = []
        except Exception as e:
            print(f"Error occurred in nucleus classification: {str(e)}")
    
    else:
        try:
            print("Running nucleus classification model inference...")
            device = torch.device("cuda:2")
            model = torch.load(path, map_location=device, weights_only=False)
            model.to(device)
            model.eval()
            
            dataset = SingleInstanceDataset(nuclei, image_ID, crop, imagenet_normalize=imagenet_normalize)
            dataloader = DataLoader(dataset, bs, shuffle=False, num_workers=4)

            chunk = []
            chunk_size = chunk_size // bs # In terms of number of batches
            with torch.no_grad():
                for i, batch in tqdm.tqdm(enumerate(dataloader)):
                    batch = batch.to(device)
                    pred = model(batch)

                    # This should be single digit output for binary classification
                    if pred.shape[1] == 1:
                        class_idxs = torch.round(pred).squeeze(dim=1).detach().cpu().numpy()
                    # This should be softmax-style output
                    else:
                        class_idxs = torch.argmax(pred, dim=0).detach().cpu().numpy()

                    for j, class_idx in enumerate(class_idxs):
                        idx = i*bs+j
                        nuclei[idx]["mclass"] = class_config[int(class_idx)]["name"]
                        chunk.append(nuclei[idx])

                    if len(chunk) == chunk_size*bs or i == len(dataloader) - 1:
                        yield json.dumps({"annotations": chunk}) + "\n"
                        chunk = []

        except Exception as e:
            print(f"Error occurred in nucleus classification: {str(e)}")
