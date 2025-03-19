"""Image focus estimation function
"""

import cv2
import numpy as np
from functools import lru_cache 


#For debugging and speed comparisons
# import matplotlib.pyplot as plt
# import imageio
# from scipy.ndimage.filters import gaussian_filter


#Faster than other options 
def argmax(a):
    return a.index(max(a))


#A.18. Modified Laplacian - (LAP2) in S. Pertuz et al. PatRec 46 (2013) 1415–1432,
# suggested in S. Nayar, Y. Nakagawa, "Shape from focus", PAMI 16 (1994) 824–831.
#@profile
def focus_estimate_LAP2(im):
    return np.sum(np.abs(np.diff(im,n=2,axis=0)))+np.sum(np.abs(np.diff(im,n=2,axis=1)))


#Subtract mean and scale down edges towards zero to focus on the central part
def center_window_2d(im, focus=1):
    #CV2 is faster
    # mean_color=np.mean(im,axis=(0,1))
    mean_color=cv2.mean(im)[:3]
    im=im-mean_color

    im=im*center_mask_2d(im.shape, focus=focus)[:,:,np.newaxis] 
    # plt.imshow(np.uint8(im+mean_color))
    # plt.show()
    return im


#Image with squared distance to center
def sqr_center_dist_2d(shp, norm=True):
    center = np.array(shp[:2])/2
    i, j = np.ogrid[:shp[0], :shp[1]]
    d2 = (i - center[0])**2 + (j-center[1])**2
    if norm: 
        d2 /= np.min(center)**2
    return d2


#Elevated cosine window {-1,0,1}->{0,1,0}
def Hann(x):
    return (np.abs(x)<1)*(np.cos(0.5*np.pi*x)**2)


#Central cosine blob; gets smaller with focus>1
#@cache #Compute only once if same shape
@lru_cache(maxsize=None)
def center_mask_2d(shp, focus=1):
    return Hann(focus*sqr_center_dist_2d(shp))


#Computes a scalar which represents the overal image contrast
#For several images of the same scene, maximal value = best focus
# Good values are:
#  blur=0.85, focus=2.0   (gives median_acc=0.94,range_acc=0.97 on eval data, where human is 0.855, 0.865)
def focus_estimate(im, blur=0.85, focus=2.0): 
    im = center_window_2d(im, focus) 
    im = cv2.GaussianBlur(im, (0,0), blur)
    #CV2 significantly faster than Scipy
    # im=gaussian_filter(im, sigma=(blur,blur,0), mode='mirror')
    return focus_estimate_LAP2(im)