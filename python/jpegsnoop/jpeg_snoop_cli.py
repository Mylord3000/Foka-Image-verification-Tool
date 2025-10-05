#!/usr/bin/env python3
"""Minimal CLI that emulates key JPEGsnoop analysis steps.

This script parses JPEG headers, extracts quantization tables, computes the
same MD5 digests that JPEGsnoop stores in its signature database, and attempts
to match them against the signatures shipped with JPEGsnoop.

The output is a JSON document so it can be consumed by the Next.js API route.
"""

from __future__ import annotations

import argparse
import dataclasses
import hashlib
import json
import os
import struct
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

SIGNATURE_FILE = Path(__file__).with_name("Signatures.inl")


@dataclasses.dataclass
class QuantTable:
    table_id: int
    precision: int
    values: List[int]

    @property
    def md5(self) -> str:
        if self.precision == 0:
            raw = bytes(self.values)
        else:
            raw = b"".join(struct.pack(">H", value) for value in self.values)
        return hashlib.md5(raw).hexdigest().upper()


@dataclasses.dataclass
class SofData:
    precision: int
    height: int
    width: int
    component_count: int


@dataclasses.dataclass
class Signature:
    make: str
    model: str
    notes: str
    hash_y: str
    hash_c: str
    layout: str
    software: str
    extra: str

    def to_dict(self) -> Dict[str, str]:
        return {
            "make": self.make,
            "model": self.model,
            "notes": self.notes,
            "layout": self.layout,
            "software": self.software,
            "extra": self.extra,
        }


class JpegParseError(RuntimeError):
    """Raised when the JPEG file cannot be parsed."""


def read_uint16(data: bytes, offset: int) -> Tuple[int, int]:
    if offset + 2 > len(data):
        raise JpegParseError("Unexpected end of data while reading uint16")
    return struct.unpack_from(">H", data, offset)[0], offset + 2


def parse_quant_tables(segment: bytes) -> Iterable[QuantTable]:
    offset = 0
    while offset < len(segment):
        header = segment[offset]
        offset += 1
        precision = header >> 4
        table_id = header & 0x0F
        length = 64 * (2 if precision else 1)
        chunk = segment[offset : offset + length]
        if len(chunk) != length:
            raise JpegParseError("Incomplete DQT segment")
        offset += length

        if precision == 0:
            values = list(chunk)
        else:
            values = list(struct.unpack(f">{64}H", chunk))

        yield QuantTable(table_id=table_id, precision=precision, values=values)


def parse_signatures() -> List[Signature]:
    if not SIGNATURE_FILE.exists():
        raise FileNotFoundError(
            f"Cannot locate Signatures.inl at {SIGNATURE_FILE!s}. "
            "Ensure the JPEGsnoop resources are available."
        )

    import re

    signatures: List[Signature] = []
    pattern = re.compile(r"_T\(\"([^\"]*)\"\)")

    with SIGNATURE_FILE.open("r", encoding="utf-8", errors="ignore") as handle:
        for line in handle:
            striped = line.strip()
            if not striped.startswith("{"):
                continue
            tokens = pattern.findall(striped)
            if len(tokens) < 5:
                continue
            make, model, notes, hash_y, hash_c, *rest = tokens
            layout = rest[0] if len(rest) > 0 else ""
            software = rest[1] if len(rest) > 1 else ""
            extra = rest[2] if len(rest) > 2 else ""
            if make == "*":
                # End of signature table sentinel.
                break
            signatures.append(
                Signature(
                    make=make,
                    model=model,
                    notes=notes,
                    hash_y=hash_y,
                    hash_c=hash_c,
                    layout=layout,
                    software=software,
                    extra=extra,
                )
            )
    return signatures


def find_signature_matches(
    signatures: Iterable[Signature],
    hash_pairs: Iterable[Tuple[str, Optional[str]]],
) -> List[Dict[str, str]]:
    available = []
    for sig in signatures:
        available.append(sig)

    matches: List[Dict[str, str]] = []
    for hash_y, hash_c in hash_pairs:
        for sig in available:
            if sig.hash_y == hash_y and (
                hash_c is None or sig.hash_c == hash_c
            ):
                matches.append(sig.to_dict())
    return matches


def parse_jpeg(path: Path) -> Tuple[SofData, List[QuantTable], Dict[str, str]]:
    data = path.read_bytes()
    if len(data) < 4 or data[0:2] != b"\xFF\xD8":
        raise JpegParseError("Not a valid JPEG (missing SOI marker)")

    offset = 2
    sof_data: Optional[SofData] = None
    quant_tables: Dict[int, QuantTable] = {}
    info_flags = {
        "hasExif": False,
        "hasJFIF": False,
        "hasAdobe": False,
    }

    while offset < len(data):
        # Skip fill bytes (0xFF multiple)
        if data[offset] != 0xFF:
            offset += 1
            continue
        while offset < len(data) and data[offset] == 0xFF:
            offset += 1
        if offset >= len(data):
            break
        marker = 0xFF00 | data[offset]
        offset += 1

        if marker == 0xFFD9:  # EOI
            break
        if marker in {0xFF01} or 0xFFD0 <= marker <= 0xFFD7:
            # Standalone markers with no payload
            continue

        length, offset = read_uint16(data, offset)
        if length < 2:
            raise JpegParseError("Invalid segment length")
        segment_data = data[offset : offset + length - 2]
        offset += length - 2

        if marker == 0xFFDB:  # DQT
            for table in parse_quant_tables(segment_data):
                quant_tables[table.table_id] = table
        elif marker in {0xFFC0, 0xFFC1, 0xFFC2, 0xFFC3}:  # Baseline & progressive SOF
            if len(segment_data) < 6:
                raise JpegParseError("Invalid SOF segment")
            precision = segment_data[0]
            height = struct.unpack(">H", segment_data[1:3])[0]
            width = struct.unpack(">H", segment_data[3:5])[0]
            components = segment_data[5]
            sof_data = SofData(
                precision=precision,
                height=height,
                width=width,
                component_count=components,
            )
        elif marker == 0xFFE1 and segment_data.startswith(b"Exif\x00\x00"):
            info_flags["hasExif"] = True
        elif marker == 0xFFE0 and segment_data.startswith(b"JFIF\x00"):
            info_flags["hasJFIF"] = True
        elif marker == 0xFFEE and segment_data.startswith(b"Adobe"):
            info_flags["hasAdobe"] = True

    if sof_data is None:
        raise JpegParseError("Missing SOF0 marker; cannot read image dimensions")

    return sof_data, list(quant_tables.values()), info_flags




def assess_tampering(info_flags: Dict[str, bool], matches: List[Dict[str, str]]) -> Dict[str, object]:
    reasons: List[str] = []

    if not info_flags.get("hasExif", False):
        reasons.append("EXIF block missing; metadata may have been stripped or altered.")

    if info_flags.get("hasAdobe", False):
        reasons.append("Adobe marker detected; file may have been edited.")

    if not matches:
        reasons.append("Quantization signature not matched to a known camera profile.")

    suspected = bool(reasons)

    if not suspected:
        reasons.append("No metadata anomalies detected.")

    summary = "Tampering suspected" if suspected else "No obvious tampering detected"

    return {
        "suspected": suspected,
        "summary": summary,
        "reasons": reasons,
    }

def summarize(path: Path) -> Dict[str, object]:
    sof_data, quant_tables, info_flags = parse_jpeg(path)
    signatures = parse_signatures()

    quant_hash_pairs: List[Tuple[str, Optional[str]]] = []
    ordered_tables = sorted(quant_tables, key=lambda qt: qt.table_id)
    for index, table in enumerate(ordered_tables):
        quant_hash_pairs.append((table.md5, None))
        if index + 1 < len(ordered_tables):
            quant_hash_pairs.append((table.md5, ordered_tables[index + 1].md5))

    matches = find_signature_matches(signatures, quant_hash_pairs)

    tampering = assess_tampering(info_flags, matches)

    return {
        "file": {
            "path": str(path),
            "sizeBytes": path.stat().st_size,
        },
        "jpeg": {
            "width": sof_data.width,
            "height": sof_data.height,
            "componentCount": sof_data.component_count,
            "precision": sof_data.precision,
            **info_flags,
        },
        "quantizationTables": [
            {
                "id": table.table_id,
                "precision": table.precision,
                "values": table.values,
                "md5": table.md5,
            }
            for table in ordered_tables
        ],
        "signatureMatches": matches,
        "tamperingAssessment": tampering,
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Analyze a JPEG image using the JPEGsnoop signature database",
    )
    parser.add_argument("image_path", help="Path to the JPEG image")
    args = parser.parse_args()

    image_path = Path(args.image_path)
    if not image_path.exists():
        raise SystemExit(json.dumps({"error": f"Image does not exist: {image_path}"}))

    try:
        result = summarize(image_path)
    except Exception as exc:  # noqa: BLE001
        error_payload = {"error": str(exc)}
        print(json.dumps(error_payload))
        raise SystemExit(1)

    print(json.dumps(result))


if __name__ == "__main__":
    main()
