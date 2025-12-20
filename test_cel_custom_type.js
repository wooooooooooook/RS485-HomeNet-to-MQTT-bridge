
const { Environment } = require('@marcbachmann/cel-js');

class DeviceReference {
  constructor(id) {
    this.id = id;
  }
}

const env = new Environment();

// Register the type with its constructor
env.registerType('DeviceReference', DeviceReference);

// Register 'id' function returning DeviceReference
env.registerFunction('id(string): DeviceReference', (id) => {
  return new DeviceReference(id);
});

// Register 'write_command' method (first arg is receiver)
// The signature format is "ReceiverType.methodName(argTypes): returnType"
env.registerFunction('DeviceReference.write_command(string, dyn): bool', (dev, cmd, val) => {
  console.log(`[Method Call] Device: ${dev.id}, Command: ${cmd}, Value: ${val}`);
  return true;
});

try {
    const res = env.evaluate("id('my_device').write_command('turn_on', 100)", {});
    console.log('Result:', res);
} catch (e) {
    console.error('Error:', e);
}
