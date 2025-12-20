
const { Environment } = require('@marcbachmann/cel-js');

const env = new Environment();

env.registerFunction('id(string): string', (id) => {
  return id;
});

env.registerFunction('write_command(string, string, dyn): bool', (id, cmd, val) => {
  console.log(`Command sent to ${id}: ${cmd}(${val})`);
  return true;
});

try {
    const res = env.evaluate("id('my_device').write_command('turn_on', 100)", {});
    console.log('Result:', res);
} catch (e) {
    console.error('Error:', e);
}
