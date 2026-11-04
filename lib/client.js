/**
 * deepseek-remote-work — 화면 반쪽.
 *
 * 슬롯 두 개에 붙는다.
 *  - `sidebar.panellist.actions` : 호스트 전환 버튼 (+ 등록/삭제)
 *  - `sidebar.workspaces`        : 선택한 원격 호스트의 세션 목록 (읽기 전용)
 *
 * "이 서버"는 목록의 맨 위 기본 항목이고, 원격이 하나 선택되면 작업 공간 아래에
 * 그 원격의 세션이 뜬다. 기기를 바꾼다는 감각을 새 화면이 아니라 사이드바 위의
 * 필터 전환으로 만들려는 의도다.
 *
 * 선택은 브라우저 로컬(localStorage)에 둔다. 폰에서 골랐다고 PC 화면이 바뀌면
 * 안 되기 때문이다. 명부만 서버에 영속한다.
 *
 * 세션 행은 아직 눌렀을 때 아무 일도 일어나지 않는다. 원격 세션을 여는 일은
 * ACP 가 과거 대화를 재생해주지 않아 별도의 결정이 필요하다 — README 참고.
 */

"use strict";

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

/* ── 호스트 전환 버튼 ──────────────────────────────────────────────────── */

function Switcher({ store, actions }) {
  const s = useStore(store);
  const selectedHost = s.hosts.find((host) => host.id === s.selected) || null;
  const [draft, setDraft] = useState({ label: "", host: "", user: "", port: "", cwd: "" });
  const field = (key) => (e) => setDraft({ ...draft, [key]: e.target.value });

  return h(
    "div",
    { className: "dshr-switcher" },
    h(
      "button",
      { type: "button", className: "dshr-btn", onClick: () => actions.toggle(), title: "작업 대상 전환" },
      h("span", { className: "dshr-dot" + (selectedHost ? " on" : "") }),
      h("span", { className: "dshr-label" }, selectedHost ? selectedHost.label : "이 서버"),
      h("span", { className: "dshr-caret" }, s.open ? "▾" : "▸"),
    ),
    s.open &&
      h(
        "div",
        { className: "dshr-panel" },
        h(
          "div",
          { className: "dshr-row" + (!s.selected ? " sel" : ""), onClick: () => actions.select(null) },
          h("span", { className: "dshr-dot" }),
          h("span", { className: "dshr-label" }, "이 서버"),
        ),
        ...s.hosts.map((host) =>
          h(
            "div",
            { key: host.id, className: "dshr-row" + (host.id === s.selected ? " sel" : ""), onClick: () => actions.select(host.id) },
            h("span", { className: "dshr-dot on" }),
            h("span", { className: "dshr-label" }, host.label),
            h("span", { className: "dshr-sub" }, host.host),
            h(
              "button",
              {
                type: "button",
                className: "dshr-del",
                title: "명부에서 삭제",
                onClick: (e) => {
                  e.stopPropagation();
                  actions.remove(host.id);
                },
              },
              "✕",
            ),
          ),
        ),
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
                h("input", { placeholder: " 작업 경로 /home/yoon", value: draft.cwd, onChange: field("cwd") }),
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
                      if (ok) setDraft({ label: "", host: "", user: "", port: "", cwd: "" });
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

  const store = createStore({ hosts: [], selected: stored, sessions: [], loading: false, error: "", open: false, adding: false });

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
    toggle: () => store.set((s) => ({ open: !s.open, error: "" })),
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

  ctx.effect(() => {}, `${PLUGIN}: client`);

  ctx.slots.inject("sidebar.panellist.actions", () =>
    ctx.slots.register({ name: "sidebar.panellist.actions", key: `${PLUGIN}#switcher` }, h(Switcher, { store, actions })),
  );
  ctx.slots.inject("sidebar.workspaces", () =>
    ctx.slots.register({ name: "sidebar.workspaces", key: `${PLUGIN}#sessions` }, h(RemoteSessions, { store, actions })),
  );
}

exports.inject = ["slots"];
exports.apply = apply;
