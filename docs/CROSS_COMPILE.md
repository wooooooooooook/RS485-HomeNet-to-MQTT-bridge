# 크로스 컴파일 가이드 (Cross Compilation Guide)

이 프로젝트는 `packages/core`에서 `serialport`와 같은 네이티브 모듈을 사용하기 때문에, 대상 아키텍처(예: Raspberry Pi의 ARMv7/ARM64)에 맞는 네이티브 빌드가 필요합니다. 이를 위해 Docker Buildx와 QEMU를 활용한 멀티 스테이지 빌드 전략을 사용합니다.

## 빌드 전략 (Build Strategy)

빌드 프로세스는 크게 두 단계로 나뉩니다. 이는 QEMU 에뮬레이션의 성능 오버헤드를 최소화하면서 네이티브 모듈의 호환성을 보장하기 위함입니다.

### 1. Common Builder (Host Architecture)

- **실행 환경**: 호스트 아키텍처 (일반적으로 AMD64/x86_64)
- **대상**: 아키텍처에 중립적인 패키지 (`packages/ui`, `packages/service`)
- **이유**: `ui` 빌드(Vite)나 `service` 트랜스파일링은 CPU 연산이 많이 필요합니다. 이를 QEMU(에뮬레이션) 상에서 실행하면 매우 느리므로, 호스트의 네이티브 성능을 활용하여 빠르게 빌드합니다.

### 2. Target Builder (Target Architecture)

- **실행 환경**: 대상 아키텍처 (ARMv7, ARM64 등 - via QEMU)
- **대상**: 네이티브 의존성이 있는 패키지 (`packages/core`) 및 최종 이미지 조립
- **이유**: `serialport` 등의 네이티브 모듈은 반드시 실행될 환경과 동일한 아키텍처에서 컴파일되어야 합니다.

## Dockerfile 상세 (Production vs Dev)

### Production (`hassio-addon/Dockerfile`)

모든 아키텍처(amd64, armv7, aarch64)를 지원해야 하므로, 리소스가 제한적인 ARMv7 환경을 위한 최적화가 포함되어 있습니다.

- **ARMv7 최적화**: `pnpm turbo build`는 메모리와 CPU를 많이 소모하므로, ARMv7 빌드 시에는 이를 우회하고 직접 `build:simple` 스크립트를 실행합니다.
  ```dockerfile
  # ARMv7일 경우 turbo 대신 직접 빌드
  RUN if [ "$TARGETARCH" = "arm" ] && [ "$TARGETVARIANT" = "v7" ]; then \
        pnpm --filter @rs485-homenet/core build:simple; \
      else \
        pnpm --filter @rs485-homenet/core build; \
      fi
  ```
- **`build:simple`**: `packages/core/package.json`에 정의된 스크립트로, `tsc`와 `schema:generate`만 실행하여 오버헤드를 줄입니다.

### Development (`hassio-addon-dev/Dockerfile`)

개발용 애드온은 주로 성능이 충분한 환경에서 사용되거나 ARMv7을 지원하지 않는 경우가 많아, 빌드 프로세스가 단순화되어 있습니다.

- **단순화**: 아키텍처 분기 없이 무조건 `pnpm turbo build`를 사용합니다.
- **소스 포함**: 디버깅을 위해 소스 맵이나 테스트 파일이 일부 남을 수 있습니다.

## 필수 도구 (Prerequisites)

로컬에서 멀티 아키텍처 이미지를 빌드하려면 다음 도구가 필요합니다.

1. **Docker Desktop** 또는 **Docker Engine**
2. **Docker Buildx**: 멀티 플랫폼 빌드 지원 플러그인
3. **QEMU**: 비-네이티브 아키텍처 에뮬레이터

```bash
# Buildx 인스턴스 생성 및 사용
docker buildx create --use

# QEMU 에뮬레이터 설치 (Linux)
docker run --privileged --rm tonistiigi/binfmt --install all
```

## 참고 자료

- `packages/core`의 네이티브 모듈은 `gcompat` (Alpine Linux) 라이브러리를 통해 glibc 호환성을 확보합니다.
- `packages/ui`는 정적 파일로 빌드되어 `packages/service`의 정적 에셋 폴더로 복사됩니다.
