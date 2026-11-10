
export type Cctv = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  description: string;
};

// 개발용 가상 CCTV 데이터입니다.
// 실제 설치 위치를 의미하지 않습니다.
const sampleCctvs: Cctv[] = [
  {
    id: "cctv-001",
    name: "테스트 CCTV 1",
    latitude: 37.5665,
    longitude: 126.9780,
    description: "서울시청 주변 테스트 위치",
  },
  {
    id: "cctv-002",
    name: "테스트 CCTV 2",
    latitude: 37.5700,
    longitude: 126.9820,
    description: "종로 방향 테스트 위치",
  },
  {
    id: "cctv-003",
    name: "테스트 CCTV 3",
    latitude: 37.5630,
    longitude: 126.9750,
    description: "시청 남서쪽 테스트 위치",
  },
];

export function addCctvLayer(map: any) {
  const kakao = window.kakao;

  if (!kakao?.maps) {
    throw new Error("카카오 지도 SDK가 준비되지 않았습니다.");
  }

  const infoWindow = new kakao.maps.InfoWindow({
    removable: true,
  });

  const markers: any[] = [];

  sampleCctvs.forEach((cctv) => {
    const position = new kakao.maps.LatLng(
      cctv.latitude,
      cctv.longitude
    );

    const marker = new kakao.maps.Marker({
      map,
      position,
      title: cctv.name,
    });

    // 사용자 입력이 HTML로 해석되지 않도록 이스케이프
    const escapeHtml = (value: string) =>
      value.replace(/[&<>"']/g, (char) => {
        const entities: Record<string, string> = {
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        };
        return entities[char];
      });

    const content = `
      <div style="padding:12px;min-width:200px;font-size:13px;">
        <strong>${escapeHtml(cctv.name)}</strong>
        <p>${escapeHtml(cctv.description)}</p>
        <small>위도: ${cctv.latitude.toFixed(5)}</small>
        <br />
        <small>경도: ${cctv.longitude.toFixed(5)}</small>
        <p style="color:#777;font-size:11px;">개발용 가상 데이터</p>
      </div>
    `;

    kakao.maps.event.addListener(marker, "click", () => {
      infoWindow.close();
      infoWindow.setContent(content);
      infoWindow.open(map, marker);
    });

    markers.push(marker);
  });

  return () => {
    infoWindow.close();
    markers.forEach((marker) => marker.setMap(null));
  };
}
