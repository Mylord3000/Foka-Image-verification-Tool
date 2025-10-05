
import argparse
import json
import sys
from typing import Any, Dict, Iterable, List, Optional, Set

from picarta import Picarta


def is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def first_number(entry: Dict[str, Any], keys: Iterable[str]) -> Optional[float]:
    for key in keys:
        if key in entry and is_number(entry[key]):
            return float(entry[key])
    return None


def build_label(entry: Dict[str, Any]) -> Optional[str]:
    label_keys = [
        "label",
        "name",
        "title",
        "description",
        "city",
        "state",
        "region",
        "province",
        "country",
        "country_name",
        "ai_city",
        "ai_province",
        "ai_country",
    ]
    parts: List[str] = []
    for key in label_keys:
        value = entry.get(key)
        if isinstance(value, str):
            cleaned = value.strip()
            if cleaned and cleaned not in parts:
                parts.append(cleaned)
    return ", ".join(parts) if parts else None


def extract_locations(node: Any, seen: Set[str]) -> List[Dict[str, Any]]:
    locations: List[Dict[str, Any]] = []

    def process_dict(entry: Dict[str, Any]) -> None:
        lat = first_number(
            entry,
            [
                "latitude",
                "lat",
                "Latitude",
                "LATITUDE",
                "ai_lat",
            ],
        )
        lon = first_number(
            entry,
            [
                "longitude",
                "lon",
                "lng",
                "long",
                "Longitude",
                "LONGITUDE",
                "ai_lon",
            ],
        )

        gps = entry.get("gps")
        if isinstance(gps, (list, tuple)) and len(gps) >= 2:
            if lat is None and is_number(gps[0]):
                lat = float(gps[0])
            if lon is None and is_number(gps[1]):
                lon = float(gps[1])

        if lat is not None and lon is not None:
            confidence = first_number(
                entry,
                [
                    "confidence",
                    "confidence_score",
                    "score",
                    "probability",
                    "certainty",
                    "ai_confidence",
                ],
            )
            confidence_value = (
                confidence * 100 if confidence is not None and confidence <= 1 else confidence
            )

            label = build_label(entry)
            confidence_key = (
                f"{confidence_value:.2f}" if confidence_value is not None else "na"
            )
            cache_key = f"{lat:.6f}:{lon:.6f}:{confidence_key}:{label or ''}"
            if cache_key not in seen:
                seen.add(cache_key)
                locations.append(
                    {
                        "latitude": lat,
                        "longitude": lon,
                        "confidence": confidence_value,
                        "label": label,
                    }
                )

        for value in entry.values():
            locations.extend(extract_locations(value, seen))

    if isinstance(node, dict):
        process_dict(node)
    elif isinstance(node, list):
        for item in node:
            locations.extend(extract_locations(item, seen))

    return locations



def normalise_picarta_response(result: Any) -> Dict[str, Any]:
    if isinstance(result, str):
        try:
            payload = json.loads(result)
        except json.JSONDecodeError:
            payload = {"raw": result}
    else:
        payload = result

    if not isinstance(payload, dict):
        return {"raw": payload, "locations": [], "summary": "No structured response."}

    locations = extract_locations(payload, set())
    locations.sort(key=lambda item: item.get("confidence") or 0, reverse=True)

    top_location = locations[0] if locations else None
    summary_parts: List[str] = []
    if top_location:
        summary = (
            f"Top match near {top_location.get('label', 'unknown location')} "
            f"({top_location['latitude']:.4f}, {top_location['longitude']:.4f})"
        )
        if top_location.get("confidence") is not None:
            summary += f" with certainty {top_location['confidence']:.1f}%"
        summary_parts.append(summary)
    else:
        summary_parts.append("No geolocation candidates returned by Picarta.")

    return {
        "raw": payload,
        "locations": locations,
        "summary": " ".join(summary_parts),
    }



def main() -> None:
    parser = argparse.ArgumentParser(description="Run Picarta localization")
    parser.add_argument("image_path", help="Path to the image to analyze")
    parser.add_argument(
        "--api-token",
        default="GRG4MGO5EP36PU0K5R41",
        help="Picarta API token",
    )
    args = parser.parse_args()

    localizer = Picarta(args.api_token)

    try:
        result = localizer.localize(img_path=args.image_path)
        normalised = normalise_picarta_response(result)
        print(json.dumps(normalised))
    except Exception as error:  # noqa: BLE001
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
