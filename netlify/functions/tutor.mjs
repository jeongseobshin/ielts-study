/**
 * IELTS AI 튜터 프록시
 *
 * 왜 서버 함수가 필요한가:
 *  1) API 키를 브라우저에 노출하지 않기 위해 (env var로만 읽음)
 *  2) api.anthropic.com은 브라우저 직접 호출 시 CORS로 막히기 때문
 *  3) 시스템 프롬프트를 서버에 고정해, 공개 URL이 범용 챗봇으로 악용되는 것을 막기 위해
 *
 * 환경변수 (Netlify → Site configuration → Environment variables):
 *   AI_PROVIDER         선택. "anthropic"(기본) 또는 "gemini"
 *
 *   -- Anthropic(Claude)을 쓸 때 --
 *   ANTHROPIC_API_KEY   provider가 anthropic이면 필수. https://console.anthropic.com 에서 발급
 *   TUTOR_MODEL         선택. 기본 claude-sonnet-5
 *
 *   -- Gemini를 쓸 때 (AI_PROVIDER=gemini) --
 *   GEMINI_API_KEY      필수. https://aistudio.google.com/apikey 에서 발급 (무료 티어 있음)
 *   GEMINI_MODEL        선택. 기본 gemini-2.5-flash
 *
 *   TUTOR_PASSCODE      선택(공통). 설정하면 이 값을 아는 사람만 사용 가능
 */

const API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const PROVIDER = (process.env.AI_PROVIDER || "anthropic").toLowerCase();
const CAUSES = ["어휘 모름", "패러프레이즈", "시간 부족", "함정", "철자·형태"];

/* ---------- 공통 출력 규약 ---------- */
const SHAPE = `
반드시 아래 JSON 객체 **하나만** 출력한다. 마크다운 코드펜스, 설명, 인사말을 절대 붙이지 않는다.

{
  "verdict": "핵심을 짚는 한 문장. 한국어.",
  "bands": [{"label":"문자열","score":6.5,"comment":"한 문장 근거"}],
  "overall": 6.5,
  "fixes": [{"issue":"무엇이 문제인가","why":"왜 감점 요인인가","before":"원문 그대로","after":"고친 문장"}],
  "tips": ["다음에 같은 유형을 만났을 때 쓸 구체적 전략 한 줄"],
  "notes": [{"area":"Reading","cause":"함정","note":"오답노트에 남길 한 문장"}]
}

규칙:
- "cause"는 반드시 다음 중 하나: ${CAUSES.join(" / ")}
- "area"는 반드시 다음 중 하나: Listening / Reading / Writing / Speaking
- "notes"는 1~3개. 사용자가 실제로 반복할 실수만 남긴다. 일반론 금지.
- "fixes"의 "before"는 사용자가 실제로 쓴 표현을 그대로 인용한다. 지어내지 않는다.
- 해설·조언은 모두 한국어로 쓰되, 영어 예문과 문법 용어는 영어 그대로 둔다.
- 칭찬을 위한 칭찬을 하지 않는다. 점수를 실제보다 후하게 주지 않는다.
`.trim();

/* ---------- PDF → CBT 구조화 프롬프트 ---------- */
const IMPORT_SYS = `
너는 IELTS Academic Reading 시험지 텍스트를 컴퓨터 시험(CBT) 데이터로 변환하는 파서다.
입력은 사용자가 소유한 PDF 문제집에서 추출한 원문 텍스트다(지문 1개 + 그에 딸린 문제들, 그리고 있다면 정답 키).
너의 임무는 이 텍스트를 아래 JSON 스키마로 정확히 옮기는 것이다. 새 문제를 창작하지 말고, 원문에 있는 것만 옮긴다.

반드시 아래 JSON 객체 **하나만** 출력한다. 마크다운 코드펜스, 설명, 인사말을 절대 붙이지 않는다.

{
  "title": "지문 제목(원문에 있으면 그대로, 없으면 첫 문장에서 짧게 지어낸 제목)",
  "src": "출처 한 줄. 예: 사용자 제공 PDF · Reading Passage 1",
  "paras": [["A","문단 원문 전체"], ["B","문단 원문 전체"]],
  "headings": ["i. 보기 문구", "ii. 보기 문구"],
  "groups": [
    {"g":"Questions 1-6", "gi":"문제 지시문 원문", "type":"heading",
     "qs":[{"n":1,"q":"Paragraph A","a":"iv","ev":"A"}]},
    {"g":"Questions 7-10", "gi":"지시문", "type":"tfng",
     "qs":[{"n":7,"q":"진술문 원문","a":"FALSE","ev":"C"}]},
    {"g":"Questions 11-13", "gi":"지시문", "type":"mcq",
     "qs":[{"n":11,"q":"질문 원문","opts":["A. 보기","B. 보기","C. 보기","D. 보기"],"a":"C. 보기","ev":"D"}]},
    {"g":"Questions 14-16", "gi":"지시문", "type":"gap", "summary":"__14__ 가 들어간 요약문(있을 때만)",
     "qs":[{"n":14,"q":"Gap 14","a":"정답단어","ev":"E"}]}
  ]
}

규칙:
- "paras": 지문을 문단 단위로 나눈다. 원문에 A/B/C… 문단 라벨이 있으면 그 라벨을 쓰고, 없으면 "A","B","C"… 순서로 직접 매긴다. 문단 본문은 요약하지 말고 원문 그대로 옮긴다.
- "headings": Matching Headings 문제가 있을 때만 그 보기 목록을 넣는다. 없으면 빈 배열 [].
- "type"은 반드시 다음 중 하나: heading / tfng / ynng / mcq / gap
    · heading = 문단에 소제목 매칭. "a"는 로마숫자(i, ii, …), "q"는 "Paragraph A" 형식.
    · tfng = True / False / Not Given. "a"는 정확히 "TRUE" / "FALSE" / "NOT GIVEN" 중 하나.
    · ynng = Yes / No / Not Given. "a"는 정확히 "YES" / "NO" / "NOT GIVEN" 중 하나.
    · mcq = 객관식. "opts"에 보기 전체를 넣고, "a"는 정답 보기 문자열을 opts 중 하나와 **완전히 동일하게** 넣는다.
    · gap = 빈칸/문장완성/요약완성/단답. 요약문이 하나로 이어지면 그룹에 "summary"를 넣고 각 "q"는 "Gap N". 개별 문장완성이면 "summary"를 생략하고 "q"에 문항 원문을 넣는다. "a"는 정답 단어(들). 허용 답이 여러 개면 "word1|word2"처럼 세로줄로 구분한다.
- "a"(정답): 입력 텍스트에 정답 키가 포함되어 있으면 반드시 그 정답을 쓴다. 정답 키가 없으면 지문 근거로 직접 풀어서 채운다. 추측이면 그래도 가장 근거 있는 답을 하나 고른다.
- "ev": 정답의 근거가 되는 문단 라벨(paras의 라벨과 일치). 모르면 첫 문단 라벨을 쓴다.
- "n"(문항 번호): 원문 번호를 그대로 쓴다. 전체에서 유일해야 한다.
- 지문·문제·보기의 영어 원문은 번역하거나 바꾸지 말고 그대로 둔다.
- 텍스트가 IELTS Reading 지문·문제 형식이 아니거나 문제를 하나도 찾을 수 없으면, 다음만 출력한다: {"error":"이 텍스트에서 Reading 문제를 찾지 못했습니다. 지문과 문제(가능하면 정답 페이지)가 함께 포함된 페이지를 선택했는지 확인하세요."}
`.trim();

/* ---------- 책 전체 색인(목차) 프롬프트 ---------- */
const BOOK_INDEX_SYS = `
너는 IELTS 문제집(케임브리지 등) PDF의 페이지별 앞부분 요약을 받아, 어떤 페이지가 어느 Test·영역인지 목차를 만드는 색인기다.
입력은 "P{번호}: {그 페이지 앞부분 텍스트}" 목록이며, 번호는 1부터 시작하는 페이지 순번이다.

반드시 아래 JSON 하나만 출력한다. 코드펜스·설명 금지.

{
  "tests": [
    {"n":1,
     "listening":[[start,end]],
     "reading":[[start,end]],
     "writing":[[start,end]],
     "speaking":[[start,end]]}
  ],
  "answerKey":[[start,end]],
  "audioscript":[[start,end]],
  "sampleAnswers":[[start,end]]
}

규칙:
- 페이지 번호는 입력의 P번호(1-기반)를 그대로 쓴다. 범위는 [시작,끝] 포함. 여러 구간이면 배열에 여러 개.
- Test별로 각 영역이 시작·끝나는 페이지를 최대한 정확히 잡는다. 없으면 빈 배열 [].
- Listening=Part/Section 1~4, reading=Reading Passage 1~3, writing=Writing Task 1~2, speaking=Part 1~3.
- 정답(Answers/Answer key)과 오디오 대본(Audioscript/Listening script/Tapescript/Transcript)은 보통 책 뒤쪽에 몰려 있다. Test별이 아니라 문서 전체 기준 범위로 answerKey/audioscript에 넣는다.
- sampleAnswers = Writing/Speaking의 공식 모범답안(Model/Sample answer)과 시험관 코멘트(examiner's comment)가 실린 페이지. 있으면 문서 전체 기준 범위로 넣고, 없으면 빈 배열 [].
- 페이지 번호를 지어내 입력 범위를 벗어나지 않는다. 확실치 않으면 가장 그럴듯한 범위를 넣는다.
- IELTS 문제집 구조가 전혀 아니면 {"error":"이 PDF에서 IELTS 시험 구조를 찾지 못했습니다."}만 출력.
`.trim();

/* ---------- Listening → CBT 구조화 프롬프트 ---------- */
const LISTENING_IMPORT_SYS = `
너는 IELTS Listening 시험지 텍스트를 CBT 데이터로 변환하는 파서다.
입력은 한 Test의 Listening 문제(보통 Section/Part 1~4)와, 있다면 정답 키·오디오 대본이다.
새 문제를 창작하지 말고 원문에 있는 것만 옮긴다.

반드시 아래 JSON 하나만 출력한다. 코드펜스·설명 금지.

{
  "title":"Test N Listening",
  "sections":[
    {"n":1,"gi":"이 섹션 상황 설명(있으면)",
     "groups":[
       {"g":"Questions 1-6","gi":"지시문","type":"gap","summary":"노트/폼/표/요약 완성문(있을 때만)",
        "qs":[{"n":1,"q":"문항 원문","opts":["A. ..","B. .."],"a":"정답","ev":"1"}]}
     ]}
  ]
}

규칙:
- 각 섹션(1~4)의 문제를 sections에 순서대로 넣는다.
- "type": gap(빈칸·폼·노트·표·요약 완성·단답) / mcq(객관식) / tfng(참/거짓) / matching(보기 목록에서 고르기 → opts로 표현, mcq처럼 취급).
- gap 정답 "a"는 정답 단어(들). 허용 답이 여럿이면 "a|b". 숫자·철자 원문 그대로.
- mcq/matching은 "opts"에 보기 전체, "a"는 opts 중 하나와 완전히 동일하게.
- "n"은 원문 문항 번호(1~40 등) 그대로, 전체에서 유일.
- "ev"는 이 문항이 속한 섹션 번호(문자열).
- 정답 키가 입력에 있으면 반드시 그 정답을 쓴다. 없으면 오디오 대본 근거로 채운다. 둘 다 없으면 빈 문자열.
- 영어 원문은 번역하지 않는다.
- Listening 문제를 찾지 못하면 {"error":"이 텍스트에서 Listening 문제를 찾지 못했습니다."}만 출력.
`.trim();

/* ---------- Writing 과제 추출 프롬프트 ---------- */
const WRITING_IMPORT_SYS = `
너는 IELTS Writing 시험지 텍스트에서 과제와, (있다면) 그 책의 공식 모범답안·시험관 코멘트를 추출하는 파서다.
반드시 아래 JSON 하나만 출력한다. 코드펜스·설명 금지.

{"task1":{"prompt":"Task 1 문제 원문(지시문 포함)","chartNote":"그림·차트·표 정보(없으면 빈 문자열)","model":"이 책의 공식 모범답안 원문(있으면 그대로, 없으면 빈 문자열)","comment":"시험관 코멘트 원문(있으면 그대로, 없으면 빈 문자열)"},
 "task2":{"prompt":"Task 2 문제 원문 전체","model":"공식 모범답안 원문(없으면 빈 문자열)","comment":"시험관 코멘트 원문(없으면 빈 문자열)"}}

규칙:
- 원문 지시문("You should spend about 20 minutes...", "Write at least 150/250 words" 등)까지 포함해 그대로 옮긴다. 번역 금지.
- Task 1은 보통 그림/차트/표를 동반한다. PDF 텍스트에는 이미지가 없으므로, 캡션·축·수치 등 텍스트로 남은 정보를 chartNote에 담는다. 없으면 빈 문자열.
- "model"(모범답안)과 "comment"(시험관 코멘트)는 입력 텍스트(정답·샘플 페이지 포함)에 그 내용이 실제로 있을 때만 원문 그대로 채운다. 없으면 반드시 빈 문자열. 절대 지어내지 않는다.
- model/comment가 어느 Task(1/2)의 것인지 본문 표시(예: "Sample answer for Task 2")로 판별해 해당 Task에 넣는다.
- 해당 Task 자체가 없으면 그 prompt를 빈 문자열로 둔다.
- Writing 과제를 찾지 못하면 {"error":"이 텍스트에서 Writing 과제를 찾지 못했습니다."}만 출력.
`.trim();

/* ---------- Speaking 자료 추출 프롬프트 ---------- */
const SPEAKING_IMPORT_SYS = `
너는 IELTS Speaking 시험지 텍스트에서 파트별 질문을 추출하는 파서다.
반드시 아래 JSON 하나만 출력한다. 코드펜스·설명 금지.

{"parts":[
  {"part":"1","cue":"Part 1 주제와 질문들 원문"},
  {"part":"2","cue":"Part 2 큐카드 원문 전체 (Describe... You should say: ...)"},
  {"part":"3","cue":"Part 3 토론 질문들 원문"}
]}

규칙:
- 각 파트의 원문 질문을 그대로 옮긴다. 번역 금지.
- 없는 파트는 빼도 된다.
- Speaking 자료를 찾지 못하면 {"error":"이 텍스트에서 Speaking 자료를 찾지 못했습니다."}만 출력.
`.trim();

/* ---------- 태스크별 시스템 프롬프트 ---------- */
const SYSTEMS = {
  writing: `
너는 IELTS Writing 공식 채점 기준(Band Descriptors, public version)에 정통한 채점관이다.
응시자는 현재 6.0~6.5 수준이며 한 달 뒤 시험에서 Overall 7.0을 목표로 한다.

채점:
- 4개 기준을 각각 0.5 단위로 채점한다: Task Response(또는 Task Achievement), Coherence and Cohesion, Lexical Resource, Grammatical Range and Accuracy.
- overall은 네 점수의 평균을 0.5 단위로 반올림한 값이다.
- 실제 시험은 짜다. 6.5를 줄지 7.0을 줄지 망설여지면 낮은 쪽을 준다. 후한 점수는 응시자에게 해롭다.
- 단어 수 미달(Task 1은 150, Task 2는 250)이면 Task Response에서 반드시 감점하고 verdict에 명시한다.

피드백:
- "fixes"는 3~5개. 점수에 가장 큰 영향을 주는 순서로 정렬한다.
- 사소한 오타보다 반복되는 구조적 문제(입장 불명확, 문단에 중심 문장 없음, 예시 없음, 같은 문형 반복)를 우선한다.
- "after"는 응시자의 현재 수준에서 실제로 쓸 수 있는 문장으로 고친다. 밴드 9 문장으로 바꿔놓지 않는다.
- "tips"는 2~3개. 이번 글에만 해당하는 게 아니라 다음 글에서 재사용할 수 있는 규칙으로 쓴다.
- 암기 템플릿 표현("In this ever-changing modern world" 등)을 발견하면 반드시 지적한다. 실제 시험에서 감점 요인이다.

${SHAPE}`,

  reading: `
너는 IELTS Reading 문제 유형별 함정 구조를 가르치는 튜터다.
응시자가 틀린 문항 하나를 받아, 왜 틀렸는지와 다음에 어떻게 다르게 접근할지를 가르친다.

- "bands"와 "overall"은 빈 배열과 null로 둔다. 이 태스크는 채점이 아니다.
- "verdict": 왜 오답인지 한 문장. 정답 근거가 지문의 어느 부분인지 짚는다.
- "fixes": 1~2개. "before"에는 응시자가 고른 선택지, "after"에는 정답과 그 근거를 넣는다.
- "tips": 이 문제 유형(True/False/Not Given, Matching Headings, Summary Completion 등)에서 통하는 일반 전략 1~2개.
- True/False/Not Given이면 False(지문이 반대로 말함)와 Not Given(지문에 언급 자체가 없음)의 차이를 이 문항에 빗대어 설명한다.
- 응시자가 지문 대신 상식이나 배경지식으로 판단했는지 판별하고, 그렇다면 지적한다.
- 지문 원문을 길게 옮겨 적지 않는다. 근거는 짧게 인용하거나 요약한다.

${SHAPE}`,

  speaking: `
너는 IELTS Speaking 시험관이다. 응시자가 자신의 답변을 옮겨 적은 스크립트를 받는다.
스크립트에는 발음·억양 정보가 없으므로 Pronunciation은 채점하지 않는다.

- "bands"는 3개만: Fluency and Coherence, Lexical Resource, Grammatical Range and Accuracy.
- "overall"은 이 3개의 평균을 0.5 단위로 반올림하되, verdict에 "발음 미반영 추정치"임을 밝힌다.
- Part 2라면 2분 분량(대략 220~300단어)에 못 미치는지 확인하고, 부족하면 지적한다.
- 같은 표현 반복, 지나치게 짧은 답변, 질문에서 벗어난 내용을 우선 지적한다.
- "tips"에는 다음 답변에서 바로 쓸 수 있는 확장 표현틀을 포함한다.
- 문어체로 고쳐주지 않는다. Speaking은 자연스러운 구어가 정답이다.

${SHAPE}`,

  import: IMPORT_SYS,
  book_index: BOOK_INDEX_SYS,
  listening_import: LISTENING_IMPORT_SYS,
  writing_import: WRITING_IMPORT_SYS,
  speaking_import: SPEAKING_IMPORT_SYS
};

/* ---------- 사용자 메시지 조립 ---------- */
function buildUserMessage(task, p) {
  const clip = (s, n) => String(s ?? "").slice(0, n);

  if (task === "writing") {
    return [
      `[유형] ${p.taskType === "task1" ? "Academic Task 1 (최소 150단어)" : "Task 2 (최소 250단어)"}`,
      `[문제]\n${clip(p.prompt, 1200)}`,
      p.chartNote ? `[시각자료 설명]\n${clip(p.chartNote, 800)}` : "",
      `[응시자 답안 · ${String(p.essay || "").trim().split(/\s+/).filter(Boolean).length}단어]\n${clip(p.essay, 9000)}`
    ].filter(Boolean).join("\n\n");
  }

  if (task === "reading") {
    return [
      `[문제 유형] ${clip(p.qtype, 80)}`,
      `[문항] ${clip(p.question, 800)}`,
      p.choices ? `[선택지] ${clip(p.choices, 800)}` : "",
      `[응시자 답] ${clip(p.userAnswer, 200) || "(무응답)"}`,
      `[정답] ${clip(p.correctAnswer, 200)}`,
      `[지문 근거 부분]\n${clip(p.evidence, 1500)}`
    ].filter(Boolean).join("\n");
  }

  if (task === "speaking") {
    return [
      `[Part ${clip(p.part, 4)}]`,
      `[질문/큐카드]\n${clip(p.cue, 800)}`,
      `[응시자 스크립트]\n${clip(p.transcript, 6000)}`
    ].join("\n\n");
  }

  if (task === "import" || task === "listening_import" || task === "writing_import" || task === "speaking_import") {
    return `아래는 PDF 문제집에서 추출한 원문 텍스트다. 위 스키마대로 변환하라.\n\n[추출 텍스트]\n${clip(p.text, 45000)}`;
  }

  if (task === "book_index") {
    return `아래는 책 각 페이지의 앞부분 요약이다. 위 스키마대로 목차 색인을 만들라.\n\n${clip(p.text, 45000)}`;
  }
  return null;
}

const EXTRACT_TASKS = new Set(["import", "book_index", "listening_import", "writing_import", "speaking_import"]);

function maxTokensFor(task) {
  if (task === "import" || task === "listening_import") return 8000;
  if (task === "book_index") return 4000;
  if (task === "writing_import") return 6000;
  if (task === "speaking_import") return 3000;
  return task === "reading" ? 1200 : 2500;
}

/* ---------- 프로바이더별 호출 ---------- */
/* 성공: { text, usage }  ·  실패: { errStatus, errMsg } */
async function callAnthropic({ system, userMsg, task }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { errStatus: 500, errMsg: "서버에 ANTHROPIC_API_KEY가 설정되지 않았습니다. Netlify → Site configuration → Environment variables에서 추가한 뒤 재배포하세요." };

  let res, data;
  try {
    res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": ANTHROPIC_VERSION
      },
      body: JSON.stringify({
        model: process.env.TUTOR_MODEL || "claude-sonnet-5",
        max_tokens: maxTokensFor(task),
        temperature: EXTRACT_TASKS.has(task) ? 0 : 0.2,
        system,
        messages: [{ role: "user", content: userMsg }]
      })
    });
    data = await res.json();
  } catch (e) {
    return { errStatus: 502, errMsg: "Anthropic API에 연결하지 못했습니다: " + e.message };
  }

  if (!res.ok) {
    const m = data?.error?.message || "알 수 없는 오류";
    if (res.status === 401) return { errStatus: 401, errMsg: "API 키가 유효하지 않습니다. 키를 다시 확인하세요." };
    if (res.status === 429) return { errStatus: 429, errMsg: "요청이 너무 많습니다. 잠시 후 다시 시도하세요." };
    if (res.status === 400 && /model/i.test(m)) return { errStatus: 400, errMsg: `모델 이름이 올바르지 않습니다 (${m}). 환경변수 TUTOR_MODEL을 현재 사용 가능한 모델로 바꾸세요.` };
    return { errStatus: res.status, errMsg: m };
  }

  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  return { text, usage: data.usage || null };
}

async function callGemini({ system, userMsg, task }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { errStatus: 500, errMsg: "서버에 GEMINI_API_KEY가 설정되지 않았습니다. https://aistudio.google.com/apikey 에서 발급해 Netlify 환경변수에 추가한 뒤 재배포하세요." };
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  const generationConfig = {
    temperature: EXTRACT_TASKS.has(task) ? 0 : 0.2,
    maxOutputTokens: maxTokensFor(task),
    responseMimeType: "application/json"
  };
  // 2.5 계열은 기본으로 '사고(thinking)'가 켜져 출력 토큰을 소모하므로 구조화 추출에서는 끈다.
  if (/2\.5/.test(model)) generationConfig.thinkingConfig = { thinkingBudget: /pro/.test(model) ? 128 : 0 };

  let res, data;
  try {
    res = await fetch(`${GEMINI_BASE}/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: userMsg }] }],
        generationConfig
      })
    });
    data = await res.json();
  } catch (e) {
    return { errStatus: 502, errMsg: "Gemini API에 연결하지 못했습니다: " + e.message };
  }

  if (!res.ok) {
    const m = data?.error?.message || "알 수 없는 오류";
    if (res.status === 400 && /api[_ ]?key/i.test(m)) return { errStatus: 401, errMsg: "Gemini API 키가 유효하지 않습니다. 키를 다시 확인하세요." };
    if (res.status === 429) return { errStatus: 429, errMsg: "요청이 너무 많습니다(무료 티어 한도일 수 있습니다). 잠시 후 다시 시도하세요." };
    if (/model/i.test(m) && /not found|not supported|invalid/i.test(m)) return { errStatus: 400, errMsg: `모델 이름이 올바르지 않습니다 (${m}). 환경변수 GEMINI_MODEL을 확인하세요.` };
    return { errStatus: res.status, errMsg: m };
  }

  const cand = (data.candidates || [])[0];
  if (!cand) {
    const br = data?.promptFeedback?.blockReason;
    return { errStatus: 502, errMsg: br ? ("Gemini가 요청을 차단했습니다: " + br) : "Gemini 응답이 비어 있습니다. 다시 시도해 주세요." };
  }
  if (cand.finishReason === "MAX_TOKENS") {
    // 응답이 잘렸을 수 있음 — 텍스트는 그대로 넘겨 파싱을 시도하되, import면 페이지를 줄이도록 유도.
  }
  const text = ((cand.content && cand.content.parts) || [])
    .map((p) => p.text || "")
    .join("\n");
  return { text, usage: data.usageMetadata || null };
}

/* ---------- 핸들러 ---------- */
export default async (req) => {
  const cors = {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "POST, OPTIONS"
  };
  const fail = (status, msg) =>
    new Response(JSON.stringify({ error: msg }), { status, headers: cors });

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return fail(405, "POST만 허용됩니다.");

  let body;
  try { body = await req.json(); } catch { return fail(400, "요청 본문이 올바른 JSON이 아닙니다."); }

  const gate = process.env.TUTOR_PASSCODE;
  if (gate && body.passcode !== gate) return fail(401, "패스코드가 올바르지 않습니다.");

  const system = SYSTEMS[body.task];
  if (!system) return fail(400, "알 수 없는 task입니다. writing / reading / speaking / import 중 하나여야 합니다.");

  const userMsg = buildUserMessage(body.task, body.payload || {});
  if (!userMsg) return fail(400, "요청 내용을 조립하지 못했습니다.");

  const out = PROVIDER === "gemini"
    ? await callGemini({ system, userMsg, task: body.task })
    : await callAnthropic({ system, userMsg, task: body.task });

  if (out.errMsg) return fail(out.errStatus || 502, out.errMsg);

  const text = String(out.text || "")
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```\s*$/, "")
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const s = text.indexOf("{"), e = text.lastIndexOf("}");
    if (s > -1 && e > s) { try { parsed = JSON.parse(text.slice(s, e + 1)); } catch {} }
  }
  if (!parsed) return fail(502, "튜터 응답을 해석하지 못했습니다. 다시 시도해 주세요." + (body.task === "import" ? " (문제집이 길면 선택 페이지를 줄여 보세요.)" : ""));

  return new Response(JSON.stringify({
    ok: true,
    provider: PROVIDER,
    result: parsed,
    usage: out.usage || null
  }), { status: 200, headers: cors });
};

/*
 * 경로 라우팅은 netlify.toml의 [[redirects]] (/api/tutor → 이 함수)로 처리한다.
 * 코드 안 config.path 지정은 일부 배포 환경에서 반영되지 않아 /api/tutor가
 * 404가 되는 경우가 있어, 명시적 리라이트 방식으로 통일했다.
 * 이 함수의 기본 엔드포인트는 /.netlify/functions/tutor 이다.
 */
