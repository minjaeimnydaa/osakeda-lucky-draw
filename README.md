# OSAKEDA Lucky Draw

오사케다 구매 고객을 위한 외부 럭키 드로우 이벤트입니다.

| 프로젝트 | 용도 | 로컬 주소 |
|---|---|---|
| `lucky-draw` | 현재 버전 | http://localhost:3000 |
| `lucky-draw-v2` | 별도 개선 버전 | http://localhost:3001 |

Node.js 24 이상에서 각 프로젝트 폴더의 `node server.js`를 실행합니다. 테스트는 각 폴더에서 `node --test test/*.test.js`로 실행합니다.

기존 참여·당첨 기록과 관리자 설정도 함께 옮길 때는 **서버를 처음 실행하기 전에** [TRANSFER.md](TRANSFER.md)를 확인합니다. 두 버전의 기록을 암호화해 백업하고 새 컴퓨터에서 복원하는 도구가 `tools/records.mjs`에 있습니다.

실행·Vercel 배포 방법은 각 프로젝트의 `README.md`, 개선 사항은 `lucky-draw-v2/V2-NOTES.md`를 참고합니다. 로컬 테스트 DB와 비밀번호는 실행 시 각 프로젝트에 따로 생성되며 Git에는 포함되지 않습니다. 참여·당첨·이메일 기록과 CSV 내보내기, 화면 캡처, 설치된 의존성도 제외합니다.
