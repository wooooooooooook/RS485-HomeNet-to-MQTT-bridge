# Scripts

The `script` feature allows you to define a sequence of actions that can be reused in automations or triggered by device commands.

## Configuration

Scripts are defined in the top-level `script` section of your configuration file.

```yaml
script:
  - id: my_morning_routine
    description: "Turn on lights and open curtains"
    then:
      - action: command
        target: id(living_room_light).command_on()
      - action: delay
        milliseconds: 500
      - action: command
        target: id(curtain).command_open()
```

## Using Scripts in Automation

You can run a script from an automation using the `run_script` action.

```yaml
automation:
  - trigger:
      - type: schedule
        cron: "0 7 * * *"
    then:
      - action: run_script
        id: my_morning_routine
```

## Using Scripts in Command Schema

You can map a device command directly to a script. This is useful for creating "virtual" devices or complex command sequences triggered by a single entity action.

```yaml
light:
  - id: scene_activator
    name: "Morning Scene"
    command_on:
      script: my_morning_routine
    command_off:
      script: my_night_routine
```

In this example, turning on the `scene_activator` light will execute the `my_morning_routine` script instead of sending a packet.
