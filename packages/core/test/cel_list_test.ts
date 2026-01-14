import { Environment } from '@marcbachmann/cel-js';

const env = new Environment();
env.registerVariable('x', 'int');
env.registerFunction('int_to_bcd(int): int', (val: bigint) => {
  const v = Number(val);
  const res = (Math.floor(v / 10) % 10 << 4) | v % 10;
  return BigInt(res);
});

try {
  const script = '[0x02, int(x)]';
  const parsed = env.parse(script);
  console.log('Success (cast):', parsed({ x: 10n }));
} catch (e) {
  console.log('Error (cast):', e.message);
}

try {
  // This should fail if x is considered dyn/int and 0x02 is int, but strictly checked?
  // Actually x is registered as 'int' in my test above.
  // In real app, 'x' is 'int'.
  const script = '[0x02, x]';
  const parsed = env.parse(script);
  console.log('Success (no cast):', parsed({ x: 10n }));
} catch (e) {
  console.log('Error (no cast):', e.message);
}

try {
  // Testing dynamic expression
  const script = '[0x02, int_to_bcd(x)]';
  const parsed = env.parse(script);
  console.log('Success (func):', parsed({ x: 10n }));
} catch (e) {
  console.log('Error (func):', e.message);
}

try {
  // Testing mixed types if one is inferred differently
  // 1 is int.
  // If I use a function that returns dyn? But helper functions return int in CelExecutor.

  // Let's test the specific memory claim: "int(expression)"

  // What if expression involves dynamic type?
  // In CelExecutor:
  // this.env.registerVariable('x', 'int');
  // ... functions return 'int'.

  // Maybe it happens when using map lookups which might return dyn?
  env.registerVariable('states', 'map');
  const script = '[0x02, states["a"]]'; // states returns dynamic value usually
  const parsed = env.parse(script);
  console.log('Success (map access):', parsed({ states: { a: 10n } }));
} catch (e) {
  console.log('Error (map access):', e.message);
}

try {
  env.registerVariable('states', 'map');
  const script = '[0x02, int(states["a"])]';
  const parsed = env.parse(script);
  console.log('Success (map access cast):', parsed({ states: { a: 10n } }));
} catch (e) {
  console.log('Error (map access cast):', e.message);
}
