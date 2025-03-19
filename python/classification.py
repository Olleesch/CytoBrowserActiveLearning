import random
import numpy as np
import torch
import tqdm
import json
from torch.utils.data import DataLoader

from data import SingleInstanceDataset


def classify_nuclei(image_ID, method, nuclei):
    try:
        with open(f"./classification_methods/{method}.json", "r") as method_json:
            method_dict = json.load(method_json)
            path = method_dict["path"]
            class_config = method_dict["classConfig"]
            crop = method_dict["crop"]
            imagenet_normalize = method_dict["imagenetNormalize"]
    except Exception as e:
        print(f"Error occurred in nucleus classification: {str(e)}. Check that method {method} is valid.")
    
    if method == "random":
        try:
            return classify_random(nuclei)
        except Exception as e:
            print(f"Error occurred in nucleus classification: {str(e)}")
    
    else:
        try:
            print("Running nucleus classification model inference...")
            device = torch.device("cuda:2")
            model = torch.load(path, map_location=device, weights_only=False)
            model.to(device)
            model.eval()
            return classify_single_instances(
                nuclei, 
                image_ID, 
                model, 
                class_config, 
                crop, 
                imagenet_normalize, 
                device
            )
        except Exception as e:
            print(f"Error occurred in nucleus classification: {str(e)}")


def classify_random(nuclei):
    classes = ["NILM", "ASC-US", "ASC-H", "LSIL", "HSIL", "SCC", "AdC"]
    for nucleus in nuclei:
        nucleus["mclass"] = classes[random.randint(0, len(classes)-1)]
    return {
        "classConfig": [],
        "annotations": nuclei
    }


def classify_single_instances(
    nuclei, 
    image_ID, 
    model, 
    class_config, 
    crop_size, 
    imagenet_normalize, 
    device
):
    bs = 64
    dataset = SingleInstanceDataset(nuclei, image_ID, crop_size, imagenet_normalize=imagenet_normalize)
    dataloader = DataLoader(dataset, bs, shuffle=False, num_workers=4)
    model = model.to(device)
    model.eval()

    class_idxs = np.zeros((len(dataset)), dtype=int)
    with torch.no_grad():
        for i, batch in tqdm.tqdm(enumerate(dataloader)):
            batch = batch.to(device)
            pred = model(batch)

            # This should be single digit output for binary classification
            if pred.shape[1] == 1:
                class_idxs[i*bs:i*bs+len(batch)] = torch.round(pred).squeeze(dim=1).detach().cpu().numpy()
            # This should be softmax-style output
            else:
                class_idxs[i*bs:i*bs+len(batch)] = torch.argmax(pred, dim=0).detach().cpu().numpy()
    
    for i, class_idx in enumerate(class_idxs):
        nuclei[i]["mclass"] = class_config[class_idx]["name"]

    return {
        "classConfig": class_config,
        "annotations": nuclei
    }
