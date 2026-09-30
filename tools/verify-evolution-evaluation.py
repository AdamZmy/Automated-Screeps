#!/usr/bin/env python3
"""Offline behavioral checks for the hauler evolution evidence gate."""

import copy
import importlib.util
from pathlib import Path
import unittest


SPEC = importlib.util.spec_from_file_location("evolution_evaluation", Path(__file__).with_name("evolution_evaluation.py"))
evaluation = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(evaluation)


def sample(stage="baseline", **changes):
    record = {
        "id": "experiment-1", "room": "W21N26", "stage": stage,
        "revision": "frontier24.1", "signature": {"rcl": 5, "sources": ["s1", "s2"], "haulerBodies": {"carry-move": 2}},
        "complete": True, "invalidReasons": [], "ticks": 1500,
        "observedTicks": 1500, "fromTick": 100, "endTick": 1600,
        "haulerTicks": 3000, "delivered": 30000, "deliveryEvents": 120,
        "carryTicks": 30000, "workerWorkTicks": 12000, "minerWorkTicks": 15000,
        "travelTicks": 1800, "payloadSum": 900, "idle": 150,
        "waitingPickup": 100, "blocked": 10, "spawnDemandTicks": 500,
        "spawnStarvedTicks": 10, "roomCpu": 1500, "cpuTicks": 1500,
        "errors": 0, "bucketStart": 10000, "bucketEnd": 10000, "bucketMin": 10000,
    }
    record.update(changes)
    return record


class EvidenceChecks(unittest.TestCase):
    def decision(self, baseline=None, trial=None, thresholds=None):
        return evaluation.evaluate(baseline if baseline is not None else sample(), trial if trial is not None else sample("trial", delivered=33000), thresholds)

    def test_keep_actual_delivery_per_hauler_tick_not_total_delivery(self):
        result = self.decision(trial=sample("trial", delivered=31000, haulerTicks=3300))
        self.assertEqual("rollback", result["decision"])
        self.assertIn("throughput_regressed", result["reasons"])
        result = self.decision(trial=sample("trial", delivered=27000, haulerTicks=2500))
        self.assertEqual("keep", result["decision"])
        self.assertAlmostEqual(10.8, result["metrics"]["trial"]["throughput"])

    def test_material_population_shift_is_not_a_policy_result(self):
        result = self.decision(trial=sample("trial", delivered=33000, haulerTicks=4500))
        self.assertEqual("invalid",result["decision"])
        self.assertIn("haulerMean_confounded",result["reasons"])

    def test_baseline_is_validated_before_candidate_activation(self):
        self.assertEqual("ready", evaluation.validate_baseline(sample())["decision"])
        for changes in ({"errors": 1}, {"invalidReasons": ["gap"]}, {"cpuTicks": 1499}, {"ticks": 1499, "observedTicks": 1499, "cpuTicks": 1499}):
            self.assertEqual("invalid", evaluation.validate_baseline(sample(**changes))["decision"])
        self.assertEqual("observe", evaluation.validate_baseline(sample(complete=False))["decision"])
        self.assertEqual("observe", evaluation.validate_baseline(sample(deliveryEvents=19))["decision"])
        self.assertEqual("observe", evaluation.validate_baseline(sample(delivered=0))["decision"])
        self.assertEqual("invalid", evaluation.validate_baseline({})["decision"])

    def test_exact_five_percent_boundaries(self):
        self.assertEqual("keep", self.decision(trial=sample("trial", delivered=31500))["decision"])
        self.assertEqual("rollback", self.decision(trial=sample("trial", delivered=28500))["decision"])
        self.assertEqual("observe", self.decision(trial=sample("trial", delivered=31499))["decision"])

    def test_neutral_completed_pair_requests_fresh_equal_pair(self):
        result = self.decision(trial=sample("trial", delivered=30300))
        self.assertEqual("observe", result["decision"])
        self.assertEqual(["throughput_inconclusive"], result["reasons"])
        self.assertTrue(result["resample"])
        self.assertEqual(1500, result["windowTicks"])

    def test_diagnostic_ratios_never_substitute_for_throughput(self):
        result = self.decision(trial=sample("trial", delivered=30000, travelTicks=10, idle=0, blocked=0, payloadSum=900000))
        self.assertEqual("observe", result["decision"])

    def test_incomplete_observes_without_extrapolation(self):
        trial = sample("trial", complete=False, ticks=1000, observedTicks=1000, cpuTicks=1000, delivered=99000)
        result = self.decision(trial=trial)
        self.assertEqual("observe", result["decision"])
        self.assertEqual(["incomplete_windows"], result["reasons"])
        self.assertFalse(result["resample"])
        self.assertEqual(1000, result["metrics"]["trial"]["ticks"])

    def test_complete_requires_exact_interval_and_cpu_coverage(self):
        for changes in ({"ticks": 1499, "observedTicks": 1499, "cpuTicks": 1499}, {"ticks": 1501, "observedTicks": 1501, "cpuTicks": 1501}, {"cpuTicks": 1499}, {"endTick": 1599}, {"observedTicks": 1499}):
            with self.subTest(changes=changes):
                self.assertEqual("invalid", self.decision(trial=sample("trial", **changes))["decision"])

    def test_gap_reset_threat_and_confounded_record_invalid(self):
        for reason in ("missing_interval", "global_reset", "signature_changed", "threat", "recovery"):
            result = self.decision(trial=sample("trial", invalidReasons=[reason], complete=False))
            self.assertEqual("invalid", result["decision"])
            self.assertIn("trial_confounded", result["reasons"])

    def test_requires_same_room_signature_and_correct_stage(self):
        for changes in ({"room": "W22N26"}, {"signature": {"rcl": 6}}, {"stage": "warmup"}):
            trial = sample("trial")
            trial.update(changes)
            self.assertEqual("invalid", self.decision(trial=trial)["decision"])
        self.assertEqual("keep", self.decision(trial=sample("trial", delivered=33000, revision="new-policy"))["decision"])

    def test_trial_runtime_error_rolls_back_immediately(self):
        for trial in (sample("trial", errors=1, complete=False), {"errors": 1}, sample("trial", errors=1, invalidReasons=["runtime_error"])):
            result = self.decision(baseline={}, trial=trial)
            self.assertEqual("rollback", result["decision"])
            self.assertEqual(["trial_runtime_errors"], result["reasons"])
        self.assertEqual("invalid", self.decision(baseline=sample(errors=1))["decision"])

    def test_low_activity_observes(self):
        for changes in ({"delivered": 0}, {"deliveryEvents": 19}, {"haulerTicks": 0, "travelTicks": 0, "idle": 0, "waitingPickup": 0, "blocked": 0}):
            result = self.decision(trial=sample("trial", **changes))
            self.assertEqual("observe", result["decision"])
            self.assertIn("insufficient_delivery_evidence", result["reasons"])
        self.assertEqual("keep", self.decision(trial=sample("trial", delivered=33000, deliveryEvents=20))["decision"])

    def test_unstarted_trial_observes_with_null_initial_fields(self):
        changes = {key: 0 for key in evaluation.TOTALS}
        changes.update(complete=False, observedTicks=0, signature=None,
                       bucketStart=None, bucketEnd=None, bucketMin=None)
        result = self.decision(trial=sample("trial", **changes))
        self.assertEqual("observe", result["decision"])
        self.assertIsNone(result["metrics"]["trial"]["bucketDelta"])

    def test_mean_capacity_confounds_beyond_twenty_percent(self):
        for key in ("carryTicks", "workerWorkTicks", "minerWorkTicks"):
            baseline = sample()
            trial = sample("trial", delivered=33000)
            trial[key] = baseline[key] * 1.2
            self.assertEqual("keep", self.decision(baseline, trial)["decision"])
            trial[key] += 1
            self.assertEqual("invalid", self.decision(baseline, trial)["decision"])
        baseline = sample(workerWorkTicks=0)
        self.assertEqual("invalid", self.decision(baseline=baseline)["decision"])

    def test_payload_mean_uses_measured_travel_exposure(self):
        result = self.decision()
        self.assertEqual(0.5, result["metrics"]["trial"]["payloadMean"])

    def test_spawn_guard_uses_demand_share_with_boundary(self):
        self.assertEqual("keep", self.decision(trial=sample("trial", delivered=33000, spawnStarvedTicks=20))["decision"])
        result = self.decision(trial=sample("trial", delivered=33000, spawnStarvedTicks=21))
        self.assertEqual("rollback", result["decision"])
        self.assertIn("spawn_shortfall_regressed", result["reasons"])
        self.assertEqual("keep", self.decision(trial=sample("trial", delivered=33000, spawnDemandTicks=1000, spawnStarvedTicks=40))["decision"])

    def test_cpu_guard_max_absolute_and_relative_allowance(self):
        self.assertEqual("keep", self.decision(trial=sample("trial", delivered=33000, roomCpu=1800))["decision"])
        result = self.decision(trial=sample("trial", delivered=33000, roomCpu=1801))
        self.assertIn("room_cpu_regressed", result["reasons"])
        self.assertEqual("rollback", result["decision"])
        baseline = sample(roomCpu=6000)
        self.assertEqual("keep", self.decision(baseline=baseline, trial=sample("trial", delivered=33000, roomCpu=6600))["decision"])
        self.assertEqual("rollback", self.decision(baseline=baseline, trial=sample("trial", delivered=33000, roomCpu=6601))["decision"])

    def test_bucket_saturation_and_different_start_levels_are_valid(self):
        baseline = sample(bucketStart=8000, bucketEnd=10000, bucketMin=8000)
        self.assertEqual("keep", self.decision(baseline=baseline)["decision"])
        trial = sample("trial", delivered=33000, bucketStart=9000, bucketEnd=9000, bucketMin=9000)
        self.assertEqual("keep", self.decision(trial=trial)["decision"])
        self.assertEqual("keep", self.decision(trial=sample("trial", delivered=33000, bucketEnd=9900, bucketMin=9900))["decision"])

    def test_bucket_net_depletion_and_transient_excursion_guards(self):
        result = self.decision(trial=sample("trial", delivered=33000, bucketEnd=9899, bucketMin=9899))
        self.assertEqual("rollback", result["decision"])
        self.assertIn("bucket_depletion_regressed", result["reasons"])
        result = self.decision(trial=sample("trial", delivered=33000, bucketEnd=10000, bucketMin=9499))
        self.assertIn("bucket_excursion_regressed", result["reasons"])
        baseline = sample(bucketStart=9000, bucketEnd=8500, bucketMin=8500)
        trial = sample("trial", delivered=33000, bucketStart=8500, bucketEnd=8000, bucketMin=8000)
        self.assertEqual("keep", self.decision(baseline, trial)["decision"])

    def test_missing_nonfinite_negative_and_impossible_totals_invalid(self):
        for key, value in (("delivered", float("nan")), ("roomCpu", float("inf")), ("ticks", True), ("blocked", -1), ("deliveryEvents", 1.5), ("bucketMin", 10001), ("spawnStarvedTicks", 501)):
            with self.subTest(key=key, value=value):
                self.assertEqual("invalid", self.decision(trial=sample("trial", **{key: value}))["decision"])
        trial = sample("trial")
        del trial["delivered"]
        self.assertEqual("invalid", self.decision(trial=trial)["decision"])

    def test_threshold_override_and_bad_config(self):
        self.assertEqual("keep", self.decision(trial=sample("trial", delivered=30900), thresholds={"improvementFraction": 0.02})["decision"])
        for thresholds in ({"madeUp": 1}, {"cpuRelativeIncrease": -1}, {"minDeliveryEvents": 0}, {"minDeliveryEvents": 1.5}, {"improvementFraction": float("nan")}):
            self.assertEqual("invalid", self.decision(thresholds=thresholds)["decision"])

    def test_input_records_and_defaults_are_not_mutated(self):
        baseline, trial = sample(), sample("trial", delivered=33000)
        old = copy.deepcopy((baseline, trial, evaluation.DEFAULT_THRESHOLDS))
        result = self.decision(baseline, trial, {"improvementFraction": 0.02})
        result["thresholds"]["improvementFraction"] = 9
        self.assertEqual(old, (baseline, trial, evaluation.DEFAULT_THRESHOLDS))


if __name__ == "__main__":
    unittest.main(verbosity=2)
