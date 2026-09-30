#!/usr/bin/env python3
"""Single-room self-evolution controller. AI reasoning runs in the existing Codex
scheduled job; this deterministic controller owns evidence, checks and uploads.
No new model key, credential destination, shell-generated patch or daemon.
"""
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
GAME = ROOT / 'new-colony'
sys.path.insert(0, str(GAME))
from screeps_api import ScreepsAPI, APIError, MODULES
from evolution_evaluation import evaluate, validate_baseline

RECORDS = ROOT / 'operations/evolution'
STATE = RECORDS / 'state.json'
CACHE = GAME / 'state/evolution'
POLICY = GAME / 'hauler-policy.js'
CHECKS = [('npm','run','test:evolution'), ('npm','run','test:hauler'), ('npm','run','test:api')]


def now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00','Z')


def atomic(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(dir=path.parent, prefix='.evolution-')
    try:
        with os.fdopen(fd, 'w') as f:
            json.dump(value, f, ensure_ascii=False, indent=2, allow_nan=False)
            f.write('\n'); f.flush(); os.fsync(f.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name): os.unlink(name)


def read(path, default=None):
    return json.loads(path.read_text()) if path.exists() else default


@contextmanager
def locked():
    CACHE.mkdir(parents=True, exist_ok=True)
    with (CACHE/'workflow.lock').open('w') as handle:
        try: fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError: raise ValueError('Another evolution controller is running')
        yield


def sources():
    return {n:(GAME/(n+'.js')).read_text() for n in MODULES}


def hashes(code):
    return {n:hashlib.sha256(code[n].encode()).hexdigest() for n in MODULES if n in code}


def config():
    # Read only the generated literal, never evaluate model-supplied JavaScript.
    s=POLICY.read_text(); m=re.search(r'Object.freeze\((\{[^\n]+\})\)',s)
    if not m: raise ValueError('Policy module has no canonical config')
    return json.loads(m.group(1))


def set_config(c):
    text=POLICY.read_text()
    updated,n=re.subn(r'Object.freeze\(\{[^\n]+\}\)',lambda _: 'Object.freeze('+json.dumps(c,separators=(',',':'))+')',text,count=1)
    if n!=1: raise ValueError('Policy config replacement failed')
    POLICY.write_text(updated)


def save(state):
    state['updatedAt']=now()
    atomic(STATE,state)
    atomic(RECORDS/'experiments'/(state['id']+'.json'),state)


def prepare_policy(state,c):
    old=POLICY.read_text();code=sources()
    rendered=re.sub(r'Object.freeze\(\{[^\n]+\}\)',lambda _: 'Object.freeze('+json.dumps(c,separators=(',',':'))+')',old,count=1)
    code['hauler-policy']=rendered
    atomic(CACHE/(state['id']+'-preparing.json'),{'policy':old})
    state['localPreparation']={'targetHashes':hashes(code),'previousPhase':state['phase']}
    state['phase']='preparing';save(state)
    POLICY.write_text(rendered)
    return old


def abort_preparation(state,old):
    POLICY.write_text(old);state['phase']=state['localPreparation']['previousPhase']
    state.pop('localPreparation');save(state)


def recover_preparation(client,state):
    preflight(client,state,require_local=False)
    current=hashes(sources());preparation=state['localPreparation']
    if current not in (state['deployedHashes'],preparation['targetHashes']):
        raise ValueError('Interrupted preparation contains foreign local edits; no files restored')
    previous=read(CACHE/(state['id']+'-preparing.json'))
    if not previous:raise ValueError('Interrupted preparation snapshot missing')
    restored=sources();restored['hauler-policy']=previous['policy']
    if hashes(restored)!=state['deployedHashes']:raise ValueError('Preparation snapshot does not match deployed code')
    abort_preparation(state,previous['policy'])
    return {'phase':state['phase'],'action':'recovered-local-preparation'}


def checks():
    results=[]
    for command in CHECKS:
        run=subprocess.run(command,cwd=ROOT,text=True,capture_output=True)
        results.append({'command':' '.join(command),'passed':run.returncode==0})
        if run.returncode:
            # Offline checks contain no credential requests.
            raise ValueError('Check failed: '+' '.join(command)+'\n'+(run.stdout+run.stderr)[-3000:])
    return results


def preflight(client,state=None,require_local=True):
    if client.identity().get('username')!='AdamZmy': raise ValueError('Unexpected game identity')
    remote=client.request('/api/user/code',{'branch':'frontier24'})
    if remote.get('branch')!='frontier24': raise ValueError('Unexpected branch')
    code=remote['modules']
    if state and hashes(code)!=state['deployedHashes']:
        raise ValueError('Remote game code changed outside this experiment; stop and reconcile before resampling')
    if require_local and state and hashes(sources())!=state['deployedHashes']:
        raise ValueError('Local managed game modules have unrecorded changes; keep ownership and do not upload')
    return code


def deploy(client,state,phase):
    # Record target before POST. A crash or uncertain response is recovered by
    # code readback, never by retrying an upload without reconciling it.
    state['pending']={'phase':phase,'targetHashes':hashes(sources()),'config':config(),'at':now()}
    state['phase']='deploying'; save(state)
    result=client.deploy(apply=True,expected_hashes=state['deployedHashes'])
    if result['status'] not in ('verified','unchanged'): raise ValueError('Deployment was not verified')
    pending=state.pop('pending');state.pop('localPreparation',None);state['phase']=phase;state['config']=pending['config']
    state['deployedHashes']=pending['targetHashes']
    state.setdefault('deployments',[]).append({'at':now(),'phase':phase,'status':result['status'],
        'changedModules':result.get('changed_modules',[]),'hashes':state['deployedHashes']})
    save(state)


def recover(client,state):
    code=preflight(client,require_local=False); h=hashes(code);p=state['pending']
    if h==p['targetHashes']:
        if hashes(sources())!=h: raise ValueError('Remote target verified; local files differ. Reconcile local sources first')
        state['phase']=p['phase'];state['config']=p['config'];state['deployedHashes']=h
        state.pop('pending');state.pop('localPreparation',None);state.setdefault('deployments',[]).append({'at':now(),'phase':state['phase'],'status':'recovered-by-readback','hashes':h});save(state)
    else:
        raise ValueError('Uncertain deployment did not match target. No automatic POST retry; inspect remote backup and local files')
    return {'phase':state['phase'],'action':'recovered'}


def start(client,state=None):
    if state and state['phase'] not in ('kept','rolled_back','inconclusive','invalid_baseline'):
        raise ValueError('One experiment is already active')
    code=preflight(client,state)
    c=config();weight=c['batchWeight']
    if c['room']!='W21N26' or c['window']!=1500 or c['warmup']!=300: raise ValueError('Initial config is outside v1 scope')
    incumbent=sources() if any(n not in code for n in MODULES) else {n:code[n] for n in MODULES}
    ident='hauler-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    c.update(id=ident,stage='baseline',revision=ident+'-baseline',variant='batch-preference' if weight else 'control')
    old=prepare_policy(state,c) if state else POLICY.read_text()
    if not state:set_config(c)
    try: verified_checks=checks()
    except Exception:
        if state:abort_preparation(state,old)
        else:POLICY.write_text(old)
        raise
    CACHE.mkdir(parents=True,exist_ok=True)
    # Only managed modules, no headers/credentials. Token check before snapshot.
    if client.token in json.dumps(code): raise ValueError('Code snapshot rejected: credential data')
    snapshot=CACHE/(ident+'-incumbent.json')
    atomic(snapshot,{'modules':incumbent})
    state={'schemaVersion':1,'id':ident,'room':'W21N26','phase':'starting','createdAt':now(),'config':c,
        'deployedHashes':hashes(code),'incumbentHashes':hashes(incumbent),'checks':verified_checks,
        'baseline':None,'trial':None,'proposal':None,'attempt':1,'decisions':[],'lastTick':None,'incumbentWeight':weight}
    atomic(CACHE/(ident+'-preparing.json'),{'policy':old})
    state['localPreparation']={'targetHashes':hashes(sources()),'previousPhase':'starting'}
    deploy(client,state,'baseline')
    return {'phase':'baseline','id':ident,'action':'collect','window':1500}


def proposal_valid(p):
    if not isinstance(p,dict) or set(p)!={'hypothesis','evidence','alternatives','batchWeight'}:
        raise ValueError('Proposal requires exactly hypothesis, evidence, alternatives, batchWeight')
    if not isinstance(p['hypothesis'],str) or not 10<=len(p['hypothesis'])<=3000: raise ValueError('Hypothesis missing or too long')
    if not isinstance(p['evidence'],list) or not 1<=len(p['evidence'])<=10 or any(not isinstance(x,str) or len(x)>2000 for x in p['evidence']): raise ValueError('Bounded evidence required')
    if not isinstance(p['alternatives'],list) or not 1<=len(p['alternatives'])<=2 or any(not isinstance(x,str) or len(x)>2000 for x in p['alternatives']): raise ValueError('Choose from at most two explained alternatives')
    if type(p['batchWeight']) not in (int,float) or not 0<=p['batchWeight']<=2: raise ValueError('batchWeight must be in [0,2]')
    return p


def propose(client,state,path):
    if state['phase']!='diagnose': raise ValueError('A complete comparable baseline is required before proposing')
    if validate_baseline(state['baseline'])['decision']!='ready': raise ValueError('Baseline failed independent evidence validation')
    p=proposal_valid(read(path));preflight(client,state)
    if p['batchWeight']==state['incumbentWeight']: raise ValueError('Candidate is identical to incumbent')
    attempts=[read(f) for f in sorted((RECORDS/'experiments').glob('*.json'))[-20:]]
    failed=[r for r in attempts if r.get('phase') in ('inconclusive','rolled_back') and r.get('incumbentWeight')==state['incumbentWeight'] and (r.get('proposal') or {}).get('batchWeight')==p['batchWeight'] and not any(d.get('decision')=='invalid' for d in r.get('decisions',[]))]
    if len(failed)>=3: raise ValueError('This candidate weight already failed three paired experiments; select another hypothesis/control value')
    state['proposal']=p;state['phase']='ready';save(state)
    return {'phase':'ready','action':'trial','hypothesis':p['hypothesis']}


def trial(client,state):
    if state['phase']!='ready': raise ValueError('A selected proposal is required')
    if validate_baseline(state['baseline'])['decision']!='ready': raise ValueError('Baseline evidence is not ready')
    preflight(client,state)
    c=config();c.update(stage='trial',revision=state['id']+'-trial-'+str(state['attempt']),variant='batch-preference' if state['proposal']['batchWeight'] else 'control',batchWeight=state['proposal']['batchWeight'])
    old=prepare_policy(state,c)
    try: state['checks']=checks()
    except Exception: abort_preparation(state,old);raise
    deploy(client,state,'trial')
    return {'phase':'trial','action':'observe','warmup':300,'window':1500}


def restore(client,state,final_phase,reason):
    preflight(client,state)
    archive=read(CACHE/(state['id']+'-incumbent.json'))
    if not archive or hashes(archive['modules'])!=state['incumbentHashes']: raise ValueError('Exact incumbent snapshot missing or corrupt; cannot rollback')
    # Guard entire code against foreign edits; restore only changed policy.
    old=POLICY.read_text();target=sources();target['hauler-policy']=archive['modules']['hauler-policy']
    atomic(CACHE/(state['id']+'-preparing.json'),{'policy':old})
    state['localPreparation']={'targetHashes':hashes(target),'previousPhase':state['phase']};state['phase']='preparing';save(state)
    POLICY.write_text(target['hauler-policy'])
    try: state['checks']=checks()
    except Exception: abort_preparation(state,old);raise
    state['rollbackReason']=reason;deploy(client,state,final_phase)
    return {'phase':final_phase,'action':'new-baseline','reason':reason}


def cycle(client,state):
    if state is None: raise ValueError('Run start after setup checks')
    if state['phase']=='deploying': return recover(client,state)
    if state['phase']=='preparing':return recover_preparation(client,state)
    preflight(client,state)
    f=client.memory('shard1','frontier');tick=(f.get('status') or {}).get('tick')
    raw=f.get('evolution') or {}
    sample={k:v for k,v in raw.items() if not k.startswith('_')}
    tick=sample.get('tick',tick)
    world_ticks=[v for v in [(f.get('status') or {}).get('tick'),(f.get('telemetry') or {}).get('tick'),(f.get('energy') or {}).get('tick'),(f.get('apiSnapshot') or {}).get('tick')] if isinstance(v,int)]
    world_tick=max(world_ticks+[tick] if isinstance(tick,int) else world_ticks,default=None)
    if state['phase'] not in ('baseline','trial'):
        if isinstance(tick,int):state['lastTick']=max(tick,state.get('lastTick') or tick)
        save(state);return {'phase':state['phase'],'action':{'diagnose':'read-role-prompts','ready':'trial','kept':'start','rolled_back':'start','inconclusive':'start','invalid_baseline':'start'}.get(state['phase'],'wait'),'tick':world_tick}
    fresh_errors=[key for key,v in (f.get('modules') or {}).items() if v.get('status')=='error' and isinstance(v.get('tick'),int) and v['tick']>=(state.get('lastTick') or 0)]
    if fresh_errors:
        reason='Live module failure: '+','.join(fresh_errors)
        if state['phase']=='trial':return restore(client,state,'rolled_back',reason)
        state['phase']='invalid_baseline';state['baselineFailure']=reason;save(state)
        return {'phase':state['phase'],'action':'diagnose-runtime','reason':reason}
    expected=all(sample.get(k)==state['config'][k] for k in ('id','room','stage','revision'))
    stale=not isinstance(tick,int) or (not sample.get('frozen') and world_tick is not None and world_tick-tick>40)
    if not expected or stale:
        if world_tick is not None:
            state.setdefault('lossSince',world_tick)
            if world_tick-state['lossSince']>=100:
                reason='Fresh world ticks but expected experiment telemetry absent/stale for100ticks'
                if state['phase']=='trial':return restore(client,state,'rolled_back',reason)
                state['phase']='invalid_baseline';state['baselineFailure']=reason;save(state)
                return {'phase':state['phase'],'action':'diagnose-runtime','reason':reason}
        save(state);return {'phase':state['phase'],'action':'wait','reason':'expected collector telemetry not observed','tick':world_tick}
    state.pop('lossSince',None)
    if not isinstance(tick,int): raise ValueError('No verifiable game tick')
    if state.get('lastTick') is not None and tick<=state['lastTick'] and not sample.get('frozen'):
        return {'phase':state['phase'],'action':'inspect-live','reason':'telemetry tick has not advanced; verify a fresh Game API snapshot before inference','tick':tick}
    state['lastTick']=tick;state['observedAt']=now()
    if state['phase'] not in ('baseline','trial'):
        save(state);return {'phase':state['phase'],'action':{'diagnose':'read-role-prompts','ready':'trial','kept':'start','rolled_back':'start','inconclusive':'start','invalid_baseline':'start'}.get(state['phase'],'wait'),'tick':tick}
    c=state['config']
    if any(sample.get(k)!=c[k] for k in ('id','room','stage','revision')):
        save(state);return {'phase':state['phase'],'action':'wait','reason':'game has not executed expected experiment config','tick':tick}
    if state['phase']=='baseline':
        state['baseline']=sample
        if sample.get('invalidReasons'):
            state['phase']='invalid_baseline';save(state)
            return {'phase':state['phase'],'action':'start','reasons':sample['invalidReasons']}
        validation=validate_baseline(sample);state['baselineValidation']=validation
        if validation['decision']=='invalid':state['phase']='invalid_baseline'
        elif validation['decision']=='ready':state['phase']='diagnose'
        elif sample.get('frozen'):state['phase']='invalid_baseline'
        save(state);return {'phase':state['phase'],'action':'read-role-prompts' if state['phase']=='diagnose' else 'start' if state['phase']=='invalid_baseline' else 'wait','tick':tick,'sampleTicks':sample.get('ticks')}
    state['trial']=sample
    verdict=evaluate(state['baseline'],sample)
    state['latestEvaluation']=verdict;save(state)
    if verdict['decision'] in ('rollback','invalid'):
        state['decisions'].append({'at':now(),'tick':tick,**verdict})
        return restore(client,state,'rolled_back','; '.join(verdict['reasons']))
    if verdict['decision']=='keep':
        state['decisions'].append({'at':now(),'tick':tick,**verdict})
        c=config();c.update(stage='retained');prepare_policy(state,c);deploy(client,state,'kept')
        return {'phase':'kept','action':'start','evaluation':verdict}
    if sample.get('complete'):
        state['decisions'].append({'at':now(),'tick':tick,**verdict})
        # Equal windows are restarted with incumbent restored, never pooled with
        # a contaminated or selectively chosen trial. Bound repeated ambiguity.
        return restore(client,state,'inconclusive','No decisive improvement in complete equal windows; acquire a fresh paired baseline')
    return {'phase':'trial','action':'wait','tick':tick,'sampleTicks':sample.get('ticks'),'evaluation':verdict}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command',choices=['status','start','cycle','propose','trial','rollback','defer'])
    parser.add_argument('--file',type=Path)
    args=parser.parse_args()
    try:
        with locked():
            state=read(STATE)
            if args.command=='status': value=state or {'phase':'uninitialized'}
            else:
                client=ScreepsAPI()
                if args.command=='start': value=start(client,state)
                elif args.command=='cycle': value=cycle(client,state)
                elif args.command=='propose':
                    if args.file is None: raise ValueError('--file required')
                    value=propose(client,state,args.file)
                elif args.command=='trial': value=trial(client,state)
                elif args.command=='defer':
                    if state['phase']!='diagnose': raise ValueError('defer requires completed baseline')
                    preflight(client,state);state['phase']='inconclusive';state['deferredReason']='No evidence-supported hypothesis on the allowed control surface';save(state)
                    value={'phase':'inconclusive','action':'start'}
                else: value=restore(client,state,'rolled_back','Operator stopped this candidate')
            print(json.dumps(value,ensure_ascii=False,indent=2,allow_nan=False))
    except (APIError,ValueError,OSError,KeyError,TypeError) as error:
        # Errors from ScreepsAPI are already secret-safe; don't dump raw Memory.
        print(str(error),file=sys.stderr);return 1
    return 0


if __name__=='__main__': sys.exit(main())
