import math, sys, os, glob, re
from os.path import splitext
from pathlib import Path

from collections import namedtuple
import xml.etree.ElementTree as ET

import json
import itertools
import numpy as np
import pandas as pd
from tqdm import tqdm

import pyvips
import torch
from torch.utils.data import Dataset
from torchvision.transforms import v2
from PIL import Image
from scipy.ndimage import gaussian_filter


def get_z_levels(image_ID):
    files = glob.glob(f'./../data/{image_ID}_z*.dzi')
    z_values = sorted(
        [int(re.search(r'_z(-?\d+)\.dzi$', f).group(1)) for f in files],
        reverse=False
    )
    return z_values

# Convenience function to return named tuple with same name as function
def returntuple(names, *args):
    # or inspect.currentframe()
    calling_fun = sys._getframe().f_back.f_code.co_name
    return namedtuple(calling_fun, names)(*args)

# Extract xml data from the dzi file
def dzi_info(filename):
    tree = ET.parse(filename)
    root = tree.getroot()
    format = root.get('Format')
    overlap = int(root.get('Overlap'))
    tilesize = int(root.get('TileSize'))
    size = {k: int(v) for k, v in root[0].attrib.items()} # Python-sigh!
    tiledir = filename.removesuffix('.dzi')+'_files'
    return returntuple("filename,tiledir,format,overlap,tilesize,size",filename,tiledir,format,overlap,tilesize,size)

def assemble_patch(x, y, z, image_ID, crop_size, level_sample=0):
    image = f"./../data/{image_ID}_z{z}.dzi"

    info = dzi_info(image)
    levels = max(info.size['Height'],info.size['Width']).bit_length()
    level = levels - level_sample

    # Tiles wide, high
    subsample = 2**level_sample     # Q: Could maybe be removed and assumed level 0
    global_width = math.ceil(info.size['Width']/subsample)
    global_height = math.ceil(info.size['Height']/subsample)

    def _get_tile_idx(coord, subsample, tilesize):
        return int(coord // (tilesize*subsample))

    # Filename: x_y.format
    global_max_x = _get_tile_idx(info.size['Width'], subsample, info.tilesize)
    global_max_y = _get_tile_idx(info.size['Height'], subsample, info.tilesize)

    crop_x = x - crop_size//2
    crop_y = y - crop_size//2
    assert math.ceil((crop_x+crop_size)/subsample) <= global_width and math.ceil((crop_y+crop_size)/subsample) <= global_height, \
        "Cannot crop outside the image borders."
    min_x = _get_tile_idx(crop_x, subsample, info.tilesize)             # Extract tile of start coordinate x
    min_y = _get_tile_idx(crop_y, subsample, info.tilesize)             # Extract tile of start coordinate y
    max_x = _get_tile_idx(crop_x+crop_size, subsample, info.tilesize)   # Extract tile of end coordinate x
    max_y = _get_tile_idx(crop_y+crop_size, subsample, info.tilesize)   # Extract tile of end coordinate y
    offset_x = int(crop_x//subsample) - min_x*info.tilesize
    offset_y = int(crop_y//subsample) - min_y*info.tilesize
    width = math.ceil(crop_size/subsample)
    height = math.ceil(crop_size/subsample)

    # Tile using pivyps
    if info.overlap==0:
        tilefun = lambda x, y: (pyvips.Image.new_from_file(os.path.join(info.tiledir,str(level),f'{x}_{y}.{info.format}'), access="sequential"))
    else: # Overlap imposes need for cropping
        tilefun = lambda x, y: (pyvips.Image.new_from_file(os.path.join(info.tiledir,str(level),f'{x}_{y}.{info.format}'), access="sequential")
                                .crop(info.overlap if x>0 else 0, 
                                      info.overlap if y>0 else 0, 
                                      info.tilesize if x<global_max_x else (global_width-1)%info.tilesize+1,
                                      info.tilesize if y<global_max_y else (global_height-1)%info.tilesize+1))
    tiles = [tilefun(x, y) for y in range(min_y, max_y + 1) for x in range(min_x, max_x + 1)]

    # Crop is required to trim lower right image border
    im = pyvips.Image.arrayjoin(tiles, across=(max_x-min_x+1)).crop(offset_x,offset_y,width,height)
    return np.array(im)


class ZStackSingleInstanceDataset(Dataset):
    def __init__(self, detections, image_ID, crop_size):
        self.detections = detections
        self.image_ID = image_ID
        self.z_levels = get_z_levels(image_ID)
        self.crop_size = crop_size
    
    def __len__(self):
        return len(self.detections)
    
    def __getitem__(self, index):
        coords = self.detections[index]
        x = coords[0]
        y = coords[1]
        patch = np.zeros((len(self.z_levels), self.crop_size, self.crop_size, 3), dtype=np.uint8)
        for i, z in enumerate(self.z_levels):
            patch[i] = assemble_patch(x, y, z, self.image_ID, self.crop_size)
        return patch


class SingleInstanceDataset(Dataset):
    def __init__(self, nuclei, image_ID, crop_size, imagenet_normalize):
        self.nuclei = nuclei
        self.image_ID = image_ID
        self.z_levels = get_z_levels(image_ID)
        self.crop_size = crop_size
        self.transform = None
        if imagenet_normalize:
            mean = [0.485, 0.456, 0.406]
            std = [0.229, 0.224, 0.225]
            self.transform = v2.Compose([
                v2.Normalize(mean=mean, std=std)
            ])
    
    def __len__(self):
        return len(self.nuclei)
    
    def __getitem__(self, index):
        nucleus = self.nuclei[index]
        coords = nucleus["points"][0]
        x = coords["x"]
        y = coords["y"]
        z = self.z_levels[nucleus["z"] + len(self.z_levels)//2]
        patch = assemble_patch(x, y, z, self.image_ID, self.crop_size)
        tensor = torch.tensor(patch).permute(2,0,1) / 255
        if not self.transform is None:
            tensor = self.transform(tensor)
        return tensor


class NucleusDetectionPool(Dataset):
    def __init__(self,
                 slide_ids: str,
                 slide_dir: str,
                 annotation_dir: str,
                 only_labeled: bool = False,
                 subsample: int = 2,
                 gauss_sigma: float = 3):
        self.slide_dir = slide_dir
        self.sample_df = pd.DataFrame(columns=["slide_id", "slide_name", "tile_paths", "nuclei_loc", "nuclei_loc_global"])
        
        self.bin_size = 2**subsample
        self.gauss_sigma = gauss_sigma

        for slide_id in tqdm(slide_ids):
            slide_name = glob.glob(f"{slide_dir}{slide_id} - *_z0.dzi")[0]
            slide_name = re.match(rf"{slide_dir}(.*?)_z0\.dzi", slide_name).group(1)

            z_values = sorted(
                int(re.search(rf"{slide_name}_z(-?\d+)\.dzi", f.name).group(1))
                for f in Path(slide_dir).glob(f"{slide_name}_z*.dzi")
            )

            info = {z: dzi_info(f"{slide_dir}/{slide_name}_z{z}.dzi") for z in z_values}
            overlap = info[0].overlap
            tile_size = info[0].tilesize

            levels = max(info[0].size['Height'], info[0].size['Width']).bit_length()
            level = levels - subsample

            ul = np.array((0,0), dtype=float)
            dr = np.array((info[0].size['Width'], info[0].size['Height']), dtype=float)

            ul /= self.bin_size
            dr /= self.bin_size

            # Convert to tile coordinates completely inside rectangle
            ul = np.ceil(ul / tile_size).astype('int')
            dr = np.floor(dr / tile_size).astype('int')

            rows = []

            for y in range(ul[1]+1,dr[1]-1):
                for x in range(ul[0]+1,dr[0]-1):
                    # Find crops based on tile coords and overlap
                    left_crop = overlap if x>0 else 0
                    top_crop = overlap if y>0 else 0
                    tile_crop = (left_crop, top_crop, tile_size, tile_size)
                    # Add tile path and nuclei coordinates to dataset df
                    tile_paths = {z: os.path.join(info[z].tiledir, str(level), f'{x}_{y}.{info[z].format}') for z in z_values}
                    rows.append({
                        "slide_id": slide_id, 
                        "slide_name": slide_name, 
                        "tile_paths": [tile_paths], 
                        "tile_coord_x": x,
                        "tile_coord_y": y,
                        "tile_crop": [tile_crop],
                        "labeled": False,
                        "nuclei_loc": None, 
                        "nuclei_loc_global": None
                    })

            self.sample_df = pd.concat([self.sample_df, pd.DataFrame(rows)], ignore_index=True)
            self.sample_df["nuclei_loc"] = self.sample_df["nuclei_loc"].astype(object)
            self.sample_df["nuclei_loc_global"] = self.sample_df["nuclei_loc_global"].astype(object)

            annotation_file = Path(f"{annotation_dir}/{slide_id}.json")
            if annotation_file.is_file():
                with open(annotation_file) as file:
                    annotation_json = json.load(file)
                self.add_labels(annotation_json)
        
        if only_labeled:
            self.sample_df = self.sample_df[(self.sample_df["labeled"])].reset_index(drop=True)
    
    def add_labels(self, annotation_json):
        slide_name = annotation_json["image"]

        z_values = sorted(
            int(re.search(rf"{slide_name}_z(-?\d+)\.dzi", f.name).group(1))
            for f in Path(self.slide_dir).glob(f"{slide_name}_z*.dzi")
        )

        info = {z: dzi_info(f"{self.slide_dir}/{slide_name}_z{z}.dzi") for z in z_values}
        tile_size = info[0].tilesize
        rects = [
            [{'x': float(p['x']), 'y': float(p['y'])} for p in d['points']]
            for d in annotation_json['annotations']
            if d['mclass'] == 'ROI'
        ]

        # Extract ground truth points
        markers = np.array([list(d['points'][0].values()) for d in annotation_json['annotations'] if ((d['mclass'] == 'Normal') | (d['mclass'] == 'Immune'))])
        points = markers / self.bin_size

        # Extract tile and position in tile for each point
        p_tile, p_pos = np.divmod(points, tile_size)    # TODO: overlap? 

        # Each rectangle with annotations
        for i, rect in enumerate(rects):
            # Extract up left and down right coordinates of rectangle
            vertices = np.array([list(p.values()) for p in rect])
            ul = vertices.min(axis=0)
            dr = vertices.max(axis=0)

            # Assert that quadrilateral really is rectangle
            for corner,dim in itertools.product([ul,dr],[0,1]):
                assert np.count_nonzero(corner[dim]==vertices[:,dim]) == 2, "Annotation quadrilateral is not axis aligned rectangle"

            # Account for downsampling
            ul /= self.bin_size
            dr /= self.bin_size

            # Convert to tile coordinates completely inside rectangle
            ul = np.ceil(ul / tile_size).astype('int')
            dr = np.floor(dr / tile_size).astype('int')

            # Each tile in rectangle
            for y in range(ul[1],dr[1]):
                for x in range(ul[0],dr[0]):
                    # Extract nuclei coordinates
                    pp = np.array([pp.astype('int') for pt, pp in zip(p_tile, p_pos) if np.array_equal(pt, np.array([x, y]))])
                    if len(pp) > 0:
                        p_global = np.array([p_global.astype('int') for pt, p_global in zip(p_tile, markers) if np.array_equal(pt, np.array([x, y]))])
                    else:
                        pp = np.zeros((0,2), dtype=int)
                        p_global = np.zeros((0,2), dtype=int)
                    
                    mask = (
                        (self.sample_df["slide_name"] == slide_name) &
                        (self.sample_df["tile_coord_x"] == x) &
                        (self.sample_df["tile_coord_y"] == y)
                    )
                    idx = self.sample_df.index[mask][0]
                    self.sample_df.loc[mask, "labeled"] = True
                    self.sample_df.at[idx, "nuclei_loc"] = pp
                    self.sample_df.at[idx, "nuclei_loc_global"] = p_global

    def get_labeled_idxs(self):
        return self.sample_df[(self.sample_df["labeled"])].index.tolist()
    
    def get_unlabeled_idxs(self):
        return self.sample_df[(self.sample_df["labeled"] == False)].index.tolist()

    def __len__(self):
        return len(self.sample_df)

    def __getitem__(self, idx):
        tile = self.sample_df.loc[idx].to_dict()
        return tile
    

class NucleusDetectionDataset(Dataset):
    def __init__(self,
                 tile_pool: NucleusDetectionPool,
                 idxs: list[int],
                 z: list[int] | int = 0,
                 nuclei_loc: bool=False,
                 masks: bool=False,
                 transform=None,
                 aux_data=None):
        self.tile_pool = tile_pool
        self.idxs = idxs
        if not isinstance(z, list): z = [z]
        self.z = z
        self.nuclei_loc = nuclei_loc
        self.masks = masks

        self.gauss_sigma = tile_pool.gauss_sigma
        self.peakval = gaussian_filter(np.ones([1,1]), sigma=self.gauss_sigma, mode='constant').max()
        self.transform = transform
        self.aux_data = aux_data

    def __len__(self):
        return len(self.idxs)
    
    def add_idxs(self, new_idxs: list[int]):
        if not isinstance(new_idxs, list):
            new_idxs = [new_idxs] 
        for idx in new_idxs:
            if not idx in self.idxs:
                self.idxs.append(idx)
            else:
                print(f"Warning when adding tile to set: Tile at data pool index {idx} already in set, ignoring.")

    def remove_idxs(self, removed_idxs: list[int]):
        if not isinstance(removed_idxs, list):
            removed_idxs = [removed_idxs] 
        for idx in removed_idxs:
            if idx in self.idxs:
                self.idxs.remove(idx)
            else:
                print(f"Warning when removing tile from set: Tile at data pool index {idx} not in set, ignoring.")

    @staticmethod
    def load(filename):
        ext = splitext(filename)[1]
        if ext in ['.npz', '.npy']:
            return Image.fromarray(np.load(filename))
        elif ext in ['.pt', '.pth']:
            return Image.fromarray(torch.load(filename).numpy())
        else:
            return Image.open(filename)

    def __getitem__(self, idx):
        tile_data = self.tile_pool[self.idxs[idx]]
        slide_id = tile_data["slide_id"]
        tile_paths = tile_data["tile_paths"][0]
        tile_crop = tile_data["tile_crop"][0]
        nuclei_loc = tile_data["nuclei_loc"]

        width = tile_crop[2]
        height = tile_crop[3]

        mask = np.zeros([height, width])
        if self.masks:
            for p in nuclei_loc: 
                mask[p[1],p[0]] = 1/self.peakval # y,x
            mask = gaussian_filter(mask, sigma=self.gauss_sigma, mode='constant')
            mask = np.clip(mask,0,1)

        selected_tiles = [tile_paths[z] for z in self.z]
        imgs = np.stack([np.asarray(self.load(tile)) for tile in selected_tiles])

        # Crop tiles
        imgs = imgs[:, tile_crop[0]:tile_crop[0] + width, tile_crop[1]:tile_crop[1] + height, :]

        if self.transform is not None:
            transformed = self.transform(images=imgs, mask=mask)
            imgs = transformed["images"]
            mask = transformed["mask"]

        imgs = torch.tensor((imgs.transpose(0,3,1,2) / 255))
        if len(imgs) == 1:
            imgs = imgs[0]

        sample = {
            "slide_id": slide_id,
            "tile_paths": selected_tiles,
            "image": imgs,
        }
        if self.nuclei_loc:
            sample["nuclei_loc"] = nuclei_loc
        if self.masks:
            sample["mask"] = torch.tensor(mask).unsqueeze(0)
        if self.aux_data is not None:
            sample["aux_data"] = self.aux_data[idx]
        return sample
    
    def get_num_focal_planes(self):
        return len(self.z)
    
    def collate(self, batch):
        # Custom collate function to handle varying properties of the sample dict rows
        res = {
            "slide_id": [sample["slide_id"] for sample in batch],
            "tile_paths": [sample["tile_paths"] for sample in batch],
            "image": torch.stack([sample["image"] for sample in batch])
        }
        if self.nuclei_loc:
            res["nuclei_loc"] = [sample["nuclei_loc"] for sample in batch]
        if self.masks:
            res["mask"] = torch.stack([sample["mask"] for sample in batch])
        if self.aux_data is not None:
            res["aux_data"] = torch.stack([sample["aux_data"] for sample in batch])
        return res
