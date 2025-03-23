import os, subprocess
import json
import numpy as np

def get_methods(dir):
    methods = []
    
    try:
        files = os.listdir(dir)
        files_json = [f for f in files if f.endswith(".json")]

        if not files_json:
            print("no files")
            raise Exception("No methods found.")
        
        for file in files_json:
            file_path = os.path.join(dir, file)
            with open(file_path, "r", encoding="utf-8") as f:
                try:
                    data = json.load(f)
                    if "name" in data:
                        methods.append({
                            "name": data["name"],
                            "description": data["description"]
                        })
                except json.JSONDecodeError as err:
                    print(f"Error parsing JSON file {file_path}: {err}")
    
    except OSError as err:
        raise Exception(f"Unable to read method directory: {err}")
    
    return methods

def get_free_gpu(min_free_mem):
    # Function to select a free GPU based on the amount of free memory
    res = subprocess.run(
        ['nvidia-smi', '--query-gpu=memory.free','--format=csv,noheader,nounits'],
        stdout=subprocess.PIPE,
        encoding='utf-8'
    )
    gpu_free_mem = [int(mem) for mem in res.stdout.strip().split('\n')]
    gpu_free_mem = gpu_free_mem[1:]     # First GPU is not dedicated to cytobrowser Q: Config?
    max_free_mem_gpu = np.argmax(gpu_free_mem)
    if gpu_free_mem[max_free_mem_gpu] > min_free_mem:
        return max_free_mem_gpu + 1     # +1 since we have removed the first GPU
    return -1

