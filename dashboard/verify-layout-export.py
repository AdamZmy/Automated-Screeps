#!/usr/bin/env python3
"""Offline public-export checks. No network, credentials, or game operations."""
import copy
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('layout_export', ROOT / 'tools/build-room-layouts.py')
EXPORT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(EXPORT)
PAYLOAD = json.loads((ROOT / 'public/data/room-layouts.json').read_text())
ROOM = PAYLOAD['rooms'][PAYLOAD['primaryRoom']]


class ExportTests(unittest.TestCase):
    def setUp(self):
        self.plan = {'version': 5, 'layoutRevision': 'reviewed-test', 'complete': True, 'structures': copy.deepcopy(ROOM['plan']['buildings'])}
        self.snapshot = dict(copy.deepcopy(ROOM['snapshot']), name=ROOM['name'],
                             currentRcl=ROOM['currentRcl'], terrain=ROOM['terrain'], objects=ROOM['objects'])
        links = [item for item in self.plan['structures'] if item['type'] == 'link']
        links[0].update(linkRole='hub', label='核心 Link', purpose='供仓库搬运',
                        targetTag='controller-link', serviceArea='核心', serviceSpot={'x': 20, 'y': 27}, privateMemory='DO_NOT_PUBLISH')
        tile = next(i for i, cell in enumerate(ROOM['terrain']) if not (int(cell) & 1) and i // 50 > 1 and i % 50 > 1)
        self.optional = {'type': 'link', 'x': tile % 50, 'y': tile // 50, 'rcl': 8,
                         'tag': 'remote-entry-west', 'linkRole': 'remote-entry', 'label': '西入口预留',
                         'optional': True, 'enabled': False, 'privateMemory': 'DO_NOT_PUBLISH',
                         'activation': {'requiresActiveRemote': True, 'minSavedCarry': 6,
                                        'notes': ['完整路线已验证'], 'secret': 'DO_NOT_PUBLISH'}}
        self.plan['optionalReservations'] = [self.optional]

    def test_roles_and_optional_are_whitelisted_and_separate(self):
        exported = EXPORT.build(self.plan, self.snapshot)
        plan = exported['rooms'][ROOM['name']]['plan']
        self.assertEqual(len(plan['buildings']), len(self.plan['structures']))
        self.assertEqual(len(plan['optionalReservations']), 1)
        link = next(item for item in plan['buildings'] if item.get('linkRole') == 'hub')
        self.assertEqual(link['purpose'], '供仓库搬运')
        self.assertEqual(link['serviceSpot'], {'x': 20, 'y': 27})
        self.assertFalse(plan['optionalReservations'][0]['enabled'])
        self.assertEqual(plan['optionalReservations'][0]['activation']['minSavedCarry'], 6)
        self.assertNotIn('DO_NOT_PUBLISH', json.dumps(exported))

    def test_enabled_reservation_is_rejected(self):
        self.optional['enabled'] = True
        with self.assertRaisesRegex(ValueError, 'formal structures'):
            EXPORT.build(self.plan, self.snapshot)

    def test_bad_coordinate_is_rejected(self):
        self.optional['x'] = 50
        with self.assertRaisesRegex(ValueError, 'coordinate'):
            EXPORT.build(self.plan, self.snapshot)

    def test_design_supplies_only_semantics(self):
        design = copy.deepcopy(self.plan)
        lean = copy.deepcopy(self.plan)
        lean['structures'] = [{field: item[field] for field in ('type', 'x', 'y', 'rcl', 'tag') if field in item}
                              for item in lean['structures']]
        lean.pop('optionalReservations')
        design['structures'][0]['status'] = 'built'
        design['currentRcl'] = 8
        exported = EXPORT.build(lean, self.snapshot, design=design)['rooms'][ROOM['name']]
        self.assertEqual(exported['currentRcl'], self.snapshot['currentRcl'])
        self.assertEqual(len(exported['plan']['optionalReservations']), 1)
        self.assertTrue(any(item.get('purpose') == '供仓库搬运' for item in exported['plan']['buildings']))
        built = {(item['type'], item['x'], item['y']) for item in self.snapshot['structures']}
        for item in exported['plan']['buildings']:
            self.assertEqual(item['status'] == 'built', (item['type'], item['x'], item['y']) in built)

    def test_mismatched_design_revision_or_geometry_rejected(self):
        for field, value in [('layoutRevision', 'other'), ('x', 49), ('rcl', 8), ('tag', 'other-tag')]:
            with self.subTest(field=field):
                design = copy.deepcopy(self.plan)
                if field == 'layoutRevision':
                    design[field] = value
                else:
                    design['structures'][0][field] = value
                with self.assertRaisesRegex(ValueError, 'match'):
                    EXPORT.build(self.plan, self.snapshot, design=design)

    def test_preview_is_never_described_as_verified_api_plan(self):
        exported = EXPORT.build(self.plan, self.snapshot, design=self.plan, preview=True)
        self.assertEqual(exported['publicationState'], 'candidate-preview')
        self.assertEqual(exported['source'], 'local-candidate-preview')
        semantics = exported['rooms'][ROOM['name']]['plan']['semanticSource']
        self.assertIn('尚未', semantics)

    def test_regional_paths_follow_observed_exits(self):
        intel = {'fetchedAt': '2026-09-25T06:40:33Z', 'intel': {
            'W21N26': {'exits': {'7': 'W22N26', '5': 'W21N25'}},
            'W22N26': {'sources': [{}, {}], 'exits': {'3': 'W21N26', '7': 'W23N26'}, 'seen': 123},
            'W21N25': {'sources': [{}], 'exits': {'1': 'W21N26', '5': 'W21N24'}, 'seen': 125},
            'W23N26': {'sources': [{}, {}], 'exits': {}, 'seen': 121},
            'W21N24': {'sources': [{}, {}], 'exits': {}, 'seen': 120}}}
        exported = EXPORT.build(self.plan, self.snapshot, intel)
        strategy = exported['regionalStrategy']
        self.assertEqual(strategy['status'], 'proposal')
        self.assertEqual(strategy['observedAt'], intel['fetchedAt'])
        rooms = {item['name']: item for item in strategy['rooms']}
        self.assertEqual(rooms['W23N26']['route'], ['W21N26', 'W22N26', 'W23N26'])
        self.assertEqual(rooms['W22N26']['sources'], 2)
        self.assertEqual(rooms['W22N26']['seenTick'], 123)
        self.assertTrue(all(item['status'] == 'proposal' for item in strategy['rooms']))


if __name__ == '__main__':
    unittest.main()
