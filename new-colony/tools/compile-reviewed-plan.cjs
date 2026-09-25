#!/usr/bin/env node
'use strict';
// Offline compiler: the reviewed design remains local; the game receives only
// execution fields, without research prose or one route per future building.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const pick=(value,fields)=>Object.fromEntries(fields.filter(k=>value[k]!==undefined).map(k=>[k,value[k]]));
function geometry(plan){return plan.structures.map(s=>[s.type,s.x,s.y,s.rcl,s.tag]);}
function compile(design){
    assert.equal(design.version,3,'Unsupported execution schema');
    assert.equal(design.complete,true,'Incomplete designs cannot become executable');
    assert.equal(typeof design.layoutRevision,'string','A reviewed revision is required');
    assert(Array.isArray(design.structures)&&design.structures.length>0);
    const out=pick(design,['version','layoutRevision','created','anchor','controllerSpot','complete','missing','roadVersion','roadCore','roadMissing','hubServiceSpot']);
    out.sourcePlans=design.sourcePlans.map(s=>pick(s,['id','x','y','pathLength']));
    out.structures=design.structures.map(s=>{
        assert(typeof s.type==='string'&&Number.isInteger(s.x)&&Number.isInteger(s.y)&&s.x>=0&&s.x<50&&s.y>=0&&s.y<50);
        assert(Number.isInteger(s.rcl)&&s.rcl>=1&&s.rcl<=8&&Number.isFinite(s.priority));
        assert(!s.optional,'Optional reservations must stay out of construction');
        return pick(s,['type','x','y','rcl','priority','tag','roadClass','sourceIds','roadSwamp','roadOrder','linkRole','sourceId','flow','targetTag','fallbackTargetTag','serviceSpot','serviceMode']);
    });
    out.counts={};for(const s of out.structures)out.counts[s.type]=(out.counts[s.type]||0)+1;
    out.roadRoutes=design.roadRoutes.filter(r=>r.kind==='source'||r.id==='controller')
        .map(r=>pick(r,['id','kind','sourceId','tiles','length','complete','swampTiles']));
    assert(out.roadRoutes.length===out.sourcePlans.length+1,'Exactly the economic routes must be retained');
    assert(out.roadRoutes.every(r=>r.complete&&r.tiles.length===r.length),'Incomplete economic route');
    assert.deepEqual(geometry(out),geometry(design),'Compilation must not move or restage buildings');
    return JSON.parse(JSON.stringify(out));
}
if(require.main===module){
    const input=path.resolve(process.argv[2]||path.join(__dirname,'../fixtures/layout-design-reviewed.json'));
    const output=path.resolve(process.argv[3]||path.join(__dirname,'../fixtures/layout-plan-reviewed.json'));
    const design=JSON.parse(fs.readFileSync(input,'utf8')),plan=compile(design);
    fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(plan,null,2)+'\n');
    console.log(JSON.stringify({revision:plan.layoutRevision,placements:plan.structures.length,routes:plan.roadRoutes.length,
        designBytes:Buffer.byteLength(JSON.stringify(design)),executionBytes:Buffer.byteLength(JSON.stringify(plan)),output}));
}
module.exports={compile,geometry};
