import sys
import json
import random

if __name__=='__main__':
    image_ID = sys.argv[1]
    collab_ID = sys.argv[2]

    try:
        with open(f'./collab_storage/{image_ID}/{image_ID}_{collab_ID}.json', 'r') as json_data:
            data = json.load(json_data)
        
        classes = [c["name"] for c in data["classConfig"]]

        for i, annotation in enumerate(data["annotations"]):
            if annotation["mclass"] == "Other":
                new_class = classes[random.randint(0, len(classes)-2)]
                data["annotations"][i]["mclass"] = new_class

        print(json.dumps(data))
        sys.stdout.flush()

    except Exception as e:
        print(f"Error occurred: {str(e)}", file=sys.stderr)
        sys.exit(1)