#!/usr/bin/env python3
"""Controller integration with a fake Screeps service and isolated workspace."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import evolution_workflow as w


class FakeAPI:
    token='OFFLINE-FAKE-TOKEN'
    def __init__(self,code):
        self.remote=copy.deepcopy(code);self.memory_value={};self.posts=0;self.uncertain=False
    def identity(self): return {'username':'AdamZmy'}
    def request(self,url,args): return {'branch':'frontier24','modules':copy.deepcopy(self.remote)}
    def memory(self,*args): return copy.deepcopy(self.memory_value)
    def deploy(self,apply=False,expected_hashes=None):
        if expected_hashes is not None and w.hashes(self.remote)!=expected_hashes: raise w.APIError('Remote changed at POST preflight')
        self.posts+=1;self.remote=w.sources()
        if self.uncertain: raise w.APIError('Uncertain POST')
        return {'status':'verified','changed_modules':['hauler-policy']}


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        root=Path(self.tmp.name);game=root/'new-colony';game.mkdir()
        for n in w.MODULES: (game/(n+'.js')).write_text((w.GAME/(n+'.js')).read_text())
        for key,value in {'ROOT':root,'GAME':game,'RECORDS':root/'operations/evolution','STATE':root/'operations/evolution/state.json','CACHE':game/'state/evolution','POLICY':game/'hauler-policy.js'}.items():
            p=patch.object(w,key,value);p.start();self.addCleanup(p.stop)
        p=patch.object(w,'checks',return_value=[{'command':'isolated-check','passed':True}]);p.start();self.addCleanup(p.stop)
        self.api=FakeAPI(w.sources());self.incumbent=w.POLICY.read_text()
        w.start(self.api)
    def state(self): return w.read(w.STATE)
    def sample(self,tick=100,complete=True,invalid=None):
        s=self.state();c=s['config']
        return {**{k:c[k] for k in ('id','room','stage','revision')},'tick':tick,'complete':complete,'invalidReasons':invalid or [],'signature':{'rcl':5},'ticks':1500 if complete else 100,'haulerTicks':3000 if complete else 200,'delivered':9000,'deliveryEvents':100,'travelTicks':1200 if complete else 80,'payloadSum':900 if complete else 60,'idle':0,'waitingPickup':0,'blocked':0,'spawnDemandTicks':0,'spawnStarvedTicks':0,'roomCpu':1500 if complete else 100,'cpuTicks':1500 if complete else 100,'errors':0,'bucketStart':9000,'bucketEnd':9000,'bucketMin':8990,'carryTicks':450000 if complete else 30000,'workerWorkTicks':30000 if complete else 2000,'minerWorkTicks':15000 if complete else 1000,'_previous':{'private':'not-public'}}
    def ready(self):
        self.api.memory_value={'evolution':self.sample()};w.cycle(self.api,self.state())
        path=w.CACHE/'proposal.json';w.atomic(path,{'hypothesis':'Larger useful batches should reduce trip costs','evidence':['tick100 sample'],'alternatives':['weight 1','weight 0.5'],'batchWeight':1})
        w.propose(self.api,self.state(),path)
    def test_initial_install_missing_new_modules_keeps_complete_incumbent_snapshot(self):
        self.api.remote.pop('evolution');self.api.remote.pop('hauler-policy');w.STATE.unlink()
        w.start(self.api)
        state=self.state();snapshot=w.read(w.CACHE/(state['id']+'-incumbent.json'))
        self.assertEqual(set(snapshot['modules']),set(w.MODULES));self.assertEqual(w.hashes(snapshot['modules']),state['incumbentHashes'])
    def test_baseline_gate_and_new_tick(self):
        self.api.memory_value={'evolution':self.sample(complete=False)}
        result=w.cycle(self.api,self.state());self.assertEqual(result['action'],'wait')
        self.assertNotIn('_previous',self.state()['baseline'])
        result=w.cycle(self.api,self.state());self.assertIn('not advanced',result['reason'])
        with self.assertRaises(ValueError):w.start(self.api,self.state())
        with self.assertRaises(ValueError):w.trial(self.api,self.state())
    def test_completed_malformed_baseline_cannot_deploy_trial(self):
        sample=self.sample();sample.pop('delivered');self.api.memory_value={'evolution':sample}
        w.cycle(self.api,self.state());self.assertEqual(self.state()['phase'],'invalid_baseline')
        count=self.api.posts
        with self.assertRaises(ValueError):w.trial(self.api,self.state())
        self.assertEqual(count,self.api.posts)
    def test_last_moment_remote_change_blocks_post(self):
        self.ready();count=self.api.posts
        with patch.object(w,'checks',side_effect=lambda: self.api.remote.update(links='changed') or []):
            with self.assertRaises(w.APIError):w.trial(self.api,self.state())
        self.assertEqual(count,self.api.posts)
    def test_interrupted_local_preparation_restores_only_proven_config(self):
        self.ready();state=self.state();c=w.config();c.update(stage='trial',batchWeight=1)
        w.prepare_policy(state,c);self.assertEqual(self.state()['phase'],'preparing')
        count=self.api.posts;w.cycle(self.api,self.state())
        self.assertEqual(self.api.posts,count);self.assertEqual(self.state()['phase'],'ready')
        self.assertEqual(w.hashes(w.sources()),self.state()['deployedHashes'])
    def test_preparation_with_foreign_edit_does_not_restore(self):
        self.ready();state=self.state();c=w.config();c.update(stage='trial',batchWeight=1);w.prepare_policy(state,c)
        (w.GAME/'links.js').write_text('foreign edit')
        with self.assertRaises(ValueError):w.cycle(self.api,self.state())
        self.assertEqual((w.GAME/'links.js').read_text(),'foreign edit')
    def test_frozen_sample_remains_evaluable_after_scheduler_delay(self):
        s=self.sample();s['frozen']=True;self.api.memory_value={'status':{'tick':500},'evolution':s}
        w.cycle(self.api,self.state());self.assertEqual(self.state()['phase'],'diagnose')
        path=w.CACHE/'p.json';w.atomic(path,{'hypothesis':'Large batch preference hypothesis','evidence':['valid baseline'],'alternatives':['weight1'],'batchWeight':1})
        w.propose(self.api,self.state(),path);w.trial(self.api,self.state());s=self.sample(tick=200);s['frozen']=True
        self.api.memory_value={'status':{'tick':1000},'evolution':s}
        with patch.object(w,'evaluate',return_value={'decision':'keep','reasons':['better'],'metrics':{}}):w.cycle(self.api,self.state())
        self.assertEqual(self.state()['phase'],'kept')
    def test_collector_failure_rolls_back_independently(self):
        self.ready();w.trial(self.api,self.state())
        self.api.memory_value={'status':{'tick':200},'modules':{'evolutionBegin':{'status':'error','tick':200}},'evolution':self.sample(tick=100)}
        w.cycle(self.api,self.state());self.assertEqual(self.state()['phase'],'rolled_back')
    def test_fresh_world_missing_telemetry_timeout(self):
        self.ready();w.trial(self.api,self.state())
        self.api.memory_value={'status':{'tick':200}};w.cycle(self.api,self.state())
        self.api.memory_value={'status':{'tick':301}};w.cycle(self.api,self.state())
        self.assertEqual(self.state()['phase'],'rolled_back')
    def test_trial_and_exact_rollback(self):
        self.ready();self.assertEqual(self.state()['phase'],'ready')
        w.trial(self.api,self.state());self.assertEqual(w.config()['stage'],'trial')
        self.assertEqual(w.config()['batchWeight'],1)
        w.restore(self.api,self.state(),'rolled_back','test')
        self.assertEqual(w.POLICY.read_text(),self.incumbent)
        self.assertEqual(self.state()['phase'],'rolled_back')
    def test_candidate_room_gate(self):
        code=w.POLICY.read_text();self.assertIn("room.name!==config.room",code);self.assertIn('priority<=2',code)
        for weight in [-1,3,float('nan'),True]:
            with self.assertRaises(ValueError):w.proposal_valid({'hypothesis':'Test hypothesis','evidence':['x'],'alternatives':['x'],'batchWeight':weight})
    def test_uncertain_write_recovery_never_reposts(self):
        self.ready();self.api.uncertain=True
        with self.assertRaises(w.APIError):w.trial(self.api,self.state())
        count=self.api.posts;self.assertEqual(self.state()['phase'],'deploying')
        w.cycle(self.api,self.state());self.assertEqual(self.api.posts,count)
        self.assertEqual(self.state()['phase'],'trial')
    def test_foreign_code_blocks_upload(self):
        self.ready();self.api.remote['links']+='// foreign edit'
        count=self.api.posts
        with self.assertRaises(ValueError):w.trial(self.api,self.state())
        self.assertEqual(count,self.api.posts)
    def test_confounded_baseline_restarts(self):
        self.api.memory_value={'evolution':self.sample(invalid=['rcl-changed'])}
        w.cycle(self.api,self.state());self.assertEqual(self.state()['phase'],'invalid_baseline')
        w.start(self.api,self.state());self.assertEqual(self.state()['phase'],'baseline')
    def test_inconclusive_restores_then_new_pair(self):
        self.ready();w.trial(self.api,self.state());self.api.memory_value={'evolution':self.sample(tick=200)}
        with patch.object(w,'evaluate',return_value={'decision':'observe','reasons':['neutral'],'metrics':{}}):
            w.cycle(self.api,self.state())
        self.assertEqual(self.state()['phase'],'inconclusive');self.assertEqual(w.POLICY.read_text(),self.incumbent)
    def test_keep_next_baseline_keeps_winning_parameter(self):
        self.ready();w.trial(self.api,self.state());self.api.memory_value={'evolution':self.sample(tick=200)}
        with patch.object(w,'evaluate',return_value={'decision':'keep','reasons':['better'],'metrics':{}}):w.cycle(self.api,self.state())
        self.assertEqual(w.config()['stage'],'retained');self.assertEqual(self.state()['phase'],'kept')
        w.start(self.api,self.state());self.assertEqual(w.config()['batchWeight'],1);self.assertEqual(w.config()['variant'],'batch-preference')
    def test_corrupt_rollback_snapshot_refuses(self):
        self.ready();w.trial(self.api,self.state());state=self.state()
        w.atomic(w.CACHE/(state['id']+'-incumbent.json'),{'modules':{}})
        with self.assertRaises(ValueError):w.restore(self.api,state,'rolled_back','test')


if __name__=='__main__': unittest.main()
