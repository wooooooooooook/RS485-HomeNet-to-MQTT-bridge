import { Environment } from '@marcbachmann/cel-js';

const env = new Environment();
env.registerVariable('states', 'map');

try {
  // states returns dynamic value usually
  const script = '[0x02, states["a"]]';
  const parsed = env.parse(script);
  console.log('Success (map access):', parsed({ states: { a: 10n } }));
} catch (e) {
  console.log('Error (map access):', e.message);
}

try {
  const script = '[0x02, int(states["a"])]';
  const parsed = env.parse(script);
  console.log('Success (map access cast):', parsed({ states: { a: 10n } }));
} catch (e) {
  console.log('Error (map access cast):', e.message);
}
