import assert from 'node:assert/strict';
import test from 'node:test';
import {collectComputerActivities} from './computerTaskQualification.mjs';

test('qualification reads canonical activity summary target references', () => {
  const targetRefs = [{kind:'computer_target',resource_ref:'fixture-window'}];
  const item = {activity:{tool_name:'computer.exec',tool_id:'actual-call',status:'success'},activity_summary:{values:{'/target_refs':targetRefs}}};
  const result = collectComputerActivities({current:{items:[item,{activity:{tool_name:'shell.exec'}}]},message:{tool_name:'computer.click',presentation:{target_refs:targetRefs}}});
  assert.deepEqual(result,[{tool:'computer.exec',toolID:'actual-call',status:'success',targetRefs}]);
  assert.deepEqual(collectComputerActivities({current:{items:[{activity:item.activity}]}})[0].targetRefs,[]);
  assert.deepEqual(collectComputerActivities({}),[]);
});
