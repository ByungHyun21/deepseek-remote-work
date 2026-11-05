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

/** 리액트 최소 흉내: 요소는 객체로 만들기만 하고, 훅은 고정값을 돌려준다. */
const fakeReact = () => ({
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
  useState: (init) => [init, () => {}],
  useEffect: () => {},
});

/** 트리를 돌며 className 에 desired 를 포함하는 노드가 있는지 본다. */
function findAll(node, desired, out = []) {
  if (!node || typeof node !== "object") return out;
  if (typeof node.type === "string" && String(node.props?.className ?? "").includes(desired)) out.push(node);
  for (const child of node.children ?? []) findAll(child, desired, out);
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
