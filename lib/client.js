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
  ".dshr-switcher{position:relative;display:flex;flex-direction:column;gap:2px;margin:2px 0}",
  ".dshr-btn{display:flex;align-items:center;gap:6px;width:100%;padding:6px 8px;border:0;border-radius:6px;background:transparent;color:inherit;font:inherit;cursor:pointer;text-align:left}",
  ".dshr-btn:hover{background:color-mix(in srgb,currentColor 10%,transparent)}",
  ".dshr-dot{width:6px;height:6px;border-radius:50%;background:currentColor;opacity:.45;flex:none}",
  ".dshr-dot.on{opacity:1;background:#4c9aff}",
  ".dshr-caret{margin-left:auto;opacity:.5;font-size:11px}",
  ".dshr-panel{border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:8px;padding:4px;margin:2px 0}",
  ".dshr-row{display:flex;align-items:center;gap:6px;padding:5px 6px;border-radius:6px;cursor:pointer}",
  ".dshr-row:hover{background:color-mix(in srgb,currentColor 10%,transparent)}",
  ".dshr-row.sel{background:color-mix(in srgb,#4c9aff 22%,transparent)}",
  ".dshr-label{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ".dshr-sub{opacity:.55;font-size:11px;flex:none}",
  ".dshr-del{border:0;background:transparent;color:inherit;opacity:.4;cursor:pointer;padding:0 4px;font:inherit}",
  ".dshr-del:hover{opacity:.9;color:#ff6b6b}",
  ".dshr-form{display:grid;gap:4px;padding:6px;border-top:1px solid color-mix(in srgb,currentColor 18%,transparent);margin-top:4px}",
  ".dshr-form input{padding:5px 6px;border-radius:5px;border:1px solid color-mix(in srgb,currentColor 25%,transparent);background:transparent;color:inherit;font:inherit}",
  ".dshr-form .two{display:grid;grid-template-columns:2fr 1fr;gap:4px}",
  ".dshr-err{color:#ff8787;font-size:12px;padding:4px 6px;white-space:pre-wrap}",
  ".dshr-hint{opacity:.5;font-size:11px;padding:4px 8px}",
  ".dshr-actions{display:flex;gap:4px;justify-content:flex-end;margin-top:2px}",
  ".dshr-mini{padding:4px 8px;border-radius:5px;border:1px solid color-mix(in srgb,currentColor 25%,transparent);background:transparent;color:inherit;font:inherit;cursor:pointer}",
  ".dshr-list-head{display:flex;align-items:center;gap:6px;padding:6px 8px 2px;font-size:12px;opacity:.7}",
  ".dshr-list-head .dshr-del{opacity:.7}",
  // 패널 본문 (main 좌석). 명부와 세션 목록을 나란히 두고, 좁은 화면에서는 한列로 접는다.
  ".dshr-page{display:grid;grid-template-columns:minmax(240px,1fr) minmax(0,1.6fr);gap:20px;padding:18px;align-items:start;max-width:1080px}",
  ".dshr-col{display:flex;flex-direction:column;gap:2px;min-width:0}",
  ".dshr-h{font-size:12px;font-weight:600;letter-spacing:.02em;opacity:.6;margin:0 0 6px}",
  "@media (max-width:760px){.dshr-page{grid-template-columns:1fr;gap:14px;padding:12px}}",
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

/* 행을 눌렀을 때 셸이 이 본문을 전체 폭 패널로 보여준다. 명부와 세션 목록을
   나란히 두는 이유: 기기를 고르는 일과 그 기기의 세션을 보는 일이 한 화면에서
   이어져야 "전환"이라는 감각이 남기 때문이다. */
function HostsPage({ store, actions }) {
  const s = useStore(store);
  const selectedHost = s.hosts.find((host) => host.id === s.selected) || null;
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const field = (key) => (e) => setDraft({ ...draft, [key]: e.target.value });

  const hostRow = (id, label, sub, active) =>
    h(
      "div",
      { key: id ?? "local", className: "dshr-row" + (active ? " sel" : ""), onClick: () => actions.select(id) },
      h("span", { className: "dshr-dot" + (id ? " on" : "") }),
      h("span", { className: "dshr-label" }, label),
      sub ? h("span", { className: "dshr-sub" }, sub) : null,
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
    "div",
    { className: "dshr-page" },
    h(
      "div",
      { className: "dshr-col" },
      h("div", { className: "dshr-h" }, "작업 대상"),
      hostRow(null, "이 서버", "세션·작업 공간을 그대로 봅니다", !s.selected),
      ...s.hosts.map((host) => hostRow(host.id, host.label, host.host, host.id === s.selected)),
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
                  className: "dshr-mini",
                  onClick: async () => {
                    const ok = await actions.add(draft);
                    if (ok) setDraft(EMPTY_DRAFT);
                  },
                },
                "등록",
              ),
            ),
            h("div", { className: "dshr-hint" }, "ssh 키로 붙습니다. 원격에 dsh 가 설치되어 있어야 합니다."),
          )
        : h(
            "div",
            { className: "dshr-actions" },
            h("button", { type: "button", className: "dshr-mini", onClick: () => actions.startAdd() }, "＋ 호스트 추가"),
          ),
    ),
    h(
      "div",
      { className: "dshr-col" },
      selectedHost
        ? h(RemoteSessions, { store, actions })
        : h(
            "div",
            { className: "dshr-hint" },
            "왼쪽에서 원격 호스트를 고르면 이쪽에 그 머신의 세션 목록이 보입니다. '이 서버'가 선택된 동안에는 작업 공간 목록을 건드리지 않습니다.",
          ),
    ),
  );
}

/* ── 원격 세션 목록 ────────────────────────────────────────────────────── */

function RemoteSessions({ store, actions }) {
  const s = useStore(store);
  const host = s.hosts.find((item) => item.id === s.selected);
  if (!host) return null;

  return h(
    "div",
    { className: "dshr-switcher" },
    h(
      "div",
      { className: "dshr-list-head" },
      h("span", { className: "dshr-dot on" }),
      h("span", { className: "dshr-label" }, `${host.label} 세션`),
      h("span", { className: "dshr-sub" }, s.loading ? "" : String(s.sessions.length)),
      h(
        "button",
        { type: "button", className: "dshr-del", title: "다시 불러오기", disabled: s.loading, onClick: () => actions.refresh() },
        s.loading ? "…" : "⟳",
      ),
    ),
    s.loading ? h("div", { className: "dshr-hint" }, "원격에 붙는 중…") : null,
    !s.loading && s.error ? h("div", { className: "dshr-err" }, s.error) : null,
    !s.loading && !s.error && s.sessions.length === 0 ? h("div", { className: "dshr-hint" }, "이 경로에 세션이 없습니다.") : null,
    !s.loading
      ? s.sessions.map((session) =>
          h(
            "div",
            { key: session.sessionId, className: "dshr-row", title: session.sessionId },
            h("span", { className: "dshr-sub" }, session.cwd || "(경로 없음)"),
            h("span", { className: "dshr-label" }, session.sessionId.slice(0, 8)),
          ),
        )
      : null,
    !s.loading && s.sessions.length > 0 ? h("div", { className: "dshr-hint" }, "목록만 보입니다 — 세션 열기는 다음 단계입니다.") : null,
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
