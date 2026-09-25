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
LINK_ROLES = {'hub', 'controller', 'source', 'remote-entry'}


def descriptions(item):
    """Export only public planning semantics, never arbitrary plan/Memory fields."""
    out = {}
    for field in ('label', 'purpose', 'targetTag', 'fallbackTargetTag', 'flow', 'serviceArea', 'sourceId', 'serviceMode'):
        if isinstance(item.get(field), str):
            out[field] = item[field][:500]
    if item.get('linkRole') in LINK_ROLES:
        out['linkRole'] = item['linkRole']
    if isinstance(item.get('serviceSpot'), dict):
        out['serviceSpot'] = position(item['serviceSpot'])
    return out


def reservation(item):
    if item.get('type') != 'link':
        raise ValueError('Only explicit optional Link reservations are supported')
    if item.get('enabled') is True:
        raise ValueError('Enabled links must be published as formal structures, not reservations')
    out = dict(position(item), type='link', optional=True, enabled=False,
               tag=str(item.get('tag', ''))[:100], **descriptions(item))
    rcl = item.get('rcl', item.get('minRcl'))
    if rcl is not None:
        if type(rcl) is not int or not 5 <= rcl <= 8:
            raise ValueError('Invalid optional Link controller level')
        out['rcl'] = rcl
    activation = item.get('activation', {})
    if not isinstance(activation, dict):
        raise ValueError('Invalid optional Link activation conditions')
    out['activation'] = {}
    for field in ('requiresActiveRemote', 'requiresMeasuredBenefit'):
        if type(activation.get(field)) is bool:
            out['activation'][field] = activation[field]
    for field in ('minSavedCarry', 'minSavedTicks', 'minSavedDistance', 'minExpectedEnergyPerTick'):
        value = activation.get(field)
        if isinstance(value, (int, float)) and not isinstance(value, bool) and value >= 0:
            out['activation'][field] = value
    notes = activation.get('notes', [])
    if isinstance(notes, str):
        notes = [notes]
    if not isinstance(notes, list):
        raise ValueError('Invalid activation notes')
    out['activation']['notes'] = [note[:500] for note in notes if isinstance(note, str)][:12]
    return out


def regional_strategy(intel_payload):
    """Local recommendations joined to dated API intel, not enabled game policy."""
    if not intel_payload:
        return None
    intel = intel_payload.get('intel', {})
    if 'W21N26' not in intel:
        raise ValueError('Regional context requires main-room intel')
    paths = {'W21N26': ['W21N26']}
    queue = ['W21N26']
    for room in queue:
        for other in intel.get(room, {}).get('exits', {}).values():
            if other not in paths:
                paths[other] = paths[room] + [other]
                if other in intel:
                    queue.append(other)
    recommendations = [
        ('W22N26', '第二基地首要重评对象 / 阶段外矿', '邻接双矿；先完成新布局与支援路线验证，再确定殖民或外矿分工。'),
        ('W21N25', '近外矿 / 南向与东向走廊', '邻接单矿；连接南部双矿与东侧走廊，入口运输先按实际产量核算。'),
        ('W23N26', '西向第二基地备选', '经 W22N26 到达；基地选址需比较控制器运输与支援成本。'),
        ('W21N24', '南向第二基地备选', '经 W21N25 到达；无沼泽记录仍需核验采运与防守路径。'),
    ]
    rooms = []
    for name, role, note in recommendations:
        if name not in intel or name not in paths:
            continue
        observed = intel[name]
        rooms.append({'name': name, 'role': role, 'note': note, 'status': 'proposal',
                      'sources': len(observed.get('sources', [])), 'route': paths[name],
                      'seenTick': observed.get('seen')})
    return {'status': 'proposal', 'observedAt': intel_payload.get('fetchedAt'),
            'source': 'API 邻接情报 + 本地用途建议', 'rooms': rooms,
            'note': '这些是候选用途，未表示已开矿或已殖民；每房 seen tick 独立。Link 仅能在同房间传能。'}


def matched_design(plan, design):
    if design is None:
        return plan
    revision = plan.get('layoutRevision')
    if not revision or design.get('layoutRevision') != revision:
        raise ValueError('Design layoutRevision does not match API execution plan')
    fields = ('type', 'x', 'y', 'rcl', 'tag')
    identities = lambda value: [tuple(item.get(field) for field in fields) for item in value.get('structures', [])]
    if identities(plan) != identities(design):
        raise ValueError('Design structures do not exactly match API execution plan geometry and RCL')
    return design


def provenance(item):
    out = {}
    for field in ('internationalCommit', 'overmindCommit', 'terrainHash'):
        value = item.get(field)
        if isinstance(value, str) and len(value) <= 128:
            out[field] = value
    if type(item.get('tick')) is int:
        out['tick'] = item['tick']
    out['reused'] = [value[:200] for value in item.get('reused', []) if isinstance(value, str)][:12]
    return out


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


def build(plan, snapshot, intel_payload=None, design=None, preview=False):
    semantic = matched_design(plan, design)
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
    for item, description in zip(plan['structures'], semantic['structures']):
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
        out.update(descriptions(description))
        buildings.append(out)
    objects = snapshot['objects']
    natural = {'sources': [position(s) for s in objects['sources']],
               'controller': position(objects['controller'])}
    if objects.get('mineral'):
        natural['mineral'] = dict(position(objects['mineral']), mineralType=objects['mineral'].get('mineralType', ''))
    natural['structures'] = [dict(s, status='built') for s in built if key(s) not in seen]
    natural['structures'] += [dict(s, status='site') for s in sites if key(s) not in seen]
    revision = hashlib.sha256(json.dumps(plan, sort_keys=True, separators=(',', ':')).encode()).hexdigest()[:16]
    optional = [reservation(item) for item in semantic.get('optionalReservations', [])]
    for item in optional:
        if int(terrain[item['y'] * 50 + item['x']]) & 1:
            raise ValueError('Optional reservation on terrain wall')
    routes = []
    for route in semantic.get('roadRoutes', []):
        route_out = {field: route[field] for field in ('id', 'kind', 'purpose', 'fromTag', 'toTag')
                     if isinstance(route.get(field), str)}
        route_out['tiles'] = [tile for tile in route.get('tiles', []) if type(tile) is int and 0 <= tile < 2500]
        route_out['complete'] = route.get('complete') is True
        routes.append(route_out)
    room = {'name': name, 'currentRcl': snapshot['currentRcl'], 'terrain': terrain, 'objects': natural,
            'plan': {'version': plan['version'], 'revision': revision,
                     'layoutRevision': str(plan.get('layoutRevision', ''))[:100], 'createdTick': plan.get('created'),
                     'semanticSource': '本地候选预览，尚未由最终 API 回读确认' if preview else '本地复核设计，已与 API 执行规划逐项核对' if design is not None else 'API 规划快照',
                     'provenance': provenance(semantic.get('provenance', {})),
                     'updatedAt': snapshot['capturedAt'], 'buildings': buildings,
                     'optionalReservations': optional, 'roadRoutes': routes, 'notes': [
                         '等级数字表示规划最早建造等级；还需满足储备、施工优先级和建筑配额。',
                         '每 10 tick 检查施工，每批最多放置 5 个工地；每房最多 8 个工地，道路最多 3 个。',
                         '防护按本次规划展示；静态通路校验不等于实战防御效果。',
                         '已建与施工状态来自标注的 API 快照；当前等级随监控遥测更新。',
                         '此图是本地候选预览，尚未确认成为游戏执行规划。' if preview else '角色、用途与可选预留来自本地复核设计；位置与等级已同 API 执行规划逐项匹配。' if design is not None else '角色和可选预留按本次规划快照提供的字段展示。']},
            'snapshot': {'tick': snapshot['tick'], 'capturedAt': snapshot['capturedAt'], 'status': 'fresh',
                         'structures': built, 'constructionSites': sites}}
    return {'schemaVersion': 2, 'generatedAt': datetime.now(timezone.utc).isoformat(timespec='seconds'),
            'source': 'local-candidate-preview' if preview else 'screeps-api',
            'publicationState': 'candidate-preview' if preview else 'verified-export',
            'shard': 'shard1', 'primaryRoom': name, 'rooms': {name: room},
            'regionalStrategy': regional_strategy(intel_payload)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan', required=True, type=Path)
    parser.add_argument('--snapshot', required=True, type=Path)
    parser.add_argument('--intel', type=Path, help='Optional dated API intel for advisory regional context')
    parser.add_argument('--design', type=Path, help='Reviewed local semantics; geometry/RCL/revision must exactly match API plan')
    parser.add_argument('--preview', action='store_true', help='Label an unpublished local candidate; output must stay outside public/')
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'public/data/room-layouts.json')
    args = parser.parse_args()
    public_dir = Path(__file__).resolve().parents[1] / 'public'
    if args.preview and public_dir in args.output.resolve().parents:
        raise ValueError('Candidate previews must be written outside public/')
    payload = build(json.loads(args.plan.read_text()), json.loads(args.snapshot.read_text()),
                    json.loads(args.intel.read_text()) if args.intel else None,
                    json.loads(args.design.read_text()) if args.design else None, preview=args.preview)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':')) + '\n')
    room = payload['rooms'][payload['primaryRoom']]
    print(json.dumps({'file': str(args.output), 'tick': room['snapshot']['tick'],
                      'rcl': room['currentRcl'], 'counts': dict(Counter(s['type'] for s in room['plan']['buildings'])),
                      'status': dict(Counter(s['status'] for s in room['plan']['buildings']))}))


if __name__ == '__main__':
    main()
