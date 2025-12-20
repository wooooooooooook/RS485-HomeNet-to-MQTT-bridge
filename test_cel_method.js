
const { Environment } = require('@marcbachmann/cel-js');

const env = new Environment();

env.registerFunction('id(string): dyn', (id) => {
  return { id };
});

env.registerFunction('write_command(dyn, string, dyn): bool', (device, cmd, val) => {
  console.log(`Command sent to ${device.id}: ${cmd}(${val})`);
  return true;
});

try {
    const res = env.evaluate("id('my_device').write_command('turn_on', 100)", {});
    console.log('Result:', res);
} catch (e) {
    console.error('Error:', e);
}
