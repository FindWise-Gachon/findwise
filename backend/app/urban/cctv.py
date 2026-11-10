
import json
import os
from pathlib import Path

import requests
from dotenv import load_dotenv
from urllib.parse import unquote


# Project paths
BASE_DIR = Path(__file__).resolve().parents[3]
ENV_PATH = BASE_DIR / "backend" / ".env"
OUTPUT_PATH = BASE_DIR / "data" / "processed" / "seoul-cctv.json"

load_dotenv(ENV_PATH)

API_URL = "https://apis.data.go.kr/1741000/cctv_info/info"
API_KEY = os.getenv("PUBLIC_DATA_API_KEY")

if API_KEY:
    API_KEY = unquote(API_KEY)

def fetch_cctv():
    if not API_KEY:
        raise ValueError(
            "PUBLIC_DATA_API_KEY가 설정되지 않았습니다."
        )

    params = {
        "serviceKey": API_KEY,
        "pageNo": 1,
        "numOfRows": 10,
        "returnType": "json",
        "cond[LCTN_ROAD_NM_ADDR::LIKE]": "서울특별시",
    }

    print("Requesting CCTV data...", flush=True)

    response = requests.get(
        API_URL,
        params=params,
        timeout=30,
    )
    print("HTTP 상태 코드:", response.status_code)
    print("서버 응답 내용:", response.text[:1000])
    response.raise_for_status()

    data = response.json()

    result = data.get("response", {})
    header = result.get("header", {})
    body = result.get("body", {})

    if str(header.get("resultCode")) != "0":
        raise RuntimeError(
            f"CCTV API error: {header.get('resultMsg')}"
        )

    items = body.get("items", {}).get("item", [])

    if isinstance(items, dict):
        items = [items]

    cctvs = []

    for item in items:
        try:
            latitude = float(item["WGS84_LAT"])
            longitude = float(item["WGS84_LOT"])
        except (ValueError, TypeError, KeyError):
            continue

        if not (33 <= latitude <= 39 and
                124 <= longitude <= 132):
            continue

        cctvs.append({
            "id": item.get("MNG_NO"),
            "name": item.get("INSTL_PRPS_SE_NM") or "CCTV",
            "latitude": latitude,
            "longitude": longitude,
            "address": (
                item.get("LCTN_ROAD_NM_ADDR")
                or item.get("LCTN_LOTNO_ADDR")
                or ""
            ),
            "manager": item.get("MNG_INST_NM") or "",
            "cameraCount": item.get("CAM_CNTOM"),
            "dataDate": item.get("DAT_CRTR_YMD"),
        })

    OUTPUT_PATH.parent.mkdir(
        parents=True, exist_ok=True
    )

    OUTPUT_PATH.write_text(
        json.dumps(
            cctvs,
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    print("API total count:", body.get("totalCount"))
    print("Fetched records:", len(items))
    print("Valid CCTV records:", len(cctvs))
    print("Saved to:", OUTPUT_PATH)


if __name__ == "__main__":
    fetch_cctv()
