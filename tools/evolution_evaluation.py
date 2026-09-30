"""Pure, offline evidence gate for one-room hauler experiments.

``evaluate(baseline, trial, thresholds=None)`` accepts two flat JSON-like records.
Each requires id, room, stage (baseline/trial), revision, a nonempty signature
object, complete (boolean), invalidReasons (list), and nonnegative numeric totals:
ticks, haulerTicks, carryTicks, workerWorkTicks, minerWorkTicks, delivered,
deliveryEvents, travelTicks, payloadSum, idle,
waitingPickup, blocked, spawnDemandTicks, spawnStarvedTicks, roomCpu, cpuTicks,
errors, bucketStart, bucketEnd, bucketMin. Bucket values are 0..10000. ``roomCpu``
is the sum of measured room CPU, not a whole-world CPU estimate. Signature must
capture stable confounders such as nominal body policy, sources, structures, room level,
threat/recovery state, and active policy other than the treatment being tested.
The collector must put gaps, resets, missing observations, signature changes, and
other confounders in invalidReasons. Optional observedTicks and fromTick/endTick
(exclusive bound) are checked when supplied. Baseline/trial revisions may differ
because the experimental policy may be deployed between the two windows.
Natural replacement overlap does not change the stable signature. The aggregate
carryTicks/workerWorkTicks/minerWorkTicks sum active body parts per observed tick;
their per-tick means and mean active hauler count must stay within 20% of baseline to control actual capacity.
An empty incomplete record may have null signature/bucket fields before its
first measured tick. payloadSum is the sum of loaded travel fractions and
payloadMean divides it by travelTicks, not by all hauler exposure.

Complete evidence requires exactly 1500 observed ticks and CPU ticks per window;
the trial begins after the runner's separate 300-tick warmup. At least 20 actual
delivery events and positive hauler exposure/delivery are required per window.
No totals from incomplete intervals are extrapolated. Throughput is actual
delivered energy / haulerTicks. Travel/payload/idle metrics are diagnostic only.

Threshold keys and defaults are in DEFAULT_THRESHOLDS. Fraction thresholds use
fractions, not percentages. CPU allowance is max(absolute, relative * baseline).
Bucket guards compare net depletion and maximum excursion from each window's
own start; a saturated 10000 bucket need not grow, nor start at the same level.
Bucket evidence is global auxiliary evidence, never the improvement metric.

The result has decision (keep/rollback/observe/invalid), stable reason codes,
metrics (baseline, trial, deltas, guards), thresholds, windowTicks, and resample.
Trial runtime errors cause immediate rollback even for incomplete/bad evidence.
Otherwise invalid records/confounders return invalid; incomplete/low-activity
records return observe. Completed comparable neutral evidence returns observe
with resample=True: the runner should collect a fresh equal pair, at most three
pairs, rather than indefinitely compare new trials to a frozen old baseline.
This module performs no IO, network calls, credential reads, or mutations.
``validate_baseline(sample)`` exposes the same control-window checks to the
runner before it enables a candidate; only decision=ready permits a trial.
"""

import math
from collections.abc import Mapping


WINDOW_TICKS = 1500
DEFAULT_THRESHOLDS = {
    "improvementFraction": 0.05,
    "rollbackFraction": 0.05,
    "minDeliveryEvents": 20,
    "spawnShortfallIncrease": 0.02,
    "cpuAbsoluteIncrease": 0.2,
    "cpuRelativeIncrease": 0.10,
    "bucketDepletionIncrease": 100,
    "bucketExcursionIncrease": 500,
    "capacityDifferenceFraction": 0.20,
}
TOTALS = (
    "ticks", "haulerTicks", "carryTicks", "workerWorkTicks", "minerWorkTicks",
    "delivered", "deliveryEvents", "travelTicks",
    "payloadSum", "idle", "waitingPickup", "blocked", "spawnDemandTicks",
    "spawnStarvedTicks", "roomCpu", "cpuTicks", "errors", "bucketStart",
    "bucketEnd", "bucketMin",
)
INTEGER_TOTALS = set(TOTALS) - {"roomCpu", "payloadSum"}
BUCKET_FIELDS = {"bucketStart", "bucketEnd", "bucketMin"}


def _number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _validate(sample, stage):
    reasons = []
    if not isinstance(sample, Mapping):
        return [stage + "_not_record"]
    unstarted = sample.get("ticks") == 0 and sample.get("complete") is False
    for key in ("id", "room", "revision"):
        if key not in sample or sample[key] is None or sample[key] == "":
            reasons.append(stage + "_missing_" + key)
    if sample.get("stage") != stage:
        reasons.append(stage + "_stage_mismatch")
    if not isinstance(sample.get("room"), str):
        reasons.append(stage + "_invalid_room")
    if not unstarted and (not isinstance(sample.get("signature"), Mapping) or not sample["signature"]):
        reasons.append(stage + "_invalid_signature")
    if not isinstance(sample.get("complete"), bool):
        reasons.append(stage + "_invalid_complete")
    invalid = sample.get("invalidReasons")
    if not isinstance(invalid, list):
        reasons.append(stage + "_invalid_invalidReasons")
    elif invalid:
        reasons.append(stage + "_confounded")
    for key in TOTALS:
        value = sample.get(key)
        if unstarted and key in BUCKET_FIELDS and value is None:
            continue
        if not _number(value) or value < 0 or (key in INTEGER_TOTALS and int(value) != value):
            reasons.append(stage + "_invalid_" + key)
    if any(stage + "_invalid_" + key in reasons for key in TOTALS):
        return reasons
    if sample["ticks"] > WINDOW_TICKS:
        reasons.append(stage + "_window_too_long")
    if sample["cpuTicks"] > sample["ticks"]:
        reasons.append(stage + "_cpu_coverage_inconsistent")
    if sample["spawnStarvedTicks"] > sample["spawnDemandTicks"] or sample["spawnDemandTicks"] > sample["ticks"]:
        reasons.append(stage + "_spawn_coverage_inconsistent")
    for key in ("travelTicks", "idle", "waitingPickup", "blocked"):
        if sample[key] > sample["haulerTicks"]:
            reasons.append(stage + "_hauler_coverage_inconsistent")
            break
    if any(sample.get(key) is not None and sample[key] > 10000 for key in BUCKET_FIELDS):
        reasons.append(stage + "_bucket_out_of_range")
    if all(sample.get(key) is not None for key in BUCKET_FIELDS) and sample["bucketMin"] > min(sample["bucketStart"], sample["bucketEnd"]):
        reasons.append(stage + "_bucket_min_inconsistent")
    if "observedTicks" in sample and (not _number(sample["observedTicks"]) or sample["observedTicks"] != sample["ticks"]):
        reasons.append(stage + "_observed_coverage_inconsistent")
    if "fromTick" in sample or "endTick" in sample:
        if not _number(sample.get("fromTick")) or not _number(sample.get("endTick")) or sample["endTick"] - sample["fromTick"] != WINDOW_TICKS:
            reasons.append(stage + "_interval_mismatch")
    if sample["complete"] and (sample["ticks"] != WINDOW_TICKS or sample["cpuTicks"] != WINDOW_TICKS):
        reasons.append(stage + "_completed_coverage_inconsistent")
    if stage == "baseline" and sample["errors"]:
        reasons.append("baseline_runtime_errors")
    return reasons


def _metrics(sample):
    exposure = sample["haulerTicks"]
    ticks = sample["ticks"]
    demand = sample["spawnDemandTicks"]
    return {
        "ticks": ticks,
        "haulerTicks": exposure,
        "haulerMean": exposure / ticks if ticks else None,
        "carryMean": sample["carryTicks"] / ticks if ticks else None,
        "workerWorkMean": sample["workerWorkTicks"] / ticks if ticks else None,
        "minerWorkMean": sample["minerWorkTicks"] / ticks if ticks else None,
        "delivered": sample["delivered"],
        "deliveryEvents": sample["deliveryEvents"],
        "throughput": sample["delivered"] / exposure if exposure else None,
        "travelShare": sample["travelTicks"] / exposure if exposure else None,
        "payloadMean": sample["payloadSum"] / sample["travelTicks"] if sample["travelTicks"] else None,
        "idleShare": sample["idle"] / exposure if exposure else None,
        "waitingPickupShare": sample["waitingPickup"] / exposure if exposure else None,
        "blockedShare": sample["blocked"] / exposure if exposure else None,
        "spawnShortfallShare": sample["spawnStarvedTicks"] / demand if demand else 0.0,
        "roomCpuMean": sample["roomCpu"] / sample["cpuTicks"] if sample["cpuTicks"] else None,
        "bucketDelta": sample["bucketEnd"] - sample["bucketStart"] if all(sample.get(key) is not None for key in ("bucketStart", "bucketEnd")) else None,
        "bucketExcursion": sample["bucketStart"] - sample["bucketMin"] if all(sample.get(key) is not None for key in ("bucketStart", "bucketMin")) else None,
    }


def validate_baseline(sample):
    """Return ready/observe/invalid before a runner activates a candidate.

    Uses the default minimum of 20 actual delivery events. Incomplete evidence
    remains observe; confounded, malformed, or errored evidence is invalid.
    """
    reasons = _validate(sample, "baseline")
    if reasons:
        return {"decision": "invalid", "reasons": reasons}
    if not sample["complete"]:
        return {"decision": "observe", "reasons": ["incomplete_baseline"]}
    if sample["delivered"] <= 0 or sample["haulerTicks"] <= 0 or sample["deliveryEvents"] < DEFAULT_THRESHOLDS["minDeliveryEvents"]:
        return {"decision": "observe", "reasons": ["insufficient_delivery_evidence"]}
    return {"decision": "ready", "reasons": []}


def evaluate(baseline, trial, thresholds=None):
    """Return an evidence decision without modifying either input record.

    Reason codes are stable identifiers suitable for runner logs/tests. A guard
    regression can roll back any adequate completed pair, including one with
    improved throughput. Neutral adequate pairs request a fresh matched pair.
    """
    limits = dict(DEFAULT_THRESHOLDS)
    result = {"decision": "invalid", "reasons": [], "metrics": {},
              "thresholds": limits, "windowTicks": WINDOW_TICKS, "resample": False}
    if isinstance(trial, Mapping) and _number(trial.get("errors")) and trial["errors"] > 0:
        result.update(decision="rollback", reasons=["trial_runtime_errors"])
        return result
    if thresholds is not None:
        if not isinstance(thresholds, Mapping) or any(key not in limits for key in thresholds):
            result["reasons"] = ["invalid_thresholds"]
            return result
        limits.update(thresholds)
    if any(not _number(value) or value < 0 for value in limits.values()):
        result["reasons"] = ["invalid_thresholds"]
        return result
    if limits["minDeliveryEvents"] < 1 or int(limits["minDeliveryEvents"]) != limits["minDeliveryEvents"]:
        result["reasons"] = ["invalid_thresholds"]
        return result
    result["reasons"] = _validate(baseline, "baseline") + _validate(trial, "trial")
    if not result["reasons"]:
        if baseline["room"] != trial["room"]:
            result["reasons"].append("room_mismatch")
        if baseline["ticks"] > 0 and trial["ticks"] > 0 and baseline["signature"] != trial["signature"]:
            result["reasons"].append("signature_mismatch")
    if result["reasons"]:
        return result
    before, after = _metrics(baseline), _metrics(trial)
    result["metrics"] = {"baseline": before, "trial": after, "deltas": {}, "guards": {}}
    if not baseline["complete"] or not trial["complete"]:
        result.update(decision="observe", reasons=["incomplete_windows"])
        return result
    if any(sample["delivered"] <= 0 or sample["haulerTicks"] <= 0 or sample["deliveryEvents"] < limits["minDeliveryEvents"] for sample in (baseline, trial)):
        result.update(decision="observe", reasons=["insufficient_delivery_evidence"], resample=True)
        return result
    capacity_changes = {}
    for key in ("haulerMean", "carryMean", "workerWorkMean", "minerWorkMean"):
        difference = abs(after[key] - before[key]) / before[key] if before[key] else (0.0 if not after[key] else None)
        capacity_changes[key] = difference
        if difference is None or difference > limits["capacityDifferenceFraction"] + 1e-12:
            result["reasons"].append(key + "_confounded")
    result["metrics"]["deltas"]["capacityFractions"] = capacity_changes
    if result["reasons"]:
        return result
    change = after["throughput"] / before["throughput"] - 1
    cpu_allowance = max(limits["cpuAbsoluteIncrease"], limits["cpuRelativeIncrease"] * before["roomCpuMean"])
    deltas = {
        "capacityFractions": capacity_changes,
        "throughputFraction": change,
        "spawnShortfallShare": after["spawnShortfallShare"] - before["spawnShortfallShare"],
        "roomCpuMean": after["roomCpuMean"] - before["roomCpuMean"],
        "bucketDepletion": max(0, -after["bucketDelta"]) - max(0, -before["bucketDelta"]),
        "bucketExcursion": after["bucketExcursion"] - before["bucketExcursion"],
    }
    guards = {
        "spawnShortfall": deltas["spawnShortfallShare"] <= limits["spawnShortfallIncrease"] + 1e-12,
        "roomCpu": deltas["roomCpuMean"] <= cpu_allowance + 1e-12,
        "bucketDepletion": deltas["bucketDepletion"] <= limits["bucketDepletionIncrease"] + 1e-12,
        "bucketExcursion": deltas["bucketExcursion"] <= limits["bucketExcursionIncrease"] + 1e-12,
        "roomCpuAllowance": cpu_allowance,
    }
    result["metrics"].update(deltas=deltas, guards=guards)
    regressions = [reason for key, reason in (
        ("spawnShortfall", "spawn_shortfall_regressed"), ("roomCpu", "room_cpu_regressed"),
        ("bucketDepletion", "bucket_depletion_regressed"), ("bucketExcursion", "bucket_excursion_regressed"),
    ) if not guards[key]]
    if change <= -limits["rollbackFraction"] + 1e-12:
        regressions.insert(0, "throughput_regressed")
    if regressions:
        result.update(decision="rollback", reasons=regressions)
    elif change >= limits["improvementFraction"] - 1e-12:
        result.update(decision="keep", reasons=["throughput_improved"])
    else:
        result.update(decision="observe", reasons=["throughput_inconclusive"], resample=True)
    return result
