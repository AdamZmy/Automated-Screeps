#!/usr/bin/env python3
"""Publish a whitelisted, offline room-plan snapshot. Never reads credentials."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

TYPES = {'spawn', 'extension', 'road', 'constructedWall', 'rampart', 'keeperLair',
         'portal', 'controller', 'link', 'storage', 'tower', 'observer', 'powerBank',
         'powerSpawn', 'extractor', 'lab', 'terminal', 'container', 'nuker',
         'factory', 'invaderCore'}


def position(item):
    for key in ('x', 'y'):
        if type(item.get(key)) is not int or not 0 <= item[key] < 50:
            raise ValueError('Invalid room coordinate')
    return {key: item[key] for key in ('x', 'y')}


def structure(item):
    if item.get('type') not in TYPES:
        raise ValueError('Unknown structure type')
    out = dict(position(item), type=item['type'])
    for key in ('progress', 'progressTotal'):
        if isinstance(item.get(key), (int, float)):
            out[key] = item[key]
    return out


def key(item):
    return item['type'], item['x'], item['y']


def conditions(item):
    if item['type'] == 'road':
        if item.get('roadClass') == 'economy':
            return ['经济干线优先施工；道路工地同时最多 3 个']
        return ['至少 RCL 4', '经济干线全部建成', 'Storage 储能 ≥20,000']
    if item['type'] == 'rampart':
        return ['Storage 储能 ≥10,000']
    if item['type'] in ('lab', 'factory', 'nuker', 'powerSpawn', 'extractor'):
        return ['Storage 储能 ≥40,000']
    return []


def build(plan, snapshot):
    name = snapshot['name']
    if name != 'W21N26':
        raise ValueError('This exporter currently targets the main colony W21N26')
    terrain = snapshot['terrain']
    if not isinstance(terrain, str) or len(terrain) != 2500 or set(terrain) - set('0123'):
        raise ValueError('Expected 50×50 row-major terrain')
    if not plan.get('complete') or not plan.get('structures'):
        raise ValueError('Cannot publish an incomplete or absent layout')
    if type(snapshot.get('tick')) is not int or type(snapshot.get('currentRcl')) is not int:
        raise ValueError('Missing observation tick or current controller level')
    built = [structure(s) for s in snapshot['structures']]
    sites = [structure(s) for s in snapshot['constructionSites']]
    built_keys, site_keys = set(map(key, built)), set(map(key, sites))
    buildings, seen = [], set()
    for item in plan['structures']:
        out = structure(item)
        identity = key(out)
        if identity in seen:
            raise ValueError('Duplicate structure in blueprint')
        seen.add(identity)
        if type(item.get('rcl')) is not int or not 1 <= item['rcl'] <= 8:
            raise ValueError('Invalid planned controller level')
        if int(terrain[item['y'] * 50 + item['x']]) & 1 and item['type'] != 'extractor':
            raise ValueError('Blueprint structure on terrain wall')
        out.update(id='{}-{}-{}'.format(*identity), rcl=item['rcl'],
                   status='built' if identity in built_keys else 'site' if identity in site_keys else 'planned',
                   conditions=conditions(item))
        for field in ('tag', 'priority', 'roadClass'):
            if field in item:
                out[field] = item[field]
        buildings.append(out)
    objects = snapshot['objects']
    natural = {'sources': [position(s) for s in objects['sources']],
               'controller': position(objects['controller'])}
    if objects.get('mineral'):
        natural['mineral'] = dict(position(objects['mineral']), mineralType=objects['mineral'].get('mineralType', ''))
    natural['structures'] = [dict(s, status='built') for s in built if key(s) not in seen]
    natural['structures'] += [dict(s, status='site') for s in sites if key(s) not in seen]
    revision = hashlib.sha256(json.dumps(plan, sort_keys=True, separators=(',', ':')).encode()).hexdigest()[:16]
    room = {'name': name, 'currentRcl': snapshot['currentRcl'], 'terrain': terrain, 'objects': natural,
            'plan': {'version': plan['version'], 'revision': revision, 'createdTick': plan.get('created'),
                     'updatedAt': snapshot['capturedAt'], 'buildings': buildings, 'notes': [
                         '等级数字表示规划最早建造等级；还需满足储备、施工优先级和建筑配额。',
                         '每 10 tick 检查施工，每批最多放置 5 个工地；每房最多 8 个工地，道路最多 3 个。',
                         'Rampart 包括关键建筑防护与外围布点；尚未验证防线完全封闭。',
                         '已建与施工状态来自标注的 API 快照；当前等级随监控遥测更新。']},
            'snapshot': {'tick': snapshot['tick'], 'capturedAt': snapshot['capturedAt'], 'status': 'fresh',
                         'structures': built, 'constructionSites': sites}}
    return {'schemaVersion': 1, 'generatedAt': datetime.now(timezone.utc).isoformat(timespec='seconds'),
            'source': 'screeps-api', 'shard': 'shard1', 'primaryRoom': name, 'rooms': {name: room}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan', required=True, type=Path)
    parser.add_argument('--snapshot', required=True, type=Path)
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'public/data/room-layouts.json')
    args = parser.parse_args()
    payload = build(json.loads(args.plan.read_text()), json.loads(args.snapshot.read_text()))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':')) + '\n')
    room = payload['rooms'][payload['primaryRoom']]
    print(json.dumps({'file': str(args.output), 'tick': room['snapshot']['tick'],
                      'rcl': room['currentRcl'], 'counts': dict(Counter(s['type'] for s in room['plan']['buildings'])),
                      'status': dict(Counter(s['status'] for s in room['plan']['buildings']))}))


if __name__ == '__main__':
    main()
