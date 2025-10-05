"use client";

import dynamic from "next/dynamic";
import type { ChangeEvent, FormEvent } from "react";
import { useRef, useState } from "react";
import type { GeoPoint } from "../components/GeoMap";

type ApiResult = {
  label: string;
  output: string;
};

type OverviewItem = {
  label: string;
  text: string;
  icon: string;
  tone?: "neutral" | "positive" | "warning";
};

const GeoMap = dynamic(() => import("../components/GeoMap"), { ssr: false });

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [options, setOptions] = useState({
    picarta: false,
    snoop: false,
  });
  const [results, setResults] = useState<ApiResult[]>([]);
  const [overview, setOverview] = useState<OverviewItem[]>([]);
  const [geoPoints, setGeoPoints] = useState<GeoPoint[]>([]);
  const [summary, setSummary] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleOpenFileDialog = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setSelectedFile(file);
  };

  const toggleOption = (key: keyof typeof options) => () => {
    setOptions((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedFile) {
      setError("Please choose a photo before submitting.");
      return;
    }

    const formData = new FormData();
    formData.append("file", selectedFile);
    formData.append("callPicarta", String(options.picarta));
    formData.append("callSnoop", String(options.snoop));

    try {
      setIsSubmitting(true);
      setError(null);
      setResults([]);
      setOverview([]);
      setGeoPoints([]);
      setSummary("");

      const response = await fetch("/api/process", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Request failed");
      }

      const data = (await response.json()) as {
        results?: ApiResult[];
        error?: string;
        summary?: string;
        geolocations?: GeoPoint[];
        overview?: OverviewItem[];
      };

      if (data.error) {
        setError(data.error);
        return;
      }

      setResults(data.results ?? []);
      setOverview(data.overview ?? []);
      setGeoPoints(data.geolocations ?? []);
      setSummary(data.summary ?? "");
    } catch (submissionError) {
      setError(
        "Something went wrong while processing the photo. Please try again.",
      );
      console.error(submissionError);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f3f6fb] flex flex-col">
      <header className="bg-blue-600 h-[10vh] min-h-[80px] flex items-center px-8">
        <span className="text-white font-bold text-3xl tracking-wide">
          Foka
        </span>
      </header>

      <main className="flex-1 bg-white">
        <div className="grid min-h-[calc(90vh)] grid-cols-1 bg-white md:grid-cols-[minmax(0,420px)_1fr] lg:grid-cols-[minmax(0,460px)_1fr]">
          <section className="border-b border-gray-100 md:border-b-0 md:border-r">
            <div className="mx-auto flex w-full max-w-md flex-col gap-12 px-6 py-12 md:sticky md:top-24 md:pb-24">
              <form onSubmit={handleSubmit} className="flex flex-col gap-6">
                <div className="space-y-2">
                  <p className="text-lg font-semibold text-gray-800">
                    Upload a photo
                  </p>
                  <p className="text-sm text-gray-500">
                    Choose the analyses to run before submitting.
                  </p>
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleFileChange}
                />

                <button
                  type="button"
                  onClick={handleOpenFileDialog}
                  className="w-full rounded-md bg-blue-600 px-4 py-3 text-white font-medium shadow-sm hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400"
                >
                  {selectedFile ? "Change photo" : "Choose a photo"}
                </button>

                {selectedFile ? (
                  <p className="text-sm text-gray-600 truncate">
                    Selected: {selectedFile.name}
                  </p>
                ) : null}

                <div className="space-y-3">
                  <label className="flex items-center gap-3 text-gray-700">
                    <input
                      type="checkbox"
                      checked={options.picarta}
                      onChange={toggleOption("picarta")}
                      className="h-5 w-5 rounded border-gray-300"
                    />
                    <span>Run Visual Geolocation</span>
                  </label>
                  <label className="flex items-center gap-3 text-gray-700">
                    <input
                      type="checkbox"
                      checked={options.snoop}
                      onChange={toggleOption("snoop")}
                      className="h-5 w-5 rounded border-gray-300"
                    />
                    <span>Run Metadata Tampering analysis</span>
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full rounded-md bg-gray-900 px-4 py-3 text-white font-semibold shadow-sm hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting ? "Submitting..." : "Submit"}
                </button>

                {error ? <p className="text-sm text-red-600">{error}</p> : null}
              </form>

              <div className="space-y-3">
                <p className="text-lg font-semibold text-gray-800">
                  Location map
                </p>
                <p className="text-sm text-gray-500">
                  Picarta geolocation candidates include a 20 km uncertainty
                  radius and reported certainty values.
                </p>
                <GeoMap points={geoPoints} />
              </div>
            </div>
          </section>

          <aside className="px-6 py-12">
            <div className="mx-auto w-full max-w-xl md:sticky md:top-24">
              <div className="rounded-xl bg-gray-100 shadow-lg">
                <div className="border-b border-gray-200 px-6 py-4">
                  <h2 className="text-xl font-semibold text-gray-800">
                    Results
                  </h2>
                </div>
                <div className="flex max-h-[calc(100vh-220px)] flex-col gap-4 overflow-y-auto px-6 py-6">
                  <div className="rounded-lg bg-white p-4 shadow-sm">
                    <p className="text-sm font-semibold text-gray-800">
                      Summary
                    </p>
                    <p className="whitespace-pre-wrap text-sm text-gray-600">
                      {summary
                        ? summary
                        : "Submit a photo and run the analyses to see the combined summary, including metadata tampering checks."}
                    </p>
                  </div>

                  {isSubmitting ? (
                    <p className="text-gray-600">Processing photo...</p>
                  ) : (
                    <div className="space-y-4">
                      {overview.length > 0 ? (
                        <ul className="space-y-3">
                          {overview.map((item) => {
                            const toneColor =
                              item.tone === "positive"
                                ? "text-emerald-600"
                                : item.tone === "warning"
                                  ? "text-amber-600"
                                  : "text-gray-500";
                            return (
                              <li
                                key={`${item.label}-${item.text}`}
                                className="flex items-start gap-3 rounded-md bg-white p-4 shadow-sm"
                              >
                                <span className={`text-lg ${toneColor}`}>
                                  {item.icon}
                                </span>
                                <div className="space-y-1">
                                  <p className="text-sm font-semibold text-gray-800">
                                    {item.label}
                                  </p>
                                  <p className="text-sm text-gray-600">
                                    {item.text}
                                  </p>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      ) : null}

                      {results.length > 0 ? (
                        <ul className="space-y-3">
                          {results.map((result) => (
                            <li
                              key={result.label}
                              className="rounded-md bg-white p-4 shadow-sm"
                            >
                              <p className="text-sm font-semibold text-gray-800">
                                {result.label}
                              </p>
                              <p className="whitespace-pre-wrap text-sm text-gray-600">
                                {result.output}
                              </p>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-sm text-gray-500">
                          Detailed call outputs will appear here after you
                          submit a photo.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
