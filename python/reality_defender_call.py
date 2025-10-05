import argparse
import json
import sys
from realitydefender import RealityDefender


def to_json_serializable(value):
    try:
        json.dumps(value)
        return value
    except TypeError:
        return {"raw": str(value)}


def main():
    parser = argparse.ArgumentParser(description="Run Reality Defender detection")
    parser.add_argument("image_path", help="Path to the image to analyze")
    parser.add_argument(
        "--api-key",
        default="rd_68b925511d181562_c7908068e2a455d17af46aced2a2563b",
        help="Reality Defender API key",
    )
    args = parser.parse_args()

    client = RealityDefender(api_key=args.api_key)
    result = client.detect_file(args.image_path)
    print(json.dumps(to_json_serializable(result)))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # noqa: BLE001
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        sys.exit(1)
