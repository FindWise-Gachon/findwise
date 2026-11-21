import * as maplibregl from "maplibre-gl";

import {
  type MapMarker,
  markerTypeLabels,
  markerTypeColors,
  searchedMarkerColor,
} from "./markerTypes";


/**
 * Assign chronological numbers to markers.
 *
 * - Earlier timestamps receive smaller numbers.
 * - Markers without a valid timestamp are excluded.
 * - Equal timestamps preserve registration order.
 */
export function getTimeOrder(
  markers: MapMarker[]
): Map<string, number> {
  const numberedMarkers = markers
    .map((marker, index) => ({
      id: marker.id,
      timestamp: marker.recordedAt
        ? Date.parse(marker.recordedAt)
        : NaN,
      index,
    }))
    .filter((item) => Number.isFinite(item.timestamp))
    .sort(
      (a, b) =>
        a.timestamp - b.timestamp ||
        a.index - b.index
    );

  const order = new Map<string, number>();

  numberedMarkers.forEach((item, index) => {
    order.set(item.id, index + 1);
  });

  return order;
}


export function addMarkerLayer(
  map: maplibregl.Map,
  markers: MapMarker[],
  onUpdateMarker: (id: string, searched: boolean) => void,
  onEditMarker: (marker: MapMarker) => void,
  onDeleteMarker: (id: string) => void,
  timeOrder: Map<string, number>,
  showTimeOrder: boolean
): () => void {

  const mapMarkers: maplibregl.Marker[] = [];

  markers.forEach((markerData) => {
        const element = document.createElement("button");
        element.type = "button";
        

        // Marker color always depends on its type
        const color = markerTypeColors[markerData.type];

        // Different symbol for each marker type
        const symbols = {
        report: "!",
        cctv: "C",
        search: "S",
        };

        element.style.cssText = `
        width: 32px;
        height: 32px;
        border-radius: 50%;
        background: ${color};
        border: 3px solid ${
            markerData.searched ? searchedMarkerColor : "white"
        };
        color: white;
        font-size: 17px;
        font-weight: bold;
        cursor: pointer;
        box-shadow: 0 2px 6px rgba(0,0,0,0.3);
        display: flex;
        align-items: center;
        justify-content: center;

        padding: 0;
        `;
        // Display marker type symbol
element.textContent = markerData.searched
  ? "✓"
  : symbols[markerData.type];



element.title = `${markerTypeLabels[markerData.type]} ${
  markerData.searched ? "(수색 완료)" : "(수색 미완료)"
}`;


// Show chronological number below the marker.
const orderNumber = timeOrder.get(markerData.id);

if (showTimeOrder && orderNumber !== undefined) {
  const numberBadge = document.createElement("span");

  numberBadge.textContent = String(orderNumber);

  numberBadge.style.cssText = `
    position: absolute;
    top: calc(100% + 5px);
    left: 50%;
    transform: translateX(-50%);
    min-width: 22px;
    height: 22px;
    padding: 0 5px;
    box-sizing: border-box;
    border-radius: 6px;
    background: #111111;
    color: white;
    border: none;
    font-size: 12px;
    font-weight: bold;
    line-height: 18px;
    text-align: center;
    white-space: nowrap;
    pointer-events: none;
    box-shadow: 0 1px 4px rgba(0,0,0,0.25);
  `;

  element.appendChild(numberBadge);
}



    

    const popupContent = document.createElement("div");
    popupContent.style.cssText =
      "min-width:220px;font-size:13px;";

    const title = document.createElement("strong");
    title.textContent = `${markerTypeLabels[markerData.type]} 마커`;

    const coordinates = document.createElement("p");
    coordinates.textContent =
      `위도: ${markerData.latitude.toFixed(6)} / ` +
      `경도: ${markerData.longitude.toFixed(6)}`;

    const time = document.createElement("p");
    time.textContent =
      `시각: ${markerData.recordedAt || "미입력"}`;

    const comment = document.createElement("p");
    comment.textContent =
      `내용: ${markerData.comment || "미입력"}`;

    const searchLabel = document.createElement("label");
    searchLabel.style.cssText =
      "display:flex;align-items:center;gap:8px;cursor:pointer;";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = markerData.searched;

    const checkboxText = document.createElement("span");
    checkboxText.textContent = "수색 완료";

    searchLabel.append(checkbox, checkboxText);

    checkbox.addEventListener("change", () => {
      onUpdateMarker(markerData.id, checkbox.checked);
    });

    
const buttonContainer = document.createElement("div");
buttonContainer.style.cssText = `
  display: flex;
  gap: 8px;
  margin-top: 12px;
`;

const editButton = document.createElement("button");
editButton.type = "button";
editButton.textContent = "수정";
editButton.style.cssText = `
  flex: 1;
  padding: 6px;
  cursor: pointer;
`;

editButton.addEventListener("click", () => {
  onEditMarker(markerData);
});

const deleteButton = document.createElement("button");
deleteButton.type = "button";
deleteButton.textContent = "삭제";
deleteButton.style.cssText = `
  flex: 1;
  padding: 6px;
  color: #dc2626;
  cursor: pointer;
`;

deleteButton.addEventListener("click", () => {
  const confirmed = window.confirm(
    "이 마커를 삭제하시겠습니까?"
  );

  if (confirmed) {
    onDeleteMarker(markerData.id);
  }
});

buttonContainer.append(editButton, deleteButton);

popupContent.append(
  title,
  coordinates,
  time,
  comment,
  searchLabel,
  buttonContainer
);


    const popup = new maplibregl.Popup({
      offset: 25,
    }).setDOMContent(popupContent);

    const marker = new maplibregl.Marker({
  element,
  anchor: 'center',
  offset: [0, 0],
})
      .setLngLat([
        markerData.longitude,
        markerData.latitude,
      ])
      .setPopup(popup)
      .addTo(map);

    mapMarkers.push(marker);
  });

  return () => {
    mapMarkers.forEach((marker) => marker.remove());
  };
}
