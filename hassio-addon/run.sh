#!/bin/sh

# Parse options from /data/options.json
CONFIG_PATH=/data/options.json

export LOG_LEVEL=$(jq --raw-output '.log_level // "info"' $CONFIG_PATH)
export MQTT_URL=$(jq --raw-output '.mqtt_url // "mqtt://127.0.0.1:1883"' $CONFIG_PATH)
export MQTT_NEED_LOGIN=$(jq --raw-output '.mqtt_need_login // false' $CONFIG_PATH)
export MQTT_USER=$(jq --raw-output '.mqtt_user // ""' $CONFIG_PATH)
export MQTT_PASSWD=$(jq --raw-output '.mqtt_passwd // ""' $CONFIG_PATH)
export MQTT_TOPIC_PREFIX=$(jq --raw-output '.mqtt_topic_prefix // "homenet"' $CONFIG_PATH)
export SERIAL_PORT=$(jq --raw-output '.serial_port // "/dev/ttyUSB0"' $CONFIG_PATH)
export CONFIG_FILE=$(jq --raw-output '.config_file // "samsung_sds.homenet_bridge.yaml"' $CONFIG_PATH)
export PORT=3000

# Setup configuration directory in Home Assistant config
HA_CONFIG_DIR="/homeassistant/homenet2mqtt"
DEFAULT_CONFIG_DIR="packages/core/config"

if [ ! -d "$HA_CONFIG_DIR" ]; then
  echo "Creating configuration directory at $HA_CONFIG_DIR..."
  mkdir -p "$HA_CONFIG_DIR"
fi

# Copy default config files if they don't exist
echo "Checking for configuration files..."
for file in "$DEFAULT_CONFIG_DIR"/*.yaml; do
  filename=$(basename "$file")
  if [ ! -f "$HA_CONFIG_DIR/$filename" ]; then
    echo "Copying default config $filename to $HA_CONFIG_DIR..."
    cp "$file" "$HA_CONFIG_DIR/"
  fi
done

export CONFIG_ROOT="$HA_CONFIG_DIR"

echo "Starting homenet2mqtt..."
echo "Configuration:"
echo "  LOG_LEVEL: $LOG_LEVEL"
echo "  MQTT_URL: $MQTT_URL"
echo "  MQTT_TOPIC_PREFIX: $MQTT_TOPIC_PREFIX"
echo "  SERIAL_PORT: $SERIAL_PORT"
echo "  CONFIG_FILE: $CONFIG_FILE"
echo "  CONFIG_ROOT: $CONFIG_ROOT"

# Run the service
node packages/service/dist/server.js
