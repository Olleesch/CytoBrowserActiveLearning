import logging, json
import random, math
import torch
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from tqdm import tqdm
from joblib import Parallel, delayed

from skimage.feature import peak_local_max
from sklearn.cluster import KMeans
from scipy.spatial.distance import cdist

from torch.utils.data import DataLoader
from skimage.feature import peak_local_max


def pred_peak_uncertainty(mask):
    """ Get the prediction peak uncertainty in the output detection mask """
    peak_coords = peak_local_max(mask, min_distance=5, threshold_abs=0, p_norm=2)
    if peak_coords.size == 0:
        return 0
    peaks = mask[tuple(peak_coords.T)]
    peak_dist = np.minimum(np.abs(peaks), np.abs(peaks - 1))
    return np.sum(peak_dist ** 2)

class ActiveLearningQuery():
    """ Query samples using active learning.
    
    Construct the queried set using some specified active learning methods. 
    The implemented methods are extensively described in https://urn.kb.se/resolve?urn=urn%3Anbn%3Ase%3Auu%3Adiva-561306.

    Attributes: 
        args_informativeness_function: The argument value for the informativeness function.
        informativeness: The function handle of the selected informativeness function.
        args_sampling_strategy: The argument value for the sampling strategy.
        sampler: The function handle of the selected sampling strategy.
    """

    def peak_uncertainty(
            self, 
            unlabeled_set,
            budget,
            model,
            batch_size,
            device
    ):
        """ Aggregated prediction peak uncertainty informativeness function """

        # Run model inference
        dataloader = torch.utils.data.DataLoader(unlabeled_set, batch_size, False, collate_fn=unlabeled_set.collate)
        num_focal_planes = unlabeled_set.get_num_focal_planes()
        informativeness_scores = np.zeros((len(unlabeled_set),1))
        model.eval()
        with torch.no_grad():
            with tqdm(total=len(unlabeled_set), desc=f'Running model inference', unit='img') as pbar:
                for i, batch in enumerate(dataloader):
                    batch_images = batch["image"]
                    # Format input images into one stack if the dataset contains multiple focal planes
                    if num_focal_planes > 1:
                        batch_images = batch_images.view(-1, batch_images.size(2), batch_images.size(3), batch_images.size(4))
                    batch_images = batch_images.to(device=device, dtype=torch.float32)
                    # Model inference
                    with torch.inference_mode():
                        masks_pred = model(batch_images)
                    # Revert shape of output to match the dataset if it contains multiple focal planes
                    if num_focal_planes > 1:
                        masks_pred = masks_pred.view(len(batch["image"]), num_focal_planes, 1, batch_images.size(2), batch_images.size(3)).squeeze(axis=2)
                    # Compute prediction peak uncertainty values per input
                    # TODO: Is multiple focal planes really handled correctly here?
                    masks_pred = masks_pred.detach().cpu().numpy().max(axis=1)
                    scores = Parallel(n_jobs=-2)(delayed(pred_peak_uncertainty)(mask) for mask in masks_pred)
                    informativeness_scores[i*batch_size:i*batch_size+len(scores), 0] = scores
                    pbar.update(batch["image"].shape[0])
        return informativeness_scores

    def cluster_representativeness(
            self,
            unlabeled_set,
            budget,
            model,
            batch_size,
            device
    ):
        """ Clustering-based representativeness informativeness function """

        # Register hook to extract features at the bottleneck layer of the network
        features = []
        def hook_fn(module, input, output):
            features.append(torch.mean(output, dim=[2,3]).squeeze(-1).squeeze(-1).detach().cpu())
        hook = model.down1.maxpool_conv[1].double_conv[5].register_forward_hook(hook_fn)

        # Run model inference
        dataloader = torch.utils.data.DataLoader(unlabeled_set, batch_size, False, collate_fn=unlabeled_set.collate)
        num_focal_planes = unlabeled_set.get_num_focal_planes()
        model.eval()
        with torch.no_grad():
            with tqdm(total=len(unlabeled_set), desc=f'Running model inference', unit='img') as pbar:
                for i, batch in enumerate(dataloader):
                    batch_images = batch["image"]
                    # Format input images into one stack if the dataset contains multiple focal planes
                    if num_focal_planes > 1:
                        batch_images = batch_images.view(-1, batch_images.size(2), batch_images.size(3), batch_images.size(4))
                    batch_images = batch_images.to(device=device, dtype=torch.float32)
                    # Model inference
                    with torch.inference_mode():
                        masks_pred = model(batch_images)
                    pbar.update(batch["image"].shape[0])
        hook.remove()

        # Concatenate features and convert to numpy
        if num_focal_planes > 1:
            features = features[::num_focal_planes] # Could be handled differently, now just takes the features from one of the planes (presumably plane 0)
        features = torch.cat(features, dim=0)
        features = features.numpy()
        np.save("./active_learning_results/temp_representativeness_embeddings.npy", features)   # Temporarily during development save the embeddings to file to examine closer
        
        # Cluster the embeddings using k-means++
        k = min(budget, len(unlabeled_set))
        kmeans = KMeans(n_clusters=k, init='k-means++')
        kmeans.fit(features)
        centers = kmeans.cluster_centers_
        distances = cdist(features, centers)

        # Find cluster belongings of each embedding and calculate the informativeness
        closest_cluster_ids = np.argmin(distances, axis=1)
        closest_distances = np.min(distances, axis=1)
        min_d = closest_distances.min()
        max_d = closest_distances.max()
        informativeness_scores = 1 - (closest_distances - min_d) / (max_d - min_d + 1e-8)
        informativeness_scores = np.stack((informativeness_scores, closest_cluster_ids), axis=1)

        return informativeness_scores

    def random_sampler(
            self, 
            unlabeled_set, 
            informativeness_scores, 
            budget,
            model,
            batch_size,
            device
    ):
        """ Random sampling """
        N = min(budget, len(unlabeled_set))
        queried_idxs = random.sample(unlabeled_set.idxs, N)
        return queried_idxs

    def topk_sampler(
            self, 
            unlabeled_set, 
            informativeness_scores, 
            budget, 
            model,
            batch_size,
            device
    ):
        """ Top-k sampling """
        k = min(budget, len(unlabeled_set))
        top_k = informativeness_scores[:,0].argsort()[-k:][::-1]
        queried_idxs = list(np.array(unlabeled_set.idxs)[top_k])
        return queried_idxs

    def cluster_sampler(
            self,
            unlabeled_set, 
            informativeness_scores, 
            budget, 
            model,
            batch_size,
            device
    ):
        """ Clustering-based diversity sampling """

        # Make sure the informativeness score contains two dimensions to store both the score and the cluster belonging
        if (len(informativeness_scores.shape) == 1):
            informativeness_scores = np.expand_dims(informativeness_scores, 1)

        if (informativeness_scores.shape[1] == 1):
            # Cluster assignments not provided, cluster data here. 
            # TODO: Same code as in the representativeness informativeness function, unnecessary repetition
            
            # Register hook to extract features at the bottleneck layer of the network
            features = []
            def hook_fn(module, input, output):
                features.append(torch.mean(output, dim=[2,3]).squeeze(-1).squeeze(-1).detach().cpu())
            hook = model.down1.maxpool_conv[1].double_conv[5].register_forward_hook(hook_fn)

            # Run model inference
            dataloader = torch.utils.data.DataLoader(unlabeled_set, batch_size, False, collate_fn=unlabeled_set.collate)
            num_focal_planes = unlabeled_set.get_num_focal_planes()
            model.eval()
            with torch.no_grad():
                with tqdm(total=len(unlabeled_set), desc=f'Running model inference', unit='img') as pbar:
                    for i, batch in enumerate(dataloader):
                        batch_images = batch["image"]
                        # Format input images into one stack if the dataset contains multiple focal planes
                        if num_focal_planes > 1:
                            batch_images = batch_images.view(-1, batch_images.size(2), batch_images.size(3), batch_images.size(4))
                        batch_images = batch_images.to(device=device, dtype=torch.float32)
                        # Model inference
                        with torch.inference_mode():
                            masks_pred = model(batch_images)
                        pbar.update(batch["image"].shape[0])
            hook.remove()

            # Concatenate features and convert to numpy
            if num_focal_planes > 1:
                features = features[::num_focal_planes] # Could be handled differently, now just takes the features from one of the planes (presumably plane 0)
            features = torch.cat(features, dim=0)
            features = features.numpy()
            
            # Cluster the embeddings using k-means++
            k = min(budget, len(unlabeled_set))
            kmeans = KMeans(n_clusters=k, init='k-means++')
            kmeans.fit(features)
            centers = kmeans.cluster_centers_
            distances = cdist(features, centers)
            closest_cluster_ids = np.argmin(distances, axis=1)
            informativeness_scores = np.stack((informativeness_scores[:,0], closest_cluster_ids), axis=1)

        assert (len(informativeness_scores.shape) == 2 and informativeness_scores.shape[1] == 2), \
            "Error: Wrong input format of the informativeness scores (must also contain cluster belongings)"

        # Extract the highest informativeness score in each cluster
        k = min(budget, len(unlabeled_set))
        scores = informativeness_scores[:, 0]
        clusters = informativeness_scores[:, 1].astype(int)
        num_clusters = np.max(clusters) + 1
        assert num_clusters == k, "Error: Number of clusters is not equal to budget"
        cluster_representatives = []
        for c in range(num_clusters):
            cluster_indices = np.where(clusters == c)[0]
            best_idx_in_cluster = cluster_indices[np.argmax(scores[cluster_indices])]
            cluster_representatives.append(best_idx_in_cluster)
        queried_idxs = list(np.array(unlabeled_set.idxs)[cluster_representatives])
        return queried_idxs

    def __init__(
            self,
            args
    ):
        self.args_sampling_strategy = args.sampling_strategy
        self.args_informativeness_function = args.informativeness_function

        if args.sampling_strategy == "random":
            self.informativeness = None
            self.sampler = self.random_sampler
            return

        if args.informativeness_function == "uncertainty":
            self.informativeness = self.peak_uncertainty
        elif args.informativeness_function == "representativeness":
            self.informativeness = self.cluster_representativeness
        else:
            raise NotImplementedError

        if args.sampling_strategy == "topk":
            self.sampler = self.topk_sampler
        elif args.sampling_strategy == "diversity":
            self.sampler = self.cluster_sampler
        else:
            raise NotImplementedError

    def query_subset(
            self,
            unlabeled_set,
            model,
            budget,
            batch_size,
            device
    ):
        """ Apply informativeness function and sampling strategy to construct the queried set """
        if self.informativeness:
            informativeness_scores = self.informativeness(unlabeled_set, budget, model, batch_size, device)
        else:
            informativeness_scores = None
        queried_idxs = self.sampler(unlabeled_set, informativeness_scores, budget, model, batch_size, device)
        return queried_idxs


class TotalLocalizationError:
    def __init__(self, images_info, alpha=0.5, slack=1, threshold=5, edge_threshold=10):
        """
        Initialize the Total Localization Error calculator.

        Code from Marco Acerbis (modified version of https://github.com/MIDA-group/Cell-Detection from https://doi.org/10.1007/978-3-031-95918-9_19)

        Parameters:
        -----------
        images_info : list of dict
            List of dictionaries, each containing:
            - 'gt_centroids': ground truth centroids DataFrame
            - 'pred_centroids': predicted centroids DataFrame
        alpha : float
            Penalty factor for false positives (extra predictions)
        slack : float
            Margin of error - Predicted centroids with distance <= slack from the gt centroids
            are considered a perfect match
        threshold : float
            Maximum accepted distance between a gt centroid and a predicted centroid.
            If the distance is greater than the threshold, the detection is considered a miss (FN + FP penalties added)
        """
        self.images_info = images_info
        self.alpha = alpha
        self.slack = slack
        self.threshold = threshold
        self.edge_threshold = edge_threshold
    
    def _filter_edge_centroids(self, gt_centroids, image_width, image_height, edge_threshold):
        """
        Filter out GT centroids and their predictions if GT is too close to image edges.

        Args:
            gt_centroids: list of (x, y) coordinates
            pred_centroids: list of (x, y) coordinates
            image_width: width of the image
            image_height: height of the image
            edge_threshold: minimum distance allowed from edges

        Returns:
            filtered_gt: GT centroids away from edges
            valid_indices: indices of valid GT centroids
        """
        # Check which GT centroids are far enough from edges
        valid_indices = []
        filtered_gt = []
        for i, (x, y) in enumerate(gt_centroids):
            if (x >= edge_threshold and x <= image_width - edge_threshold and
                y >= edge_threshold and y <= image_height - edge_threshold):
                valid_indices.append(i)
                filtered_gt.append((x, y))

        return filtered_gt, valid_indices

    def _relative_distance(self, gt_point, pred_point):
        """
        Calculate relative distance between ground truth and predicted centroids.

        Parameters:
        -----------
        gt_point : tuple
            Ground truth centroid coordinates (x, y)
        pred_point : tuple
            Predicted centroid coordinates (x, y)

        Returns:
        --------
        float: Relative distance
        """
        # Unpack coordinates
        gt_x, gt_y = gt_point
        pred_x, pred_y = pred_point

        # Handle virtual points with infinite coordinates
        if gt_x == float('inf') or pred_x == float('inf'):
            return 1.0

        # Calculate the euclidean distance
        distance = math.sqrt((gt_x - pred_x)**2 + (gt_y - pred_y)**2)
        return distance

    def _match_centroids(self, image_width, image_height, gt_points, pred_points, edge_threshold):
        """
        Match ground truth and predicted centroids to minimize total distance (Hungarian algorithm).

        Parameters:
        -----------
        gt_points : list
            Ground truth centroid coordinates
        pred_points : list
            Predicted centroid coordinates

        Returns:
        --------
        float: Localization error for the image
        dict: Additional error metrics
        int: Number of true positives
        int: Number of predicted points
        int: Number of ground truth points
        """
        n_gt = len(gt_points)
        n_pred = len(pred_points)

        # Calculate base distance matrix
        distance_matrix = np.zeros((max(n_gt, n_pred), max(n_gt, n_pred)))

        # Fill the distance matrix with actual distances where possible
        for i in range(min(n_gt, distance_matrix.shape[0])):
            for j in range(min(n_pred, distance_matrix.shape[1])):
                distance = self._relative_distance(gt_points[i], pred_points[j])
                distance_matrix[i, j] = distance

        # Fill penalties for false negative
        if n_gt > n_pred:
            for i in range(n_gt):
                for j in range(n_pred, distance_matrix.shape[1]):
                    distance_matrix[i, j] = 10000

        # Use Hungarian algorithm for optimal matching
        from scipy.optimize import linear_sum_assignment
        row_ind, col_ind = linear_sum_assignment(distance_matrix)
        matched_distances = distance_matrix[row_ind, col_ind]

        filtered_gt, valid_indices = self._filter_edge_centroids(gt_points, image_width, image_height, edge_threshold)

        # Calculate the error for each pairing
        errors = []
        c = 0
        for i in range(len(matched_distances)):
            if matched_distances[i] <= self.slack:
                errors.append(0)
            elif matched_distances[i] <= self.threshold:
                errors.append((matched_distances[i] - self.slack)/(self.threshold - self.slack))
            elif matched_distances[i] <= ((self.alpha+1)*self.threshold - self.alpha*self.slack):
                errors.append((matched_distances[i] - self.slack)/(self.threshold - self.slack))
            elif matched_distances[i] == 10000:
                errors.append(1)
            else:
                errors.append(1 + self.alpha)

        fp =  max(0, n_pred - n_gt)
        final_error = []
        for i in valid_indices:
            final_error.append(errors[i])
        misdetections = np.count_nonzero(np.array(final_error) > 1)
        perfect_matches = np.count_nonzero(np.array(final_error) == 0)
        final_error.append(fp*self.alpha)

        n_gt = len(valid_indices)

        # Handle special cases
        if n_pred == 0:
            return float(n_gt), {'fn': n_gt, 'fp': 0, 'matches': 0, 'perfect_matches': 0, 'misdetections': 0}, 0, 0, n_gt
        if n_gt == 0:
            return float(n_pred * self.alpha), {'fn': 0, 'fp': n_pred, 'matches': 0, 'perfect_matches': 0, 'misdetections': 0}, 0, n_pred, 0
        

        error_metrics = {
            'fn': max(0, n_gt - n_pred) + misdetections,  # False negatives (missing detections)
            'fp': fp + misdetections,  # False positives (extra predictions)
            'perfect_matches': perfect_matches,  # Matches within slack
            'misdetections': misdetections, # Detection over the threshold value
        }

        tp = len(valid_indices) - np.count_nonzero(np.array(final_error) == 1)

        return np.sum(final_error), error_metrics, tp, n_pred, n_gt

    def calculate_total_localization_error(self):
        """
        Calculate the average localization error across all images.

        Returns:
        --------
        dict: A dictionary with the results, including the total error, precision, recall, F1-score, number of true positives, negatices, etc
        """
        image_errors = []
        detailed_errors = []
        false_negatives = []
        false_positives = []
        true_positives = []
        perfect_matches = []
        misdetections = []
        prediction = []
        ground_truth = []

        for img_info in self.images_info:
            # Extract image information
            gt_centroids = img_info['gt_centroids']
            pred_centroids = img_info['pred_centroids']
            image_width = img_info['width']
            image_height = img_info['height']

            # Convert centroids to list of tuples
            gt_points = list(zip(gt_centroids['x'], gt_centroids['y']))
            pred_points = list(zip(pred_centroids['x'], pred_centroids['y']))
            
            # Calculate localization error for this image
            img_error, error_metrics, tp, n_pred, n_gt = self._match_centroids(
                image_width, image_height, gt_points, pred_points, self.edge_threshold
            )

            if tp == 0:
                fn = 0
                fp = 0
                precision =  0
                recall = 0
                FScore = 0
            else: 
                fn = error_metrics['fn']
                fp = error_metrics['fp']
                precision =  tp / (tp + fp)
                recall = tp / (tp + fn)
                FScore = 2*tp / (2*tp + fn + fp)

            image_errors.append(img_error)
            false_negatives.append(fn)
            false_positives.append(fp)
            true_positives.append(tp)
            perfect_matches.append(error_metrics['perfect_matches'])
            misdetections.append(error_metrics['misdetections'])
            prediction.append(n_pred)
            ground_truth.append(n_gt)

            detailed_errors.append({
                'gt_count': tp,
                'pred_count': n_pred,
                'image_error': img_error,
                'false_negatives': fn,
                'false_positives': fp,
                'precision': precision,
                'recall': recall,
                'F-score': FScore,
                'perfect_matches': error_metrics['perfect_matches'],
                'misdetections': error_metrics['misdetections'],
            })
        self.detailed_errors = detailed_errors

        # Calculate total localization error, precision, recall and Fscore
        total_error = np.sum(image_errors) / np.sum(ground_truth)
        total_precision = np.sum(true_positives) / (np.sum(true_positives) + np.sum(false_positives))
        total_recall = np.sum(true_positives) / (np.sum(true_positives) + np.sum(false_negatives))
        total_FScore = 2*np.sum(true_positives) / (2*np.sum(true_positives) + np.sum(false_negatives) + np.sum(false_positives))
        total_prediction = np.sum(prediction)
        total_ground_truth = np.sum(ground_truth)
        total_tp = np.sum(true_positives)
        total_fp = np.sum(false_positives)
        total_fn = np.sum(false_negatives)
        total_perfect_matches = np.sum(perfect_matches)
        total_misdetections = np.sum(misdetections)

        res = {
            "total_error": total_error,
            "total_precision": total_precision,
            "total_recall": total_recall,
            "total_FScore": total_FScore,
            "total_prediction": total_prediction,
            "total_ground_truth": total_ground_truth,
            "total_tp": total_tp,
            "total_fp": total_fp,
            "total_fn": total_fn,
            "total_perfect_matches": total_perfect_matches,
            "total_misdetections": total_misdetections
        }

        return res


def find_spots(img, threshold, min_dist=5):
    """ Help function to extract the predicted nuclei locations from the output detection mask """

    def _find_spots(im):
        return np.fliplr(peak_local_max(im, min_distance=min_dist, threshold_abs=threshold, p_norm=2))
    if len(img.shape) == 2:
        xy = _find_spots(img)
    if len(img.shape) == 3:
        xy = [_find_spots(im) for im in img]
    return xy


def save_eval_json(filename, res):
    """ Help function to save the evaluation results to a JSON file """

    eval_json = {
        "total_error": res["total_error"],
        "total_precision": res["total_precision"],
        "total_recall": res["total_recall"],
        "total_FScore": res["total_FScore"],
        "n_prediction": int(res["total_prediction"]),
        "n_ground_truth": int(res["total_ground_truth"]),
        "n_tp": int(res["total_tp"]),
        "n_fp": int(res["total_fp"]),
        "n_fn": int(res["total_fn"]),
        "n_perfect_detections": int(res["total_perfect_matches"]),
        "n_misdetections": int(res["total_misdetections"]),
    }
    with open(filename, "w") as f:
        json.dump(eval_json, f, indent=4)


def evaluate_net(args, net, dataset, device):
    """ Evaluate the model on the test dataset """

    # To store inference results
    tiles_info = []

    # Run model inference
    num_focal_planes = dataset.get_num_focal_planes()
    loader_args = dict(batch_size=args.batch_size, num_workers=args.workers, pin_memory=True)
    data_loader = DataLoader(dataset, shuffle=False, collate_fn=dataset.collate, **loader_args)
    net.eval()
    count = 0
    with torch.no_grad():
        with tqdm(total=len(dataset), desc=f'Running model inference', unit='img') as pbar:
            for batch in data_loader:
                batch_images = batch["image"]
                batch_nuclei_gt = batch["nuclei_loc"]

                # Format input images into one stack if the dataset contains multiple focal planes
                if num_focal_planes > 1:
                    batch_images = batch_images.view(-1, batch_images.size(2), batch_images.size(3), batch_images.size(4))
                batch_images = batch_images.to(device=device, dtype=torch.float32)
                # Model inference
                with torch.inference_mode():
                    masks_pred = net(batch_images)
                # Revert shape of output to match the dataset if it contains multiple focal planes
                if num_focal_planes > 1:
                    masks_pred = masks_pred.view(len(batch["image"]), num_focal_planes, 1, batch_images.size(2), batch_images.size(3)).squeeze(axis=2)
                masks = masks_pred.detach().cpu().numpy().max(axis=1)
                # Find predicted nuclei locations from the output detection masks
                batch_nuclei_pred = find_spots(masks,args.threshold,args.min_dist)

                # Construct dataframes to process the results and compute evaluation metrics
                for (nuclei_gt, nuclei_pred, image) in zip(batch_nuclei_gt, batch_nuclei_pred, batch_images):
                    count += nuclei_pred.shape[0]
                    gt_centroids = pd.DataFrame({'x': nuclei_gt[:,0], 'y': nuclei_gt[:,1]})
                    pred_centroids = pd.DataFrame({'x': nuclei_pred[:,0], 'y': nuclei_pred[:,1]})
                    tiles_info.append({
                        "gt_centroids": gt_centroids,
                        "pred_centroids": pred_centroids,
                        "width": image.shape[2],
                        "height": image.shape[1]
                    })
                
                pbar.update(batch["image"].shape[0])
                pbar.set_postfix_str(f'Count={count:5d}')
    
    # Compute evaluation metrics
    tle_calculator = TotalLocalizationError(
        tiles_info,
        alpha=args.alpha,
        slack=args.slack,
        threshold=args.dist_threshold,
        edge_threshold=args.edge_threshold
    )
    res = tle_calculator.calculate_total_localization_error()
    logging.info(f"Evaluation results:\n"
                 f"\tTotal error:                  {res["total_error"]:.4f}\n"
                 f"\tTotal precision:              {res["total_precision"]:.4f}\n"
                 f"\tTotal recall:                 {res["total_recall"]:.4f}\n"
                 f"\tTotal f-score:                {res["total_FScore"]:.4f}\n"
                 f"\tNumber of predictions:        {res["total_prediction"]}\n"
                 f"\tNumber of ground truth:       {res["total_ground_truth"]}\n"
                 f"\tNumber of true positives:     {res["total_tp"]}\n"
                 f"\tNumber of false positives:    {res["total_fp"]}\n"
                 f"\tNumber of false negatives:    {res["total_fn"]}\n"
                 f"\tNumber of perfect detections: {res["total_perfect_matches"]}\n"
                 f"\tNumber of misdetections:      {res["total_misdetections"]}\n")
    save_eval_json(args.eval_json, res)

    return res["total_error"], res["total_precision"], res["total_recall"], res["total_FScore"]


def save_metric_label_curve(n_labels, metric, title, label, filename, metric_std=None):
    """ Help function to save the metric-label curve of a measuremed sequence of results """

    plt.figure(figsize=(5, 5))
    if not metric_std is None:
        plt.errorbar(n_labels, metric, yerr=metric_std, fmt='o-', capsize=4, ms=5, color="black")
    else:
        plt.plot(n_labels, metric, "o-", c="black")

    plt.axhline(y=metric[0], xmin=0, xmax=1, color="black", linestyle="--", label="Lower bound")
    plt.axhline(y=metric[-1], xmin=0, xmax=1, color="black", linestyle="--", label="Upper bound")

    x_diff = n_labels[-1]-n_labels[0]
    x_mid = x_diff/2 + n_labels[0]
    y_diff = abs(metric[0]-metric[-1])
    y_bot = min(metric[0], metric[-1]) - y_diff*0.01
    y_top = max(metric[0], metric[-1]) + y_diff*0.01
    plt.text(x_mid, y_bot, "lower bound", ha="center", va="top", color="black", fontsize=8)
    plt.text(x_mid, y_top, "upper bound", ha="center", va="bottom", color="black", fontsize=8)

    plt.xlabel("size of labeled dataset (tiles)")
    plt.ylabel(label)
    plt.grid(True)
    plt.title(title)

    plt.savefig(filename, bbox_inches="tight")
    plt.close()


def plot_results(res, res_dir, res_std=None):
    """ Help function to plot the full results of an experiment """

    a_t_combos = res["r0"].keys()

    for key in a_t_combos:
        n_labels = np.array([d[key]["n_label"] for d in res.values()])

        error = np.array([d[key]["error"] for d in res.values()])
        if not res_std is None:
            error_std = np.array([d[key]["error"] for d in res_std.values()])
        else:
            error_std = None
        save_metric_label_curve(n_labels, error, "Error Curve", "test error", (res_dir / f"error_curve_{key}.png"), error_std)
        
        precision = np.array([d[key]["precision"] for d in res.values()])*100
        if not res_std is None:
            precision_std = np.array([d[key]["precision"] for d in res_std.values()])*100
        else:
            precision_std = None
        save_metric_label_curve(n_labels, precision, "Precision Curve", "test precision (%)", (res_dir / f"precision_curve_{key}.png"), precision_std)
        
        recall = np.array([d[key]["recall"] for d in res.values()])*100
        if not res_std is None:
            recall_std = np.array([d[key]["recall"] for d in res_std.values()])*100
        else:
            recall_std = None
        save_metric_label_curve(n_labels, recall, "Recall Curve", "test recall (%)", (res_dir / f"recall_curve_{key}.png"), recall_std)
        
        FScore = np.array([d[key]["FScore"] for d in res.values()])*100
        if not res_std is None:
            FScore_std = np.array([d[key]["FScore"] for d in res_std.values()])*100
        else:
            FScore_std = None
        save_metric_label_curve(n_labels, FScore, "F1-Score Curve", "test f1-score (%)", (res_dir / f"fscore_curve_{key}.png"), FScore_std)
