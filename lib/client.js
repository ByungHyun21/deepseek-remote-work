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
 * "이 서버"는 목록의 맨 위 기본 항목이고, 원격이 하나 선택되면 전환 버튼의
 * 전개 패널 안에 그 원격의 세션이 뜬다. 기기를 바꾼다는 감각을 새 화면이 아니라
 * 사이드바 위의 필터 전환으로 만들려는 의도다. (원래 `sidebar.workspaces` 에
 * 붙이려 했으나 그 좌석은 ui-workspace 가 점유한 single 좌석이라 불가.)
 *
 * 선택은 브라우저 로컬(localStorage)에 둔다. 폰에서 골랐다고 PC 화면이 바뀌면
 * 안 되기 때문이다. 명부만 서버에 영속한다.
 *
 * 세션 행은 아직 눌렀을 때 아무 일도 일어나지 않는다. 원격 세션을 여는 일은
 * ACP 가 과거 대화를 재생해주지 않아 별도의 결정이 필요하다 — README 참고.
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
  /* 자동화 작업(dsh-client-ui-schedule) 화면의 디자인 언어를 그대로 따른다. 같은 셸
     안에 있는 두 플러그인이 서로 다른 앱처럼 보이지 않게 하려는 목적이고, 색상도
     셸이 내려주는 같은 alias 토큰을 쓴다 (라이트/다크·테마가 자동으로 따라온다). */
  ".dshr-page{width:100%;min-width:0;height:100%;min-height:0;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font-size:14px;line-height:1.6;display:flex;overflow:hidden}",
  ".dshr-listPane{flex-direction:column;flex:1;min-width:0;min-height:0;display:flex}",
  ".dshr-scroll{scrollbar-gutter:stable;--dsh-scrollbar-width:9px;--dsh-scrollbar-thumb-border:2px;flex:1;min-height:0;overflow:auto}",
  ".dshr-content{max-width:960px;margin:0 auto;padding:0 clamp(24px,4vw,48px) 48px}",
  ".dshr-heading{flex-wrap:wrap;justify-content:space-between;align-items:center;gap:16px;margin-bottom:24px;padding-top:28px;display:flex}",
  ".dshr-h1{font-size:18px;font-weight:600;line-height:1.4;margin:0}",
  ".dshr-add{height:32px;padding:0 12px;border:0;border-radius:16px;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);font:inherit;font-size:13px;font-weight:500;cursor:pointer}",
  ".dshr-add:hover{filter:brightness(1.06)}",
  ".dshr-note{color:var(--dsw-alias-label-caption);margin-top:10px;font-size:13px;line-height:21px}",
  ".dshr-list{flex-direction:column;gap:2px;display:flex}",
  ".dshr-row{appearance:none;text-align:left;border:0;background:transparent;color:inherit;font:inherit;border-radius:12px;justify-content:flex-start;align-items:flex-start;gap:12px;width:100%;padding:8px;display:flex;cursor:pointer}",
  ".dshr-row:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 7%,transparent)}",
  ".dshr-row.sel{background:color-mix(in srgb,var(--dsw-alias-button-primary-fill) 14%,transparent)}",
  ".dshr-glyph{width:16px;height:20px;color:var(--dsw-alias-label-tertiary);flex:none;margin-top:2px}",
  ".dshr-body{flex-direction:column;flex:1;min-width:0;display:flex}",
  ".dshr-title{font-weight:500;line-height:23px;text-overflow:ellipsis;white-space:nowrap;overflow:hidden}",
  ".dshr-summary{color:var(--dsw-alias-label-tertiary);margin-top:2px;font-size:13px;line-height:21px;overflow-wrap:anywhere;display:block}",
  ".dshr-meta{color:var(--dsw-alias-label-caption);font-size:13px;line-height:21px;overflow-wrap:anywhere}",
  ".dshr-del{border:0;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;padding:0 4px;font:inherit;flex:none}",
  ".dshr-del:hover{color:var(--dsw-alias-state-error-primary)}",
  ".dshr-err{color:var(--dsw-alias-state-error-primary);margin-top:10px;font-size:13px;line-height:21px;white-space:pre-wrap}",
  ".dshr-form{border-top:.5px solid var(--dsw-alias-border-l3);flex-direction:column;gap:8px;margin-top:18px;padding-top:18px;display:flex}",
  ".dshr-form .two{grid-template-columns:2fr 1fr;gap:8px;display:grid}",
  ".dshr-form input{border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;background:transparent;color:inherit;font:inherit;padding:7px 10px;min-width:0}",
  ".dshr-form input:focus{outline:none;border-color:var(--dsw-alias-button-primary-fill)}",
  ".dshr-actions{justify-content:flex-end;gap:8px;margin-top:4px;display:flex}",
  ".dshr-mini{border:.5px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;border-radius:16px;height:32px;padding:0 12px;font:inherit;font-size:13px}",
  ".dshr-mini:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l1)}",
  ".dshr-empty{color:var(--dsw-alias-label-tertiary);flex-direction:column;align-items:center;text-align:center;gap:4px;padding:48px 20px;display:flex}",
  /* 오른쪽 디테일 패널 — 선택한 호스트의 세션. 자동화 작업의 detail 과 같은 배선
     (고정 폭 + 왼쪽 hairline 보더 + 자체 스크롤) 을 쓴다. */
  ".dshr-detail{--gutter:24px;border-left:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-base);flex-direction:column;flex:0 0 47%;min-width:0;min-height:0;display:flex;position:relative}",
  ".dshr-detailBar{border-bottom:.5px solid var(--dsw-alias-border-l3);flex-shrink:0;justify-content:space-between;align-items:center;gap:20px;height:44px;min-height:44px;padding:0 var(--gutter);display:flex}",
  ".dshr-detailTitle{font-size:13px;font-weight:500;line-height:16px;text-overflow:ellipsis;white-space:nowrap;overflow:hidden}",
  ".dshr-detailScroll{scrollbar-gutter:stable;--dsh-scrollbar-width:9px;--dsh-scrollbar-thumb-border:2px;min-height:0;padding:24px var(--gutter) 28px;flex:1;overflow:auto}",
  ".dshr-iconBtn{width:28px;height:28px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;padding:0;font:inherit;line-height:1}",
  ".dshr-iconBtn:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent);color:var(--dsw-alias-label-primary)}",
  // 좁은 창에서는 디테일 패널이 남은 폭을 다 쓰고, 본문 여백도 줄인다.
  "@media (max-width:900px){.dshr-detail{border-left:0;flex:auto}.dshr-content{padding-left:20px;padding-right:20px}}",
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

/* ── 사이드바 아이콘 ───────────────────────────────────────────────────── */

/* `sidebar.panellist` 등록은 **아이콘만** 렌더하고, 행 버튼과 이름·툴팁은 셸이
   만든다. 자동화 작업(dsh-client-ui-schedule)이 같은 방식으로 order 10 에 앉는다. */
function HostsIcon({ size = 16 }) {
  return h(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.7,
      strokeLinecap: "round",
      "aria-hidden": true,
    },
    h("rect", { x: 3, y: 4, width: 18, height: 7, rx: 2 }),
    h("rect", { x: 3, y: 14, width: 18, height: 6, rx: 2 }),
    h("circle", { cx: 7, cy: 7.5, r: 0.9, fill: "currentColor", stroke: "none" }),
    h("circle", { cx: 7, cy: 17, r: 0.9, fill: "currentColor", stroke: "none" }),
  );
}

/* ── 작업 대상 패널 ────────────────────────────────────────────────────── */

const EMPTY_DRAFT = { label: "", host: "", user: "", port: "", cwd: "" };

/* 행 앞에 붙이는 작은 표식. 원격과 이 서버를 모양으로 구분한다. */
function Glyph({ remote }) {
  return h(
    "span",
    { className: "dshr-glyph" },
    h(
      "svg",
      { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", "aria-hidden": true },
      remote
        ? h("g", null, h("rect", { x: 3, y: 4, width: 18, height: 7, rx: 2 }), h("rect", { x: 3, y: 14, width: 18, height: 6, rx: 2 }), h("circle", { cx: 7, cy: 7.5, r: 0.9, fill: "currentColor", stroke: "none" }))
        : h("g", null, h("rect", { x: 2.5, y: 4, width: 19, height: 12, rx: 2 }), h("path", { d: "M9 20h6M12 16v4" })),
    ),
  );
}

/* 셸이 이 본문을 전체 폭 패널로 보여준다. 자동화 작업 화면과 같은 뼈대
   (page → listPane → scroll → content, 오른쪽 detail) 를 쓰는 이유: 한 셸 안에
   있는 플러그인들이 서로 다른 앱처럼 보이지 않게 하기 위해서다. */
function HostsPage({ store, actions }) {
  const s = useStore(store);
  const selectedHost = s.hosts.find((host) => host.id === s.selected) || null;
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const field = (key) => (e) => setDraft({ ...draft, [key]: e.target.value });

  const pick = (id) => () => actions.select(id);
  const hostRow = (id, title, summary, meta, active) =>
    h(
      "div",
      {
        key: id ?? "local",
        className: "dshr-row" + (active ? " sel" : ""),
        role: "button",
        tabIndex: 0,
        onClick: pick(id),
        onKeyDown: (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            actions.select(id);
          }
        },
      },
      h(Glyph, { remote: !!id }),
      h(
        "div",
        { className: "dshr-body" },
        h("div", { className: "dshr-title" }, title),
        summary ? h("span", { className: "dshr-summary" }, summary) : null,
        meta ? h("span", { className: "dshr-meta" }, meta) : null,
      ),
      id
        ? h(
            "button",
            {
              type: "button",
              className: "dshr-del",
              title: "명부에서 삭제",
              onClick: (e) => {
                e.stopPropagation();
                actions.remove(id);
              },
            },
            "✕",
          )
        : null,
    );

  return h(
    "section",
    { className: "dshr-page", "aria-label": "작업 대상" },
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
            "div",
            { className: "dshr-heading" },
            h("h1", { className: "dshr-h1" }, "작업 대상"),
            s.adding
              ? null
              : h("button", { type: "button", className: "dshr-add", onClick: () => actions.startAdd() }, "＋ 호스트 추가"),
          ),
          h(
            "div",
            { className: "dshr-list" },
            hostRow(null, "이 서버", "세션과 작업 공간을 그대로 봅니다", null, !s.selected),
            ...s.hosts.map((host) =>
              hostRow(
                host.id,
                host.label,
                host.user ? host.user + "@" + host.host : host.host,
                host.cwd || null,
                host.id === s.selected,
              ),
            ),
          ),
          s.hosts.length === 0
            ? h("div", { className: "dshr-empty" }, h("div", null, "등록된 원격 호스트가 없습니다."), h("div", { className: "dshr-meta" }, "위에서 호스트를 추가하면 이 목록에 나타납니다."))
            : null,
          s.error ? h("div", { className: "dshr-err" }, s.error) : null,
          s.adding
            ? h(
                "div",
                { className: "dshr-form" },
                h("input", { placeholder: "이름 (예: 0.36 작업실)", value: draft.label, onChange: field("label") }),
                h(
                  "div",
                  { className: "two" },
                  h("input", { placeholder: "주소 (192.168.0.36)", value: draft.host, onChange: field("host") }),
                  h("input", { placeholder: "포트", value: draft.port, onChange: field("port"), inputMode: "numeric" }),
                ),
                h(
                  "div",
                  { className: "two" },
                  h("input", { placeholder: "사용자 (예: yoon)", value: draft.user, onChange: field("user") }),
                  h("input", { placeholder: "작업 경로 /home/yoon", value: draft.cwd, onChange: field("cwd") }),
                ),
                h(
                  "div",
                  { className: "dshr-actions" },
                  h("button", { type: "button", className: "dshr-mini", onClick: () => actions.cancelAdd() }, "취소"),
                  h(
                    "button",
                    {
                      type: "button",
                      className: "dshr-add",
                      onClick: async () => {
                        const ok = await actions.add(draft);
                        if (ok) setDraft(EMPTY_DRAFT);
                      },
                    },
                    "등록",
                  ),
                ),
                h("div", { className: "dshr-note" }, "ssh 키로 붙습니다. 원격에 dsh 가 설치되어 있어야 합니다."),
              )
            : null,
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
    "div",
    { className: "dshr-detail" },
    h(
      "div",
      { className: "dshr-detailBar" },
      h("div", { className: "dshr-detailTitle" }, s.loading ? host.label + " · 붙는 중" : host.label + " · 세션 " + s.sessions.length),
      h(
        "button",
        { type: "button", className: "dshr-iconBtn", title: "다시 불러오기", disabled: s.loading, onClick: () => actions.refresh() },
        s.loading ? "…" : "⟳",
      ),
    ),
    h(
      "div",
      { className: "dshr-detailScroll" },
      s.loading ? h("div", { className: "dshr-empty" }, "원격에 붙는 중…") : null,
      !s.loading && s.error ? h("div", { className: "dshr-err" }, s.error) : null,
      !s.loading && !s.error && s.sessions.length === 0
        ? h(
            "div",
            { className: "dshr-empty" },
            h("div", null, "이 경로에 세션이 없습니다."),
            host.cwd ? h("div", { className: "dshr-meta" }, "기준 경로 " + host.cwd) : null,
          )
        : null,
      !s.loading && s.sessions.length > 0
        ? h(
            "div",
            { className: "dshr-list" },
            ...s.sessions.map((session) =>
              h(
                "div",
                { key: session.sessionId, className: "dshr-row", title: session.sessionId },
                h(Glyph, { remote: false }),
                h(
                  "div",
                  { className: "dshr-body" },
                  h("div", { className: "dshr-title" }, session.sessionId.slice(0, 8)),
                  h("span", { className: "dshr-summary" }, session.cwd || "(경로 없음)"),
                ),
              ),
            ),
          )
        : null,
      !s.loading && s.sessions.length > 0 ? h("div", { className: "dshr-note" }, "목록만 보입니다 — 세션 열기는 다음 단계입니다.") : null,
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
  }
  ctx.effect(() => {
    const node = document.getElementById(STYLE_ID);
    if (node) node.remove();
  }, `${PLUGIN}: style`);

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
    ctx.slots.register({ name: "sidebar.panellist", id: PANEL_ID, order: 20, label: "작업 대상" }, HostsIcon),
  );
}

exports.inject = ["slots"];
exports.apply = apply;

return module.exports;
} });
