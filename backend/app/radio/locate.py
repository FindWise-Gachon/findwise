"""위치 확정(③): 무전 속 위치 표현을 좌표로 바꾼다. 두 가지 방법이 있다.

1. 구역명 사전 (`Gazetteer`)
   사람이 만든 지명 목록(JSON)에서 "두 번째 갈림길" 같은 이름을 찾아 중심 좌표와 반경을 돌려준다.
   지명이 하나도 없거나 둘 이상이면 추측하지 않고 위치 없음으로 둔다 (지휘관이 지도에서 직접 지정한다).
2. 상대 위치 (`resolve_relative`)
   "여기서 북쪽 200m" 같은 표현을 보고 대원의 기준 위치(투영좌표)에서 방향·거리만큼 옮긴 좌표로 바꾼다.

두 함수 모두 (Location 또는 None, 경고 목록)을 돌려준다. 결과는 이벤트 후보의 위치일 뿐이며, 지휘관이 확인하고
승인하기 전에는 지도에 반영되지 않는다(AGENTS.md). 좌표는 분석 격자와 같은 투영좌표(m)이고, 북쪽이 +y다.

사전 JSON 형식 (data/samples/radio-gazetteer-example.json 참고)
    {"schema_version": 1, "places": [
        {"name": "두 번째 갈림길", "aliases": ["2번 갈림길"], "x": 270000, "y": 4182000, "radius_m": 150},
        {"name": "하프돔 아래 계곡", "lon": -119.53, "lat": 37.745, "radius_m": 200}]}
  - 좌표는 x, y(격자와 같은 투영좌표) 또는 lon, lat(WGS84, 격자 crs가 있어야 변환)로 적는다.
  - 이름과 별칭은 공백을 무시하고 비교하며, 서로 겹치면 오류다.

명령줄 (개발용):
    PYTHONPATH=backend python -m app.radio.locate "두 번째 갈림길 수색 완료" --gazetteer data/samples/radio-gazetteer-example.json
    PYTHONPATH=backend python -m app.radio.locate "여기서 북쪽 200m" --reference 270000 4182000
"""
from __future__ import annotations

import argparse
import json
import math
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from .schema import Location
from .update_map import GridSpec

Resolved = tuple[Optional[Location], list[str]]

# ---- 상대 위치 -------------------------------------------------------------
_BEARING = {"북": 0.0, "북동": 45.0, "동": 90.0, "남동": 135.0,
            "남": 180.0, "남서": 225.0, "서": 270.0, "북서": 315.0}
_UNIT_M = {"km": 1000.0, "킬로미터": 1000.0, "킬로": 1000.0, "m": 1.0, "미터": 1.0}

_B = r"(?<![가-힣A-Za-z0-9])"  # '여기서'의 '서'를 방향으로 읽지 않도록 단어 시작을 확인한다
_DIR = r"(?P<dir>북동|북서|남동|남서|동|서|남|북)"
_NUM = r"(?P<num>\d+(?:\.\d+)?)\s*(?P<unit>km|킬로미터|킬로|미터|m)(?![A-Za-z])"
_REF = r"(?P<ref>여기|현재\s*위치|제\s*위치|우리\s*위치)(?:에서|서부터|부터|서)?\s*"
_DIR_FIRST = re.compile(rf"(?:{_REF}|{_B}){_DIR}(?:쪽|으로|방향)*\s*(?:으로\s*)?{_NUM}", re.IGNORECASE)
_DIST_FIRST = re.compile(rf"(?:{_REF})?{_NUM}\s*(?:떨어진\s*)?{_B}{_DIR}(?:쪽|으로|방향)?", re.IGNORECASE)

DEFAULT_MAX_DISTANCE_M = 5000.0  # 이보다 먼 상대 위치는 오인식으로 보고 반영하지 않는다


@dataclass(frozen=True)
class RelativeOffset:
    text: str            # 원문에서 찾은 표현
    direction: str       # 북, 북동, ...
    distance_m: float
    has_reference: bool  # '여기서' 처럼 기준을 말했는지
    span: tuple[int, int] = (0, 0)  # 원문에서 표현이 차지하는 [시작, 끝) 위치


def offset_point(x: float, y: float, direction: str, distance_m: float) -> tuple[float, float]:
    """투영좌표 (x, y)에서 방향(북·북동·…)으로 distance_m 만큼 옮긴 좌표. 북쪽이 +y, 동쪽이 +x다."""
    if direction not in _BEARING:
        raise ValueError(f"알 수 없는 방향입니다: {direction}")
    angle = math.radians(_BEARING[direction])
    return x + distance_m * math.sin(angle), y + distance_m * math.cos(angle)


def parse_relative(text: str) -> Optional[RelativeOffset]:
    """문장에서 '방향 + 거리' 표현을 찾는다. 없으면 None. 숫자는 아라비아 숫자만 읽는다."""
    for pattern in (_DIR_FIRST, _DIST_FIRST):
        found = pattern.search(text or "")
        if found:
            distance = float(found.group("num")) * _UNIT_M[found.group("unit").lower()]
            return RelativeOffset(text=re.sub(r"\s+", " ", found.group(0)).strip(),
                                  direction=found.group("dir"), distance_m=distance,
                                  has_reference=found.group("ref") is not None, span=found.span())
    return None


def resolve_relative(text: str, reference_xy: Optional[tuple[float, float]], *,
                     radius_m: Optional[float] = None, grid: Optional[GridSpec] = None,
                     max_distance_m: float = DEFAULT_MAX_DISTANCE_M) -> Resolved:
    """'여기서 북쪽 200m'를 reference_xy(보고 대원의 투영좌표)에서 옮긴 Location으로 바꾼다.

    radius_m은 수색 범위 반경이며 모르면 비워 둔다(지휘관이 지정). grid를 주면 격자 밖 결과를 거른다.
    """
    offset = parse_relative(text)
    if offset is None:
        return None, []
    if not 0 < offset.distance_m <= max_distance_m:
        return None, [f"상대 위치의 거리가 범위를 벗어났습니다: '{offset.text}' (0 초과 {max_distance_m:g} m 이하만 처리)"]
    if reference_xy is None or not all(math.isfinite(v) for v in reference_xy):
        return None, [f"기준 위치(보고 대원 위치)가 없어 '{offset.text}'를 계산하지 못했습니다. 지도에서 위치를 지정해 주세요"]
    warnings = []
    if not offset.has_reference:
        warnings.append(f"'{offset.text}'는 기준을 말하지 않아 보고 대원 위치를 기준으로 가정했습니다")
    x, y = offset_point(reference_xy[0], reference_xy[1], offset.direction, offset.distance_m)
    if grid is not None and not _inside(grid, x, y):
        return None, warnings + [f"'{offset.text}'로 계산한 위치가 분석 격자 밖입니다"]
    return Location(kind="상대위치", value=offset.text, x=x, y=y, radius_m=radius_m), warnings


def resolve_from_place(text: str, place: "Place", *, grid: Optional[GridSpec] = None,
                       radius_m: Optional[float] = None,
                       max_distance_m: float = DEFAULT_MAX_DISTANCE_M) -> Resolved:
    """'두 번째 갈림길에서 북쪽 200m'를 지명(place)의 중심 좌표에서 옮긴 Location으로 바꾼다.

    resolve_relative와 같은 방향·거리 규칙을 쓰되 기준이 보고 대원이 아니라 사전의 지명이다.
    거리가 범위를 벗어나거나 결과가 격자 밖이면 (None, 경고)를 돌려준다.
    """
    offset = parse_relative(text)
    if offset is None:
        return None, []
    if not 0 < offset.distance_m <= max_distance_m:
        return None, [f"상대 위치의 거리가 범위를 벗어났습니다: '{offset.text}' (0 초과 {max_distance_m:g} m 이하만 처리)"]
    x, y = offset_point(place.x, place.y, offset.direction, offset.distance_m)
    label = f"{place.name}에서 {offset.text}"
    if grid is not None and not _inside(grid, x, y):
        return None, [f"'{label}'로 계산한 위치가 분석 격자 밖입니다"]
    return Location(kind="상대위치", value=label, x=x, y=y, radius_m=radius_m), []


def _inside(grid: GridSpec, x: float, y: float) -> bool:
    return (grid.x0 <= x < grid.x0 + grid.cols * grid.cell_m and
            grid.y0 - grid.rows * grid.cell_m < y <= grid.y0)


# ---- 구역명 사전 -----------------------------------------------------------
def _key(name: str) -> str:
    return re.sub(r"\s+", "", name or "").lower()


@dataclass(frozen=True)
class Place:
    name: str
    x: float
    y: float
    radius_m: Optional[float] = None
    aliases: tuple[str, ...] = ()
    lat: Optional[float] = None
    lon: Optional[float] = None


class Gazetteer:
    """지명 → 중심 좌표·반경. 이름과 별칭은 공백·대소문자를 무시하고 비교한다."""

    def __init__(self, places: list[Place]):
        self.places = list(places)
        self._index: dict[str, Place] = {}
        for place in self.places:
            for name in (place.name, *place.aliases):
                key = _key(name)
                if not key:
                    raise ValueError("사전에 빈 이름이 있습니다")
                if key in self._index and self._index[key] is not place:
                    raise ValueError(f"사전에 겹치는 이름이 있습니다: '{name}' ({self._index[key].name} / {place.name})")
                self._index[key] = place

    @classmethod
    def from_dict(cls, data: dict, grid: Optional[GridSpec] = None) -> "Gazetteer":
        if not isinstance(data, dict) or not isinstance(data.get("places"), list) or not data["places"]:
            raise ValueError("사전에 'places' 목록이 없습니다")
        places = []
        for index, raw in enumerate(data["places"], start=1):
            if not isinstance(raw, dict) or not isinstance(raw.get("name"), str) or not raw["name"].strip():
                raise ValueError(f"사전 {index}번째 항목에 name이 없습니다")
            name = raw["name"].strip()
            aliases = raw.get("aliases", [])
            if not isinstance(aliases, list) or not all(isinstance(a, str) for a in aliases):
                raise ValueError(f"'{name}': aliases는 문자열 목록이어야 합니다")
            radius = raw.get("radius_m")
            if radius is not None and (isinstance(radius, bool) or not isinstance(radius, (int, float))
                                       or not math.isfinite(radius) or radius <= 0):
                raise ValueError(f"'{name}': radius_m은 0보다 큰 숫자여야 합니다")
            lat = lon = None
            if "x" in raw or "y" in raw:
                x, y = _number(raw, "x", name), _number(raw, "y", name)
            elif "lon" in raw or "lat" in raw:
                lon, lat = _number(raw, "lon", name), _number(raw, "lat", name)
                if not (-180 <= lon <= 180 and -90 <= lat <= 90):
                    raise ValueError(f"'{name}': lon/lat 범위를 확인해 주세요")
                if grid is None or not grid.crs:
                    raise ValueError(f"'{name}': lon/lat를 쓰려면 격자 crs(예: EPSG:32611)가 필요합니다")
                x, y = _project(lon, lat, grid.crs)
            else:
                raise ValueError(f"'{name}': 좌표(x, y 또는 lon, lat)가 없습니다")
            if grid is not None and not _inside(grid, x, y):
                raise ValueError(f"'{name}': 좌표가 분석 격자 밖입니다 ({x:.0f}, {y:.0f})")
            places.append(Place(name=name, x=x, y=y, radius_m=float(radius) if radius is not None else None,
                                aliases=tuple(a.strip() for a in aliases), lat=lat, lon=lon))
        return cls(places)

    @classmethod
    def from_json_file(cls, path, grid: Optional[GridSpec] = None) -> "Gazetteer":
        return cls.from_dict(json.loads(Path(path).read_text(encoding="utf-8")), grid)

    def find(self, text: str) -> list[tuple[Place, str]]:
        """문장에 나온 지명을 (장소, 일치한 이름) 목록으로 돌려준다. 다른 지명 안에 포함된 짧은 이름은 뺀다."""
        compact = _key(text)
        spans = []  # (시작, 끝, 장소, 이름)
        for key, place in self._index.items():
            start = compact.find(key)
            while start != -1:
                spans.append((start, start + len(key), place, key))
                start = compact.find(key, start + 1)
        kept = [s for s in spans if not any(o is not s and o[0] <= s[0] and s[1] <= o[1] and (o[1] - o[0]) > (s[1] - s[0])
                                            for o in spans)]
        kept.sort(key=lambda s: s[0])
        seen, result = set(), []
        for _, _, place, key in kept:  # 같은 장소가 별칭으로 두 번 나와도 한 번만
            if id(place) not in seen:
                seen.add(id(place))
                result.append((place, key))
        return result

    def resolve(self, text: str) -> Resolved:
        """문장 속 지명을 Location으로 바꾼다. 없으면 (None, []), 둘 이상이면 추측하지 않고 경고만 돌려준다."""
        found = self.find(text)
        if not found:
            return None, []
        if len(found) > 1:
            names = ", ".join(place.name for place, _ in found)
            return None, [f"지명이 여러 개 나왔습니다({names}). 지도에서 위치를 지정해 주세요"]
        place, _ = found[0]
        return Location(kind="지명", value=place.name, x=place.x, y=place.y, radius_m=place.radius_m,
                        lat=place.lat, lon=place.lon), []


def _number(raw: dict, key: str, name: str) -> float:
    value = raw.get(key)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"'{name}': {key}는 유한한 숫자여야 합니다")
    return float(value)


def _project(lon: float, lat: float, crs: str) -> tuple[float, float]:
    from rasterio.warp import transform  # 사전에 lon/lat를 쓸 때만 불러온다
    xs, ys = transform("EPSG:4326", crs, [lon], [lat])
    return float(xs[0]), float(ys[0])


# ---- 개발용 명령줄 ---------------------------------------------------------
def main(argv: Optional[list[str]] = None) -> None:
    parser = argparse.ArgumentParser(description="무전 속 위치 표현을 좌표로 바꾼다")
    parser.add_argument("text", help="무전 문장")
    parser.add_argument("--gazetteer", help="구역명 사전 JSON")
    parser.add_argument("--grid", help="격자 JSON (사전 좌표 검사와 lon/lat 변환에 사용)")
    parser.add_argument("--reference", nargs=2, type=float, metavar=("X", "Y"), help="보고 대원의 투영좌표")
    args = parser.parse_args(argv)
    grid = GridSpec.from_json_file(args.grid) if args.grid else None
    location, warnings = None, []
    if args.gazetteer:
        location, warnings = Gazetteer.from_json_file(args.gazetteer, grid).resolve(args.text)
    if location is None:
        relative, relative_warnings = resolve_relative(args.text, tuple(args.reference) if args.reference else None,
                                                       grid=grid)
        location, warnings = relative, warnings + relative_warnings
    print(json.dumps({"location": None if location is None else location.__dict__, "warnings": warnings},
                     ensure_ascii=False))


if __name__ == "__main__":
    main()
