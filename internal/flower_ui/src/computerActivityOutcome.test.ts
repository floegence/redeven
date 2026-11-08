import { expect, it } from 'vitest';
import type { FlowerActivityItem } from './contracts/flowerSurfaceContracts';
import { computerObservationInterruption, isPresentedToolFailure } from './computerActivityOutcome';

const item = (changes: Partial<FlowerActivityItem> = {}): FlowerActivityItem => ({item_id:'read',kind:'tool',status:'error',severity:'error',needs_attention:true,requires_approval:false,tool_name:'computer_exec',...changes});
const diagnosis = {code:'TARGET_OBSERVATION_UNAVAILABLE',message:'A localized or arbitrary detail'};
it('classifies both full details and bounded historical summaries using structured evidence', () => {
  for (const changes of [{payload:{error:diagnosis}}, {chips:[{kind:'computer_observation',label:'observation',value:'unavailable'}]}]) {
    expect(computerObservationInterruption(item(changes))).toBe('unavailable');
    expect(isPresentedToolFailure(item(changes))).toBe(false);
  }
});
it('never infers an interruption from error text or a missing observation alone', () => {
  for (const changes of [{payload:{error:{message:diagnosis.code}}}, {chips:[{kind:'computer_observation',label:'observation',value:'not_observed'}]},
    {tool_name:'terminal_exec',payload:{error:diagnosis}}, {payload:{error:{code:'SCRIPT_ARGUMENT_ERROR',message:diagnosis.code}}}]) {
    expect(computerObservationInterruption(item(changes))).toBeUndefined();
    expect(isPresentedToolFailure(item(changes))).toBe(true);
  }
});
it('keeps unknown effects and actual user decisions prominent', () => {
  for (const changes of [{chips:[{kind:'effect_outcome',label:'effect',value:'uncertain'}]}, {chips:[{kind:'computer_failure_phase',label:'phase',value:'unknown'}]},
    {requires_approval:true}, {approval_state:'requested' as const}]) {
    expect(isPresentedToolFailure(item({payload:{error:diagnosis},...changes}))).toBe(true);
  }
});

it('keeps prior approval distinct from a pending user decision', () => {
  expect(computerObservationInterruption(item({requires_approval:true,approval_state:'approved',payload:{error:diagnosis}}))).toBe('unavailable');
});
it('does not let an observation chip override a different explicit error', () => {
  expect(isPresentedToolFailure(item({payload:{error:{code:'SCRIPT_ARGUMENT_ERROR',message:'Invalid input'}},chips:[{kind:'computer_observation',label:'observation',value:'unavailable'}]}))).toBe(true);
});

it('presents a confirmed budget stop as partial work without masking other failures', () => {
  const chips = [{kind:'computer_budget',label:'budget',value:'time'}];
  expect(computerObservationInterruption(item({chips,payload:{error:{code:'TIMEOUT'}}}))).toBe('budget');
  expect(computerObservationInterruption(item({chips}))).toBe('budget');
  for (const code of ['SCRIPT_ARGUMENT_ERROR','TARGET_PERMISSION_REQUIRED','EFFECT_OUTCOME_UNKNOWN']) {
    expect(computerObservationInterruption(item({chips,payload:{error:{code}}}))).toBeUndefined();
  }
  expect(computerObservationInterruption(item({chips,field_summary:{uncertain_effect:true,fields:[]}}))).toBeUndefined();
});

it('presents an explicit output limit without hiding unrelated errors or uncertainty', () => {
  const chips = [{kind:'computer_budget',label:'budget',value:'output'}];
  for (const code of [undefined,'SCRIPT_OUTPUT_LIMIT','SCRIPT_FAILED']) {
    expect(computerObservationInterruption(item({chips,payload:{error:{code}}}))).toBe('output');
  }
  for (const code of ['SCRIPT_ARGUMENT_ERROR','TARGET_PERMISSION_REQUIRED','TIMEOUT']) {
    expect(isPresentedToolFailure(item({chips,payload:{error:{code}}}))).toBe(true);
  }
  expect(isPresentedToolFailure(item({chips,field_summary:{uncertain_effect:true,fields:[]}}))).toBe(true);
});

it('recognizes the stable output-limit code without a presentation chip', () => {
  const result = item({payload:{error:{code:'SCRIPT_OUTPUT_LIMIT',message:'Computer script stopped before completion (SCRIPT_OUTPUT_LIMIT)'}}});
  expect(computerObservationInterruption(result)).toBe('output');
  expect(isPresentedToolFailure(result)).toBe(false);
});

it('keeps an undispatched action distinct from confirmed input and ordinary read interruption', () => {
  const interrupted=item({payload:{error:diagnosis},chips:[{kind:'computer_failure_phase',label:'phase',value:'not_dispatched'}]});
  expect(computerObservationInterruption(interrupted)).toBe('not_dispatched');
  expect(isPresentedToolFailure(interrupted)).toBe(false);
  expect(computerObservationInterruption({...interrupted,payload:{error:{code:'EFFECT_OUTCOME_UNKNOWN'}}})).toBeUndefined();
});

it('keeps a confirmed input separate from its failed content lookup, including history summaries',()=>{
 for(const code of ['ELEMENT_NOT_FOUND','AMBIGUOUS_ELEMENT','TARGET_CAPABILITY_UNAVAILABLE']){
  const chips=[{kind:'computer_failure_phase',label:'phase',value:'effect_confirmed'},{kind:'computer_failed_read',label:'read',value:'read'}];
  expect(computerObservationInterruption(item({chips,payload:{error:{code}}}))).toBe('read_failed');
  expect(computerObservationInterruption(item({chips}))).toBe('read_failed');
  expect(isPresentedToolFailure(item({chips:chips.slice(1),payload:{error:{code}}}))).toBe(true);
  expect(isPresentedToolFailure(item({chips,payload:{error:{code:'SCRIPT_FAILED'}}}))).toBe(true);
  expect(isPresentedToolFailure(item({chips,field_summary:{uncertain_effect:true,fields:[]},payload:{error:{code}}}))).toBe(true);
 }
});
