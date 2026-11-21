"""Serialize one Ring result for the local map preview."""
import base64
import json
import sys

import numpy as np

from .ring_model import DEFAULT_PROFILES, MODEL_VERSION, load_profile, read_distances, ring_probability

SUBJECT_TYPE = "hiker_temperate_mountain"


def ring_preview(grid, lkp_xy):
    profiles = json.loads(DEFAULT_PROFILES.read_text(encoding="utf-8"))
    profile = load_profile(profiles, SUBJECT_TYPE)
    probability, in_grid_mass = ring_probability(grid, lkp_xy, read_distances(profile, SUBJECT_TYPE))
    palette, indices = np.unique(probability.ravel(), return_inverse=True)
    # Four rings, the outer density and zero use at most six palette entries.
    return {
        "grid_id": grid["grid_id"],
        "model_version": MODEL_VERSION,
        "profile_label": profile["label_ko"],
        "in_grid_mass": in_grid_mass,
        "palette": palette.tolist(),
        "cell_indices": base64.b64encode(indices.astype(np.uint8).tobytes()).decode("ascii"),
    }


if __name__ == "__main__":
    grid_json, x, y = sys.argv[1:]
    print(json.dumps(ring_preview(json.loads(grid_json), (float(x), float(y))), allow_nan=False))
