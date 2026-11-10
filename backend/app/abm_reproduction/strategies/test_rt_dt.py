import unittest
import numpy as np
from ..agent import Agent
from ..config import ABMConfig
from ..grid import TerrainGrid
from ..simulation import SimulationState
from .direction_utils import forward_cells
from .direction_traveling import direction_traveling_candidate, run_direction_traveling_continuous
from .route_traveling import route_traveling_candidate, run_route_traveling_continuous

class RTDTTests(unittest.TestCase):
    def setUp(self):
        cfg = ABMConfig()
        self.grid = TerrainGrid(cfg, np.ones(cfg.grid_shape, bool), np.zeros(cfg.grid_shape, bool))
        self.agent = Agent(100, 100)
        self.rng = np.random.default_rng(7)
        self.features = np.zeros(cfg.grid_shape, bool)

    def test_forward_east(self):
        self.assertEqual(set(forward_cells(self.agent, (99, 100))), {(101,99),(101,100),(101,101)})

    def test_forward_diagonal(self):
        self.assertEqual(set(forward_cells(self.agent, (99, 99))), {(100,101),(101,101),(101,100)})

    def test_dt_only_forward(self):
        for _ in range(100):
            self.assertIn(direction_traveling_candidate(self.agent, (99,100), self.rng), forward_cells(self.agent,(99,100)))

    def test_rt_uses_feature(self):
        self.features[99,101] = True
        self.assertEqual(route_traveling_candidate(self.agent,self.grid,self.features,(99,100),self.rng),(101,99))

    def test_rt_falls_back_to_rw(self):
        # no linear feature: candidate belongs to RW's 3x3 neighborhood
        for _ in range(30):
            x,y=route_traveling_candidate(self.agent,self.grid,self.features,(99,100),self.rng)
            self.assertLessEqual(abs(x-100),1)
            self.assertLessEqual(abs(y-100),1)

    def test_continuous_updates_time(self):
        state=SimulationState(previous_position=(99,100))
        records=run_direction_traveling_continuous(self.agent,self.grid,state,3,self.rng)
        self.assertEqual(len(records),3)
        self.assertEqual(state.step_count,3)
        self.assertAlmostEqual(self.agent.elapsed_seconds,3*3600/850)

    def test_rt_continuous_updates_time(self):
        state=SimulationState(previous_position=(99,100))
        records=run_route_traveling_continuous(self.agent,self.grid,self.features,state,2,self.rng)
        self.assertEqual(len(records),2)
        self.assertEqual(state.step_count,2)

if __name__ == '__main__':
    unittest.main()
