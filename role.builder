var observation = require('observation');

var roleBuilder = {

    /** @param {Creep} creep **/
    run: function(creep) {
        // 检查observation中的warning状态
        if (observation.warning) {
            creep.say('Warning! Pausing construction');
            return;
        }
        
        // Check if the builder is currently building and has no energy left
        if (creep.memory.building && creep.store[RESOURCE_ENERGY] == 0) {
            // Set the builder to not building and make it say "🔄 harvest"
            creep.memory.building = false;
            creep.say('🔄 harvest');
        }
        // Check if the builder is not currently building and has full energy capacity
        if (!creep.memory.building && creep.store.getFreeCapacity() == 0) {
            // Set the builder to building and make it say "🚧 build"
            creep.memory.building = true;
            creep.say('🚧 build');
        }

        // If the builder is currently building
        if (creep.memory.building) {
            // Find all the construction sites in the room
            var targets = creep.room.find(FIND_CONSTRUCTION_SITES);
            // If there are any construction sites
            if (targets.length) {
                // Build the first construction site in the list
                if (creep.build(targets[0]) == ERR_NOT_IN_RANGE) {
                    // If the construction site is too far away, move towards it
                    creep.moveTo(targets[0], {visualizePathStyle: {stroke: '#ffffff'}});
                }
            } else {
                // If there are no construction sites, go to upgrade the controller
                if (creep.upgradeController(creep.room.controller) == ERR_NOT_IN_RANGE) {
                    // If the controller is too far away, move towards it
                    creep.moveTo(creep.room.controller, {visualizePathStyle: {stroke: '#ffffff'}});
                }
            }
        } else {
            // If the builder is not currently building
            // Find the closest spawn with energy
            var target = creep.pos.findClosestByRange(FIND_MY_SPAWNS, {
                filter: (structure) => {
                    return structure.store[RESOURCE_ENERGY] > 0;
                }
            });

            if (target) {
                // Withdraw energy from the closest spawn with energy
                if (creep.withdraw(target, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
                    // If the spawn is too far away, move towards it
                    creep.moveTo(target, {visualizePathStyle: {stroke: '#ffffff'}});
                }
            }
        }
    }
};

module.exports = roleBuilder;
