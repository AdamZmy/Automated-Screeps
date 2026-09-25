'use strict';
// Focused integration checks for one-time static plan activation. Geometry and
// staged RCL checks live in tools/verify-layout-candidate.cjs.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const file=process.argv[2]||path.join(__dirname,'planner.js');
const code=fs.readFileSync(file,'utf8');
const name='W21N26',revision='test-reviewed',id='test-immutable-plan';
const types=['spawn','extension','tower','road','container','storage','link','rampart','lab','terminal','factory','observer','powerSpawn','nuker','extractor'];
const clone=o=>JSON.parse(JSON.stringify(o));
const candidate={version:3,layoutRevision:revision,created:1,roadVersion:1,complete:true,anchor:{x:21,y:28},structures:[
    {type:'spawn',x:21,y:28,rcl:1,tag:'primary'},
    {type:'extension',x:20,y:29,rcl:2,tag:'existing'},
    {type:'road',x:21,y:29,rcl:2,tag:'existing-road'}
]};
function fixture(extra=[],missing=false){
    let reads=0,sites=0;
    const old={version:3,created:100,complete:true,roadVersion:1,structures:[]};
    const memory={plan:old,economyControl:{old:true},upgradeStation:{old:true}};
    const buildings=candidate.structures.map(i=>({structureType:i.type,pos:{x:i.x,y:i.y}})).concat(extra);
    const room={name,controller:{id:'test-controller',my:true,level:3},find(t){return t===1?buildings:[];},createConstructionSite(){sites++;return 0;}};
    const ctx={console,module:{exports:{}},Memory:{frontier:{rooms:{[name]:memory}}},Game:{time:100,rooms:{[name]:room},constructionSites:{}},
        FIND_STRUCTURES:1,FIND_MY_CONSTRUCTION_SITES:2,CONTROLLER_STRUCTURES:Object.fromEntries(types.map(t=>[t,{}])),
        require(){return {load(){reads++;return missing?null:clone(candidate);},has(){return false;}};},
        PathFinder:{search(){throw Error('Static activation must not search');}}};
    vm.createContext(ctx);
    const instrumented=code.replace(/const REVIEWED_PLANS=\{[^;]*\};/,`const REVIEWED_PLANS=${JSON.stringify({[name]:{id,revision,controllerId:'test-controller'}})};`);
    assert.notEqual(instrumented,code,'Expected reviewed plan activation manifest');
    vm.runInContext(instrumented,ctx);
    return {ctx,room,memory,old,buildings,planner:ctx.module.exports,get reads(){return reads;},get sites(){return sites;}};
}
{
    const f=fixture();const result=f.planner.ensure(f.room);
    assert.equal(result.layoutRevision,revision);assert.equal(f.memory.planMigration.status,'applied');
    assert.equal(f.memory.economyControl,undefined);assert.equal(f.memory.upgradeStation,undefined);
    assert.equal(f.buildings.length,3,'No demolition');
    for(let i=0;i<50;i++){f.ctx.Game.time++;assert.equal(f.planner.ensure(f.room),result);}
    assert.equal(f.reads,1,'Only one archive decode for this approved revision');
}
for(const type of ['extension','road','container']){
    const f=fixture([{structureType:type,pos:{x:40,y:40}}]);
    assert.equal(f.planner.ensure(f.room),f.old);assert.equal(f.memory.planMigration.status,'blocked');
    f.planner.run(f.room);assert.equal(f.sites,0,'Conflicting migration must stop old-layout construction');
    assert.equal(f.reads,1,'Blocked activation backs off');
    f.buildings.pop();f.ctx.Game.time+=500;
    assert.equal(f.planner.ensure(f.room).layoutRevision,revision,'Safe retry after conflict disappears');
}
{
    const f=fixture([],true);assert.equal(f.planner.ensure(f.room),f.old);
    f.planner.run(f.room);assert.equal(f.memory.planMigration.status,'blocked');assert.equal(f.sites,0);
}
{
    const f=fixture();f.room.controller.my=false;
    assert.equal(f.planner.ensure(f.room),f.old);assert.equal(f.reads,0,'No activation in unowned surveyed room');
}
{
    const f=fixture();f.room.controller.id='different-world-controller';
    assert.equal(f.planner.ensure(f.room),f.old);assert.equal(f.reads,0,'Room name alone is not approval for another world');
}
console.log('PASS reviewed-plan activation: exact archive, one decode, preserved facilities, conflict/missing-archive backoff, construction hold, safe retry, no search');
