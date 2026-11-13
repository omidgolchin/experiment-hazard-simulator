"""Experiment hazard simulator.

A small Monte Carlo model of an agent experiment (condition A vs condition B
on T tasks with S seeds per task) with eight toggleable design hazards.
All data are simulated; there is no empirical dataset in this project.
"""

from .model import Settings, simulate_experiments

__all__ = ["Settings", "simulate_experiments"]
