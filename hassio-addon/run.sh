#!/bin/sh

# Parse options from /data/options.json
CONFIG_PATH=/data/options.json

export LOG_LEVEL=$(jq --raw-output '.log_level // "info"' $CONFIG_PATH)
export MQTT_URL=$(jq --raw-output '.mqtt_url // "mqtt://127.0.0.1:1883"' $CONFIG_PATH)
export MQTT_NEED_LOGIN=$(jq --raw-output '.mqtt_need_login // false' $CONFIG_PATH)
export MQTT_USER=$(jq --raw-output '.mqtt_user // ""' $CONFIG_PATH)
export MQTT_PASSWD=$(jq --raw-output '.mqtt_passwd // ""' $CONFIG_PATH)
MQTT_TOPIC_PREFIXES=$(jq --raw-output '.mqtt_topic_prefixes // [] | join(",")' $CONFIG_PATH)
LEGACY_MQTT_TOPIC_PREFIX=$(jq --raw-output '.mqtt_topic_prefix // ""' $CONFIG_PATH)
SERIAL_PORTS=$(jq --raw-output '.serial_ports // [] | join(",")' $CONFIG_PATH)
CONFIG_FILES=$(jq --raw-output '.config_files // [] | join(",")' $CONFIG_PATH)
LEGACY_SERIAL_PORT=$(jq --raw-output '.serial_port // ""' $CONFIG_PATH)
LEGACY_CONFIG_FILE=$(jq --raw-output '.config_file // ""' $CONFIG_PATH)
export PORT=3000

if [ -z "$SERIAL_PORTS" ] && [ -n "$LEGACY_SERIAL_PORT" ] && [ "$LEGACY_SERIAL_PORT" != "null" ]; then
  echo "[addon] serial_port 설정을 serial_ports 배열로 옮겨주세요. 기존 값을 임시로 사용합니다."
  SERIAL_PORTS="$LEGACY_SERIAL_PORT"
fi

if [ -z "$CONFIG_FILES" ] && [ -n "$LEGACY_CONFIG_FILE" ] && [ "$LEGACY_CONFIG_FILE" != "null" ]; then
  echo "[addon] config_file 설정을 config_files 배열로 옮겨주세요. 기존 값을 임시로 사용합니다."
  CONFIG_FILES="$LEGACY_CONFIG_FILE"
fi

if [ -z "$MQTT_TOPIC_PREFIXES" ] && [ -n "$LEGACY_MQTT_TOPIC_PREFIX" ] && [ "$LEGACY_MQTT_TOPIC_PREFIX" != "null" ]; then
  echo "[addon] mqtt_topic_prefix 설정을 mqtt_topic_prefixes 배열로 옮겨주세요. 기존 값을 임시로 사용합니다."
  MQTT_TOPIC_PREFIXES="$LEGACY_MQTT_TOPIC_PREFIX"
fi

if [ -z "$MQTT_TOPIC_PREFIXES" ]; then
  MQTT_TOPIC_PREFIXES="homenet"
fi

IFS=',' read -r -a SERIAL_PORT_LIST <<< "$SERIAL_PORTS"
IFS=',' read -r -a CONFIG_FILE_LIST <<< "$CONFIG_FILES"
IFS=',' read -r -a MQTT_TOPIC_PREFIX_LIST <<< "$MQTT_TOPIC_PREFIXES"

if [ ${#SERIAL_PORT_LIST[@]} -eq 0 ]; then
  echo "[addon] serial_ports에 최소 1개 이상의 항목이 필요합니다."
  exit 1
fi

if [ ${#CONFIG_FILE_LIST[@]} -eq 0 ]; then
  echo "[addon] config_files에 최소 1개 이상의 항목이 필요합니다."
  exit 1
fi

if [ ${#SERIAL_PORT_LIST[@]} -ne ${#CONFIG_FILE_LIST[@]} ]; then
  echo "[addon] serial_ports(${#SERIAL_PORT_LIST[@]})와 config_files(${#CONFIG_FILE_LIST[@]}) 개수가 일치해야 합니다."
  exit 1
fi

if [ ${#MQTT_TOPIC_PREFIX_LIST[@]} -eq 0 ]; then
  echo "[addon] mqtt_topic_prefixes에 최소 1개 이상의 항목이 필요합니다."
  exit 1
fi

if [ ${#MQTT_TOPIC_PREFIX_LIST[@]} -ne 1 ] && [ ${#MQTT_TOPIC_PREFIX_LIST[@]} -ne ${#SERIAL_PORT_LIST[@]} ]; then
  echo "[addon] mqtt_topic_prefixes(${#MQTT_TOPIC_PREFIX_LIST[@]})는 1개이거나 serial_ports(${#SERIAL_PORT_LIST[@]})와 같아야 합니다."
  exit 1
fi

export SERIAL_PORTS="$SERIAL_PORTS"
export CONFIG_FILES="$CONFIG_FILES"
export MQTT_TOPIC_PREFIXES="$MQTT_TOPIC_PREFIXES"
export SERIAL_PORT="${SERIAL_PORT_LIST[0]}"
export CONFIG_FILE="${CONFIG_FILE_LIST[0]}"
export MQTT_TOPIC_PREFIX="${MQTT_TOPIC_PREFIX_LIST[0]}"

# Setup configuration directory in Home Assistant config
HA_CONFIG_DIR="/homeassistant/homenet2mqtt"
DEFAULT_CONFIG_DIR="packages/core/config"
INIT_MARKER="$HA_CONFIG_DIR/.initialized"

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
  touch "$INIT_MARKER"
  echo "기본 설정파일이 $HA_CONFIG_DIR 에 복사되었습니다."
  echo "알맞은 설정파일을 검토 및 수정한 뒤 애드온 설정에서 config_file을 지정 하고 애드온을 다시 시작해주세요."
  exit 0
fi

export CONFIG_ROOT="$HA_CONFIG_DIR"

echo "Starting homenet2mqtt..."
echo "Configuration:"
echo "  LOG_LEVEL: $LOG_LEVEL"
echo "  MQTT_URL: $MQTT_URL"
echo "  MQTT_TOPIC_PREFIXES: $MQTT_TOPIC_PREFIXES"
echo "  SERIAL_PORTS: $SERIAL_PORTS"
echo "  CONFIG_FILES: $CONFIG_FILES"
echo "  CONFIG_ROOT: $CONFIG_ROOT"
echo "포트-설정 파일 매핑:"
for i in "${!SERIAL_PORT_LIST[@]}"; do
  echo "  ${SERIAL_PORT_LIST[$i]} -> ${CONFIG_FILE_LIST[$i]}"
done
echo "포트-토픽 접두사 매핑:"
for i in "${!SERIAL_PORT_LIST[@]}"; do
  prefix_index=$i
  if [ ${#MQTT_TOPIC_PREFIX_LIST[@]} -eq 1 ]; then
    prefix_index=0
  fi
  echo "  ${SERIAL_PORT_LIST[$i]} -> ${MQTT_TOPIC_PREFIX_LIST[$prefix_index]}"
done

# Run the service
node packages/service/dist/server.js
