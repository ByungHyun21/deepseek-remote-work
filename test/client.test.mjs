/**
 * 클라이언트 번들 실행 시험.
 *
 * 브라우저 모듈 계약(`window.__ModuleLoader__.load({id, factory})`)은 파일을
 * 평가하는 순간 팩토리를 **등록만** 하게 요구한다. 최상위에서 `require` 를 쓰면
 * 브라우저에서 그 자리에서 죽는다 — 이 파일이 한 번 그랬다. 그래서 이 시험은
 * 실제 평가를 흉내 낸다: 가짜 로더로 파일을 돌리고, 팩토리를 materialize 하고,
 * apply() 를 부르고, 등록이 어떤 좌석에 어떤 옵션으로 앉는지 본다.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SOURCE = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

/** 리액트 최소 흉내: 함수 컴포넌트는 실제로 렌더해 트리에 심고, 훅은 고정값을 돌려준다. */
const fakeReact = () => {
  const createElement = (type, props, ...children) => {
    const flat = children.flat(Infinity);
    // 컴포넌트를 인라인으로 펼치지 않으면 시험이 행·버튼을 아예 못 본다.
    if (typeof type === "function") return type({ ...(props ?? {}), children: flat });
    return { type, props: props ?? {}, children: flat };
  };
  return {
    createElement,
    useState: (init) => [init, () => {}],
    useEffect: () => {},
  };
};

/** 트리를 돌며 className 에 desired 를 포함하는 노드가 있는지 본다. */
function findAll(node, desired, out = []) {
  if (!node || typeof node !== "object") return out;
  if (typeof node.type === "string" && String(node.props?.className ?? "").includes(desired)) out.push(node);
  for (const child of node.children ?? []) findAll(child, desired, out);
  return out;
}

/** 공백으로 갈린 클래스 토큰이 정확히 일치하는 노드만. (`dshr-card` 와 `dshr-cardHead` 를 가린다.) */
function findExactly(node, token, out = []) {
  if (!node || typeof node !== "object") return out;
  const classes = String(node.props?.className ?? "").split(/\s+/);
  if (typeof node.type === "string" && classes.includes(token)) out.push(node);
  for (const child of node.children ?? []) findExactly(child, token, out);
  return out;
}

/** 파일을 평가해 { 등록된 팩토리, materialize 된 exports } 를 만든다. */
function boot() {
  const registered = [];
  const appended = [];
  const sandbox = {
    window: { __ModuleLoader__: { load: (entry) => registered.push(entry) } },
    document: {
      getElementById: () => null,
      createElement: () => ({ id: "", textContent: "", remove() {} }),
      head: { append: (node) => appended.push(node) },
    },
    fetch: async () => ({ ok: true, json: async () => ({ hosts: [] }) }),
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox);
  assert.equal(registered.length, 1, "파일이 팩토리를 하나도 등록하지 않았다");
  const module = registered[0].factory((name) => {
    if (name === "react") return fakeReact();
    throw new Error(`예상치 못한 require: ${name}`);
  });
  return { registered: registered[0], module, appended, sandbox };
}

/** 가짜 ctx 로 apply() 를 실행해 좌석 등록을 모은다. */
function apply(ctxSlots) {
  const { module, appended } = boot();
  const registrations = [];
  const effects = [];
  const ctx = {
    effect: (fn, label) => effects.push({ fn, label }),
    slots: {
      inject: (name, factory) => {
        factory();
        return () => {};
      },
      register: (options, component) => {
        registrations.push({ options, component });
        return () => {};
      },
    },
  };
  module.apply(ctx);
  if (ctxSlots) ctxSlots(ctx);
  return { registrations, effects, module, appended };
}

test("팩토리 밖에는 사이드이펙트가 없다 (계약의 핵심)", () => {
  // 로더 없이 평가하면 죽어야 정상이다 — 즉 그 호출이 최상위에 있다는 뜻.
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  // vm 렘을 건너면 에러 객체의 프로토타입이 달라지므로 메시지로 본다.
  assert.throws(() => vm.runInContext(SOURCE, sandbox), /Cannot read properties of undefined/);
});

test("등록되는 모듈 id 와 exports 형태", () => {
  const { registered, module } = boot();
  assert.equal(registered.id, "deepseek-remote-work");
  assert.deepEqual([...module.inject], ["slots"], "exports.inject 는 ['slots']");
  assert.equal(typeof module.apply, "function");
});

test("CSS 는 materialize 시점에 한 번 주입된다", () => {
  const { appended } = apply();
  assert.equal(appended.length, 1);
  assert.match(appended[0].textContent, /\.dshr-page/);
});

test("nav 패널 행 + main 패널 두 좌석에 앉는다", () => {
  const { registrations } = apply();
  const bySeat = Object.fromEntries(registrations.map((r) => [r.options.name, r]));
  const row = bySeat["sidebar.panellist"];
  const page = bySeat["main"];

  assert.ok(row, "sidebar.panellist 등록이 없다 — 자동화 작업 옆에 행이 안 뜬다");
  assert.ok(page, "main 등록이 없다 — 행을 눌러도 열릴 패널이 없다");
  assert.equal(registrations.length, 2, `예상 좌석은 2개, 실제로 ${registrations.length}개`);

  // list 좌석은 id, keyed 좌석은 key 를 쓰고 둘은 같은 id 로 짝을 이룬다.
  assert.equal(typeof row.options.id, "string");
  assert.equal(page.options.key, row.options.id);
  assert.equal(row.options.order, 20, "자동화 작업(order 10) 뒤, 더 보기 앞");
  assert.equal(row.options.label, "작업 대상");

  // register 두 번째 인자는 컴포넌트 함수여야 한다 (요소 인스턴스 금지).
  assert.equal(typeof row.component, "function");
  assert.equal(typeof page.component, "function");
});

test("아이콘 컴포넌트는 svg 를, 패널 본문은 페이지를 렌더한다", () => {
  const store = {
    get: () => ({ hosts: [{ id: "h1", label: "0.36", host: "192.168.0.36" }], selected: "h1", sessions: [{ sessionId: "abcd1234efgh", cwd: "/home/yoon" }], loading: false, error: "", adding: false }),
    set: () => {},
    subscribe: () => () => {},
  };
  const actions = { select() {}, remove() {}, startAdd() {}, cancelAdd() {}, refresh() {}, add: async () => true };

  const { registrations } = apply();
  const row = registrations.find((r) => r.options.name === "sidebar.panellist");
  const page = registrations.find((r) => r.options.name === "main");

  const icon = row.component({ size: 16 });
  assert.equal(icon.type, "svg");

  const injected = page.options.inject();
  assert.deepEqual(Object.keys(injected).sort(), ["actions", "store"]);
  const view = page.component({ store, actions });
  assert.ok(findAll(view, "dshr-page").length >= 1, "패널 본문 루트가 없다");
  assert.ok(findAll(view, "dshr-row").length >= 2, "이 서버 + 호스트 행이 있어야 한다");
});

/* ── 디자인 회귀 ──────────────────────────────────────────────────────────
   이 플러그인은 셸 화면(자동화 작업·플러그인)의 값을 옮겨 쓰는 방식이다.
   값이 셸에서 빠져나오면 (하드코딩 색, 자체 버튼 hover, 별도 끊점) 두 화면이
   서로 다른 앱처럼 보이기 시작한다 — 그 길로 가지 않도록 여기서 막는다. */

/** 페이지 본문을 임의 상태로 렌더한다. */
function renderPage(state) {
  const store = { get: () => state, set: () => {}, subscribe: () => () => {} };
  const actions = { select() {}, remove() {}, startAdd() {}, cancelAdd() {}, refresh() {}, add: async () => true };
  const { registrations } = apply();
  return registrations.find((r) => r.options.name === "main").component({ store, actions });
}

const STATE = {
  hosts: [{ id: "h1", label: "0.36", host: "192.168.0.36", user: "yoon", port: 22, cwd: "/home/yoon" }],
  selected: "h1",
  sessions: [{ sessionId: "abcd1234efgh", cwd: "/home/yoon" }],
  loading: false,
  error: "",
  adding: false,
};

const cssOf = () => apply().appended[0].textContent;

test("색을 하드코딩하지 않는다 — 셸 테마 토큰만 쓴다", () => {
  const css = cssOf();
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, "16 진 색이 들어갔다 — 라이트/다크에서 어긋난다");
  assert.doesNotMatch(css, /\brgba?\(/, "rgb() 리터럴은 테마를 따라가지 않는다");
  for (const token of [
    "--dsw-alias-interactive-bg-hover",
    "--dsw-alias-button-primary-fill",
    "--dsw-alias-button-primary-hover",
    "--dsw-alias-border-l3",
    "--dsw-alias-label-tertiary",
    "--dsw-alias-bg-skeleton",
    "--dsw-radius-md",
    "--dsw-focus-ring-color",
  ]) {
    assert.ok(css.includes(token), `셸 토큰 ${token} 을 쓰지 않는다`);
  }
});

test("버튼 hover 는 셸의 값 — brightness 로 자체 발광하지 않는다", () => {
  const css = cssOf();
  assert.doesNotMatch(css, /brightness\(/, "filter:brightness 는 셸 어디에도 없는 hover 다");
  assert.match(css, /\.dshr-btn\.primary:hover:not\(:disabled\)\{background:var\(--dsw-alias-button-primary-hover\)\}/);
});

test("제목은 20px/500 + 설명 한 줄 — 자동화 작업·플러그인 화면과 같게", () => {
  const css = cssOf();
  assert.match(css, /\.dshr-h1\{margin:0;font-size:20px;font-weight:500;line-height:28px\}/);
  assert.match(css, /\[data-platform=darwin\] \.dshr-heading\{padding-top:calc\(28px \+ var\(--dsh-frame-top-clearance/);
  const view = renderPage(STATE);
  assert.equal(findAll(view, "dshr-intro").length, 1, "제목 아래 설명 줄이 없다");
});

test("행 hover 와 선택은 같은 셸 토큰이고, 눌렀을 때 영역은 stretched-link 버튼이다", () => {
  const css = cssOf();
  assert.match(css, /\.dshr-row:hover\{background:var\(--dsw-alias-interactive-bg-hover\)\}/);
  assert.match(css, /\.dshr-row\.sel\{background:var\(--dsw-alias-interactive-bg-hover\)\}/);
  const view = renderPage(STATE);
  assert.ok(findAll(view, "dshr-rowOpen").length >= 2, "행 전체를 누르는 버튼이 없다");
  assert.ok(findAll(view, "dshr-rowEnd").length >= 1, "삭제 버튼이 행 위에 얹히지 않았다 (button 안의 button 은 부적합)");
});

test("입력은 자동화 작업의 설정 카드 배선이다 (라벨·hairline·48px 행)", () => {
  const css = cssOf();
  assert.match(css, /\.dshr-field\{justify-content:space-between;align-items:center;gap:12px;min-height:48px;display:flex\}/);
  assert.match(css, /\.dshr-field\+\.dshr-field\{border-top:\.5px solid var\(--dsw-alias-border-l3\)\}/);
  const view = renderPage({ ...STATE, adding: true });
  assert.equal(findExactly(view, "dshr-card").length, 1);
  assert.equal(findExactly(view, "dshr-field").length, 5, "이름·주소·포트·사용자·작업 경로");
  for (const input of findAll(view, "dshr-fieldInput")) {
    assert.ok(input.props.id, "입력에 id 가 없다 — 라벨과 이어지지 않는다");
  }
  for (const label of findAll(view, "dshr-fieldLabel")) {
    assert.ok(label.props.htmlFor, "라벨이 입력과 연결되지 않았다");
  }
});

test("안내·실패는 notice 카드, 빈 상태는 glyph + title + action 이다", () => {
  const css = cssOf();
  assert.match(css, /\.dshr-notice\{background:var\(--dsw-specific-sidebar-fill\)/);
  const empty = renderPage({ ...STATE, hosts: [], selected: null, sessions: [] });
  assert.equal(findAll(empty, "dshr-emptyGlyph").length, 1);
  assert.equal(findAll(empty, "dshr-emptyTitle").length, 1);
  assert.equal(findAll(empty, "dshr-emptyAction").length, 1, "빈 상태에 행동 버튼이 없다");
  const failed = renderPage({ ...STATE, error: "ssh 붙기 실패" });
  assert.ok(findAll(failed, "dshr-notice error").length >= 1);
});

test("붙는 중에는 스켈레톤, 디테일 헤더에는 상태 태그와 다시 불러오기가 있다", () => {
  const view = renderPage({ ...STATE, loading: true });
  assert.equal(findAll(view, "dshr-skelBar").length > 0, true, "스켈레톤이 없다");
  assert.equal(findAll(view, "dshr-spin").length, 1, "새로고침 버튼이 도는 중임을 표시하지 않는다");
  const done = renderPage(STATE);
  assert.equal(findAll(done, "dshr-tag").length >= 2, true, "행/디테일에 상태 태그가 없다");
});

test("끊점은 자동화 작업과 같은 지점 (1100/760/400) 을 쓴다", () => {
  const css = cssOf();
  assert.match(css, /@media \(width<=1100px\)/);
  assert.match(css, /@media \(width<=760px\)\{\.dshr-page\.hasDetail \.dshr-listPane\{display:none\}/);
  assert.match(css, /@media \(width<=400px\)/);
  assert.ok(css.includes(".dshr-back"), "좁은 창에서 목록으로 돌아가는 길이 없다");
});
