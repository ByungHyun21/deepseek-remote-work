/**
 * deepseek-remote-work — 화면 반쪽.
 *
 * 좌석 두 개를 쓴다:
 *  - `sidebar.panellist` : 사이드바 nav 의 패널 행 (자동화 작업 ↔ 더 보기 사이). 아이콘만 렌더.
 *  - `main` (keyed)      : 그 행을 눌렀을 때 열리는 전체 폭 패널. 명부 + 원격 세션 목록.
 *
 * "이 서버"는 명부 맨 위 기본 항목이고, 원격이 선택되면 패널 오른쪽에 그 원격의
 * 세션이 뜬다. 작업 공간 목록 자체는 건드리지 않는다 — 그 자리는 ui-workspace 가
 * 점유한 single 좌석이라 옆에 끼어들 수 없고, 끼어드는 게 맞지도 않다.
 *
 * 선택은 브라우저 로컬(localStorage)에 둔다. 폰에서 골랐다고 PC 화면이 바뀌면
 * 안 되기 때문이다. 명부만 서버에 영속한다.
 *
 * 세션 행은 아직 눌렀을 때 아무 일도 일어나지 않는다. 원격 세션을 여는 일은
 * ACP 가 과거 대화를 재생해주지 않아 별도의 결정이 필요하다 — README 참고.
 *
 * ── 디자인 ───────────────────────────────────────────────────────────────
 * 셸이 이미 갖고 있는 두 화면 — 자동화 작업(`dsh-client-ui-schedule` 의
 * TaskManagerPage)과 플러그인(`dsh-client-ui-plugin-manager` 의
 * PluginManagerPage) — 의 값을 그대로 쓴다. 목표는 "예쁜 별도 앱"이 아니라
 * 같은 셸의 같은 종류의 화면처럼 보이게 하는 것이다:
 *
 *  · 제목 20px/500 + 그 아래 13px 설명 한 줄 (두 화면 모두 `pageTitle`/`pageIntro`)
 *  · 행 hover·선택은 `--dsw-alias-interactive-bg-hover` 하나 (색을 따로 만들지 않는다)
 *  · 버튼은 공용 Button 의 값 — radius `--dsw-radius-md`, hover 는 brightness 가 아니라
 *    `--dsw-alias-button-primary-hover`, ghost 는 `--dsw-alias-interactive-bg-*`
 *  · 아이콘 버튼은 28×28, radius `--dsw-radius-sm`, 색 `--dsw-alias-label-caption`
 *  · 입력은 자동화 작업의 설정 카드(ruleRows/ruleRow/ruleLabel/ruleInput) 와 같은
 *    배선 — hairline 으로 갈린 48px 행, 라벨 왼쪽·값 오른쪽, hover 시에만 배경
 *  · 안내는 notice 카드, 실패는 같은 카드의 error 색, 빈 상태는 glyph + title + action
 *  · 초점 링은 `--dsw-focus-ring-color`, 로딩은 스켈레톤(`--dsw-alias-bg-skeleton`)
 *  · 끊점도 같이 쓴다 — 1100px where gutters tighten, 760px 에서 목록을 접고 디테일
 *
 * 공용 UI 키트(`dsh-client-ui-primitives`)는 각 번들에 인라인되어 브라우저 모듈로
 * 뜨지 않으므로 `require` 할 수 없고, 위 값들을 CSS 로 옮겨 적는 것이 현재 방식이다.
 * 색과 라운드는 전부 셸 토큰이라 라이트/다크와 테마를 자동으로 따라간다.
 */

// dsh 클라이언트 모듈 프로토콜: 이 파일은 평가될 때 팩토리를 "등록"만 한다.
// body 의 모든 사이드이펙트(React require, CSS 주입)는 materialization 시점에
// 팩토리 안에서 돈다. 평범한 ESM/CJS 모듈로 내보내면 웹 부트의 import 단계에서
// 죽는다 — window.__ModuleLoader__.load 등록이 계약의 전부다.
window.__ModuleLoader__.load({ id: "deepseek-remote-work", factory: (require) => {
const module = { exports: {} }; const exports = module.exports;

const React = require("react");
const h = React.createElement;
const { useState, useEffect } = React;

const PLUGIN = "deepseek-remote-work";
const API = "/remote-work/api";
const SELECT_KEY = "dsh-remote-work.selected";
const STYLE_ID = "dshr-style";

const CSS = [
  // ── 페이지 뼈대 — 자동화 작업과 같은 5단 (page → listPane → scroll → content → heading)
  ".dshr-page{width:100%;min-width:0;height:100%;min-height:0;--gutter:24px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font-size:14px;line-height:1.6;display:flex;overflow:hidden}",
  ".dshr-listPane{flex-direction:column;flex:1;min-width:0;min-height:0;display:flex}",
  ".dshr-scroll{scrollbar-gutter:stable;--dsh-scrollbar-width:9px;--dsh-scrollbar-thumb-border:2px;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);flex:1;min-height:0;overflow:auto}",
  ".dshr-content{max-width:960px;margin:0 auto;padding:0 clamp(24px,4vw,48px) 56px}",
  ".dshr-heading{flex-wrap:wrap;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:22px;padding-top:28px;display:flex}",
  "[data-platform=darwin] .dshr-heading{padding-top:calc(28px + var(--dsh-frame-top-clearance,0px))}",
  ".dshr-headingText{min-width:0;max-width:100%}",
  ".dshr-h1{margin:0;font-size:20px;font-weight:500;line-height:28px}",
  ".dshr-intro{color:var(--dsw-alias-label-secondary);margin:4px 0 0;font-size:13px;line-height:20px}",
  // ── 버튼 — 공용 Button(base + primary/ghost) 의 값
  ".dshr-btn{box-sizing:border-box;flex:none;display:inline-flex;align-items:center;justify-content:center;gap:4px;height:32px;padding:0 12px;border:none;border-radius:var(--dsw-radius-md,16px);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;white-space:nowrap;cursor:pointer;transition:background .15s,color .15s}",
  ".dshr-btn:disabled{cursor:not-allowed;opacity:.4}",
  ".dshr-btn.primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}",
  ".dshr-btn.primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}",
  ".dshr-btn.ghost:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}",
  ".dshr-btn.ghost:active:not(:disabled){background:var(--dsw-alias-interactive-bg-active)}",
  // ── 아이콘 버튼 — 공용 IconButton 과 같은 치수
  ".dshr-iconBtn{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:6px;border:none;border-radius:var(--dsw-radius-sm,8px);background:transparent;color:var(--dsw-alias-label-caption);line-height:1;cursor:pointer;transition:background .15s,color .15s}",
  ".dshr-iconBtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}",
  ".dshr-iconBtn.danger:hover:not(:disabled){color:var(--dsw-alias-state-error-primary)}",
  ".dshr-iconBtn:disabled{cursor:default;opacity:.5}",
  // ── 태그 — 공용 Tag 치수
  ".dshr-tag{flex:none;display:inline-flex;align-items:center;height:18px;padding:0 7px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:10px;line-height:1;white-space:nowrap}",
  ".dshr-tag.active{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 14%,transparent);color:var(--dsw-alias-state-business-primary)}",
  ".dshr-tag.pending{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 16%,transparent);color:var(--dsw-alias-state-warn-primary)}",
  // ── 안내 카드 (notice) — 자동화 작업의 notice 와 같은 값, 실패는 error 색
  ".dshr-notice{background:var(--dsw-specific-sidebar-fill);color:var(--dsw-alias-label-secondary);border-radius:10px;flex-wrap:wrap;align-items:flex-start;gap:9px;margin:0 0 20px;padding:12px 14px;font-size:12px;line-height:20px;display:flex}",
  ".dshr-notice.error{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,var(--dsw-specific-sidebar-fill));color:var(--dsw-alias-state-error-primary)}",
  ".dshr-notice p{flex:1;min-width:0;margin:0;overflow-wrap:anywhere}",
  // ── 이 서버 카드 — 지금 보고 있는 작업 대상. 아이콘 타일 + 이름 + 설명 한 줄
  ".dshr-local{box-sizing:border-box;position:relative;display:flex;align-items:center;gap:14px;width:100%;padding:16px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-lg,14px);background:var(--dsw-alias-bg-layer-2);color:inherit;font:inherit;text-align:left;cursor:pointer;transition:background .15s,border-color .15s}",
  ".dshr-local:hover{background:var(--dsw-alias-interactive-bg-hover)}",
  ".dshr-local.sel{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 45%,var(--dsw-alias-border-l3));background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 7%,var(--dsw-alias-bg-layer-2))}",
  ".dshr-tile{flex:none;display:grid;place-items:center;width:40px;height:40px;border-radius:var(--dsw-radius-md,12px);border:.5px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary)}",
  ".dshr-local .dshr-tile{border-color:transparent;background:linear-gradient(145deg,color-mix(in srgb,var(--dsw-alias-state-business-primary) 22%,var(--dsw-alias-bg-base)),var(--dsw-alias-bg-base));color:var(--dsw-alias-state-business-primary)}",
  ".dshr-localBody{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}",
  ".dshr-localTop{display:flex;align-items:center;gap:8px;min-width:0}",
  ".dshr-localName{font-size:14px;font-weight:500;line-height:20px}",
  ".dshr-localSub{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}",
  // ── 원격 호스트 — 섹션 헤더 + 카드 그리드
  ".dshr-section{margin-top:30px}",
  ".dshr-sectionHead{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}",
  ".dshr-sectionTitle{display:flex;align-items:center;gap:8px;margin:0;font-size:13px;font-weight:500;line-height:20px;color:var(--dsw-alias-label-secondary)}",
  ".dshr-count{display:inline-flex;align-items:center;height:18px;padding:0 7px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary);font-size:10px;font-weight:400;line-height:1}",
  ".dshr-hostGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}",
  ".dshr-hostCard{position:relative;display:flex;align-items:flex-start;gap:12px;padding:14px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-lg,14px);background:var(--dsw-alias-bg-layer-2);min-width:0;transition:background .15s,border-color .15s}",
  ".dshr-hostCard:hover{background:var(--dsw-alias-interactive-bg-hover)}",
  ".dshr-hostCard.sel{background:var(--dsw-alias-interactive-bg-hover);border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 45%,var(--dsw-alias-border-l3))}",
  ".dshr-cardHit{position:absolute;inset:0;z-index:0;border:0;border-radius:inherit;background:transparent;cursor:pointer}",
  ".dshr-cardHit:focus{outline:none}",
  ".dshr-cardHit:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}",
  ".dshr-hostCard>.dshr-tile,.dshr-hostCard>.dshr-hostBody{position:relative;z-index:1;pointer-events:none}",
  ".dshr-hostBody{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}",
  ".dshr-hostTop{display:flex;align-items:center;gap:8px;min-width:0}",
  ".dshr-hostName{font-size:14px;font-weight:500;line-height:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}",
  ".dshr-addrRow{display:flex;align-items:baseline;gap:4px;min-width:0}",
  ".dshr-addr{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}",
  ".dshr-pathRow{display:flex;align-items:center;gap:5px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;min-width:0}",
  ".dshr-path{overflow-wrap:anywhere}",
  ".dshr-rowEnd{z-index:2;position:relative;display:inline-flex;align-items:center;gap:8px;flex:none}",
  // ── 빈 상태 — glyph + title + action (두 화면 공통), 호스트가 없을 때는 점선 카드
  ".dshr-emptyCard{border:.5px dashed var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-lg,14px);background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 55%,transparent)}",
  ".dshr-empty{text-align:center;color:var(--dsw-alias-label-tertiary);flex-direction:column;align-items:center;padding:40px 20px;font-size:14px;display:flex}",
  ".dshr-emptyGlyph{color:var(--dsw-alias-label-caption);margin-bottom:12px}",
  ".dshr-emptyTitle{color:var(--dsw-alias-label-secondary);margin-bottom:6px;font-size:14px;font-weight:500;line-height:1.6}",
  ".dshr-emptyHint{color:var(--dsw-alias-label-caption);font-size:13px;line-height:20px;max-width:420px}",
  ".dshr-emptyAction{margin-top:16px}",
  // ── 새 호스트 폼 — 카드 안 2열 필드(라벨 위, 입력 아래)
  ".dshr-formCard{margin-top:12px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-lg,14px);background:var(--dsw-alias-bg-layer-2);padding:16px}",
  ".dshr-formHead{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}",
  ".dshr-formTitle{margin:0;font-size:14px;font-weight:500;line-height:20px}",
  ".dshr-formGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}",
  ".dshr-formField{display:grid;gap:6px;min-width:0}",
  ".dshr-formField.wide{grid-column:1/-1}",
  ".dshr-formLabel{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}",
  ".dshr-formInput{box-sizing:border-box;width:100%;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm,10px);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;padding:8px 10px;outline:none;transition:background .15s,border-color .15s}",
  ".dshr-formInput::placeholder{color:var(--dsw-alias-label-caption)}",
  ".dshr-formInput:hover{background:var(--dsw-alias-interactive-bg-hover)}",
  ".dshr-formInput:focus{border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-business-primary) 16%,transparent)}",
  ".dshr-formHint{color:var(--dsw-alias-label-tertiary);margin:10px 0 0;font-size:12px;line-height:18px}",
  ".dshr-formActions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}",
  // ── 오른쪽 디테일 — 자동화 작업 detail 과 같은 배선 (47% + hairline + 자체 스크롤)
  ".dshr-detail{--gutter:24px;border-left:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-base);flex-direction:column;flex:0 0 47%;min-width:0;min-height:0;display:flex;position:relative}",
  ".dshr-detailBar{border-bottom:.5px solid var(--dsw-alias-border-l3);flex-shrink:0;justify-content:space-between;align-items:center;gap:20px;height:44px;min-height:44px;padding:0 var(--gutter);display:flex}",
  ".dshr-detailBarText{align-items:center;gap:8px;min-width:0;display:flex}",
  ".dshr-detailTitle{font-size:13px;font-weight:500;line-height:16px;text-overflow:ellipsis;white-space:nowrap;overflow:hidden}",
  ".dshr-detailScroll{scrollbar-gutter:stable;--dsh-scrollbar-width:9px;--dsh-scrollbar-thumb-border:2px;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);min-height:0;padding:24px var(--gutter) 28px;flex:1;overflow:auto}",
  ".dshr-hostHero{display:flex;align-items:center;gap:14px;padding:16px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-lg,14px);background:var(--dsw-alias-bg-layer-2);margin-bottom:24px}",
  ".dshr-heroBody{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}",
  ".dshr-heroName{margin:0;font-size:16px;font-weight:500;line-height:24px;overflow-wrap:anywhere}",
  ".dshr-heroMeta{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;overflow-wrap:anywhere}",
  ".dshr-sessionGrid{display:grid;gap:8px}",
  ".dshr-session{display:flex;align-items:center;gap:10px;padding:10px 12px;border:.5px solid var(--dsw-alias-border-l3);border-radius:12px;background:var(--dsw-alias-bg-layer-2);min-width:0}",
  ".dshr-session .dshr-tile{width:30px;height:30px;border-radius:var(--dsw-radius-sm,8px)}",
  ".dshr-sessionBody{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}",
  ".dshr-sessionId{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary)}",
  ".dshr-sessionMeta{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:17px;overflow-wrap:anywhere}",
  // ── 스켈레톤 — 플러그인 화면의 skeleton 과 같은 값
  ".dshr-skel{flex-direction:column;gap:2px;display:flex}",
  ".dshr-skelRow{align-items:flex-start;gap:12px;padding:8px;display:flex}",
  ".dshr-skelBar{height:12px;border-radius:var(--dsw-radius-xs,6px);background:var(--dsw-alias-bg-skeleton);animation:dshr-pulse 2s cubic-bezier(.36,0,.64,1) infinite}",
  "@keyframes dshr-pulse{0%{opacity:1}40%{opacity:.6}80%,to{opacity:1}}",
  ".dshr-spin svg{animation:dshr-rotate 1s linear infinite}",
  "@keyframes dshr-rotate{to{transform:rotate(360deg)}}",
  "@media (prefers-reduced-motion:reduce){.dshr-skelBar,.dshr-spin svg{animation:none}}",
  // ── 초점 — 셸 두 화면 모두 페이지 전체에 같은 링을 깐다
  ".dshr-page :focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}",
  ".dshr-page .dshr-cardHit:focus-visible,.dshr-page .dshr-formInput:focus-visible{outline:none}",
  // ── 좁은 창에서 목록으로 — 목록이 접히는 760px 아래에서만 버튼을 보여준다
  ".dshr-back{display:none}",
  // ── 끊점 — 자동화 작업과 같은 지점 (1100/760/400), 좁은 폭에서 카드·폼은 1열
  "@media (width<=1100px){.dshr-detail{--gutter:20px}}",
  "@media (width<=760px){.dshr-page.hasDetail .dshr-listPane{display:none}.dshr-detail{border-left:0;flex-basis:100%}.dshr-detailScroll{padding-top:20px}.dshr-content{padding-left:20px;padding-right:20px}.dshr-back{display:inline-flex}}",
  "@media (width<=560px){.dshr-hostGrid{grid-template-columns:minmax(0,1fr)}.dshr-formGrid{grid-template-columns:minmax(0,1fr)}}",
  "@media (width<=400px){.dshr-detail{--gutter:16px}.dshr-formActions{flex-wrap:wrap}.dshr-hostGrid{gap:8px}}",
].join("\n");

/* ── 아주 작은 상태 저장소 ─────────────────────────────────────────────── */

function createStore(initial) {
  let state = initial;
  const subs = new Set();
  return {
    get: () => state,
    set(patch) {
      const next = typeof patch === "function" ? patch(state) : patch;
      state = { ...state, ...next };
      for (const fn of subs) fn();
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

function useStore(store) {
  const [, bump] = useState(0);
  useEffect(() => store.subscribe(() => bump((n) => n + 1)), [store]);
  return store.get();
}

/* ── 서버 호출 ─────────────────────────────────────────────────────────── */

async function call(path, body) {
  try {
    const res = await fetch(path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined);
    const data = await res.json().catch(() => null);
    if (!res.ok) return { error: (data && data.error) || `요청 실패 (${res.status})` };
    return data || {};
  } catch (error) {
    return { error: `연결 실패: ${error.message}` };
  }
}

/* ── 아이콘 ────────────────────────────────────────────────────────────── */

/* 셸 화면들은 전부 svg 를 쓴다. 기호 문자(✕·⟳)는 폰트마다 크기가 달라 보이므로
   여기서는 svg 로 맞춘다. */
const SVG = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", "aria-hidden": true };

function IconServer({ size = 16 }) {
  return h(
    "svg",
    { width: size, height: size, viewBox: "0 0 24 24", ...SVG },
    h("rect", { x: 3, y: 4, width: 18, height: 7, rx: 2 }),
    h("rect", { x: 3, y: 14, width: 18, height: 6, rx: 2 }),
    h("circle", { cx: 7, cy: 7.5, r: 0.9, fill: "currentColor", stroke: "none" }),
    h("circle", { cx: 7, cy: 17, r: 0.9, fill: "currentColor", stroke: "none" }),
  );
}

function IconMonitor({ size = 16 }) {
  return h(
    "svg",
    { width: size, height: size, viewBox: "0 0 24 24", ...SVG },
    h("rect", { x: 2.5, y: 4, width: 19, height: 12, rx: 2 }),
    h("path", { d: "M9 20h6M12 16v4" }),
  );
}

function IconPlus({ size = 14 }) {
  return h("svg", { width: size, height: size, viewBox: "0 0 24 24", ...SVG }, h("path", { d: "M12 5v14M5 12h14" }));
}

function IconClose({ size = 14 }) {
  return h("svg", { width: size, height: size, viewBox: "0 0 24 24", ...SVG }, h("path", { d: "M6 6l12 12M18 6L6 18" }));
}

function IconRefresh({ size = 14 }) {
  return h(
    "svg",
    { width: size, height: size, viewBox: "0 0 24 24", ...SVG },
    h("path", { d: "M20 12a8 8 0 1 1-2.34-5.66" }),
    h("path", { d: "M20 4v4h-4" }),
  );
}

function IconArrowLeft({ size = 14 }) {
  return h("svg", { width: size, height: size, viewBox: "0 0 24 24", ...SVG }, h("path", { d: "M19 12H5M11 6l-6 6 6 6" }));
}

function IconFolder({ size = 12 }) {
  return h(
    "svg",
    { width: size, height: size, viewBox: "0 0 24 24", ...SVG },
    h("path", { d: "M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5v8A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z" }),
  );
}

function IconTerminal({ size = 14 }) {
  return h(
    "svg",
    { width: size, height: size, viewBox: "0 0 24 24", ...SVG },
    h("path", { d: "M4 5.5h16v13H4z" }),
    h("path", { d: "M7 9.5l3 2.5-3 2.5M12.5 14.5h4" }),
  );
}

/* ── 공용 조각 ─────────────────────────────────────────────────────────── */

function Button({ variant = "ghost", className, children, ...rest }) {
  return h("button", { type: "button", className: ["dshr-btn", variant, className].filter(Boolean).join(" "), ...rest }, children);
}

function IconButton({ icon, danger, spin, className, ...rest }) {
  const classes = ["dshr-iconBtn", danger ? "danger" : null, spin ? "dshr-spin" : null, className].filter(Boolean);
  return h("button", { type: "button", className: classes.join(" "), ...rest }, icon);
}

function Tag({ tone, children }) {
  return h("span", { className: "dshr-tag" + (tone ? " " + tone : "") }, children);
}

function Notice({ tone, children }) {
  return h("div", { className: "dshr-notice" + (tone ? " " + tone : "") }, h("p", null, children));
}

function EmptyState({ glyph, title, hint, action }) {
  return h(
    "div",
    { className: "dshr-empty" },
    h("div", { className: "dshr-emptyGlyph" }, glyph),
    h("div", { className: "dshr-emptyTitle" }, title),
    hint ? h("div", { className: "dshr-emptyHint" }, hint) : null,
    action ? h("div", { className: "dshr-emptyAction" }, action) : null,
  );
}

function SkeletonRows({ count = 4 }) {
  const widths = [["60%", "84%"], ["44%", "70%"], ["68%", "58%"], ["52%", "76%"]];
  return h(
    "div",
    { className: "dshr-skel", "aria-hidden": true },
    ...Array.from({ length: count }, (_, i) =>
      h(
        "div",
        { key: i, className: "dshr-skelRow" },
        h("div", { className: "dshr-skelBar", style: { width: "16px", height: "20px", flex: "none" } }),
        h(
          "div",
          { style: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 } },
          h("div", { className: "dshr-skelBar", style: { width: widths[i % widths.length][0] } }),
          h("div", { className: "dshr-skelBar", style: { width: widths[i % widths.length][1], opacity: 0.7 } }),
        ),
      ),
    ),
  );
}

/* ── 작업 대상 패널 ────────────────────────────────────────────────────── */

const EMPTY_DRAFT = { label: "", host: "", user: "", port: "", cwd: "" };

const FIELDS = [
  { key: "label", label: "이름", placeholder: "예: 0.36 작업실" },
  { key: "host", label: "주소", placeholder: "192.168.0.36" },
  { key: "port", label: "포트", placeholder: "22", inputMode: "numeric" },
  { key: "user", label: "사용자", placeholder: "yoon" },
  { key: "cwd", label: "작업 경로", placeholder: "/home/yoon" },
];

const addressOf = (host) => (host.user ? host.user + "@" + host.host : host.host);

/* 포트는 명시되지 않았거나 22 이면 적지 않는다 — 명부 행과 디테일 헤더가 같은 문구를
   쓰게 한 곳으로 모은다. (port 는 문자열로 들어올 수 있어 문자열로 비교한다.) */
function hostMetas(host) {
  const port = host.port === undefined || host.port === null || host.port === "" ? "" : String(host.port);
  return [addressOf(host), port && port !== "22" ? "포트 " + port : null, host.cwd || null].filter(Boolean);
}

/* 이 서버 카드 — 지금 보고 있는 작업 대상. 아이콘 타일 + 이름 + 설명. */
function LocalCard({ active, onSelect }) {
  return h(
    "button",
    { type: "button", className: "dshr-local" + (active ? " sel" : ""), onClick: onSelect, "aria-current": active ? "true" : undefined },
    h("span", { className: "dshr-tile" }, h(IconMonitor, { size: 20 })),
    h(
      "span",
      { className: "dshr-localBody" },
      h(
        "span",
        { className: "dshr-localTop" },
        h("span", { className: "dshr-localName" }, "이 서버"),
        active ? h(Tag, { tone: "active" }, "사용 중") : null,
      ),
      h("span", { className: "dshr-localSub" }, "세션과 작업 공간을 그대로 봅니다"),
    ),
  );
}

/* 원격 호스트 카드. 카드 전체를 누르는 투명 버튼(cardHit)을 깔고, 삭제 버튼은
   그 위에 얹는다 (button 안에 button 을 넣지 않기 위해). */
function HostCard({ host, active, onSelect, onRemove }) {
  const port = host.port === undefined || host.port === null || host.port === "" ? "" : String(host.port);
  return h(
    "div",
    { className: "dshr-hostCard" + (active ? " sel" : "") },
    h("button", {
      type: "button",
      className: "dshr-cardHit",
      onClick: onSelect,
      "aria-label": host.label + " 선택",
      "aria-current": active ? "true" : undefined,
    }),
    h("span", { className: "dshr-tile" }, h(IconServer, { size: 20 })),
    h(
      "div",
      { className: "dshr-hostBody" },
      h(
        "div",
        { className: "dshr-hostTop" },
        h("span", { className: "dshr-hostName", title: host.label }, host.label),
        active ? h(Tag, { tone: "active" }, "사용 중") : null,
      ),
      h(
        "div",
        { className: "dshr-addrRow" },
        h("span", { className: "dshr-addr", title: addressOf(host) }, addressOf(host)),
        port && port !== "22" ? h("span", { className: "dshr-addr" }, ":" + port) : null,
      ),
      host.cwd
        ? h(
            "div",
            { className: "dshr-pathRow" },
            h(IconFolder, { size: 12 }),
            h("span", { className: "dshr-path", title: host.cwd }, host.cwd),
          )
        : null,
    ),
    h(
      "div",
      { className: "dshr-rowEnd" },
      h(IconButton, {
        title: "명부에서 삭제",
        "aria-label": host.label + " 삭제",
        danger: true,
        icon: h(IconClose, { size: 14 }),
        onClick: onRemove,
      }),
    ),
  );
}

/* 새 호스트 폼 — 카드 안 2열 필드. */
function AddHostForm({ draft, onChange, onSubmit, onCancel, error }) {
  return h(
    "div",
    { className: "dshr-formCard" },
    h(
      "div",
      { className: "dshr-formHead" },
      h("h2", { className: "dshr-formTitle" }, "새 호스트"),
      h(IconButton, { title: "닫기", "aria-label": "호스트 추가 닫기", icon: h(IconClose, { size: 14 }), onClick: onCancel }),
    ),
    h(
      "div",
      { className: "dshr-formGrid" },
      ...FIELDS.map((f) =>
        h(
          "label",
          { key: f.key, className: "dshr-formField" + (f.key === "cwd" ? " wide" : ""), htmlFor: "dshr-field-" + f.key },
          h("span", { className: "dshr-formLabel" }, f.label),
          h("input", {
            id: "dshr-field-" + f.key,
            className: "dshr-formInput",
            value: draft[f.key],
            placeholder: f.placeholder,
            inputMode: f.inputMode,
            onChange: (e) => onChange(f.key, e.target.value),
          }),
        ),
      ),
    ),
    h("p", { className: "dshr-formHint" }, "ssh 키로 붙습니다. 원격에 dsh 가 설치되어 있어야 합니다."),
    error ? h(Notice, { tone: "error" }, error) : null,
    h(
      "div",
      { className: "dshr-formActions" },
      h(Button, { onClick: onCancel }, "취소"),
      h(Button, { variant: "primary", onClick: onSubmit }, "등록"),
    ),
  );
}

/* 셸이 이 본문을 전체 폭 패널로 보여준다. */
function HostsPage({ store, actions }) {
  const s = useStore(store);
  const selectedHost = s.hosts.find((host) => host.id === s.selected) || null;
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const change = (key, value) => setDraft({ ...draft, [key]: value });

  const submit = async () => {
    const ok = await actions.add(draft);
    if (ok) setDraft(EMPTY_DRAFT);
  };

  return h(
    "section",
    { className: "dshr-page" + (selectedHost ? " hasDetail" : ""), "aria-label": "작업 대상" },
    h(
      "div",
      { className: "dshr-listPane" },
      h(
        "div",
        { className: "dshr-scroll" },
        h(
          "div",
          { className: "dshr-content" },
          h(
            "header",
            { className: "dshr-heading" },
            h(
              "div",
              { className: "dshr-headingText" },
              h("h1", { className: "dshr-h1" }, "작업 대상"),
              h("p", { className: "dshr-intro" }, "이 서버와 원격 머신을 같은 내비게이션에서 오갑니다. 원격은 세션 목록만 읽습니다."),
            ),
            s.adding || s.hosts.length === 0
              ? null
              : h(Button, { variant: "primary", onClick: () => actions.startAdd() }, h(IconPlus, { size: 14 }), "호스트 추가"),
          ),
          s.error && !s.adding ? h(Notice, { tone: "error" }, s.error) : null,
          h(LocalCard, { active: !s.selected, onSelect: () => actions.select(null) }),
          h(
            "section",
            { className: "dshr-section" },
            h(
              "div",
              { className: "dshr-sectionHead" },
              h(
                "h2",
                { className: "dshr-sectionTitle" },
                "원격 호스트",
                s.hosts.length ? h("span", { className: "dshr-count" }, String(s.hosts.length)) : null,
              ),
            ),
            s.adding
              ? h(AddHostForm, {
                  draft,
                  onChange: change,
                  onSubmit: submit,
                  onCancel: () => actions.cancelAdd(),
                  error: s.error,
                })
              : null,
            s.hosts.length > 0
              ? h(
                  "div",
                  { className: "dshr-hostGrid", role: "list" },
                  ...s.hosts.map((host) =>
                    h(HostCard, {
                      key: host.id,
                      host,
                      active: host.id === s.selected,
                      onSelect: () => actions.select(host.id),
                      onRemove: () => actions.remove(host.id),
                    }),
                  ),
                )
              : s.adding
                ? null
                : h(
                    "div",
                    { className: "dshr-emptyCard" },
                    h(EmptyState, {
                      glyph: h(IconServer, { size: 28 }),
                      title: "등록된 원격 호스트가 없습니다.",
                      hint: "ssh 키로 붙을 수 있는 머신을 등록하면 이 목록에 나타납니다.",
                      action: h(Button, { variant: "primary", onClick: () => actions.startAdd() }, h(IconPlus, { size: 14 }), "호스트 추가"),
                    }),
                  ),
          ),
        ),
      ),
    ),
    selectedHost ? h(SessionPane, { store, actions, host: selectedHost }) : null,
  );
}

/* ── 오른쪽 디테일: 선택한 호스트의 세션 ───────────────────────────────── */

function SessionPane({ store, actions, host }) {
  const s = useStore(store);

  return h(
    "aside",
    { className: "dshr-detail", "aria-label": host.label + " 세션" },
    h(
      "header",
      { className: "dshr-detailBar" },
      h(
        "div",
        { className: "dshr-detailBarText" },
        h("span", { className: "dshr-detailTitle" }, "세션"),
        s.loading
          ? h(Tag, { tone: "pending" }, "붙는 중")
          : s.error
            ? h(Tag, { tone: "pending" }, "실패")
            : h(Tag, null, "총 " + s.sessions.length),
      ),
      // 좁은 창에서는 목록이 접히므로 돌아갈 길을 함께 둔다.
      h(
        "div",
        { className: "dshr-rowEnd" },
        h(IconButton, {
          className: "dshr-back",
          title: "목록으로",
          "aria-label": "목록으로",
          icon: h(IconArrowLeft, { size: 14 }),
          onClick: () => actions.select(null),
        }),
        h(IconButton, {
          title: "다시 불러오기",
          "aria-label": "다시 불러오기",
          disabled: s.loading,
          spin: s.loading,
          icon: h(IconRefresh, { size: 14 }),
          onClick: () => actions.refresh(),
        }),
      ),
    ),
    h(
      "div",
      { className: "dshr-detailScroll" },
      h(
        "div",
        { className: "dshr-hostHero" },
        h("span", { className: "dshr-tile" }, h(IconServer, { size: 20 })),
        h(
          "div",
          { className: "dshr-heroBody" },
          h("h2", { className: "dshr-heroName" }, host.label),
          h("div", { className: "dshr-heroMeta" }, hostMetas(host).join(" · ")),
        ),
      ),
      s.loading
        ? h(SkeletonRows, null)
        : s.error
          ? h(Notice, { tone: "error" }, s.error)
          : s.sessions.length === 0
            ? h(
                "div",
                { className: "dshr-emptyCard" },
                h(EmptyState, {
                  glyph: h(IconTerminal, { size: 28 }),
                  title: "이 경로에 세션이 없습니다.",
                  hint: host.cwd ? "기준 경로 " + host.cwd : "원격에서 세션을 하나 만들어 보세요.",
                }),
              )
            : h(
                "div",
                { className: "dshr-sessionGrid", role: "list" },
                ...s.sessions.map((session) =>
                  h(
                    "div",
                    { key: session.sessionId, className: "dshr-session", title: session.sessionId },
                    h("span", { className: "dshr-tile" }, h(IconTerminal, { size: 14 })),
                    h(
                      "div",
                      { className: "dshr-sessionBody" },
                      h("span", { className: "dshr-sessionId" }, session.sessionId.slice(0, 8)),
                      h("span", { className: "dshr-sessionMeta" }, session.cwd || "(경로 없음)"),
                    ),
                  ),
                ),
              ),
      !s.loading && s.sessions.length > 0
        ? h(Notice, null, "목록만 보입니다 — 세션 열기는 다음 단계입니다.")
        : null,
    ),
  );
}

/* ── 적용 ──────────────────────────────────────────────────────────────── */

function apply(ctx) {
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.append(style);
    // ctx.effect 은 등록 즉시 fn 을 실행한다. 스타일은 여기서 붙이고, 정리는
    // 돌려주는 함수(언마운트)에서만 한다 — fn 안에서 remove 하면 바로 사라진다.
    ctx.effect(() => () => style.remove(), `${PLUGIN}: style`);
  }

  let stored = null;
  try {
    stored = localStorage.getItem(SELECT_KEY);
  } catch {
    /* 저장 못 쓰는 브라우저면 이 서버로 시작 */
  }

  const store = createStore({ hosts: [], selected: stored, sessions: [], loading: false, error: "", adding: false });

  const remember = (id) => {
    try {
      if (id) localStorage.setItem(SELECT_KEY, id);
      else localStorage.removeItem(SELECT_KEY);
    } catch {
      /* 무시 */
    }
  };

  const loadSessions = async (id) => {
    if (!id) return;
    store.set({ loading: true, error: "", sessions: [] });
    const result = await call(`${API}/sessions?host=${encodeURIComponent(id)}`);
    // 그동안 선택이 바뀌었으면 결과를 버린다.
    if (store.get().selected !== id) return;
    store.set({ loading: false, sessions: result.sessions ?? [], error: result.error ?? "" });
  };

  const loadHosts = async () => {
    const result = await call(`${API}/hosts`);
    const hosts = result.hosts ?? [];
    store.set({ hosts });
    const current = store.get().selected;
    if (current && !hosts.some((host) => host.id === current)) {
      store.set({ selected: null, sessions: [], error: "" });
      remember(null);
    } else if (current) {
      void loadSessions(current);
    }
  };

  const actions = {
    startAdd: () => store.set({ adding: true, error: "" }),
    cancelAdd: () => store.set({ adding: false, error: "" }),
    async add(draft) {
      const result = await call(`${API}/hosts`, { op: "add", ...draft });
      if (result.error) {
        store.set({ error: result.error });
        return false;
      }
      store.set({ hosts: result.hosts ?? [], adding: false, error: "" });
      return true;
    },
    async remove(id) {
      const result = await call(`${API}/hosts`, { op: "remove", id });
      if (result.error) return store.set({ error: result.error });
      const hosts = result.hosts ?? [];
      const wasSelected = store.get().selected === id;
      store.set({ hosts, ...(wasSelected ? { selected: null, sessions: [], error: "" } : {}) });
      if (wasSelected) remember(null);
    },
    select(id) {
      remember(id);
      store.set({ selected: id, sessions: [], error: "", loading: false });
      void loadSessions(id);
    },
    refresh: () => void loadSessions(store.get().selected),
  };

  void loadHosts();

  // 자리: 사이드바 nav 의 **패널 행** — 자동화 작업과 더 보기 버튼 사이.
  // `sidebar.panellist` 는 list 좌석이고, 여기에 등록한 아이콘이 그 자리에 앉는다
  // (자동화 작업 = dsh-client-ui-schedule 가 order 10, 우리는 order 20). 행 버튼과
  // 이름·툴팁은 셸이 만들고, 행을 누르면 셸이 `main` keyed 좌석에서 같은 id 패널로
  // 전환한다 — 그래서 본문은 `main` 에 별도로 등록한다 (TaskManagerPage 와 같은 구조).
  //
  // 지난 시도에서 확인한 것 (되돌리면 깨진다):
  //  - `sidebar.panellist.actions` 는 More **메뉴의 행** 전용. 사이드바 자리가 아니다.
  //  - `sidebar.workspaces` 는 ui-workspace 가 점유한 **single** 좌석. 얹을 수 없다.
  //  - `sidebar.footer.action` 은 최하단. 위치가 요구와 다르다.
  //  - register 의 두 번째 인자는 **컴포넌트 함수** — 요소 인스턴스를 넘기면 안 된다.
  const PANEL_ID = `${PLUGIN}.hosts`;
  ctx.slots.inject("main", () =>
    ctx.slots.register({ name: "main", key: PANEL_ID, inject: () => ({ store, actions }) }, HostsPage),
  );
  ctx.slots.inject("sidebar.panellist", () =>
    ctx.slots.register({ name: "sidebar.panellist", id: PANEL_ID, order: 20, label: "작업 대상" }, IconServer),
  );
}

exports.inject = ["slots"];
exports.apply = apply;

return module.exports;
} });
