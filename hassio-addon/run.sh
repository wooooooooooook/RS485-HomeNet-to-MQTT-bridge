#!/bin/bash

# Parse options from /data/options.json
CONFIG_PATH=/data/options.json

export LOG_LEVEL=$(jq --raw-output '.log_level // "info"' $CONFIG_PATH)
export MQTT_URL=$(jq --raw-output '.mqtt_url // "mqtt://127.0.0.1:1883"' $CONFIG_PATH)
export MQTT_NEED_LOGIN=$(jq --raw-output '.mqtt_need_login // false' $CONFIG_PATH)
export MQTT_USER=$(jq --raw-output '.mqtt_user // ""' $CONFIG_PATH)
export MQTT_PASSWD=$(jq --raw-output '.mqtt_passwd // ""' $CONFIG_PATH)
export MQTT_TOPIC_PREFIX=$(jq --raw-output '.mqtt_topic_prefix // "homenet2mqtt"' $CONFIG_PATH)
CONFIG_FILES=$(jq --raw-output '.config_files // [] | join(",")' $CONFIG_PATH)
LEGACY_CONFIG_FILE=$(jq --raw-output '.config_file // ""' $CONFIG_PATH)
export PORT=3000

if [ -z "$CONFIG_FILES" ] && [ -n "$LEGACY_CONFIG_FILE" ] && [ "$LEGACY_CONFIG_FILE" != "null" ]; then
  echo "[addon] config_file 설정을 config_files 배열로 옮겨주세요. 기존 값을 임시로 사용합니다."
  CONFIG_FILES="$LEGACY_CONFIG_FILE"
fi

IFS=',' read -r -a CONFIG_FILE_LIST <<< "$CONFIG_FILES"

if [ ${#CONFIG_FILE_LIST[@]} -eq 0 ]; then
  echo "[addon] config_files가 비어 있습니다. 기본 설정 마법사를 기다립니다."
else
  export CONFIG_FILES="$CONFIG_FILES"
  export CONFIG_FILE="${CONFIG_FILE_LIST[0]}"
fi

# Setup configuration directory in Home Assistant config
HA_CONFIG_DIR="/homeassistant/homenet2mqtt"
DEFAULT_CONFIG_DIR="packages/core/config"
INIT_MARKER="$HA_CONFIG_DIR/.initialized"
RESTART_FLAG="$HA_CONFIG_DIR/.restart-required"

if [ ! -d "$HA_CONFIG_DIR" ]; then
  echo "Creating configuration directory at $HA_CONFIG_DIR..."
  mkdir -p "$HA_CONFIG_DIR"
fi

if [ ! -f "$INIT_MARKER" ]; then
  echo "First run detected, seeding configuration files..."
  for file in "$DEFAULT_CONFIG_DIR"/*.yaml; do
    filename=$(basename "$file")
    echo "Copying default config $filename to $HA_CONFIG_DIR..."
    cp "$file" "$HA_CONFIG_DIR/"
  done
  if [ -d "$DEFAULT_CONFIG_DIR/examples" ]; then
    echo "Copying example configs to $HA_CONFIG_DIR/examples..."
    cp -r "$DEFAULT_CONFIG_DIR/examples" "$HA_CONFIG_DIR/"
  fi
  touch "$INIT_MARKER"
  echo "기본 및 예제 설정파일이 $HA_CONFIG_DIR 에 복사되었습니다."
  echo "알맞은 설정파일을 검토 및 수정한 뒤 애드온 설정에서 config_files를 지정 하고 애드온을 다시 시작해주세요."
  exit 0
fi

export CONFIG_ROOT="$HA_CONFIG_DIR"

echo "Starting homenet2mqtt..."
echo "Configuration:"
echo "  LOG_LEVEL: $LOG_LEVEL"
echo "  MQTT_URL: $MQTT_URL"
echo "  CONFIG_FILES: $CONFIG_FILES"
echo "  CONFIG_ROOT: $CONFIG_ROOT"
echo "  MQTT_NEED_LOGIN: $MQTT_NEED_LOGIN"
echo "  MQTT_USER: $MQTT_USER"
echo "  MQTT_TOPIC_PREFIX: $MQTT_TOPIC_PREFIX"

# Run the service with restart flag support for initialization flow
while true; do
  node packages/service/dist/server.js
  exit_code=$?

  if [ $exit_code -eq 0 ] && [ -f "$RESTART_FLAG" ]; then
    echo "[addon] Restart flag detected. Re-launching service to apply selected default config..."
    rm -f "$RESTART_FLAG"
    continue
  fi

  exit $exit_code
done
