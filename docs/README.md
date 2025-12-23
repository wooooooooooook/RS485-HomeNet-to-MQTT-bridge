# RS485-HomeNet-to-MQTT-bridge 문서 허브

`docs/` 디렉터리의 파일을 주제별로 재구성했습니다. 필요한 정보를 빠르게 찾을 수 있도록 영역별 링크를 제공합니다.

## 빠른 시작
- **기기별 설정 샘플**: [DEVICE_SETTINGS.md](./DEVICE_SETTINGS.md) – `SYSTEM_TYPE`/`CONFIG_FILES`에 맞춰 사용할 YAML 경로와 기본 시리얼 파라미터.
- **Home Assistant Discovery**: [HOMEASSISTANT_DISCOVERY.md](./HOMEASSISTANT_DISCOVERY.md) – MQTT Discovery 발행 규칙과 예제.
- **자동화 규칙**: [AUTOMATION.md](./AUTOMATION.md) – 트리거/액션 스키마와 CEL 가드 사용법.

## 구성 스키마
- **엔티티 스키마 총람**: [config-schema/README.md](./config-schema/README.md) – 엔티티별 문서와 공통 옵션 인덱스.
- **상태·명령 스키마 정의**: [config-schema/schemas.md](./config-schema/schemas.md) – `StateSchema`, `StateNumSchema`, `CommandSchema` 필드 및 디코딩 옵션.
- **CEL 표현식 가이드**: [CEL_GUIDE.md](./CEL_GUIDE.md) – `!lambda` 대체 표현식과 헬퍼 함수.

## 엔티티 예제 및 참조
- **예제 모음**: [ENTITY_EXAMPLES.md](./ENTITY_EXAMPLES.md) – 엔티티별 YAML 스니펫.
- **스니펫 갤러리**: [GALLERY.md](./GALLERY.md) – 갤러리 스니펫 구조와 적용 흐름.
- **구형 람다 안내(참고용)**: [LAMBDA.md](./LAMBDA.md) – CEL 이전 문법. 신규 작성 시 CEL 문서를 사용하세요.

## 기타
- **자동화/스키마 교차 참고**: 자동화에서 사용하는 상태·명령 스키마는 [config-schema/schemas.md](./config-schema/schemas.md)을, 표현식 작성은 [CEL_GUIDE.md](./CEL_GUIDE.md)를 참조하세요.
