/** Conservative Node TAP adapter. Nested suites remain unsupported rather than guessing test identity. */
export interface TestOutcomes {
  adapter: 'node-tap-top-level-v1';
  complete: boolean;
  tests: {name:string; status:'passed'|'failed'|'skipped'}[];
  limitations: string[];
}
export function parseTestOutcomes(output: string, truncated = false): TestOutcomes {
  const tests: TestOutcomes['tests'] = [];
  const limitations: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    const m = /^(not ok|ok) \d+ - (.+?)(?: # (SKIP|TODO)(?:\s.*)?)?$/.exec(line);
    if (m) tests.push({name:m[2]!,status:m[3] ? 'skipped' : m[1] === 'ok' ? 'passed' : 'failed'});
  }
  const count = Number(output.match(/^# tests (\d+)\s*$/m)?.[1] ?? -1);
  const plan = Number(output.match(/^1\.\.(\d+)\s*$/m)?.[1] ?? -1);
  const summaryCount = (name:string):number => Number(output.match(new RegExp(`^# ${name} (\\d+)\\s*$`, 'm'))?.[1] ?? -1);
  if (summaryCount('pass') !== tests.filter(t=>t.status === 'passed').length || summaryCount('fail') !== tests.filter(t=>t.status === 'failed').length) limitations.push('Test outcomes disagree with summary counts');
  if (truncated) limitations.push('Execution output truncated');
  if (!/^TAP version 13\s*$/m.test(output)) limitations.push('No supported TAP header');
  if (/^\s+(?:not )?ok \d+ - /m.test(output)) limitations.push('Nested test identities are not supported');
  if (tests.length === 0 || tests.length !== count || count !== plan) limitations.push('Test identities do not match the complete test plan');
  if (new Set(tests.map(t=>t.name)).size !== tests.length) limitations.push('Duplicate test names are ambiguous');
  if ((output.match(/^TAP version 13\s*$/gm) ?? []).length !== 1) limitations.push('Multiple or missing TAP streams');
  if (/^Bail out!|^# cancelled [1-9]/m.test(output)) limitations.push('Execution cancelled or bailed out');
  return {adapter:'node-tap-top-level-v1',complete:limitations.length === 0,tests,limitations};
}
