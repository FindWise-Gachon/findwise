
export type MissingPersonReport = {
  id: string;
  location: string;
  latitude: number;
  longitude: number;
  reportedAt: string;
  description: string;
  status: "unverified" | "reviewing" | "verified";
};

// 개발용 가상 제보 데이터
// 실제 실종 사건이나 목격 정보를 의미하지 않습니다.
const sampleReports: MissingPersonReport[] = [
  {
    id: "REPORT-001",
    location: "서울시청 인근",
    latitude: 37.5668,
    longitude: 126.9800,
    reportedAt: "2026-11-05 14:30",
    description: "실종자로 추정되는 인물을 목격했다는 제보",
    status: "unverified",
  },
  {
    id: "REPORT-002",
    location: "광화문 인근",
    latitude: 37.5729,
    longitude: 126.9769,
    reportedAt: "2026-11-05 15:10",
    description: "비슷한 인상착의의 인물이 이동했다는 제보",
    status: "reviewing",
  },
  {
    id: "REPORT-003",
    location: "서울역 인근",
    latitude: 37.5547,
    longitude: 126.9707,
    reportedAt: "2026-11-05 16:20",
    description: "실종자와 유사한 인물을 목격했다는 제보",
    status: "unverified",
  },
];

const statusLabels = {
  unverified: "미확인",
  reviewing: "확인 중",
  verified: "확인 완료",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[char];
  });
}


export function addReportLayer(map: any) {
  const kakao = window.kakao;

  if (!kakao?.maps) {
    throw new Error("카카오 지도 SDK가 준비되지 않았습니다.");
  }

  const markers: any[] = [];
  let activeInfo: any = null;

  sampleReports.forEach((report) => {
    const position = new kakao.maps.LatLng(
      report.latitude,
      report.longitude
    );

    const markerElement = document.createElement("button");
    markerElement.type = "button";
    markerElement.textContent = "!";
    markerElement.title = `제보 ${report.id}`;
    markerElement.setAttribute(
      "aria-label",
      `제보 ${report.id}, ${report.location}`
    );

    Object.assign(markerElement.style, {
      width: "32px",
      height: "32px",
      borderRadius: "50%",
      background: "#E74C3C",
      color: "white",
      border: "3px solid white",
      boxShadow: "0 2px 6px rgba(0,0,0,0.3)",
      fontSize: "18px",
      fontWeight: "bold",
      cursor: "pointer",
    });

    const marker = new kakao.maps.CustomOverlay({
      map,
      position,
      content: markerElement,
      yAnchor: 1,
      zIndex: 5,
    });

    const onClick = () => {
      if (activeInfo) {
        activeInfo.setMap(null);
      }

      const content = document.createElement("div");
      content.style.cssText =
        "position:relative;background:white;border:1px solid #ccc;" +
        "border-radius:8px;padding:14px;width:240px;" +
        "box-shadow:0 2px 8px #0003;font-size:13px;";

      content.innerHTML = `
        <button type="button" data-close
          style="position:absolute;right:8px;top:6px;cursor:pointer;"
          aria-label="정보창 닫기">×</button>
        <strong style="color:#E74C3C;">
          제보 ${escapeHtml(report.id)}
        </strong>
        <p><b>위치:</b> ${escapeHtml(report.location)}</p>
        <p><b>시각:</b> ${escapeHtml(report.reportedAt)}</p>
        <p><b>내용:</b> ${escapeHtml(report.description)}</p>
        <p><b>상태:</b> ${statusLabels[report.status]}</p>
        <small style="color:#777;">개발용 가상 데이터</small>
      `;

      const info = new kakao.maps.CustomOverlay({
        map,
        position,
        content,
        yAnchor: 1.45,
        zIndex: 10,
      });

      activeInfo = info;

      content.querySelector("[data-close]")?.addEventListener(
        "click",
        () => {
          info.setMap(null);
          if (activeInfo === info) activeInfo = null;
        }
      );
    };

    markerElement.addEventListener("click", onClick);

    markers.push({ marker, markerElement, onClick });
  });

  return () => {
    if (activeInfo) activeInfo.setMap(null);

    markers.forEach(({ marker, markerElement, onClick }) => {
      markerElement.removeEventListener("click", onClick);
      marker.setMap(null);
    });
  };
}

