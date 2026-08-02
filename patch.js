const fs = require('fs');
const filepath = 'packages/core/test/automation/automation-manager.test.ts';
let code = fs.readFileSync(filepath, 'utf8');

const targetString = "expect(mockSender).toHaveBeenCalledWith(undefined, [0x01, 0x02], { ackMatch: { data: [0x06] } });\n  });";

const replacementString = targetString + `

  it('should handle send_packet action with CEL expression ACK format', async () => {
    const config: HomenetBridgeConfig = {
      ...baseConfig,
      automation: [
        {
          id: 'send_packet_cel_ack_test',
          trigger: [{ type: 'startup' }],
          then: [
            {
              action: 'send_packet',
              data: [0x01, 0x02],
              ack: "packet[3] == 0x06",
            },
          ],
        },
      ],
    };

    const mockSender = vi.fn().mockResolvedValue(undefined);

    automationManager = new AutomationManager(
      config,
      packetProcessor as any,
      commandManager as any,
      mqttPublisher as any,
      undefined,
      mockSender, // inject mock sender
    );
    automationManager.start();

    await vi.runAllTimersAsync();

    // Verify format conversion
    expect(mockSender).toHaveBeenCalledWith(undefined, [0x01, 0x02], { ackMatch: { guard: "packet[3] == 0x06" } });
  });`;

code = code.replace(targetString, replacementString);
fs.writeFileSync(filepath, code);
