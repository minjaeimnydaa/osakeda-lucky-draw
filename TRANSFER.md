# 다른 컴퓨터로 기록 옮기기

이 도구는 현재 버전과 V2의 로컬 기록을 각각 보존합니다. 이벤트 설정, 발급 코드의 해시, 참여·당첨·이메일·발급 상태와 관리자 설정을 함께 옮깁니다. 두 버전의 기록을 합치거나 원본을 지우지 않습니다.

## 현재 컴퓨터에서 백업

저장소 최상위 폴더에서 Node.js 24로 실행합니다.

```sh
node tools/records.mjs backup
```

`private-transfer/records-.../` 폴더에 암호화된 `records.osakeda-backup`과 복구 키 `restore-key.txt`가 생성됩니다. 이 두 파일은 GitHub에 올라가지 않습니다. 백업 파일을 새 컴퓨터로 가져가고, 복구 키는 별도의 안전한 경로로 전달하세요. 키가 없으면 기록을 복원할 수 없습니다.

백업은 실행 중인 SQLite의 온라인 백업 기능을 사용합니다. `.data/events.sqlite`만 직접 복사하면 최근 기록이 누락될 수 있습니다. DB 무결성과 건수를 확인한 스냅샷을 사용하며, 별도 모션 테스트 DB는 포함하지 않습니다. 백업 이후에 생긴 기록도 옮기려면 백업을 다시 생성합니다.

## 새 컴퓨터에서 복원

1. GitHub 저장소를 새 폴더에 복제합니다.
2. **아직 `node server.js`를 실행하지 않습니다.** 두 프로젝트에 새 DB나 `.env.local`이 생기기 전에 복원합니다.
3. 백업 파일과 복구 키 파일을 준비하고 저장소 최상위 폴더에서 실행합니다. 아래 경로는 실제 파일 위치로 바꿉니다.

```sh
node tools/records.mjs restore "C:/transfer/records.osakeda-backup" "C:/separate-location/restore-key.txt"
```

4. 복원 완료 메시지를 확인한 다음 원하는 버전을 실행합니다.

```sh
cd lucky-draw-v2
node server.js
```

원래 관리자 비밀번호와 참여 코드로 다시 접속할 수 있습니다. 브라우저 로그인 자체는 새 컴퓨터에서 다시 해야 할 수 있습니다. 이미 새 기록이 생성된 폴더에는 덮어쓰지 않습니다. 그 경우 기존 폴더를 보관하고 새로 복제한 폴더에서 복원하세요.

복원 도구는 두 버전의 복호화·무결성·건수를 먼저 검사하고, 고정된 `.env.local`과 `.data/events.sqlite` 경로에만 기록합니다. 기존 DB·설정·WAL/SHM 파일이 있으면 중단합니다. 사용자 이메일이나 비밀번호는 로그에 출력하지 않습니다.

## Vercel에 연결한 뒤 수정하기

Vercel 연결이 코드 수정을 더 어렵게 만들지는 않습니다. GitHub의 코드를 수정해 올리면 연결된 브랜치에 새 배포를 만들 수 있습니다. 작업 브랜치의 미리보기에서 확인하고 운영 브랜치에 반영하는 흐름으로 관리하면 됩니다.

현재 프로젝트의 로컬 DB는 SQLite이고, Vercel 운영 실행은 `DATABASE_URL`을 통한 PostgreSQL 연결을 요구합니다. 이 백업은 **다른 컴퓨터의 로컬 개발 환경 복원용**이며 PostgreSQL 이관 도구는 아닙니다. Vercel 운영에 기존 기록을 이어 쓰려면 해당 버전의 DB와 보안 키를 운영용 DB로 한 번 이관해야 합니다.

- 현재 버전과 V2를 각각 배포하려면 같은 GitHub 저장소에서 Root Directory를 각각 `lucky-draw`, `lucky-draw-v2`로 지정합니다.
- 테스트·미리보기와 운영의 DB 및 환경 변수를 분리합니다. 테스트가 운영 경품 수량이나 당첨 기록에 영향을 주지 않게 합니다.
- `DATABASE_URL`, `SESSION_SECRET`, `ADMIN_PASSWORD`는 Vercel 환경 변수에 설정합니다. 원래 기록을 이관할 경우 해당 버전의 `SESSION_SECRET`을 유지해야 고객 식별이 이어집니다.
- 경품 수량·확률·기간 변경은 기존 관리자 정책을 따릅니다. 화면 배포를 되돌리는 것과 DB 기록을 되돌리는 것은 별개입니다.

확인한 공식 문서: [Git 연동 배포](https://vercel.com/docs/git), [환경 변수 분리](https://vercel.com/docs/environment-variables), [PostgreSQL 연결](https://vercel.com/docs/marketplace-storage), [SQLite 온라인 백업](https://nodejs.org/download/release/v24.8.0/docs/api/sqlite.html#sqlitebackupsourceDb-path-options).
