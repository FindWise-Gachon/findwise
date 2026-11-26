"""무전 반영 전후 비교 실험 (합성 시나리오).

질문: 수색 팀의 '수색 완료' 보고를 확률 지도에 반영하면, 반영하지 않을 때보다 실종자를 더 잘 찾는가?
이 실험은 update_map.apply_event(수색 완료)와 top_zones(우선 수색 구역)를 그대로 사용한다.

세 가지 지휘소를 비교한다 (같은 실종자 위치·같은 발견 난수를 쓰는 짝지은 비교).
  - 미반영       : 무전을 받지 못해 지도가 그대로다. 다음 팀도 같은 우선 구역으로 보낸다.
  - 단순 제외    : 보고를 받으면 수색한 영역을 지도에서 통째로 지운다 (수색하면 반드시 찾는다고 가정).
  - 확률 보정    : 현재 규칙. 수색한 영역에 (1 - POD)를 곱하고 다시 정규화한다 (놓쳤을 가능성을 남긴다).

실험 1 (순차 수색): 매 단계 현재 지도의 1순위 구역으로 팀을 보내고, 실종자가 그 안에 있으면 POD 확률로 발견한다.
                     못 찾으면 '수색 완료(미발견)' 보고가 들어와 지도를 고친다. 단계별 누적 발견율을 잰다.
실험 2 (면적 예산): 처음 지도의 상위 구역 K곳을 차례로 수색했는데 못 찾은 경우만 모아, 보고를 반영한 지도에서
                     실종자가 상위 b% 면적 안에 들어오는 비율을 잰다. (평가 초안 4항의 '같은 면적 예산에서
                     포함된 비율'과 같은 방식이다.)

현실의 무전 오류를 흉내 내는 설정
  - pod_scale      : 실제 발견 확률 = 보고 규칙의 POD × pod_scale (1이면 규칙의 가정과 같고, 낮추면 대원이 과대 보고한 셈)
  - location_error : 보고된 수색 위치가 실제 수색 위치에서 어긋나는 정도 (정규분포 표준편차, m)

한계: 실종자 위치를 지도 자체에서 뽑고(지도가 정확하다고 가정), 대원 행동과 발견 모델이 단순한 합성 시나리오다.
현장 성능의 증거가 아니라 '보고를 반영하는 규칙이 어떤 가정에서 얼마나 이득인지'를 보는 실험이다.

실행 (저장소 루트):
    PYTHONPATH=backend python -m app.radio.simulate
    PYTHONPATH=backend python -m app.radio.simulate --sweep pod-scale 1.0,0.7,0.5
    PYTHONPATH=backend python -m app.radio.simulate --grid data/processed/grid.json --prior-npz data/processed/ring.npz --trials 100
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from dataclasses import asdict, dataclass, replace
from pathlib import Path
from typing import Optional

import numpy as np

from .schema import Confidence, EventType, FieldEvent, Location, Status
from .update_map import POD_BY_CONFIDENCE, GridSpec, apply_event, new_state, top_zones

CONDITIONS = ("none", "exclude", "update")
LABELS = {"none": "미반영", "exclude": "단순 제외", "update": "확률 보정(현재 규칙)"}
BUDGETS = (0.01, 0.05, 0.10, 0.20)
Z95 = 1.96


@dataclass(frozen=True)
class SimConfig:
    trials: int = 1000
    steps: int = 8                      # 팀 수 (수색 횟수)
    radius_m: float = 300.0             # 한 팀이 수색하는 원의 반지름
    confidence: Confidence = Confidence.NORMAL  # 보고하는 확인 강도 (POD가 정해진다)
    pod_scale: float = 1.0
    location_error_m: float = 0.0
    seed: int = 2026

    def validate(self) -> None:
        if self.trials < 1 or self.steps < 1:
            raise ValueError("trials와 steps는 1 이상이어야 합니다")
        if not self.radius_m > 0:
            raise ValueError("radius_m은 0보다 커야 합니다")
        if not self.pod_scale > 0:
            raise ValueError("pod_scale은 0보다 커야 합니다")
        if not self.location_error_m >= 0:
            raise ValueError("location_error_m은 0 이상이어야 합니다")

    @property
    def true_pod(self) -> float:
        return min(POD_BY_CONFIDENCE[self.confidence] * self.pod_scale, 1.0)


# ---- 격자·사전 확률 --------------------------------------------------------
def default_grid() -> GridSpec:
    """합성 실험용 6 km 격자 (30 m 셀, 200 × 200). 개발 격자와 같은 범위를 거칠게 나눈 것이다."""
    return GridSpec(x0=268800.0, y0=4183680.0, cell_m=30.0, rows=200, cols=200,
                    crs="EPSG:32611", grid_id="sim-200x200-30m")


def gaussian_prior(grid: GridSpec, center_xy: Optional[tuple[float, float]] = None,
                   sigma_m: float = 600.0) -> np.ndarray:
    """중심에서 멀어질수록 줄어드는 합 1의 확률 격자. 중심을 비우면 격자 가운데."""
    if not sigma_m > 0:
        raise ValueError("sigma_m은 0보다 커야 합니다")
    if center_xy is None:
        center_xy = (grid.x0 + grid.cols * grid.cell_m / 2, grid.y0 - grid.rows * grid.cell_m / 2)
    X, Y = grid.centers()
    prob = np.exp(-((X - center_xy[0]) ** 2 + (Y - center_xy[1]) ** 2) / (2 * sigma_m ** 2))
    return prob / prob.sum()


def load_prior_npz(path, grid: GridSpec) -> np.ndarray:
    """Ring 모델 NPZ 등 `probability` 배열을 읽는다. 격자 모양이 다르거나 합이 1이 아니면 오류."""
    with np.load(path, allow_pickle=False) as data:
        if "probability" not in data:
            raise ValueError("NPZ에 probability 배열이 없습니다")
        prob = np.asarray(data["probability"], dtype=float)
    if prob.shape != grid.shape:
        raise ValueError(f"확률 격자 {prob.shape}와 격자 정의 {grid.shape}가 다릅니다")
    if not np.isfinite(prob).all() or (prob < 0).any() or not math.isclose(float(prob.sum()), 1.0, abs_tol=1e-6):
        raise ValueError("probability는 유한하고 0 이상이며 합이 1이어야 합니다")
    return prob


# ---- 지휘소가 지도를 고치는 세 가지 방식 -------------------------------------
def next_target(prob: np.ndarray, grid: GridSpec, radius_m: float) -> tuple[float, float]:
    """현재 지도의 우선 수색 구역 1순위 중심. 구역 한 변이 수색 원의 지름과 비슷하도록 잡는다."""
    zone_cells = max(1, round(2 * radius_m / grid.cell_m))
    zone = top_zones(prob, grid, n=1, zone_cells=zone_cells)[0]
    return (zone["x_min"] + zone["x_max"]) / 2, (zone["y_min"] + zone["y_max"]) / 2


def exclude_circle(prob: np.ndarray, grid: GridSpec, x: float, y: float, radius_m: float) -> np.ndarray:
    out = prob.copy()
    out[grid.circle_mask(x, y, radius_m)] = 0.0
    total = float(out.sum())
    return out / total if total > 0 else prob.copy()


def _searched_event(k: int, x: float, y: float, radius_m: float, confidence: Confidence) -> FieldEvent:
    return FieldEvent(f"sim-{k}", EventType.SEARCHED,
                      Location(kind="좌표", value="합성 수색", x=x, y=y, radius_m=radius_m),
                      confidence, status=Status.APPROVED)


def _cell_xy(grid: GridSpec, index: int) -> tuple[float, float]:
    row, col = divmod(index, grid.cols)
    return grid.x0 + (col + 0.5) * grid.cell_m, grid.y0 - (row + 0.5) * grid.cell_m


def area_fraction(prob: np.ndarray, index: int) -> float:
    """실종자 셀(index)을 찾기까지 확률 높은 순으로 훑어야 하는 면적 비율 (0~1, 낮을수록 좋다).
    동점은 격자 행 우선 인덱스가 앞선 셀부터 센다 (평가 초안 4항)."""
    flat = prob.ravel()
    value = flat[index]
    rank = int(np.count_nonzero(flat > value) + np.count_nonzero(flat[:index] == value)) + 1
    return rank / flat.size


# ---- 통계 -------------------------------------------------------------------
def wilson(successes: int, n: int) -> tuple[float, float, float]:
    """(비율, 95% 신뢰구간 하한, 상한). n이 0이면 (nan, nan, nan)."""
    if n == 0:
        return math.nan, math.nan, math.nan
    p = successes / n
    denom = 1 + Z95 ** 2 / n
    center = (p + Z95 ** 2 / (2 * n)) / denom
    half = Z95 * math.sqrt(p * (1 - p) / n + Z95 ** 2 / (4 * n ** 2)) / denom
    return p, max(0.0, center - half), min(1.0, center + half)


def paired_difference(a: np.ndarray, b: np.ndarray) -> dict:
    """짝지은 두 결과의 평균 차이 (b - a)와 95% 신뢰구간 (정규 근사)."""
    diff = np.asarray(b, dtype=float) - np.asarray(a, dtype=float)
    n = diff.size
    mean = float(diff.mean()) if n else math.nan
    if n < 2:
        return {"mean": mean, "lo": math.nan, "hi": math.nan, "n": n}
    half = Z95 * float(diff.std(ddof=1)) / math.sqrt(n)
    return {"mean": mean, "lo": mean - half, "hi": mean + half, "n": n}


# ---- 실험 1: 순차 수색 --------------------------------------------------------
def run_sequential(cfg: SimConfig, grid: GridSpec, prior: np.ndarray) -> dict:
    cfg.validate()
    rng = np.random.default_rng(cfg.seed)
    flat_prior = prior.ravel() / prior.sum()
    static_center = next_target(prior, grid, cfg.radius_m)  # 미반영: 지도가 그대로라 늘 같은 곳
    found = {c: np.zeros(cfg.trials, dtype=int) for c in CONDITIONS}  # 0 = 못 찾음, k = k번째 팀이 발견

    for trial in range(cfg.trials):
        truth = _cell_xy(grid, int(rng.choice(flat_prior.size, p=flat_prior)))
        draws = rng.random(cfg.steps)
        jitter = rng.normal(0.0, cfg.location_error_m, size=(cfg.steps, 2))
        for cond in CONDITIONS:
            belief = prior
            state = new_state(prior) if cond == "update" else None
            for k in range(cfg.steps):
                center = static_center if cond == "none" else next_target(belief, grid, cfg.radius_m)
                if math.hypot(truth[0] - center[0], truth[1] - center[1]) <= cfg.radius_m and draws[k] < cfg.true_pod:
                    found[cond][trial] = k + 1
                    break
                reported = (center[0] + jitter[k][0], center[1] + jitter[k][1])
                if cond == "exclude":
                    belief = exclude_circle(belief, grid, *reported, cfg.radius_m)
                elif cond == "update":
                    state = apply_event(state, _searched_event(k, *reported, cfg.radius_m, cfg.confidence), grid)
                    belief = state.prob

    by_step = {c: [float(np.mean((found[c] > 0) & (found[c] <= k))) for k in range(1, cfg.steps + 1)]
               for c in CONDITIONS}
    final = {}
    for c in CONDITIONS:
        p, lo, hi = wilson(int((found[c] > 0).sum()), cfg.trials)
        final[c] = {"rate": p, "lo": lo, "hi": hi}
    hit = {c: (found[c] > 0).astype(float) for c in CONDITIONS}
    return {"detection_by_step": by_step, "final": final,
            "paired": {"update_vs_none": paired_difference(hit["none"], hit["update"]),
                       "update_vs_exclude": paired_difference(hit["exclude"], hit["update"])}}


# ---- 실험 2: 같은 면적 예산에서 포함된 비율 --------------------------------------
def run_budget(cfg: SimConfig, grid: GridSpec, prior: np.ndarray, budgets=BUDGETS) -> dict:
    cfg.validate()
    rng = np.random.default_rng([cfg.seed, 1])
    flat_prior = prior.ravel() / prior.sum()
    zone_cells = max(1, round(2 * cfg.radius_m / grid.cell_m))
    plan = [((z["x_min"] + z["x_max"]) / 2, (z["y_min"] + z["y_max"]) / 2)
            for z in top_zones(prior, grid, n=cfg.steps, zone_cells=zone_cells)]  # 처음 지도의 상위 K구역
    fractions = {c: [] for c in CONDITIONS}
    discovered = 0

    for _ in range(cfg.trials):
        index = int(rng.choice(flat_prior.size, p=flat_prior))
        truth = _cell_xy(grid, index)
        draws = rng.random(len(plan))
        jitter = rng.normal(0.0, cfg.location_error_m, size=(len(plan), 2))
        if any(math.hypot(truth[0] - cx, truth[1] - cy) <= cfg.radius_m and draws[k] < cfg.true_pod
               for k, (cx, cy) in enumerate(plan)):
            discovered += 1  # 수색 중에 찾았으면 지도 비교 대상이 아니다
            continue
        belief_exclude, state = prior, new_state(prior)
        for k, (cx, cy) in enumerate(plan):
            reported = (cx + jitter[k][0], cy + jitter[k][1])
            belief_exclude = exclude_circle(belief_exclude, grid, *reported, cfg.radius_m)
            state = apply_event(state, _searched_event(k, *reported, cfg.radius_m, cfg.confidence), grid)
        beliefs = {"none": prior, "exclude": belief_exclude, "update": state.prob}
        for cond in CONDITIONS:
            fractions[cond].append(area_fraction(beliefs[cond], index))

    kept = len(fractions["none"])
    arrays = {c: np.asarray(v) for c, v in fractions.items()}
    inclusion = {c: {f"{b:g}": wilson(int((arrays[c] <= b).sum()), kept)[0] for b in budgets} for c in CONDITIONS}
    mean_fraction = {c: (float(arrays[c].mean()) if kept else math.nan) for c in CONDITIONS}
    return {"kept": kept, "discovered_during_plan": discovered, "inclusion": inclusion,
            "mean_area_fraction": mean_fraction,
            "paired": {"update_vs_none": paired_difference(arrays["none"], arrays["update"]),
                       "update_vs_exclude": paired_difference(arrays["exclude"], arrays["update"])}}


# ---- 실행·출력 -------------------------------------------------------------
def run(cfg: SimConfig, grid: GridSpec, prior: np.ndarray) -> dict:
    return {"config": {**asdict(cfg), "confidence": cfg.confidence.value, "true_pod": cfg.true_pod},
            "grid": {"grid_id": grid.grid_id, "rows": grid.rows, "cols": grid.cols, "cell_m": grid.cell_m},
            "sequential": run_sequential(cfg, grid, prior),
            "budget": run_budget(cfg, grid, prior)}


def sweep(cfg: SimConfig, grid: GridSpec, prior: np.ndarray, key: str, values: list[float]) -> list[dict]:
    """한 설정(pod_scale 또는 location_error_m)만 바꿔 가며 결과를 모은다."""
    field = {"pod-scale": "pod_scale", "location-error": "location_error_m"}.get(key)
    if field is None:
        raise ValueError("sweep 키는 pod-scale 또는 location-error 입니다")
    return [{"value": v, **run(replace(cfg, **{field: v}), grid, prior)} for v in values]


def _pct(x: float) -> str:
    return "  -  " if x is None or (isinstance(x, float) and math.isnan(x)) else f"{x * 100:5.1f}%"


def format_report(result: dict, header: str = "") -> str:
    cfg, seq, bud = result["config"], result["sequential"], result["budget"]
    lines = ["무전 반영 전후 비교 실험 (합성 시나리오)"]
    if header:
        lines.append(header)
    lines.append(f"시행 {cfg['trials']}회 · 팀 {cfg['steps']}개 · 수색 반경 {cfg['radius_m']:g} m · 보고 강도 {cfg['confidence']}"
                 f" (실제 발견 확률 {cfg['true_pod']:.2f}) · 위치 오차 σ {cfg['location_error_m']:g} m · 시드 {cfg['seed']}")
    lines += ["", "[실험 1] 순차 수색: 단계별 누적 발견율"]
    lines.append("  " + " " * 22 + "".join(f"{k:>7}" for k in range(1, cfg["steps"] + 1)) + "   (95% 신뢰구간)")
    for c in CONDITIONS:
        row = "".join(f"{_pct(v):>7}" for v in seq["detection_by_step"][c])
        f = seq["final"][c]
        lines.append(f"  {LABELS[c]:<18}{row}   [{_pct(f['lo']).strip()} ~ {_pct(f['hi']).strip()}]")
    for key, name in (("update_vs_none", "확률 보정 − 미반영"), ("update_vs_exclude", "확률 보정 − 단순 제외")):
        d = seq["paired"][key]
        lines.append(f"  {name}: {d['mean'] * 100:+.1f}%p (95% 구간 {d['lo'] * 100:+.1f} ~ {d['hi'] * 100:+.1f})")
    lines += ["", f"[실험 2] 같은 면적 예산에서 실종자가 포함된 비율 (수색 중 발견 {bud['discovered_during_plan']}회 제외, 대상 {bud['kept']}회)"]
    lines.append("  " + " " * 18 + "".join(f"{'상위 ' + format(b * 100, 'g') + '%':>10}" for b in BUDGETS) + "   평균 면적 비율")
    for c in CONDITIONS:
        row = "".join(f"{_pct(bud['inclusion'][c][f'{b:g}']):>10}" for b in BUDGETS)
        lines.append(f"  {LABELS[c]:<14}{row}   {_pct(bud['mean_area_fraction'][c])}")
    d = bud["paired"]["update_vs_none"]
    lines.append(f"  평균 면적 비율 차이(확률 보정 − 미반영): {d['mean'] * 100:+.2f}%p (95% 구간 {d['lo'] * 100:+.2f} ~ {d['hi'] * 100:+.2f}, 낮을수록 좋음)")
    lines += ["", "해석 주의: 합성 시나리오이며 지도가 정확하고 실종자가 지도 분포에서 나온다고 가정합니다. 현장 성능의 증거가 아닙니다."]
    return "\n".join(lines)


def format_sweep(rows: list[dict], key: str) -> str:
    lines = [f"민감도 분석: {key}", f"  {key:<14}" + "".join(f"{LABELS[c]:>22}" for c in CONDITIONS) + "   (순차 수색 최종 발견율)"]
    for row in rows:
        final = row["sequential"]["final"]
        lines.append(f"  {row['value']:<14g}" + "".join(f"{_pct(final[c]['rate']):>22}" for c in CONDITIONS))
    lines += ["", f"  {key:<14}" + "".join(f"{LABELS[c]:>22}" for c in CONDITIONS) + "   (면적 예산 10% 포함 비율)"]
    for row in rows:
        inc = row["budget"]["inclusion"]
        lines.append(f"  {row['value']:<14g}" + "".join(f"{_pct(inc[c]['0.1']):>22}" for c in CONDITIONS))
    return "\n".join(lines)


def main(argv: Optional[list[str]] = None) -> None:
    parser = argparse.ArgumentParser(description="무전 반영 전후 비교 실험 (합성 시나리오)")
    parser.add_argument("--trials", type=int, default=SimConfig.trials)
    parser.add_argument("--steps", type=int, default=SimConfig.steps, help="수색 팀 수")
    parser.add_argument("--radius", type=float, default=SimConfig.radius_m, help="수색 반경(m)")
    parser.add_argument("--confidence", choices=[c.value for c in Confidence], default=Confidence.NORMAL.value)
    parser.add_argument("--pod-scale", type=float, default=SimConfig.pod_scale)
    parser.add_argument("--location-error", type=float, default=SimConfig.location_error_m, help="보고 위치 오차 σ(m)")
    parser.add_argument("--seed", type=int, default=SimConfig.seed)
    parser.add_argument("--prior-sigma", type=float, default=600.0, help="기본 사전 확률의 퍼짐(m)")
    parser.add_argument("--grid", help="격자 JSON (없으면 합성 6 km 격자)")
    parser.add_argument("--prior-npz", help="probability 배열이 든 NPZ (예: Ring 모델 결과). --grid와 같은 격자여야 함")
    parser.add_argument("--sweep", nargs=2, metavar=("KEY", "VALUES"), help="예: pod-scale 1.0,0.7,0.5")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)

    grid = GridSpec.from_json_file(args.grid) if args.grid else default_grid()
    header_parts = [f"격자 {grid.grid_id or '(이름 없음)'} {grid.rows}×{grid.cols}, 셀 {grid.cell_m:g} m"]
    if args.prior_npz:
        prior = load_prior_npz(args.prior_npz, grid)
        digest = hashlib.sha256(Path(args.prior_npz).read_bytes()).hexdigest()
        header_parts.append(f"사전 확률 {args.prior_npz} (SHA-256 {digest})")
    else:
        prior = gaussian_prior(grid, sigma_m=args.prior_sigma)
        header_parts.append(f"사전 확률: 격자 중심 가우시안 σ {args.prior_sigma:g} m")
    cfg = SimConfig(trials=args.trials, steps=args.steps, radius_m=args.radius,
                    confidence=Confidence(args.confidence), pod_scale=args.pod_scale,
                    location_error_m=args.location_error, seed=args.seed)
    cfg.validate()
    if args.sweep:
        key, raw = args.sweep
        rows = sweep(cfg, grid, prior, key, [float(v) for v in raw.split(",")])
        print(json.dumps(rows, ensure_ascii=False, indent=2) if args.json else format_sweep(rows, key))
        return
    result = run(cfg, grid, prior)
    print(json.dumps(result, ensure_ascii=False, indent=2) if args.json
          else format_report(result, "; ".join(header_parts)))


if __name__ == "__main__":
    main()
