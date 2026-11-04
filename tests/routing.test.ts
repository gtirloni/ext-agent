import { test } from 'node:test'
import assert from 'node:assert/strict'
import { register } from '../plugins/ext-agent/hooks/register.ts'
import { parseRoutes, instructionsBody } from '../plugins/ext-agent/hooks/routing.ts'

const routes = { 'gsd-executor': { runtime: 'pi', model: 'deepseek/flash', instructionsFile: '~/agents/executor.md' } }
function harness(options: any = {}) {
  const hooks: any[] = []
  register(((name: string, matcher: any, fn?: any) => { hooks.push({name, matcher: fn ? matcher : undefined, fn: fn ?? matcher}); return {catch() {}} }) as any,
    {agentRoutes: JSON.stringify(routes), stallMinutes: 0, ...options})
  return (name: string, tool?: string) => hooks.find(h => h.name === name && (tool ? h.matcher?.tool === tool : !h.matcher))!.fn
}
const next = Object.assign(async (e: any) => e, {signal: new AbortController().signal})
const api = () => ({
  env: {get: async () => '/home/test'},
  fs: {read: async (p: string) => { assert.equal(p, '/home/test/agents/executor.md'); return '---\nname: gsd-executor\nmodel: sonnet\n---\nExecute tasks and write SUMMARY.md.' }},
  session: {cwd: async () => '/repo', messages: async () => [{role:'user', text:'Implement the plan.', toolResults:[]}]},
  agent: {list: async () => [] as any[]},
  settings: {read: async () => ({})},
  process: {run: async (_: any) => ({stdout:'',stderr:'',exitCode:0}), spawn: (_: any): any => {}},
})
async function drain(generator: any) {
  const chunks = []
  for (;;) { const r = await generator.next(); if (r.done) return {chunks, result:r.value}; chunks.push(r.value) }
}

test('routes validate strictly; frontmatter is removed without changing role body', () => {
  assert.equal(parseRoutes(JSON.stringify(routes))['gsd-executor'].runtime, 'pi')
  for (const invalid of ['[]','null','{"fork":{}}','{"gsd-executor":{"runtime":"other"}}','{"gsd-executor":{"runtime":"pi"}}']) assert.throws(() => parseRoutes(invalid))
  assert.equal(instructionsBody('---\r\nname: x\r\n---\r\nRole'), 'Role')
  assert.throws(() => instructionsBody('---\nname: x'))
})
test('native agents pass through unchanged, configured types retain identity and background flag', async () => {
  const hook = harness()('tool.call','Agent'), $ = api()
  const native = {subagent_type:'gsd-planner',model:'opus',prompt:'Plan'}
  assert.equal(await hook($,native,next),native)
  const result = await hook($,{subagent_type:'gsd-executor',model:'sonnet',prompt:'Build',run_in_background:true},next)
  assert.equal(result.subagent_type,'gsd-executor')
  assert.equal(result.run_in_background,true)
  assert.match(result.prompt,/^model: pi:deepseek\/flash\n/)
})
test('missing role or invalid routing refuses dispatch; no native fallback', async () => {
  const $ = api(); $.fs.read = async () => {throw new Error('missing role')}
  assert.match((await harness()('tool.call','Agent')($,{subagent_type:'gsd-executor',prompt:'Build'},next)).deny,/missing role/)
  assert.match((await harness({agentRoutes:'{bad'})('tool.call','Agent')($,{subagent_type:'gsd-executor',prompt:'Build'},next)).deny,/invalid agentRoutes/)
})
test('worktree isolation is delegated once and configured types survive blockBuiltin', async () => {
  const h=harness({blockBuiltin:true}), $=api()
  const result=await h('tool.call','Agent')($,{subagent_type:'gsd-executor',prompt:'Build',isolation:'worktree',name:'build'},next)
  assert.equal(result.isolation,undefined); assert.match(result.prompt,/worktree: build/)
  assert.equal(await h('agent.offer')($,{agent:'gsd-executor',provider:{plugin:'engine'}},next) instanceof Object,true)
  assert.deepEqual(await h('agent.offer')($,{agent:'gsd-planner',provider:{plugin:'engine'}},next),{isOffered:false})
})
for (const runtime of ['pi','opencode']) test(`${runtime} worker receives role and task, preserves native type, reports failure without fallback`, async () => {
  const h=harness({agentRoutes:JSON.stringify({'gsd-executor':{...routes['gsd-executor'],runtime,model:undefined}})}), $=api()
  $.agent.list=async()=>[{id:`test-${runtime}`,type:'gsd-executor',name:'worker'}]
  let argv: string[]=[]; let nativeCalls=0
  $.process.spawn=({argv:a}:any)=> { argv=a; return (async function*(){
    yield {stream:'stdout',text:runtime==='pi' ? JSON.stringify({type:'message_update',assistantMessageEvent:{type:'text_delta',delta:'Partial work'}})+'\n' : JSON.stringify({type:'text',part:{messageID:'1',text:'Partial work'}})+'\n'}
    return {code:1,signal:null}
  })() }
  const native=Object.assign(async function*(){nativeCalls++;return {}},{signal:next.signal})
  const output=await drain(h('turn.step')($,{agentId:`test-${runtime}`,index:0,turnId:'t'},native))
  assert.equal(nativeCalls,0)
  assert.match(argv.at(-1)!,/Execute tasks and write SUMMARY.md/)
  assert.match(argv.at(-1)!,/Implement the plan/)
  assert.doesNotMatch(argv.at(-1)!,/model: sonnet/)
  assert.match(output.result.toolUses[0].input.message,/exit 1/)
  assert.doesNotMatch(output.result.toolUses[0].input.message,/— answered by/)
})

test('spawn and stream exceptions are reported without calling the native model', async () => {
  for (const phase of ['spawn','stream']) {
    const h=harness(), $=api(), id=`failure-${phase}`
    $.agent.list=async()=>[{id,type:'gsd-executor'}]
    $.process.spawn=()=> {
      if (phase==='spawn') throw new Error('spawn unavailable')
      return (async function*(){throw new Error('stream unavailable')})()
    }
    const native=Object.assign(async function*(){assert.fail('native fallback')},{signal:next.signal})
    const output=await drain(h('turn.step')($,{agentId:id,index:0,turnId:'t'},native))
    assert.match(output.result.toolUses[0].input.message,new RegExp(`${phase} unavailable`))
  }
})

test('follow-up turns keep the role and reuse the external session', async () => {
  const h=harness(), $=api(), id='follow-up'
  $.agent.list=async()=>[{id,type:'gsd-executor'}]
  const calls:string[][]=[]
  $.process.spawn=({argv}:any)=>{calls.push(argv);return (async function*(){
    yield {stream:'stdout',text:JSON.stringify({type:'message_update',assistantMessageEvent:{type:'text_delta',delta:'Done'}})+'\n'}
    return {code:0,signal:null}
  })()}
  const native=Object.assign(async function*(){assert.fail('native fallback')},{signal:next.signal})
  const step=h('turn.step')
  await drain(step($,{agentId:id,index:0,turnId:'a'},native))
  await drain(step($,{agentId:id,index:1,turnId:'a'},native))
  $.session.messages=async()=>[{role:'user',text:'Now test it.',toolResults:[]}]
  $.fs.read=async()=>{throw new Error('role should already be pinned')}
  await drain(step($,{agentId:id,index:0,turnId:'b'},native))
  assert.equal(calls.length,2)
  assert.match(calls[1].at(-1)!,/Execute tasks and write SUMMARY.md/)
  assert.match(calls[1].at(-1)!,/Now test it/)
  const session=(args:string[])=>args[args.indexOf('--session-id')+1]
  assert.equal(session(calls[0]),session(calls[1]))
})

test('streamed Agent arguments and final tool use agree before schema validation', async () => {
  const h=harness(), $=api()
  const input={subagent_type:'gsd-executor',model:'sonnet',prompt:'Build',run_in_background:true}
  const stream=Object.assign((async function*(){
    yield {kind:'tool',index:1,id:'call',name:'Agent'}
    const json=JSON.stringify(input)
    yield {kind:'input',index:1,json:json.slice(0,20)}
    yield {kind:'input',index:1,json:json.slice(20)}
    yield {kind:'stop',stopReason:'tool_use',usage:null}
  })(),{result:Promise.resolve({toolUses:[{name:'Agent',input}]})})
  const native=Object.assign(()=>stream,{signal:next.signal})
  const output=await drain(h('turn.step')($,{index:0,turnId:'main'},native))
  const rewritten=JSON.parse(output.chunks.find((x:any)=>x.kind==='input').json)
  assert.equal(rewritten.model,undefined)
  assert.equal(rewritten.subagent_type,'gsd-executor')
  assert.match(rewritten.prompt,/^model: pi:deepseek\/flash/)
  assert.deepEqual(output.result.toolUses[0].input,rewritten)
})

test('legacy worker remains available with an empty routing configuration', async () => {
  const h=harness({agentRoutes:'{}'}), $=api()
  const result=await h('tool.call','Agent')($,{subagent_type:'ext-agent:worker',prompt:'model: pi\nBuild'},next)
  assert.equal(result.subagent_type,'ext-agent:worker')
  assert.match(result.prompt,/^model: pi\n/)
})
