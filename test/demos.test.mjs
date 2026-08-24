import { Sheet } from '../src/lib/engine.js';
import { DEFAULT_DEMO_ID, DEMOS, demoById } from '../src/lib/demos.js';

let passed = 0;
const failures = [];

const ids = DEMOS.map((demo) => demo.id);
if (DEMOS.length >= 6 && new Set(ids).size === DEMOS.length) passed++;
else failures.push('demo ids should be unique and cover several topics');

if (demoById('not-a-demo').id === DEFAULT_DEMO_ID) passed++;
else failures.push('an unknown demo id should fall back to the default demo');

for (const demo of DEMOS) {
  const results = new Sheet().evaluateAll(demo.lines);
  const truthSteps = results.filter((result) => result.kind === 'truth');
  const problem = results.find((result) => (
    result.kind === 'error'
    || (result.kind === 'truth' && (result.value !== true || result.method !== 'proved'))
  ));

  if (!demo.topic || !demo.title || !demo.description) {
    failures.push(`${demo.id}: missing catalog copy`);
  } else if (demo.lines.at(-1) !== '') {
    failures.push(`${demo.id}: should end with a blank editable row`);
  } else if (truthSteps.length < 3) {
    failures.push(`${demo.id}: should demonstrate at least three proof steps`);
  } else if (problem) {
    failures.push(`${demo.id}: contains a non-exact step ${JSON.stringify(problem)}`);
  } else {
    passed++;
  }
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`${passed} proof-demo catalog cases passed`);
