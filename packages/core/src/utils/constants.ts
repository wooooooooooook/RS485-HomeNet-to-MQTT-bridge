/**
 * MQTT topic prefix - configurable via MQTT_TOPIC_PREFIXES (comma-separated) or MQTT_TOPIC_PREFIX.
 * Default: "homenet2mqtt"
 */
const rawMqttTopicPrefix = process.env.MQTT_TOPIC_PREFIXES || process.env.MQTT_TOPIC_PREFIX || 'homenet2mqtt';
export const MQTT_TOPIC_PREFIX = rawMqttTopicPrefix
  .split(',')
  .map((value) => value.trim())
  .find((value) => value.length > 0) || 'homenet2mqtt';
