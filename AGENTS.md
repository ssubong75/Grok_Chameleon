# Grok Chameleon 작업 지침

이 파일은 이 저장소와 바탕화면 기준본에서 Grok Chameleon을 수정·검증·배포하는 모든 Codex 작업에 적용됩니다. 대화의 기억이나 추정 대신 아래 규칙을 우선 적용합니다.

## 기본 원칙

- 파일, 경로, 동작, 배포 구조를 추정하지 말고 실제 소스를 먼저 확인합니다.
- "확인" 요청은 읽기와 진단만 수행하며 파일을 변경하지 않습니다.
- "수정" 또는 최종 업데이트 요청이 있을 때만 승인된 범위의 파일을 변경합니다.
- 실제 사용자 라이브러리와 USB 자료는 기능 검증용으로 수정하지 않습니다.
- 기존 사용자 변경 및 작업 범위와 무관한 파일은 수정하거나 커밋하지 않습니다.

## 기준본과 공통 소스

- Mac 기준본은 사용자가 매 작업에서 직접 지정합니다. 경로를 기억해 두거나 추정하지 않고, 시작할 때 실제 존재 여부와 앱 내부 경로를 확인합니다.
- 사용자가 Windows에서 내려받은 Windows 배포본을 기준본으로 지정할 수도 있습니다. 작업마다 사용자가 지정한 기준본을 우선하며 Mac 기준본이라고 자동 가정하지 않습니다.
- GitHub 공통 소스는 저장소의 `common/app/`이며 이것이 유일한 공통 트리입니다.
- 이전에 있던 plain 트리와 clone-batch 트리의 분리 구조는 폐지되었습니다. 배포본은 하나뿐이므로 공통 동작과 전용 동작을 모두 `common/app`에 반영합니다.
- 배포 전 변경을 공통 코드, Windows 전용, Mac 전용으로 분류합니다.
- 가능한 변경은 Windows와 Mac에 동일한 공통 소스로 구현합니다.
- Mac 전용 Electron, Python 경로, `process.platform`, `process.resourcesPath`, 창 처리, 권한 및 프레임워크 심볼릭 링크 구조를 유지합니다.
- 공통 소스와 기준본을 대조할 때 승인된 변경 파일만 반영합니다.

## Windows 기준본

- 현재 Windows ZIP의 앱 공통 소스 경로는 `Grok Chameleon\Resources\Grok Chameleon\resources\app`이고 번들 Python 경로는 `Grok Chameleon\Resources\Python\python.exe`입니다.
- Windows 기준본 작업을 시작할 때 사용자가 실제로 압축 해제한 폴더와 위 내부 경로를 다시 확인하며 다운로드 위치를 추정하지 않습니다.
- Windows 기준본의 공통 텍스트 소스는 CRLF일 수 있으므로 GitHub의 LF 공통 원본과 비교할 때 줄바꿈을 정규화합니다.
- Windows에서 새로 입력하거나 JSON·인덱스에 기록하는 한글 경로는 NFC를 유지하고 Mac의 기존 NFD 파일명 표현을 가져와 강제로 적용하지 않습니다.
- Windows 기준본의 `resources/app` 전체를 Mac 앱에 복사하거나 Mac 앱 전체를 Windows에 복사하지 않습니다. 검증된 대응 파일만 공통 소스에 반영합니다.
- Windows에서 발견한 변경이 공통 동작이면 `common/app`에 반영하고 기존 워크플로로 두 운영체제를 같은 커밋에서 빌드합니다. Windows 전용 동작이면 공통 코드와 분리하고 Mac 구조가 유지되는지 확인합니다.

## 현재 공통 소스 등록 누락 파일

- 다음 파일은 현재 Windows와 Mac 배포본에 동일하게 존재하지만 GitHub `common/app` 및 기존 워크플로 공통 복사 목록에는 등록되어 있지 않습니다.
- Electron·Python: `electron/preload-main.js`, `runtime/build_routes.py`
- 이미지 편집기: `web/editor.html`, `web/assets/editor.js`, `web/assets/editor.css`
- 웹 스크립트: `web/scripts/automation.js`, `web/scripts/b_detail_media.js`, `web/scripts/collection_utils.js`, `web/scripts/composer_submit.js`, `web/scripts/detail_common_actions.js`, `web/scripts/detail_video_player.js`, `web/scripts/dialog.js`, `web/scripts/i_detail_media.js`, `web/scripts/library_utils.js`, `web/scripts/prompt_render.js`, `web/scripts/prompt_translate.js`, `web/scripts/source_filter.js`, `web/scripts/source_render.js`
- 스타일: `web/styles/base.css`, `web/styles/composer.css`, `web/styles/responsive.css`
- 현재 직접 로드되지 않는 이전 파일: `web/scripts/app.js`
- 위 파일 중 하나를 수정해야 하면 기준본만 바꾸지 않습니다. 먼저 공통/Windows 전용/Mac 전용으로 분류하고, 공통 파일이면 `common/app` 대응 파일과 기존 워크플로의 Windows 조립 목록, Mac `shared_relatives`, 게시 ZIP 검증 목록에 같은 상대 경로를 등록합니다.
- `web/scripts/app.js`는 현재 `index.html`에서 로드되지 않으므로 수정 또는 공통 등록 전에 실제 사용 여부를 다시 확인합니다.
- `package.json`은 Mac에만 `pack:mac` 명령이 있어 Windows와 내용이 다르므로 통째로 공통화하지 않습니다.
- `tools/i2v_smoke_test.js`는 현재 Mac 배포본에만 있는 검증 도구이므로 Windows 공통 파일로 복사하지 않습니다.

## 패치 규칙

- 여러 파일과 서로 다른 함수 위치를 하나의 거대한 수동 패치로 묶지 않습니다.
- 실제 파일의 현재 문맥을 읽은 뒤 파일별 또는 독립된 작은 단위로 패치합니다.
- 패치가 실패하면 같은 패치를 추측으로 반복하지 말고 실제 문맥을 다시 읽습니다.
- 각 파일 반영 직후 기준본과 GitHub 대응 파일을 비교하고, 전체 반영 후 승인된 공통 파일을 다시 비교합니다.
- 셸에서 `path`, `PATH`, `home`, `HOME`, `CODEX_HOME` 등 시스템·특수 변수명을 작업 변수로 사용하지 않습니다.
- 복잡한 중첩 따옴표, 불필요한 명령 치환, 긴 복합 확인 명령을 피하고 검사를 짧은 단위로 나눕니다.
- 실패한 검사가 있으면 정확한 명령, 해당 하위 명령의 종료 코드, 실제 원인을 먼저 확인합니다.

## NFC, NFD 및 줄바꿈

- JSON, 인덱스, API 경로와 새 이름은 가능한 한 NFC로 기록합니다.
- Mac 파일시스템이 표시하는 기존 NFD 이름을 Windows 구조로 강제 이식하거나 상위 폴더명을 일괄 변경하지 않습니다.
- 기존 경로의 정규화 형식이 다를 수 있으므로 비교 전에 실제 경로와 정규화 결과를 확인합니다.
- Windows 배포본과 Mac/Linux 공통 원본을 비교할 때 CRLF와 LF를 정규화합니다.
- 단순 바이트 차이만으로 Windows 소스 불일치나 경로 오류라고 단정하지 않습니다.

## 서버와 기능 검증

- `common/app/runtime/`은 완성된 독립 런타임이 아니라 배포본에 적용되는 공통 파일 모음입니다.
- 공통 폴더의 `server.py`를 보조 모듈과 환경값 없이 직접 import하거나 실행하지 않습니다.
- 배포 전 공통 Python 파일은 먼저 AST 문법 검사로 확인합니다.
- 기능 검사는 전체 런타임이 있는 기준본 또는 워크플로가 조립한 배포본에서 수행합니다.
- 서버 기능 테스트가 필요하면 실제 라이브러리가 아닌 임시 디렉터리를 사용하고, 시작 전에 필요한 `GROK_CHAMELEON_RUNTIME_DIR`, `GROK_CHAMELEON_PORTABLE_ROOT`, `GROK_CHAMELEON_LIBRARY_POINTER_PATH`, `GROK_CHAMELEON_PLATFORM_KEY`를 지정합니다.
- 테스트가 생성한 `__pycache__`와 임시 파일은 정확한 대상만 정리하고 커밋하지 않습니다.

## GitHub 배포

- 기존 `main` 브랜치와 기존 `Grok Chameleon` 워크플로(`.github/workflows/release.yml`)만 사용합니다.
- 새 브랜치, 새 YAML 파일, 새 태그 또는 새 릴리스를 만들지 않습니다.
- 빌드 잡은 Windows와 Mac을 각각 한 번씩 돌립니다. 두 잡은 완전히 같은 조립·검사·포장 단계를 지나며 대상 운영체제만 다릅니다.
- 기존 `Grok_Chameleon` 릴리스의 자산 두 개만 갱신합니다. `Win_Grok_Chameleon.zip`과 `Mac_Grok_Chameleon.zip`을 `common/app` 트리에서 만듭니다.
- 두 잡 모두 릴리스에 게시된 같은 이름의 ZIP을 입력으로 내려받아 조립하므로 실행끼리 결과가 누적되지 않습니다.
- 배포 시작 전 로컬 HEAD와 `origin/main`가 일치하는지, 작업 트리가 승인된 변경만 포함하는지 확인합니다.
- Windows와 Mac은 반드시 같은 Git 커밋의 공통 소스를 사용해야 합니다.
- 플랫폼 전용 파일이나 워크플로 자체를 변경해야 한다면 변경 전에 정확한 필요성과 대상 파일을 사용자에게 알립니다.
- 문서나 지침만 변경하여 앱 공통 소스가 바뀌지 않은 커밋은 불필요한 배포를 실행하지 않습니다.

## ZIP -47 검사

- macOS ZIP 실행 오류를 찾을 때 일반적인 `-47` 부분 문자열 전체를 오류로 판단하지 않습니다.
- UUID의 `-474E` 같은 정상 문자열을 제외하고 `OSStatus error -47`, `fBsyErr`, `Resource busy` 등 실제 오류 표현만 판별합니다.
- 기존 워크플로의 16진 문자 경계 검사를 더 넓은 단순 검색으로 되돌리지 않습니다.

## 필수 배포 검증

- 기존 워크플로의 Windows·Mac 공통 소스 비교와 문법 검사를 통과해야 합니다.
- Windows는 CRLF/LF 정규화 후 같은 커밋의 공통 변경이 반영됐는지 확인합니다.
- Mac은 AppleDouble(`._`), `__MACOSX`, `.DS_Store`, `__pycache__` 부재를 확인합니다.
- Mac 실행 권한, 프레임워크 심볼릭 링크, 끊어진 링크 부재, ZIP 무결성, `ditto` 압축 해제, 코드 서명, Electron 실행, 번들 Python 경로 및 이번 공통 변경을 확인합니다.
- 검증된 두 빌드가 모두 성공한 뒤에만 릴리스 자산을 교체합니다.
- 게시 단계에서 빌드 ZIP 두 개와 GitHub 원격 자산의 SHA-256이 각각 일치해야 하고, 릴리스 자산 수가 정확히 두 개여야 합니다.
- 실제 게시된 Mac ZIP의 검증 작업까지 성공해야 배포 완료로 판단합니다.

## 중복 최종검사 금지

- 기존 워크플로 전체가 성공한 뒤 같은 Windows·Mac ZIP을 로컬로 다시 내려받아 워크플로와 동일한 검사를 반복하지 않습니다.
- 최종 확인은 워크플로의 `headSha`, 전체 성공 여부, 릴리스 자산 두 개의 이름·크기·SHA-256·갱신 시각, 저장소의 깨끗한 상태로 제한합니다.
- 워크플로에서 이미 확인한 공통 파일 전체 비교, Mac 메타데이터, 심볼릭 링크, 서명, Electron 및 Python 실행을 로컬에서 다시 반복하지 않습니다.
- 워크플로가 실패했을 때만 실패한 정확한 단계와 관련된 검사를 추가로 수행합니다.
