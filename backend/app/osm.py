"""Assemble OSM multipolygon ways without filling holes or repairing invalid data."""
from shapely.geometry import MultiPolygon, Polygon, mapping

def join_rings(segments):
    pending = [list(segment) for segment in segments]
    rings = []
    while pending:
        ring = pending.pop()
        if len(ring) < 2:
            raise ValueError("Incomplete OSM way geometry")
        while ring[-1] != ring[0]:
            matches = [(index, segment) for index, segment in enumerate(pending)
                       if segment[0] == ring[-1] or segment[-1] == ring[-1]]
            if len(matches) != 1:
                raise ValueError("Open or ambiguous OSM water boundary")
            index, segment = matches[0]
            pending.pop(index)
            if segment[-1] == ring[-1]:
                segment = segment[::-1]
            ring.extend(segment[1:])
        polygon = Polygon(ring)
        if not polygon.is_valid or polygon.area == 0:
            raise ValueError("Invalid OSM water ring")
        rings.append(ring)
    return rings

def water_geometry(relation):
    segments = {"outer": [], "inner": []}
    for member in relation["members"]:
        if member["type"] != "way":
            if member.get("role") in ("outer", "inner"):
                raise ValueError("Nested water boundary relations require review")
            continue
        role = member.get("role") or "outer"
        if role not in segments:
            raise ValueError("Unsupported water boundary role")
        segments[role].append([(point["lon"], point["lat"]) for point in member.get("geometry", [])])
    outer = join_rings(segments["outer"])
    if not outer:
        raise ValueError("Water relation has no exterior")
    shells = [Polygon(ring) for ring in outer]
    holes = [[] for _ in outer]
    for ring in join_rings(segments["inner"]):
        hole = Polygon(ring)
        candidates = [index for index, shell in enumerate(shells) if shell.contains(hole)]
        if not candidates:
            raise ValueError("Water island is outside every exterior")
        owner = min(candidates, key=lambda index: shells[index].area)
        holes[owner].append(ring)
    geometry = MultiPolygon([Polygon(shell, inner) for shell, inner in zip(outer, holes)])
    if not geometry.is_valid:
        raise ValueError("Overlapping or invalid water multipolygon")
    return mapping(geometry)
