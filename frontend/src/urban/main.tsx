
import React from "react";
import { createRoot } from "react-dom/client";
import UrbanMap from "./UrbanMap";

const root = document.getElementById("urban-root");

if (!root) {
  throw new Error("urban-root 요소를 찾을 수 없습니다.");
}

document.body.style.margin = "0";

createRoot(root).render(
  <React.StrictMode>
    <UrbanMap />
  </React.StrictMode>
);
