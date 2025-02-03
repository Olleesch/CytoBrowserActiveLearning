import sys
import json

if __name__=='__main__':
    image_ID = sys.argv[1]

    try:
        with open(f'./temp/nuclei_detection_results/nuclei_{image_ID}.json', 'r') as json_data:
            data = json.load(json_data)

        print(json.dumps(data))
        sys.stdout.flush()
        
    except Exception as e:
        print(f"Error occurred: {str(e)}", file=sys.stderr)
        sys.exit(1)