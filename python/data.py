import math, sys, os, glob, re
import numpy as np
from collections import namedtuple
import xml.etree.ElementTree as ET
import pyvips
import torch
from torch.utils.data import Dataset
from torchvision.transforms import v2


def get_z_levels(image_ID):
    files = glob.glob(f'./../data/{image_ID}_z*.dzi')
    z_values = sorted(
        [int(re.search(r'_z(-?\d+)\.dzi$', f).group(1)) for f in files],
        reverse=True
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
        z = self.z_levels[nucleus["z"]]
        patch = assemble_patch(x, y, z, self.image_ID, self.crop_size)
        tensor = torch.tensor(patch).permute(2,0,1) / 255
        if self.transform:
            tensor = self.transform(tensor)
        return tensor
