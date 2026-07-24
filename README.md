# IELTS 7.0 · 28일 스프린트

빌드 과정이 없는 정적 사이트입니다. `index.html` 하나로 동작하며 프레임워크·의존성·서버가 필요 없습니다.

## Netlify에 올리기

**방법 1 — 드래그 앤 드롭 (가장 빠름, 1분)**

1. https://app.netlify.com/drop 접속
2. `ielts-sprint` 폴더를 통째로 브라우저에 끌어다 놓기 (또는 `ielts-sprint.zip` 업로드)
3. 끝. `random-name-123.netlify.app` 주소가 즉시 발급됩니다
4. Site configuration → Change site name 에서 주소를 원하는 이름으로 변경

**방법 2 — Git 연동 (수정할 때마다 자동 재배포)**

GitHub 저장소에 올린 뒤 Netlify에서 "Add new site → Import an existing project"로 연결합니다.

| 항목 | 값 |
|---|---|
| Build command | *(비워둠)* |
| Publish directory | `.` |

**방법 3 — CLI**

```bash
npm install -g netlify-cli
cd ielts-sprint
netlify deploy --prod --dir=.
```

## 파일

```
ielts-sprint/
├── index.html      전체 앱 (HTML + CSS + JS)
├── netlify.toml    배포 설정 및 보안 헤더
└── README.md
```

## 데이터가 저장되는 방식

기록은 **브라우저의 localStorage**에 저장됩니다. 서버도 계정도 없습니다.

- 배포된 주소에서 열면 자동 저장되고 새로고침해도 유지됩니다
- **기기·브라우저마다 별도로 저장됩니다.** 폰과 노트북이 동기화되지 않습니다
- 시크릿 모드나 브라우저 데이터 삭제 시 사라집니다
- 한 기기를 정해서 쓰는 걸 권합니다. 폰으로 체크하실 거면 폰에서만 쓰세요

저장이 불가능한 환경(일부 미리보기 창 등)에서는 상단에 경고 배너가 뜨고, 그 세션에서만 기록이 유지됩니다.

## 폰 홈 화면에 추가

배포 후 모바일 브라우저에서 열고 "홈 화면에 추가"를 하면 앱처럼 전체화면으로 실행됩니다. 매일 여는 도구이므로 이걸 권합니다.

## 고치고 싶을 때

`index.html` 상단의 자바스크립트 상수만 바꾸면 됩니다.

| 상수 | 내용 |
|---|---|
| `ROTATION` | 요일별 학습 항목과 소요 시간 |
| `WEEKS` | 주차별 주제·지침·목표 |
| `PRESETS` | 타이머 프리셋 (초 단위) |
| `REF` | 영역별 핵심 기술 아코디언 내용 |
| `CAUSES` | 오답 원인 분류 |

예를 들어 Speaking 시간을 늘리고 싶으면 `ROTATION`의 해당 요일 배열에 `["Speaking 섀도잉", 20]`을 추가하면 그리드·진행률·체크리스트에 자동 반영됩니다.

## 점수 계산 규칙

Overall은 4영역 평균을 반 밴드 단위로 반올림합니다. 평균이 **.25면 다음 반 밴드로, .75면 다음 정수 밴드로 올림**됩니다.

따라서 **합계 27.0 (평균 6.75) 이면 Overall 7.0** 입니다. 예: L 7.5 / R 7.0 / W 6.0 / S 6.5.

지원처가 Overall 외에 영역별 최저 점수를 함께 요구하는 경우가 많으니 요강을 먼저 확인하세요.
