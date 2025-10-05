"use client";

import "leaflet/dist/leaflet.css";

import type { LayerGroup, Map as LeafletMap } from "leaflet";
import { useEffect, useRef, useState } from "react";

export type GeoPoint = {
  latitude: number;
  longitude: number;
  confidence?: number;
  label?: string;
};

export type GeoMapProps = {
  points: GeoPoint[];
};

const DEFAULT_CENTER: [number, number] = [20, 0];
const DEFAULT_ZOOM = 2;

const GeoMap = ({ points }: GeoMapProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<LeafletMap | null>(null);
  const layersRef = useRef<LayerGroup | null>(null);
  const [leafletModule, setLeafletModule] = useState<
    typeof import("leaflet") | null
  >(null);

  useEffect(() => {
    let mounted = true;
    import("leaflet")
      .then((module) => {
        if (!mounted) {
          return;
        }

        module.Icon.Default.mergeOptions({
          iconRetinaUrl:
            "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
          iconUrl:
            "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
          shadowUrl:
            "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
        });

        setLeafletModule(module);
      })
      .catch((error) => {
        // eslint-disable-next-line no-console
        console.error("Failed to load Leaflet", error);
      });

    return () => {
      mounted = false;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!leafletModule || !containerRef.current || mapInstanceRef.current) {
      return;
    }

    const map = leafletModule.map(containerRef.current, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      attributionControl: false,
      zoomControl: true,
    });

    leafletModule
      .tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png")
      .addTo(map);

    layersRef.current = leafletModule.layerGroup().addTo(map);
    mapInstanceRef.current = map;
  }, [leafletModule]);

  useEffect(() => {
    if (!leafletModule || !mapInstanceRef.current || !layersRef.current) {
      return;
    }

    const map = mapInstanceRef.current as import("leaflet").Map;
    const group = layersRef.current as import("leaflet").LayerGroup;

    group.clearLayers();

    if (points.length === 0) {
      map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
      return;
    }

    const bounds = leafletModule.latLngBounds([]);

    points.forEach((point) => {
      const latLng = leafletModule.latLng(point.latitude, point.longitude);
      bounds.extend(latLng);

      const certainty =
        typeof point.confidence === "number"
          ? `${point.confidence.toFixed(1)}%`
          : "Unknown";

      leafletModule
        .marker(latLng)
        .bindPopup(
          `<div class="space-y-1 text-sm">\n            <p class="font-semibold">${
            point.label ?? "Unnamed location"
          }</p>\n            <p>Lat: ${point.latitude.toFixed(4)}, Lng: ${point.longitude.toFixed(4)}</p>\n            <p>Certainty: ${certainty}</p>\n            <p>Uncertainty radius: 20 km</p>\n          </div>`,
        )
        .addTo(group);

      leafletModule
        .circle(latLng, {
          radius: 20000,
          color: "#2563eb",
          fillColor: "#2563eb",
          fillOpacity: 0.15,
          weight: 1.5,
          interactive: false,
        })
        .addTo(group);
    });

    if (bounds.isValid()) {
      map.fitBounds(bounds.pad(0.4));
    }
  }, [leafletModule, points]);

  return (
    <div className="relative h-72 w-full overflow-hidden rounded-xl border border-gray-200 shadow-sm">
      <div ref={containerRef} className="h-full w-full" />
      {points.length === 0 ? (
        <div className="absolute inset-0 flex items-center justify-center bg-white/80 px-4 text-center text-sm text-gray-600">
          Picarta has not returned geolocation data for the latest analysis yet.
        </div>
      ) : null}
      {!leafletModule ? (
        <div className="absolute inset-0 flex items-center justify-center bg-white/90 text-sm text-gray-500">
          Loading map…
        </div>
      ) : null}
    </div>
  );
};

export default GeoMap;
