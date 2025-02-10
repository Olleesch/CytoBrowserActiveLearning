import os
import json

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
                        methods.append(data["name"])
                except json.JSONDecodeError as err:
                    print(f"Error parsing JSON file {file_path}: {err}")
    
    except OSError as err:
        raise Exception(f"Unable to read method directory: {err}")
    
    return sorted(methods)