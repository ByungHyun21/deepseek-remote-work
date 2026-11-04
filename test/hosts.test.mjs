import { test } from "node:test";
import assert from "node:assert/strict";
import { validateHost, parseDocument, createHostsStore, hasBadPathChar } from "../lib/hosts.js";

/** fs 를 흉내 내는 최소 객체. 저장 경로의 원자성만 보면 된다. */
function fakeFs(files = {}) {
  const written = [];
  return {
    files,
    written,
    readFileSync: (p) => {
      if (!(p in files)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return files[p];
    },
    writeFileSync: (p, data) => {
      written.push([p, data]);
    },
    renameSync: (from, to) => {
      const entry = written.find(([p]) => p === from);
      files[to] = entry ? entry[1] : "";
    },
  };
}

test("정상 입력은 정규화되어 통과한다", () => {
  const { value, error } = validateHost({ label: "작업실", host: "192.168.0.36", user: "yoon", port: "22", cwd: "/home/yoon" });
  assert.equal(error, undefined);
  assert.equal(value.port, 22);
  assert.equal(value.label, "작업실");
  assert.match(value.id, /^[A-Za-z0-9_-]{8}$/);
});

test("포트 생략은 22, 공백은 잘린다", () => {
  const { value } = validateHost({ label: "  노트북  ", host: " 10.0.0.5 " });
  assert.equal(value.port, 22);
  assert.equal(value.label, "노트북");
  assert.equal(value.host, "10.0.0.5");
});

test("ssh 옵션 주입 시도를 거절한다", () => {
  assert.match(validateHost({ label: "x", host: "-oProxyCommand=touch" }).error, /시작할 수 없습니다/);
  assert.match(validateHost({ label: "x", host: "a;rm -rf /" }).error, /문자, 숫자/);
  assert.match(validateHost({ label: "x", host: "" }).error, /주소를/);
  assert.match(validateHost({ label: "", host: "a" }).error, /이름/);
});

test("경로 검사: 유니코드와 공백은 허용, 제어 문자와 역슬래시는 거절", () => {
  assert.equal(hasBadPathChar("/home/yoon/작업 실"), false);
  assert.equal(hasBadPathChar("C:\\work"), true);
  assert.equal(hasBadPathChar("bad\nname"), true);
  assert.match(validateHost({ label: "x", host: "a", cwd: "C:\\work" }).error, /경로/);
});

test("망가진 문서는 빈 명부로 되돌린다", () => {
  assert.deepEqual(parseDocument("{"), { version: 1, hosts: [] });
  assert.deepEqual(parseDocument(""), { version: 1, hosts: [] });
  const ok = parseDocument(JSON.stringify({ version: 1, hosts: [{ id: "abc", host: "h", label: "L" }, { id: "bad", host: "-x" }] }));
  assert.equal(ok.hosts.length, 1);
  assert.equal(ok.hosts[0].port, 22);

  // 명부 파일을 직접 편집해 앞이 - 인 값을 넣어도 ssh 옵션으로 새면 안 된다.
  const smuggle = parseDocument(JSON.stringify({ version: 1, hosts: [{ id: "a", host: "-oProxyCommand=x" }, { id: "b", host: "ok", user: "-oProxyCommand=x" }] }));
  assert.equal(smuggle.hosts.length, 1);
  assert.equal(smuggle.hosts[0].host, "ok");
  assert.equal(smuggle.hosts[0].user, "");
});

test("명부 추가·삭제와 중복 거절", () => {
  const file = "/x/hosts.json";
  const fs = fakeFs({});
  const store = createHostsStore({ file, fs, maxHosts: 2 });

  const first = store.add({ label: "A", host: "10.0.0.1" });
  assert.equal(first.error, undefined);
  assert.match(store.add({ label: "dup", host: "10.0.0.1" }).error, /이미/);
  assert.equal(store.add({ label: "B", host: "10.0.0.2" }).error, undefined);
  assert.match(store.add({ label: "C", host: "10.0.0.3" }).error, /최대 2개/);

  assert.equal(store.list().length, 2);
  assert.equal(store.remove(first.host.id), true);
  assert.equal(store.remove("없음"), false);
  assert.equal(store.list().length, 1);
});

test("저장된 파일을 다시 읽는다 (round-trip)", () => {
  const file = "/x/hosts.json";
  const fs = fakeFs({});
  const store = createHostsStore({ file, fs, maxHosts: 5 });
  const added = store.add({ label: "A", host: "10.0.0.1", user: "yoon", cwd: "/home/yoon" });

  const reopened = createHostsStore({ file, fs, maxHosts: 5 });
  const list = reopened.list();
  assert.equal(list.length, 1);
  assert.deepEqual(list[0], {
    id: added.host.id,
    label: "A",
    host: "10.0.0.1",
    user: "yoon",
    port: 22,
    cwd: "/home/yoon",
  });
});
