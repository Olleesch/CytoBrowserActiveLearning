import requests

import argparse, logging, json
import math
import numpy as np
from pathlib import Path
from datetime import datetime, timezone
from threading import Event

import torch
import albumentations

from data_utils import NucleusDetectionPool, NucleusDetectionDataset
from active_learning_utils import ActiveLearningQuery, evaluate_net, plot_results

from NucleusDetection import train_net, load_network


def active_learning_experiment(
        experiment_id: int, 
        callback_url: str, 
        parameters: dict, 
        proceed_query: Event, 
        data: dict
):
    """ The active learning experimental pipeline.

    Pipeline: 
        1. Set up AL experiment. Load a trained model (on some annotated set/pre-trained), 
           set up datasets (labeled dataset, unlabeled dataset part of the training pool 
           plus a completely separate test dataset), set annotation budget b, number of 
           annotation rounds T, and other AL parameters. 

        2. Active learning loop (repeat T times):
        2.a. Sample selection. Apply informativeness function to all samples in the
             unlabeled set (implies running model inference on all samples in the set)
             to obtain the queried dataset with some sampling strategy S. 
        2.b. Annotation by oracle. Annotate queried samples and move annotated samples
             from the unlabeled set to the labeled set. 
        2.c. Train model. Train the model on the labeled set and compute evaluation
             metrics based on the separate test set. Save model and performance metrics
             somewhere. 

        ( 2.d. Repeat from step 1 if several models/AL methods are evaluated. )
        3. Create figures and tables with the results. 
    
    Args:
        experiment_id: An identifier of the active learning process.
        callback_url: The callback URL to send process updates back to the CytoBrowser server.
        parameters: A dictionary containing experiment parameters containing
                        informativenessFunction - The name of the informativeness method to use,
                        samplingStrategy        - The name of the sampling strategy to use,
                        annotationRounds        - The total number of annotation rounds,
                        annotationBudget        - The total annotation budget (total number of 
                                                  samples to annotate throughout the process)
        proceed_query: An event object used to pause the pipeline until it is triggered (used 
                       to wait for the oracle to annotate samples in step 2.b. of the pipeline).
        data: A dictionary to transmit data to this process running the pipeline after after
              oracle annotation. The dictionary is initially empty, but is later updated by
              external processes while this function is running, providing the pipeline with 
              new annotations in step 2.b.
    """

    # Help function to update the status of the experiment in the active learning handler in the CytoBrowser backend
    def update_status(msg):
        try:
            requests.post(f"{callback_url}/api/activeLearning/", json=msg)
        except Exception as e:
            print(f"Callback failed for active learning process {msg.get('id')}: {e}")


    """ 1. Set up AL experiment """

    logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
    logging.info("Starting active learning pipeline")

    # Make a dir for the results
    time_stamp = datetime.now().strftime("%y%m%d-%H%M%S")
    res_dir = Path(f"./active_learning_results/{time_stamp}/")
    res_dir.mkdir()

    # Set the device
    device = torch.device("cuda:0")
    logging.info(f"Using device {device}\n")

    # Get experiment parameters
    informativeness_function = parameters.get("informativenessFunction")
    sampling_strategy = parameters.get("samplingStrategy")
    T = int(parameters.get("annotationRounds"))
    B = int(parameters.get("annotationBudget"))
    
    # Set default experiment parameters
    num_runs = 1
    retrain_model = False
    epoch_checkfreq = 50
    num_epochs = 500
    note = f"Large-scale experiment testing;"

    # Set slides of the train, validation, and test pools
    slide_ids_val = ["040", "067"]
    slide_ids_test = ["001", "049", "061"]
    excluded = set(slide_ids_val + slide_ids_test)
    slide_ids_train = [
        f"{i:03d}" for i in range(1, 105)
        if f"{i:03d}" not in excluded
    ]

    # Set directories from which to read image data and existing annotations
    slide_dir = "./../data/"
    annotation_dir = "./active_learning_annotations/"

    """ Repeat for a number of runs to average results """
    # To store evaluation results
    res = {}
    for run in range(num_runs):

        # These are the datasets (tile pools) used in the pipeline. The first contains all samples
        # used by the AL process, includes the unlabeled and labeled sets. The second contains samples
        # separated for testing to ensure that a number of slides are never included in the training
        # process for fair model evaluation. 
        AL_train_tile_pool = NucleusDetectionPool(slide_ids_train, slide_dir, annotation_dir)
        AL_val_tile_pool = NucleusDetectionPool(slide_ids_val, slide_dir, annotation_dir, only_labeled=True)
        AL_test_tile_pool = NucleusDetectionPool(slide_ids_test, slide_dir, annotation_dir, only_labeled=True)
        logging.info(f"Created tile (sample) pools for active learning:\n"
                    f"\tAL train tile pool consisting of {len(AL_train_tile_pool)} tiles from slides {slide_ids_train}\n"
                    f"\tAL val tile pool consisting of {len(AL_val_tile_pool)} tiles from slides {slide_ids_val}\n"
                    f"\tAL test tile pool consisting of {len(AL_test_tile_pool)} tiles from slides {slide_ids_test}\n")
        
        # We create separate sets for evaluation and testing. 
        # dataset_test = NucleusDetectionDataset(AL_test_tile_pool, range(len(AL_test_tile_pool)), z=[0, -2000, 2000], masks=True, nuclei_loc=True)
        dataset_test = NucleusDetectionDataset(AL_test_tile_pool, range(len(AL_test_tile_pool)), z=0, masks=True, nuclei_loc=True)
        dataset_val = NucleusDetectionDataset(AL_val_tile_pool, range(len(AL_val_tile_pool)), z=0, masks=True, nuclei_loc=False)

        # Next, we define the labeled and unlabeled datasets used for training models by the AL process. 
        # To start with, we say that the tiles in the first slide are labeled and the rest are unlabeled. 
        labeled_pool_idxs = AL_train_tile_pool.get_labeled_idxs()
        unlabeled_pool_idxs = AL_train_tile_pool.get_unlabeled_idxs()
        transform = albumentations.Compose([albumentations.HorizontalFlip(p=0.5),
                                            albumentations.RandomRotate90(p=1)])
        labeled_set = NucleusDetectionDataset(AL_train_tile_pool, labeled_pool_idxs, z=0, masks=True, nuclei_loc=False, transform=transform)
        unlabeled_set = NucleusDetectionDataset(AL_train_tile_pool, unlabeled_pool_idxs, z=0, masks=False, nuclei_loc=False)
        logging.info(f"Created labeled and unlabeled datasets:\n"
                    f"\tLabeled set consisting of {len(labeled_set)} tiles\n"
                    f"\tUnlabeled set consisting of {len(unlabeled_set)} tiles\n"
                    f"\tIsolated labeled validation set consisting of {len(dataset_val)} tiles\n"
                    f"\tIsolated labeled test set consisting of {len(dataset_test)} tiles\n")
        
        # Active learning parameters
        args_active_learning = argparse.Namespace(
            informativeness_function=informativeness_function,
            sampling_strategy=sampling_strategy,
            retrain_model=retrain_model,
            num_runs=num_runs,
            T=T,
            b=math.ceil(B / T),
        )
        active_learning_query = ActiveLearningQuery(args_active_learning)
        # For initial experiments, the annotation budget is set so that the full dataset has been queried
        # in the final annotation round. 
        logging.info(f"Active learning parameters:\n"
                    f"\tNumber of annotation rounds: {args_active_learning.T}\n"
                    f"\tAnnotation budget:           {args_active_learning.b}\n"
                    f"\tInformativeness function:    {args_active_learning.informativeness_function}\n"
                    f"\tSampling strategy:           {args_active_learning.sampling_strategy}\n"
                    f"\tNumber of runs:              {args_active_learning.num_runs}\n"
                    f"\tModel re-training:           {args_active_learning.retrain_model}\n")
        
        # Model training arguments, specify checkpoint dir and model name at each training
        args_train = argparse.Namespace(
            dir_checkpoint="",      # Specify at each training to get separate dirs
            checkfreq=epoch_checkfreq,
            model="",               # Specify at each training to get separate model saves
            workers=4,
            epochs=num_epochs,
            batch_size=16,
            lr=1e-5,                # 1e-5 for extensive training
            start_epoch=1,
            val_fraction=0.1,       # Not used here
            load=False,
            amp=False,
            classes=1
        )
        
        # Model evaluation arguments
        test_thresholds = [0.4, 0.45, 0.5, 0.55]#, 0.6]
        test_alpha = [0.3, 1]
        args_test = argparse.Namespace(
            eval_json="",           # Specify at each evaluation to get separate json files
            batch_size=16,
            workers=1,
            threshold=0.4,
            min_dist=5,
            alpha=0.3,
            slack=5,
            dist_threshold=22,
            edge_threshold=25
        )

        # Save parameters to setup json
        setup_dict = {
            "timestamp": str(time_stamp),
            "note": note,
            "args_active_learning": vars(args_active_learning),
            "args_train": vars(args_train),
            "args_test": vars(args_test),
            "args_data": {
                "slide_ids_train": str(slide_ids_train),
                "slide_ids_val": str(slide_ids_val),
                "slide_ids_test": str(slide_ids_test)
            }
        }
        with open(res_dir / "setup.json", "w") as file:
            json.dump(setup_dict, file, indent=4)
        
        res[f"{run}"] = {}
        run_res_dir = res_dir / f"{run}"
        run_res_dir.mkdir()

        # Now, we can train the initial model on the initial labeled set. First split the labeled set into 
        # training and validation sets, then train the model. 
        logging.info(f"Loading initial model")
        # Update the status of the process to 'train'.
        update_status({
            "type": "updateProcess",
            "id": experiment_id,
            "status": "train",
            "round": 0,
            "query": None
        })
        round_res_dir = run_res_dir / "r0"
        round_res_dir.mkdir()
        args_train.checkfreq = min(args_train.checkfreq, args_train.epochs)
        args_train.dir_checkpoint = round_res_dir / "checkpoints/"
        args_train.model = round_res_dir / "model.pth"
        train_net(args_train, net, labeled_set, dataset_val, device)
        logging.info(f"Initial model training finished\n")

        # Evaluate trained model on the test set. 
        # Update the status of the process to 'eval'.
        update_status({
            "type": "updateProcess",
            "id": experiment_id,
            "status": "eval",
            "round": 0,
            "query": None
        })
        res[f"{run}"]["r0"] = {}
        for threshold in test_thresholds:
            args_test.threshold = threshold
            for alpha in test_alpha:
                args_test.alpha = alpha
                args_test.eval_json = round_res_dir / f"eval_t{threshold}_a{alpha}.json"
                logging.info(f"Evaluating model on test dataset (threshold={threshold}, alpha={alpha})")
                total_error, total_precision, total_recall, total_FScore = evaluate_net(args_test, net, dataset_test, device)
                res[f"{run}"]["r0"][f"t{threshold}_a{alpha}"] = {
                    "n_label": len(labeled_set),
                    "error": total_error,
                    "precision": total_precision,
                    "recall": total_recall,
                    "FScore": total_FScore
                }
        logging.info("Model evaluation finished\n")

        """ 2. Active learning loop """
        
        if not args_active_learning.retrain_model:
            args_train.epochs = args_train.epochs // 3
            args_train.checkfreq = args_train.checkfreq // 3

        # At this point, the active learning process can begin. 
        for t in range(args_active_learning.T):
            logging.info(f"Starting active learning round {t+1}/{args_active_learning.T}")
            """ 2.a. Sample selection """
            update_status({
                "type": "updateProcess",
                "id": experiment_id,
                "status": "selection",
                "round": t+1,
                "query": None
            })
            # Query sample subset with setup active learning method. 
            queried_idxs = active_learning_query.query_subset(unlabeled_set, net, args_active_learning.b, args_test.batch_size, device)
            logging.info(f"Queried {len(queried_idxs)} tiles for annotation")

            """ 2.b. Annotation """
            # Construct query message
            query = {
                "samples": [],
                "queriedOn": datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
            }
            for idx in queried_idxs:
                sample_dict = unlabeled_set.tile_pool[idx]
                sample_query = {
                    "name": sample_dict["slide_name"],
                    "thumbnail": f"data/{sample_dict["slide_name"]}_z0_files/15/{int(sample_dict["tile_coord_x"])}_{int(sample_dict["tile_coord_y"])}.jpg",
                    "zLevels": list(sample_dict["tile_paths"][0].keys()),
                    "tile_x": int(sample_dict["tile_coord_x"]),
                    "tile_y": int(sample_dict["tile_coord_y"])
                }
                query["samples"].append(sample_query)
            # Update the status of the process to 'query' and pass along the queried samples.
            update_status({
                "type": "updateProcess",
                "id": experiment_id,
                "status": "query",
                "round": t+1,
                "query": query
            })
            proceed_query.wait()

            # Add queried samples to labeled set. 
            print(f"Number of samples returned from oracle: {len(data.get("samples"))}")
            for sample in data.get("samples"):
                sample["image"] = sample.get("name")
                AL_train_tile_pool.add_labels(sample)
                labeled_pool_idxs = AL_train_tile_pool.get_labeled_idxs()
                unlabeled_pool_idxs = AL_train_tile_pool.get_unlabeled_idxs()
                labeled_set = NucleusDetectionDataset(AL_train_tile_pool, labeled_pool_idxs, z=0, masks=True, nuclei_loc=False, transform=transform)
                unlabeled_set = NucleusDetectionDataset(AL_train_tile_pool, unlabeled_pool_idxs, z=0, masks=False, nuclei_loc=False)

            # Update the status of the process to 'train'.
            update_status({
                "type": "updateProcess",
                "id": experiment_id,
                "status": "train",
                "round": t+1,
                "query": None
            })
            proceed_query.clear()
            logging.info(f"Annotated {len(queried_idxs)} tiles")
            logging.info(f"Current state of datasets:\n"
                        f"\tLabeled set consisting of {len(labeled_set)} tiles\n"
                        f"\tUnlabeled set consisting of {len(unlabeled_set)} tiles\n"
                        f"\tIsolated test set (labeled) consisting of {len(dataset_test)} tiles\n")

            """ 2.c. Model training """
            # Train model with labeled set. 
            logging.info(f"Training model on labeled dataset")
            round_res_dir = run_res_dir / f"r{t+1}"
            round_res_dir.mkdir()
            np.save(f"{round_res_dir}/selections_{t+1}.npy", np.array(queried_idxs))
            args_train.dir_checkpoint = round_res_dir / f"checkpoints/"
            args_train.model = round_res_dir / f"model.pth"
            if args_active_learning.retrain_model:
                net = load_network(device)
            train_net(args_train, net, labeled_set, dataset_val, device)
            logging.info(f"Model training finished\n")

            # Evaluate trained model on the test set. 
            # Update the status of the process to 'eval'.
            update_status({
                "type": "updateProcess",
                "id": experiment_id,
                "status": "eval",
                "round": t+1,
                "query": None
            })
            res[f"{run}"][f"r{t+1}"] = {}
            for threshold in test_thresholds:
                args_test.threshold = threshold
                for alpha in test_alpha:
                    args_test.alpha = alpha
                    args_test.eval_json = round_res_dir / f"eval_t{threshold}_a{alpha}.json"
                    logging.info(f"Evaluating model on test dataset (threshold={threshold}, alpha={alpha})")
                    total_error, total_precision, total_recall, total_FScore = evaluate_net(args_test, net, dataset_test, device)
                    res[f"{run}"][f"r{t+1}"][f"t{threshold}_a{alpha}"] = {
                        "n_label": len(labeled_set),
                        "error": total_error,
                        "precision": total_precision,
                        "recall": total_recall,
                        "FScore": total_FScore
                    }
            logging.info("Model evaluation finished\n")
        
        # Update the status of the process to 'finalizing'.
        update_status({
            "type": "updateProcess",
            "id": experiment_id,
            "status": "finalizing",
            "round": t+1,
            "query": None
        })
        with open(run_res_dir / "res.json", "w") as f:
            json.dump(res[f"{run}"], f, indent=4)
        logging.info("Active learning process finished\n")
        
        """ 3. Visualize results """

        logging.info("Generating plots to visualize results")
        fig_dir = run_res_dir / "figures/"
        fig_dir.mkdir()
        plot_results(res[f"{run}"], fig_dir)
        logging.info("Plots generated\n")
    
    """ Compute statistics over multiple runs and plot """

    res["avg"] = {}
    res["std"] = {}
    res["best"] = {}
    for t in range(args_active_learning.T + 1):
        res["avg"][f"r{t}"] = {}
        res["std"][f"r{t}"] = {}
        res["best"][f"r{t}"] = {}
        for threshold in test_thresholds:
            for alpha in test_alpha:
                res["avg"][f"r{t}"][f"t{threshold}_a{alpha}"] = {}
                res["avg"][f"r{t}"][f"t{threshold}_a{alpha}"]["n_label"] = res[f"0"][f"r{t}"][f"t{threshold}_a{alpha}"]["n_label"]
                res["avg"][f"r{t}"][f"t{threshold}_a{alpha}"]["error"] = np.nanmean(np.array([res[f"{run}"][f"r{t}"][f"t{threshold}_a{alpha}"]["error"] for run in range(num_runs)]))
                res["avg"][f"r{t}"][f"t{threshold}_a{alpha}"]["precision"] = np.nanmean(np.array([res[f"{run}"][f"r{t}"][f"t{threshold}_a{alpha}"]["precision"] for run in range(num_runs)]))
                res["avg"][f"r{t}"][f"t{threshold}_a{alpha}"]["recall"] = np.nanmean(np.array([res[f"{run}"][f"r{t}"][f"t{threshold}_a{alpha}"]["recall"] for run in range(num_runs)]))
                res["avg"][f"r{t}"][f"t{threshold}_a{alpha}"]["FScore"] = np.nanmean(np.array([res[f"{run}"][f"r{t}"][f"t{threshold}_a{alpha}"]["FScore"] for run in range(num_runs)]))

                res["std"][f"r{t}"][f"t{threshold}_a{alpha}"] = {}
                res["std"][f"r{t}"][f"t{threshold}_a{alpha}"]["n_label"] = res[f"0"][f"r{t}"][f"t{threshold}_a{alpha}"]["n_label"]
                res["std"][f"r{t}"][f"t{threshold}_a{alpha}"]["error"] = np.nanstd(np.array([res[f"{run}"][f"r{t}"][f"t{threshold}_a{alpha}"]["error"] for run in range(num_runs)]))
                res["std"][f"r{t}"][f"t{threshold}_a{alpha}"]["precision"] = np.nanstd(np.array([res[f"{run}"][f"r{t}"][f"t{threshold}_a{alpha}"]["precision"] for run in range(num_runs)]))
                res["std"][f"r{t}"][f"t{threshold}_a{alpha}"]["recall"] = np.nanstd(np.array([res[f"{run}"][f"r{t}"][f"t{threshold}_a{alpha}"]["recall"] for run in range(num_runs)]))
                res["std"][f"r{t}"][f"t{threshold}_a{alpha}"]["FScore"] = np.nanstd(np.array([res[f"{run}"][f"r{t}"][f"t{threshold}_a{alpha}"]["FScore"] for run in range(num_runs)]))

                res["best"][f"r{t}"][f"t{threshold}_a{alpha}"] = {}
                res["best"][f"r{t}"][f"t{threshold}_a{alpha}"]["n_label"] = res[f"0"][f"r{t}"][f"t{threshold}_a{alpha}"]["n_label"]
                best_error_run = np.nanargmin(np.array([res[f"{run}"][f"r{t}"][f"t{threshold}_a{alpha}"]["error"] for run in range(num_runs)]))
                res["best"][f"r{t}"][f"t{threshold}_a{alpha}"]["error"] = np.array([res[f"{run}"][f"r{t}"][f"t{threshold}_a{alpha}"]["error"] for run in range(num_runs)])[best_error_run]
                res["best"][f"r{t}"][f"t{threshold}_a{alpha}"]["precision"] = np.array([res[f"{run}"][f"r{t}"][f"t{threshold}_a{alpha}"]["precision"] for run in range(num_runs)])[best_error_run]
                res["best"][f"r{t}"][f"t{threshold}_a{alpha}"]["recall"] = np.array([res[f"{run}"][f"r{t}"][f"t{threshold}_a{alpha}"]["recall"] for run in range(num_runs)])[best_error_run]
                res["best"][f"r{t}"][f"t{threshold}_a{alpha}"]["FScore"] = np.array([res[f"{run}"][f"r{t}"][f"t{threshold}_a{alpha}"]["FScore"] for run in range(num_runs)])[best_error_run]
    with open(res_dir / "res.json", "w") as f:
        json.dump(res, f, indent=4)
    
    fig_dir = res_dir / "figures/"
    fig_dir.mkdir()

    fig_dir = res_dir / "figures/avg/"
    fig_dir.mkdir()
    plot_results(res["avg"], fig_dir, res["std"])

    fig_dir = res_dir / "figures/best/"
    fig_dir.mkdir()
    plot_results(res["best"], fig_dir)
