'use strict';
// The external experiment controller replaces only this reviewed data module.
const config = Object.freeze({"id":"hauler-20260930T195223821086Z","room":"W21N26","stage":"baseline","variant":"control","revision":"hauler-20260930T195223821086Z-baseline","batchWeight":0,"window":1500,"warmup":300});
function routeScore(room,priority,amount,capacity,score){
    if(room.name!==config.room||config.variant!=='batch-preference'||priority<=2)return score;
    // A smooth preference, never a minimum load or a reason to wait. Urgent
    // spawn/extension/tower/controller supply retains its existing ordering.
    return score*(1+config.batchWeight*(1-Math.min(1,amount/Math.max(1,capacity))));
}
module.exports={config,routeScore};
