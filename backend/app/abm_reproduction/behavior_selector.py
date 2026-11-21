from enum import Enum
from typing import Mapping

import numpy as np


class Behavior(str, Enum):
    RW = "RW"
    RT = "RT"
    DT = "DT"
    SP = "SP"
    VE = "VE"
    BT = "BT"


BEHAVIORS = tuple(Behavior)


def validate_pmf(pmf: Mapping[str, float]) -> np.ndarray:
    """
    PMF가 올바른 확률 분포인지 검사한다.

    조건:
    1. 여섯 행동이 모두 존재해야 한다.
    2. 각 확률은 0 이상이어야 한다.
    3. 확률의 합은 1이어야 한다.
    """
    normalized = {
        (key.value if isinstance(key, Behavior) else key): value
        for key, value in pmf.items()
    }

    expected = {behavior.value for behavior in BEHAVIORS}

    if set(normalized) != expected:
        missing = expected - set(normalized)
        extra = set(normalized) - expected
        raise ValueError(
            f"Invalid PMF keys. Missing={missing}, Extra={extra}"
        )

    probabilities = np.array(
        [normalized[behavior.value] for behavior in BEHAVIORS],
        dtype=float,
    )

    if not np.all(np.isfinite(probabilities)):
        raise ValueError("PMF probabilities must be finite.")

    if np.any(probabilities < 0):
        raise ValueError("PMF probabilities cannot be negative.")

    if not np.isclose(probabilities.sum(), 1.0, atol=1e-9):
        raise ValueError(
            f"PMF probabilities must sum to 1. "
            f"Current sum={probabilities.sum()}"
        )

    return probabilities


def select_behavior(
    pmf: Mapping[str, float],
    rng: np.random.Generator,
) -> Behavior:
    """
    PMF에 따라 행동 전략 하나를 무작위로 선택한다.
    """
    probabilities = validate_pmf(pmf)

    selected = rng.choice(
        len(BEHAVIORS),
        p=probabilities,
    )

    return BEHAVIORS[int(selected)]
