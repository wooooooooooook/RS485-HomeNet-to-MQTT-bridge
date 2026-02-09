#!/usr/bin/with-contenv bashio

# Home Assistant addon: options.json에서 설정을 읽어옴
# Docker container: 환경변수에서 설정을 읽어옴
CONFIG_PATH=/data/options.json

if [ -f "$CONFIG_PATH" ]; then
  # Home Assistant 애드온 환경
  bashio::log.info "Running as Home Assistant addon"
  export LOG_LEVEL=$(jq --raw-output '.log_level // "info"' $CONFIG_PATH)
  export MQTT_URL=$(jq --raw-output '.mqtt_url // ""' $CONFIG_PATH)
  export MQTT_NEED_LOGIN=$(jq --raw-output '.mqtt_need_login // false' $CONFIG_PATH)
  export MQTT_USER=$(jq --raw-output '.mqtt_user // ""' $CONFIG_PATH)
  export MQTT_PASSWD=$(jq --raw-output '.mqtt_passwd // ""' $CONFIG_PATH)
  
  # MQTT 설정이 비어있거나 기본값이면 bashio를 통해 Supervisor의 MQTT 서비스 정보 사용
  if [ -z "$MQTT_URL" ] || [ "$MQTT_URL" == "mqtt://core-mosquitto:1883" ]; then
    if bashio::services.available "mqtt"; then
      MQTT_HOST=$(bashio::services mqtt "host")
      MQTT_PORT=$(bashio::services mqtt "port")
      export MQTT_URL="mqtt://${MQTT_HOST}:${MQTT_PORT}"
      bashio::log.info "Using Supervisor MQTT service: $MQTT_URL"
    else
      bashio::log.warning "MQTT service not available from Supervisor, using default"
      export MQTT_URL="mqtt://127.0.0.1:1883"
    fi
  fi
  
  # MQTT 인증 정보가 비어있으면 bashio를 통해 가져오기
  if [ -z "$MQTT_USER" ] || [ -z "$MQTT_PASSWD" ]; then
    if bashio::services.available "mqtt"; then
      BASHIO_MQTT_USER=$(bashio::services mqtt "username")
      BASHIO_MQTT_PASSWD=$(bashio::services mqtt "password")
      if [ -n "$BASHIO_MQTT_USER" ] && [ -n "$BASHIO_MQTT_PASSWD" ]; then
        export MQTT_USER="$BASHIO_MQTT_USER"
        export MQTT_PASSWD="$BASHIO_MQTT_PASSWD"
        export MQTT_NEED_LOGIN="true"
        bashio::log.info "Using Supervisor MQTT credentials for user: $MQTT_USER"
      fi
    fi
  fi
  export MQTT_TOPIC_PREFIX=$(jq --raw-output '.mqtt_topic_prefix // "homenet2mqtt"' $CONFIG_PATH)
  CONFIG_FILES=$(jq --raw-output '.config_files // [] | join(",")' $CONFIG_PATH)
  LEGACY_CONFIG_FILE=$(jq --raw-output '.config_file // ""' $CONFIG_PATH)
  
  if [ -z "$CONFIG_FILES" ] && [ -n "$LEGACY_CONFIG_FILE" ] && [ "$LEGACY_CONFIG_FILE" != "null" ]; then
    echo "[addon-dev] config_file 설정을 config_files 배열로 옮겨주세요. 기존 값을 임시로 사용합니다."
    CONFIG_FILES="$LEGACY_CONFIG_FILE"
  fi
  
  if [ -z "$CONFIG_FILES" ] || [ "$CONFIG_FILES" == "null" ]; then
    CONFIG_FILES="default.homenet_bridge.yaml,"
  fi
  
  export CONFIG_FILES="$CONFIG_FILES"
  
  # Home Assistant 경로 사용
  HA_CONFIG_DIR="/homeassistant/homenet2mqtt"
else
  # Docker 컨테이너 환경
  echo "[run.sh] Running as Docker container"
  export LOG_LEVEL="${LOG_LEVEL:-info}"
  export MQTT_URL="${MQTT_URL:-mqtt://localhost:1883}"
  export MQTT_NEED_LOGIN="${MQTT_NEED_LOGIN:-false}"
  export MQTT_USER="${MQTT_USER:-}"
  export MQTT_PASSWD="${MQTT_PASSWD:-}"
  export MQTT_TOPIC_PREFIX="${MQTT_TOPIC_PREFIX:-homenet2mqtt}"
  export CONFIG_FILES="${CONFIG_FILES:-default.homenet_bridge.yaml,}"
  
  # CONFIG_ROOT 환경변수 또는 기본값 /config 사용
  HA_CONFIG_DIR="${CONFIG_ROOT:-/config}"
fi

export PORT="${PORT:-3000}"

IFS=',' read -r -a CONFIG_FILE_LIST <<< "$CONFIG_FILES"
export CONFIG_FILE="${CONFIG_FILE_LIST[0]}"

# Setup configuration directory
DEFAULT_CONFIG_DIR="packages/core/config"
INIT_MARKER="$HA_CONFIG_DIR/.initialized"
RESTART_FLAG="$HA_CONFIG_DIR/.restart-required"

if [ ! -d "$HA_CONFIG_DIR" ]; then
  echo "Creating configuration directory at $HA_CONFIG_DIR..."
  mkdir -p "$HA_CONFIG_DIR"
fi

if [ ! -f "$INIT_MARKER" ]; then
  echo "First run detected, seeding configuration files..."
  # 예제 설정 파일만 복사 (default 설정은 서버에서 UI를 통해 생성됨)
  if [ -d "$DEFAULT_CONFIG_DIR/examples" ]; then
    echo "Copying example configs to $HA_CONFIG_DIR/examples..."
    mkdir -p "$HA_CONFIG_DIR/examples"
    cp -r "$DEFAULT_CONFIG_DIR/examples/"* "$HA_CONFIG_DIR/examples/" 2>/dev/null || true
  fi
  echo "예제 설정파일이 $HA_CONFIG_DIR/examples 에 복사되었습니다."
  echo "UI에서 예제 설정을 선택하고 시리얼 포트 경로를 입력해주세요."
  # .initialized 마커는 서버에서 초기화 완료 후 생성됨
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
    echo "[addon-dev] Restart flag detected. Re-launching service to apply selected default config..."
    rm -f "$RESTART_FLAG"
    continue
  fi

  exit $exit_code
done
