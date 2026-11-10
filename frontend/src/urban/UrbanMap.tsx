
import { useEffect, useRef, useState } from "react";
import { addCctvLayer } from "./CctvLayer";
import { addReportLayer } from "./ReportLayer";

declare global {
  interface Window {
    kakao?: any;
  }
}

export default function UrbanMap() {
  const mapRef = useRef<HTMLDivElement>(null);

  const kakaoMapRef = useRef<any>(null);
  const cctvCleanupRef = useRef<(() => void) | null>(null);
  const reportCleanupRef = useRef<(() => void) | null>(null);

  const [error, setError] = useState("");
  const [showCctv, setShowCctv] = useState(true);
  const [showReports, setShowReports] = useState(true);
  const [mapReady, setMapReady] = useState(false);

  // 카카오 지도 초기화
  useEffect(() => {
    const key = import.meta.env.VITE_KAKAO_JS_KEY;

    if (!key) {
      setError("카카오 JavaScript 키가 설정되지 않았습니다.");
      return;
    }

    let cancelled = false;
    let script: HTMLScriptElement | null = null;

    const initializeMap = () => {
      window.kakao?.maps.load(() => {
        if (cancelled || !mapRef.current) return;

        const map = new window.kakao.maps.Map(mapRef.current, {
          center: new window.kakao.maps.LatLng(
            37.5665,
            126.978
          ),
          level: 5,
        });

        kakaoMapRef.current = map;
        setMapReady(true);
      });
    };

    if (window.kakao?.maps) {
      initializeMap();
    } else {
      script = document.createElement("script");
      script.src =
        `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&autoload=false`;

      script.onload = initializeMap;
      script.onerror = () => {
        if (!cancelled) {
          setError("카카오 지도 SDK를 불러오지 못했습니다.");
        }
      };

      document.head.appendChild(script);
    }

    return () => {
      cancelled = true;
      setMapReady(false);
      kakaoMapRef.current = null;

      if (script) {
        script.remove();
      }
    };
  }, []);

  // CCTV 레이어 ON/OFF
  useEffect(() => {
    if (!mapReady || !kakaoMapRef.current) return;

    if (showCctv) {
      cctvCleanupRef.current = addCctvLayer(
        kakaoMapRef.current
      );
    }

    return () => {
      cctvCleanupRef.current?.();
      cctvCleanupRef.current = null;
    };
  }, [mapReady, showCctv]);

  // 제보 레이어 ON/OFF
  useEffect(() => {
    if (!mapReady || !kakaoMapRef.current) return;

    if (showReports) {
      reportCleanupRef.current = addReportLayer(
        kakaoMapRef.current
      );
    }

    return () => {
      reportCleanupRef.current?.();
      reportCleanupRef.current = null;
    };
  }, [mapReady, showReports]);

  return (
    <div
      style={{
        width: "100%",
        height: "100vh",
        position: "relative",
      }}
    >
      {error && (
        <p style={{ color: "red", padding: "12px" }}>
          {error}
        </p>
      )}

      <div
        ref={mapRef}
        style={{
          width: "100%",
          height: "100%",
        }}
      />

      {/* 지도 위 레이어 제어 패널 */}
      <div
        style={{
          position: "absolute",
          top: "20px",
          right: "20px",
          zIndex: 100,
          background: "white",
          padding: "16px",
          borderRadius: "10px",
          boxShadow: "0 2px 10px rgba(0,0,0,0.2)",
          minWidth: "180px",
          fontFamily: "Arial, sans-serif",
        }}
      >
        <strong>FindWise 지도 레이어</strong>

        <label
          style={{
            display: "block",
            marginTop: "14px",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={showCctv}
            onChange={(e) =>
              setShowCctv(e.target.checked)
            }
          />
          {" "}CCTV 위치
        </label>

        <label
          style={{
            display: "block",
            marginTop: "10px",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={showReports}
            onChange={(e) =>
              setShowReports(e.target.checked)
            }
          />
          {" "}실종자 제보
        </label>
      </div>
    </div>
  );
}
