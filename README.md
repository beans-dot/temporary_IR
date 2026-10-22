# 연성대학교 IR 대시보드 (YSU Institutional Research Archive)

대학알리미 공시 데이터와 자체 데이터를 통합 분석하는 IR(Institutional Research) 대시보드 시스템입니다.

## 아키텍처

```
IR_dashboard/
├─ frontend/   Next.js 14 (App Router) + TypeScript + Tailwind + shadcn/ui + Recharts + Zustand
├─ backend/    NestJS + TypeORM + PostgreSQL
├─ scripts/    로컬 PostgreSQL 초기화 (init-db.ps1)
├─ package.json
└─ .env.example
```

- 상태 관리: Zustand (`frontend/src/store/useDashboardStore.ts`) — Props Drilling 없이 전역 관리
- 차트: Recharts 기반 하이브리드 차트 (Auto-Scaling, connectNulls=false, 데이터 라벨/추세선/기준선 토글, PNG Export)
- DnD: `@hello-pangea/dnd` (관리자 지표 트리 빌더)
- 파서: `fast-xml-parser`(대학알리미 API), `exceljs`(업로드 검증), `xlsx`(피벗 엑셀 다운로드)

## 데이터베이스 (EAV)

- `ir_metric_category`, `ir_metric_registry`
- `ir_university_master` — `school_type`(전문대학/4년제), `region_type`(권역: 수도권/비수도권), `region_city`(지역: 17개 광역 시/도)
- `ir_department` — 대학별 학과(교육편제). `is_active`로 폐과/통폐합 제외. 유니크 `(univ_code, dept_code)`
- `ir_raw_data` — **복합 인덱스 `(year, univ_code, metric_id)`** + **유니크 `(year, univ_code, dept_code, metric_id)`** (Upsert 기준)
- `ir_user_preset`(JSONB), `ir_update_log`

## 대시보드 4대 카테고리

`모집` · `학생·취창업` · `교육·교원` · `재정·교육여건`

## 대상 선택 트리 (Multi-depth)

- **연성대학교(기준 대학)**: 타 대학과 동일하게 공시 `ir_department`(대계열 `series_lg` → 학과)로 트리 구성. 루트만 별도 고정.
- **타 대학(비교 집단)**: 6단계 위계 — `학교종류 → 권역 → 지역(시/도) → 대학명 → 대계열 → 공시 학과명`. 앞 4단계는 `getUniversityCode` 실데이터, 뒤 2단계(대계열/학과)는 학과정보 API(`ALIMI_DEPT_*`) 또는 통계 API 부수 추출로 채워집니다.
- 프론트엔드 트리는 모든 노드에 체크박스 + **Cascade Select All**(부모 체크 시 하위 전체 연쇄 선택/해제, 부분 선택은 indeterminate)을 지원합니다.
- **자체 지표 상호 배타**: `selectedTargets`에 타 대학이 1개라도 있으면 Dual-Listbox의 `[자체]`(INTERNAL) 지표는 `disabled` 처리됩니다.

## 로컬 실행

Node.js와 이 PC에 설치된 PostgreSQL을 사용합니다. 스키마가 `jsonb`, advisory lock을 쓰므로 데이터베이스 엔진은 PostgreSQL입니다. 저장소 루트의 `.env`는 `localhost:5432`를 가리키고, 프론트엔드는 `http://localhost:4000/api`로 프록시합니다.

### 1) 사전 준비

PostgreSQL 15 이상을 설치하고 서비스를 실행합니다. Windows 설치 파일은 https://www.postgresql.org/download/windows/ 입니다.

```bash
copy .env.example .env
```

`.env`의 `DATA_GO_KR_KEY`, `JWT_SECRET`을 실제 값으로 바꿉니다. `backend/.env`가 있으면 그 값이 루트 `.env`보다 우선합니다.

### 2) 데이터베이스 계정

슈퍼유저(`postgres`) 비밀번호로 앱 전용 역할과 데이터베이스를 만듭니다. 이미 있으면 비밀번호만 `.env`와 맞춥니다.

```powershell
$env:POSTGRES_SUPER_PASSWORD = "<postgres 슈퍼유저 비밀번호>"
npm run db:init
```

### 3) 의존성 설치와 개발 서버

저장소 루트에서 백엔드(4000)와 프론트엔드(3000)를 함께 띄웁니다.

```bash
npm run install:all
npm run dev
```

- 화면: http://localhost:3000
- API: http://localhost:4000/api

최초 1회 시딩(4대 카테고리 + 대학알리미 Upsert)은 별도입니다. API 키가 있어야 하며 시간이 걸립니다.

```bash
npm run seed
```

운영처럼 빌드 결과만 실행할 때는 `npm run build` 다음 `npm run start` 입니다.

## 주요 API

| Method | Path | 설명 |
| --- | --- | --- |
| GET | `/api/metrics/tree` | 업무 주제별 지표 트리 (Dual-Listbox) |
| PUT | `/api/metrics/reorder` | 트리 빌더 순서 저장 |
| GET | `/api/universities/tree` | 대상 Multi-depth 트리 |
| POST | `/api/pivot` | 1차 피벗 JSON (행: 대상/지표, 열: 연도) |
| POST | `/api/upload/excel` | 자체 데이터 업로드 (3단계 검증) |
| POST | `/api/alimi/batch` | 대학알리미 최신 공개연도 배치 시작(202 Accepted) |
| GET | `/api/alimi/batch/status` | 배치 단계·진행률·결과 조회 |
| GET/POST/DELETE | `/api/presets` | 프리셋 저장/로드 |
| GET | `/api/update-log/latest` | Ticker 최신 1건 |

## 업로드 엑셀 형식

헤더: `year, univ_code, dept_code, metric_id, metric_name, metric_value`

- 결측치(빈칸/undefined)는 거부됩니다. 값이 없으면 문자열 `NULL` 또는 숫자 `0`을 입력하세요.
- 기존 데이터 존재 시 덮어쓰기 확인, 마감(잠금) 연도는 2차 경고 후 진행합니다. 실패 시 전체 롤백됩니다.
- 자체 데이터(`INTERNAL`)와 모니터링(`MONITORING`) 업로드는 분리되며, 생성 양식의 `source_type`이 다른 업로드 영역에서는 거부됩니다.
- 정보공시(`ALIMI`)는 개별 수정·엑셀 업로드가 불가하며 대학알리미 연동으로만 갱신합니다.
- 일반 업로드는 신규 지표를 자동 생성하지 않습니다. 지표 DB 관리에서 먼저 등록하고 최신 양식의 `metric_id`를 사용해야 합니다.

## 대학알리미 OpenAPI 연동 (실데이터 파이프라인)

제공기관 루트: `https://apis.data.go.kr/B340014`. 공통 접속/방어 규칙:

- **numOfRows=9999** 강제 — 정부 API의 10건 페이지 제한 함정 방어(초과 시 자동 페이지네이션).
- **paramsSerializer** — `serviceKey`는 원본 그대로 전달하고 나머지만 인코딩하여 **이중 인코딩(401)** 방지.
- **XML/JSON 이중 파싱** — `fast-xml-parser` 로 XML 응답을, JSON 응답은 `JSON.parse` 로 처리.
- **Rate Limit 방어** — operation/연도 순회 시 `setTimeout` 딜레이(`ALIMI_CALL_DELAY_MS`, 기본 800ms).
- **Upsert(ON CONFLICT)** — `(year, univ_code, dept_code, metric_id)` 기준. 정기 배치 시 타 대학의 정정 공시가 자동 반영됩니다.
- **최신 공개연도 자동 선택** — 현재 연도 자료가 0건이면 `ALIMI_YEAR_LOOKBACK` 범위에서 가장 최근 공개연도를 찾아 동기화합니다.
- **월간 자동 배치** — 기본 매월 1일 03:00(Asia/Seoul), `ALIMI_BATCH_CRON`과 `ALIMI_BATCH_TIME_ZONE`으로 조정합니다.
- **중복 실행 방지** — PostgreSQL advisory lock으로 수동·자동 배치가 겹쳐도 하나만 실행합니다.
- **백그라운드 실행** — 수동 API는 즉시 202를 반환하며 진행 상태는 `/api/alimi/batch/status`에서 확인합니다.

### 소스 구성

| 구분 | 서비스 | 매핑 카테고리 | 적재 방식 |
| --- | --- | --- | --- |
| 대학 마스터/트리 | `BasicInformationService_2/getUniversityCode` | - | 대학명·학교종류·지역 |
| 재정 | `FinancesService` (등록금·장학금·교육비·대출 등) | 재정·교육여건 | XML 수치 태그 동적 파싱 |
| 교육여건 | `EducationConditionService` (기숙사·도서관·교지 등) | 재정·교육여건 | 동일 |
| 교원·연구 | `EducationResearchService` (전임교원·강의·연구비 등) | 교육·교원 | 동일 |
| 학생 | `StudentService` (충원율·취업률·중도탈락 등) | 모집 / 학생·취창업 | 동일 |
| 산학협력 | `IndustryAcademicCooperationService` (계약학과·현장실습 등) | 학생·취창업 | 동일 + 학과명(`indctVal5` 등) → `dept_code` |

- **지표 하드코딩 금지**: 응답 item의 `Object.keys`를 순회해 수치형 태그를 모두 `ir_metric_registry`에 Upsert합니다.
- **학과 단위**: XML에 학과코드/학과명(또는 산학협력 목록의 학과명 슬롯)이 있으면 `ir_raw_data.dept_code`에 매핑. 없을 때만 `_ALL_`.
- **Pivot `_ALL_` 폴백**: 순수 대학단위 지표(해당 연·대학·지표에 학과 raw가 전무)에만 학과 선택 시 `_ALL_` 폴백. 학과단위 지표는 정확 매칭만.
- 통계 그룹은 `ALIMI_STATS_GROUPS`(JSON)로 확장 가능. 시딩은 연성 우선 + `ALIMI_STATS_UNIV_LIMIT`(0=전체, 양수=샘플 한도).

### 학과정보 API (공시 트리 소스)

`BasicInformationService_1` 사용:

| 용도 | Service | Operation | 비고 |
| --- | --- | --- | --- |
| 대학별 학과 | `ALIMI_DEPT_SERVICE` | `getUniversityMajorCode` | `svyYr` + `schlId` 필수. `korMjrNm`/`mjrId`, 대계열 `korSrsLclftNm` |
| 대계열 코드표 | `ALIMI_SERIES_SERVICE` | `getCodeByLargeSeries` | `svyYr` 필요. `cdid`→`cdnm` |

- **[데이터 무결성] 폐과 필터링**: `schlMjrStatNm` / `MajorStatus` 가 폐과·폐지 등이면 DB 활성 적재 및 트리에서 제외.
- 연성대학교·타 대학 모두 동일하게 `ir_department.series_lg` → 학과로 트리 렌더링.
