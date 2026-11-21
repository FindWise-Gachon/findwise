# test_valid_pmf: 확률의 합이 1인 pmf를 정상 처리하는지
# test_invalid_pmf: 잘못돈 확률 분포에서 오류 발생시키는지
# test_select_behavior: 6가지 행동 중 하나를 선택하는지
# test_sampling_distribution: 반복 선택 시 설정한 확률과 비슷한 비율이 나타나는지
# test_reproducibility: 동일한 시드에서 동일한 결과가 나오는지

import unittest

import numpy as np

from .behavior_selector import (
    Behavior,
    select_behavior,
    validate_pmf,
)


class TestBehaviorSelector(unittest.TestCase):

    def setUp(self):
        self.pmf = {
            "RW": 0.50,
            "RT": 0.20,
            "DT": 0.10,
            "SP": 0.10,
            "VE": 0.05,
            "BT": 0.05,
        }

    def test_valid_pmf(self):
        probabilities = validate_pmf(self.pmf)
        self.assertAlmostEqual(probabilities.sum(), 1.0)

    def test_invalid_pmf(self):
        invalid = self.pmf.copy()
        invalid["RW"] = 0.80

        with self.assertRaises(ValueError):
            validate_pmf(invalid)

    def test_select_behavior(self):
        rng = np.random.default_rng(42)
        selected = select_behavior(self.pmf, rng)

        self.assertIsInstance(selected, Behavior)

    def test_sampling_distribution(self):
        rng = np.random.default_rng(42)

        results = [
            select_behavior(self.pmf, rng)
            for _ in range(10000)
        ]

        rw_ratio = results.count(Behavior.RW) / len(results)

        self.assertAlmostEqual(
            rw_ratio,
            0.50,
            delta=0.03,
        )

    def test_reproducibility(self):
        rng1 = np.random.default_rng(42)
        rng2 = np.random.default_rng(42)

        results1 = [
            select_behavior(self.pmf, rng1)
            for _ in range(100)
        ]

        results2 = [
            select_behavior(self.pmf, rng2)
            for _ in range(100)
        ]

        self.assertEqual(results1, results2)


if __name__ == "__main__":
    unittest.main()
