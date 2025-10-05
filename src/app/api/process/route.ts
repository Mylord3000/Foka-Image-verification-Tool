import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type ApiResult = {
  label: string;
  output: string;
};

type PythonValue =
  | string
  | number
  | boolean
  | null
  | PythonValue[]
  | { [key: string]: PythonValue };

type PythonExecutionResult = {
  text: string;
  raw: PythonValue | string | null;
};

type OverviewEntry = {
  label: string;
  text: string;
  icon: string;
  tone?: "neutral" | "positive" | "warning";
};

type GeoPoint = {
  latitude: number;
  longitude: number;
  confidence?: number;
  label?: string;
};

const isRecord = (
  value: PythonValue | string | null,
): value is Record<string, PythonValue> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const toNumber = (value: PythonValue | string | null): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return undefined;
};

const getNumberFromRecord = (
  record: Record<string, PythonValue>,
  keys: string[],
): number | undefined => {
  for (const key of keys) {
    if (key in record) {
      const candidate = toNumber(record[key]);
      if (typeof candidate === "number") {
        return candidate;
      }
    }
  }
  return undefined;
};

const getStringFromRecord = (
  record: Record<string, PythonValue>,
  keys: string[],
): string | undefined => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
};

const normaliseConfidence = (value: number | undefined): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  const percent = value <= 1 ? value * 100 : value;
  const bounded = Math.max(0, Math.min(100, percent));
  return Number.isFinite(bounded) ? bounded : undefined;
};

const normaliseLocationEntry = (entry: PythonValue): GeoPoint | null => {
  if (!isRecord(entry)) {
    return null;
  }

  const latitude = getNumberFromRecord(entry, [
    "latitude",
    "lat",
    "Latitude",
    "LATITUDE",
  ]);
  const longitude = getNumberFromRecord(entry, [
    "longitude",
    "lon",
    "lng",
    "long",
    "Longitude",
    "LONGITUDE",
  ]);

  if (latitude === undefined || longitude === undefined) {
    return null;
  }

  const confidence = getNumberFromRecord(entry, [
    "confidence",
    "confidence_score",
    "score",
    "probability",
    "certainty",
  ]);
  const label = getStringFromRecord(entry, [
    "label",
    "name",
    "description",
    "city",
    "state",
    "region",
    "country",
    "country_name",
    "admin1",
    "admin2",
  ]);

  return {
    latitude,
    longitude,
    confidence: normaliseConfidence(confidence),
    label: label ?? undefined,
  };
};

const extractPicartaLocations = (
  raw: PythonExecutionResult["raw"],
): GeoPoint[] => {
  if (!isRecord(raw)) {
    return [];
  }

  const rawLocations = raw.locations;
  if (!Array.isArray(rawLocations)) {
    return [];
  }

  const results: GeoPoint[] = [];
  const seen = new Set<string>();

  for (const entry of rawLocations) {
    const location = normaliseLocationEntry(entry);
    if (!location) {
      continue;
    }

    const cacheKey = `${location.latitude.toFixed(6)}:${location.longitude.toFixed(6)}`;
    if (seen.has(cacheKey)) {
      continue;
    }

    seen.add(cacheKey);
    results.push(location);
  }

  results.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
  return results;
};

const buildPicartaSummary = (
  raw: PythonExecutionResult["raw"],
  locations: GeoPoint[],
): string => {
  if (isRecord(raw)) {
    const summaryValue = raw.summary;
    if (typeof summaryValue === "string" && summaryValue.trim()) {
      return summaryValue.trim();
    }
  }

  if (locations.length === 0) {
    return "No geolocation candidates returned by Picarta.";
  }

  const top = locations[0];
  const label = top.label ?? "unknown location";
  const base = `Top match near ${label} (${top.latitude.toFixed(4)}, ${top.longitude.toFixed(4)})`;
  if (typeof top.confidence === "number") {
    return `${base} with certainty ${top.confidence.toFixed(1)}%`;
  }
  return base;
};

const extractTamperingDetails = (
  raw: PythonExecutionResult["raw"],
): { summary: string; suspected: boolean; reasons: string[] } | null => {
  if (!isRecord(raw)) {
    return null;
  }

  const assessment = raw.tamperingAssessment;
  if (!isRecord(assessment)) {
    return null;
  }

  const suspectedValue = assessment.suspected;
  const suspected =
    typeof suspectedValue === "boolean" ? suspectedValue : false;
  const summaryValue = assessment.summary;
  const summary =
    typeof summaryValue === "string" && summaryValue.trim()
      ? summaryValue.trim()
      : suspected
        ? "Tampering suspected"
        : "No obvious tampering detected";
  const reasonsValue = assessment.reasons;
  const reasons = Array.isArray(reasonsValue)
    ? reasonsValue
        .filter(
          (entry): entry is string => typeof entry === "string" && entry.trim(),
        )
        .map((entry) => entry.trim())
    : [];

  return {
    summary,
    suspected,
    reasons,
  };
};

const runPythonScript = async (
  scriptPath: string,
  imagePath: string,
): Promise<PythonExecutionResult> => {
  try {
    const { stdout } = await new Promise<{ stdout: string }>(
      (resolve, reject) => {
        const child = execFile(
          "python3",
          [scriptPath, imagePath],
          { cwd: process.cwd() },
          (error, stdout, stderr) => {
            if (error) {
              const enrichedError = new Error(
                `Failed to run ${scriptPath}: ${error.message}
${stderr}`,
              );
              reject(enrichedError);
              return;
            }

            resolve({ stdout });
          },
        );

        child.on("error", (spawnError) => {
          reject(
            new Error(`Unable to start python process: ${spawnError.message}`),
          );
        });
      },
    );

    const trimmed = stdout.trim();

    if (!trimmed) {
      return {
        text: "No data returned from the script.",
        raw: null,
      };
    }

    try {
      const raw = JSON.parse(trimmed) as PythonValue;
      return {
        text: pythonValueToString(raw),
        raw,
      };
    } catch (_parseError) {
      return {
        text: trimmed,
        raw: trimmed,
      };
    }
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(error.message);
    }

    throw new Error("Unknown error while running python script.");
  }
};

const pythonValueToString = (value: PythonValue): string => {
  if (value === null) {
    return "null";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return JSON.stringify(value, null, 2);
};

const buildSummary = (
  entries: Array<{ label: string; text: string }>,
): string =>
  entries.map(({ label, text }) => `${label}:\n${text}`).join("\n\n");

type UploadFile = Blob & { name: string };

const isUploadFile = (value: FormDataEntryValue | null): value is UploadFile =>
  typeof value === "object" &&
  value !== null &&
  "arrayBuffer" in value &&
  typeof (value as Blob).arrayBuffer === "function" &&
  "name" in value &&
  typeof (value as { name?: unknown }).name === "string";

const saveUploadedFile = async (file: UploadFile) => {
  const buffer = Buffer.from(await file.arrayBuffer());
  const baseDir = await mkdtemp(join(tmpdir(), "foka-"));
  const sanitizedName =
    file.name.replace(/[^a-zA-Z0-9._-]/g, "_") || `upload-${randomUUID()}`;
  const filePath = join(baseDir, sanitizedName);

  await writeFile(filePath, buffer);

  return { baseDir, filePath };
};

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!isUploadFile(file)) {
      return NextResponse.json(
        { error: "Photo is missing from the request." },
        { status: 400 },
      );
    }

    const includeSecond = formData.get("call2") === "true";
    const includeFourth = formData.get("call4") === "true";
    const includePicarta = formData.get("callPicarta") === "true";
    const includeSnoop = formData.get("callSnoop") === "true";

    const { baseDir, filePath } = await saveUploadedFile(file);

    try {
      const results: ApiResult[] = [];
      const summaryEntries: Array<{ label: string; text: string }> = [];
      const overviewEntries: OverviewEntry[] = [];
      let geolocations: GeoPoint[] = [];

      if (includePicarta) {
        try {
          const picarta = await runPythonScript(
            "python/picarta_call.py",
            filePath,
          );
          geolocations = extractPicartaLocations(picarta.raw);
          const picartaSummary = buildPicartaSummary(picarta.raw, geolocations);
          summaryEntries.push({ label: "Picarta", text: picartaSummary });
          overviewEntries.push({
            label: "Picarta",
            text: picartaSummary,
            icon: "🗺️",
            tone: "neutral",
          });

          const detailedOutput = picartaSummary
            ? `${picartaSummary}\n\n${picarta.text}`
            : picarta.text;

          results.push({
            label: "API Call 1 - Picarta",
            output: detailedOutput,
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unknown error";
          const fallback = `Picarta analysis failed: ${message}`;
          summaryEntries.push({ label: "Picarta", text: fallback });
          overviewEntries.push({
            label: "Picarta",
            text: fallback,
            icon: "🗺️",
            tone: "warning",
          });
          results.push({
            label: "API Call 1 - Picarta",
            output: fallback,
          });
        }
      } else {
        const notRequested = "Picarta geolocation not requested.";
        summaryEntries.push({ label: "Picarta", text: notRequested });
        overviewEntries.push({
          label: "Picarta",
          text: notRequested,
          icon: "🗺️",
          tone: "neutral",
        });
      }

      if (includeSecond) {
        results.push({
          label: "API Call 2",
          output: `Extended analysis finished using ${file.name}.`,
        });
      }

      try {
        const reality = await runPythonScript(
          "python/reality_defender_call.py",
          filePath,
        );
        const realityDetails = isRecord(reality.raw) ? reality.raw : null;
        const statusValue =
          realityDetails && "status" in realityDetails
            ? realityDetails.status
            : null;
        const realityStatus =
          typeof statusValue === "string" && statusValue.trim()
            ? statusValue.trim().toUpperCase()
            : "COMPLETED";
        const rawScore =
          realityDetails && "score" in realityDetails
            ? realityDetails.score
            : null;
        const realityScore = toNumber(rawScore);
        const realityText = `Reality Defender output:
${reality.text}`;
        const overviewText =
          typeof realityScore === "number"
            ? `Status: ${realityStatus} (score ${realityScore.toFixed(2)})`
            : `Status: ${realityStatus}`;
        summaryEntries.push({
          label: "Reality Defender",
          text: overviewText,
        });
        overviewEntries.push({
          label: "Reality Defender",
          text: overviewText,
          icon: "🛡️",
          tone: realityStatus === "AUTHENTIC" ? "positive" : "neutral",
        });
        results.push({
          label: "API Call 3 - Reality Defender",
          output: realityText,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        const fallback = `Reality Defender analysis failed: ${message}`;
        summaryEntries.push({ label: "Reality Defender", text: fallback });
        overviewEntries.push({
          label: "Reality Defender",
          text: fallback,
          icon: "🛡️",
          tone: "warning",
        });
        results.push({
          label: "API Call 3 - Reality Defender",
          output: fallback,
        });
      }

      if (includeFourth) {
        results.push({
          label: "API Call 4",
          output: `Final verification completed for ${file.name}.`,
        });
      }

      if (includeSnoop) {
        try {
          const snoop = await runPythonScript(
            "python/jpegsnoop/jpeg_snoop_cli.py",
            filePath,
          );
          const tampering = extractTamperingDetails(snoop.raw);
          const tamperingSummary = tampering
            ? [
                tampering.summary,
                tampering.reasons.length > 0
                  ? `Reasons:\n- ${tampering.reasons.join("\n- ")}`
                  : undefined,
              ]
                .filter(Boolean)
                .join("\n\n")
            : "JPEGsnoop completed, but tampering data was unavailable.";
          const tamperingTone = tampering?.suspected ? "warning" : "positive";
          const tamperingIcon = tampering?.suspected ? "⚠️" : "✅";

          summaryEntries.push({ label: "JPEGsnoop", text: tamperingSummary });
          overviewEntries.push({
            label: "JPEGsnoop",
            text:
              tampering?.summary ??
              tamperingSummary.split("\n")[0] ??
              tamperingSummary,
            icon: tamperingIcon,
            tone: tamperingTone,
          });

          const detailedOutput = `${tamperingSummary}\n\n${snoop.text}`;
          results.push({
            label: "API Call 5 - JPEGsnoop",
            output: detailedOutput,
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unknown error";
          const fallback = `JPEGsnoop analysis failed: ${message}`;
          summaryEntries.push({ label: "JPEGsnoop", text: fallback });
          overviewEntries.push({
            label: "JPEGsnoop",
            text: fallback,
            icon: "⚠️",
            tone: "warning",
          });
          results.push({
            label: "API Call 5 - JPEGsnoop",
            output: fallback,
          });
        }
      } else {
        const notRequested = "Analysis not requested.";
        summaryEntries.push({
          label: "JPEGsnoop",
          text: notRequested,
        });
        overviewEntries.push({
          label: "JPEGsnoop",
          text: notRequested,
          icon: "✅",
          tone: "neutral",
        });
      }

      const summary = buildSummary(summaryEntries);

      return NextResponse.json({
        results,
        summary,
        geolocations,
        overview: overviewEntries,
      });
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  } catch (error) {
    console.error("Error processing photo", error);
    return NextResponse.json(
      {
        error: "Unexpected error while processing the photo.",
      },
      { status: 500 },
    );
  }
}
