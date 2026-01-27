# 크로스 컴파일 가이드 (Cross Compilation Guide)

## 빌드 아키텍처 중립성 여부

이 프로젝트의 빌드 결과물은 **아키텍처 중립적이지 않습니다**.
주된 이유는 `packages/core/package.json`에 포함된 `serialport`와 같은 네이티브 의존성 때문입니다.
네이티브 모듈은 빌드 시점의 호스트 아키텍처(예: amd64)에 맞춰 바이너리(bindings)를 컴파일하므로,
단순히 빌드된 결과물(`node_modules` 포함)을 다른 아키텍처(예: arm v7, arm64)로 복사하여 실행하면 오류가 발생합니다.

## 해결 방법: Docker Buildx 및 QEMU 사용

amd64 호스트에서 arm v7(또는 다른 아키텍처)용 이미지를 빌드하려면 Docker Buildx와 QEMU 에뮬레이션을 사용해야 합니다.
이 프로젝트의 CI/CD 파이프라인(`.github/workflows/deploy-addon.yml`)에서도 이 방식을 사용하여 멀티 아키텍처 이미지를 빌드하고 배포합니다.

### 1. QEMU 및 Buildx 설정

호스트 머신에 QEMU 에뮬레이터와 Docker Buildx 환경을 구성해야 합니다.

```bash
# QEMU 에뮬레이터 설치 (비 Linux 환경이나 에뮬레이션 지원이 없는 경우 필요)
docker run --privileged --rm tonistiigi/binfmt --install all

# 새로운 빌더 인스턴스 생성 및 사용 설정
docker buildx create --name multiarch-builder --driver docker-container --use
docker buildx inspect --bootstrap
```

### 2. 멀티 아키텍처 빌드 실행

다음은 `deploy/docker/service.Dockerfile`을 사용하여 arm v7용 이미지를 빌드하는 예시입니다.

```bash
# arm v7용 이미지 빌드 및 로컬 Docker 데몬으로 로드
docker buildx build \
  --platform linux/arm/v7 \
  --file deploy/docker/service.Dockerfile \
  --tag homenet2mqtt:armv7 \
  --load \
  .
```

- `--platform linux/arm/v7`: 타겟 아키텍처를 지정합니다. 콤마로 구분하여 여러 아키텍처를 지정할 수 있습니다 (예: `linux/amd64,linux/arm64,linux/arm/v7`).
  - **주의**: `--load` 옵션은 단일 플랫폼 빌드에서만 사용 가능합니다. 멀티 플랫폼 이미지를 동시에 빌드하려면 `--push`를 사용하여 레지스트리에 업로드하거나, 개별적으로 빌드해야 합니다.

이 과정을 통해 생성된 이미지는 arm v7 기반 기기(예: Raspberry Pi 2/3/4 등)에서 정상적으로 실행됩니다.
