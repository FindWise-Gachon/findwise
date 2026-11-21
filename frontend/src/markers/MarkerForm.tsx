import { useEffect, useState, type FormEvent } from "react";

import {
  type MapMarker,
  type MarkerType,
  markerTypeLabels,
} from "./markerTypes";

type MarkerFormProps = {
  onAddMarker: (marker: MapMarker) => void
  selectedCoordinate?: {
    latitude: number
    longitude: number
  } | null
}

export default function MarkerForm({
  onAddMarker,
  selectedCoordinate,
}: MarkerFormProps) {

  const [type, setType] = useState<MarkerType>("report");

  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [recordedAt, setRecordedAt] = useState("");
  const [comment, setComment] = useState("");
  const [searched, setSearched] = useState(false);

  const [error, setError] = useState("");

  
useEffect(() => {
  if (!selectedCoordinate) return

  setLatitude(selectedCoordinate.latitude.toFixed(6))
  setLongitude(selectedCoordinate.longitude.toFixed(6))
}, [selectedCoordinate])


  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    // Validate coordinate inputs
    if (!latitude.trim() || !longitude.trim()) {
      setError("위도와 경도를 입력해 주세요.");
      return;
    }

    const lat = Number(latitude);
    const lng = Number(longitude);

    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      setError("올바른 위도와 경도를 입력해 주세요.");
      return;
    }

    // Create a new marker
    const newMarker: MapMarker = {
      id: crypto.randomUUID(),
      type,
      latitude: lat,
      longitude: lng,
      recordedAt,
      comment: comment.trim(),
      searched,
    };

    onAddMarker(newMarker);

    // Reset form after successful submission
    setLatitude("");
    setLongitude("");
    setRecordedAt("");
    setComment("");
    setSearched(false);
  };

  
  return (
    <form
      onSubmit={handleSubmit}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 22,
        fontFamily: "sans-serif",
        color: "#ecf1f2",
      }}
    >
      {/* 1. Marker type */}
      <section>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <span style={{
            width: 27, height: 27, borderRadius: "50%",
            background: "#3b5260", display: "flex",
            alignItems: "center", justifyContent: "center", fontSize: 13,
          }}>1</span>
          <strong style={{ fontSize: 15 }}>마커 유형</strong>
        </div>

        <label style={{ display: "block", fontSize: 12, color: "#c6d6dc" }}>
          등록할 마커 종류
          <select
            value={type}
            onChange={(e) => setType(e.target.value as MarkerType)}
            style={{
              display: "block", width: "100%", marginTop: 8,
              padding: 12, background: "#1d272f", color: "#ecf1f2",
              border: "1px solid #647783", borderRadius: 6,
              boxSizing: "border-box", fontSize: 13,
            }}
          >
            {(Object.entries(markerTypeLabels) as [MarkerType, string][]).map(
              ([value, label]) => (
                <option key={value} value={value}>{label}</option>
              )
            )}
          </select>
        </label>
      </section>

      {/* 2. Coordinates */}
      <section>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <span style={{
            width: 27, height: 27, borderRadius: "50%",
            background: "#3b5260", display: "flex",
            alignItems: "center", justifyContent: "center", fontSize: 13,
          }}>2</span>
          <strong style={{ fontSize: 15 }}>위치 정보</strong>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <label style={{ minWidth: 0, fontSize: 12, color: "#c6d6dc" }}>
            위도
            <input
              type="number"
              step="any"
              value={latitude}
              onChange={(e) => setLatitude(e.target.value)}
              placeholder="37.6605"
              required
              style={{
                display: "block", width: "100%", marginTop: 8,
                padding: "12px 8px", background: "#1d272f",
                color: "#ecf1f2", border: "1px solid #647783",
                borderRadius: 6, boxSizing: "border-box", fontSize: 12,
              }}
            />
          </label>

          <label style={{ minWidth: 0, fontSize: 12, color: "#c6d6dc" }}>
            경도
            <input
              type="number"
              step="any"
              value={longitude}
              onChange={(e) => setLongitude(e.target.value)}
              placeholder="126.9823"
              required
              style={{
                display: "block", width: "100%", marginTop: 8,
                padding: "12px 8px", background: "#1d272f",
                color: "#ecf1f2", border: "1px solid #647783",
                borderRadius: 6, boxSizing: "border-box", fontSize: 12,
              }}
            />
          </label>
        </div>
        <p style={{ fontSize: 11, color: "#a6b8c1", margin: "10px 0 0" }}>
          좌표 확인 메뉴에서 선택한 위치가 자동 입력됩니다.
        </p>
      </section>

      {/* 3. Record information */}
      <section>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <span style={{
            width: 27, height: 27, borderRadius: "50%",
            background: "#3b5260", display: "flex",
            alignItems: "center", justifyContent: "center", fontSize: 13,
          }}>3</span>
          <strong style={{ fontSize: 15 }}>기록 정보</strong>
        </div>

        <label style={{ display: "block", fontSize: 12, color: "#c6d6dc" }}>
          기록 시각
          <input
            type="datetime-local"
            value={recordedAt}
            onChange={(e) => setRecordedAt(e.target.value)}
            style={{
              display: "block", width: "100%", marginTop: 8,
              padding: 12, background: "#1d272f", color: "#ecf1f2",
              colorScheme: "dark",
              border: "1px solid #647783", borderRadius: 6,
              boxSizing: "border-box", fontSize: 13,
            }}
          />
        </label>

        <label style={{
          display: "block", fontSize: 12,
          color: "#c6d6dc", marginTop: 14,
        }}>
          코멘트
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="제보 내용이나 수색 정보를 입력하세요."
            rows={3}
            style={{
              display: "block", width: "100%", marginTop: 8,
              padding: 12, background: "#1d272f", color: "#ecf1f2",
              border: "1px solid #647783", borderRadius: 6,
              boxSizing: "border-box", fontSize: 13,
              resize: "vertical", fontFamily: "inherit",
            }}
          />
        </label>
      </section>

      {/* 4. Search status */}
      <section>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <span style={{
            width: 27, height: 27, borderRadius: "50%",
            background: "#3b5260", display: "flex",
            alignItems: "center", justifyContent: "center", fontSize: 13,
          }}>4</span>
          <strong style={{ fontSize: 15 }}>수색 상태</strong>
        </div>

        <label style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: 14, background: "#1d272f",
          border: "1px solid #53676e", borderRadius: 6,
          cursor: "pointer", fontSize: 13,
        }}>
          <input
            type="checkbox"
            checked={searched}
            onChange={(e) => setSearched(e.target.checked)}
            style={{ accentColor: "#a9ded5", width: 17, height: 17 }}
          />
          수색 완료
        </label>
      </section>

      {error && (
        <p role="alert" style={{
          color: "#ffb4a9", fontSize: 12, margin: 0,
        }}>
          {error}
        </p>
      )}

      <button
        type="submit"
        style={{
          width: "100%", padding: 14,
          background: "#a9ded5", color: "#193c3b",
          border: "none", borderRadius: 6,
          cursor: "pointer", fontWeight: 700, fontSize: 14,
        }}
      >
        마커 등록
      </button>
    </form>
  );

}