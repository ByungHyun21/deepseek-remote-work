import { test } from "node:test";
import assert from "node:assert/strict";
import { splitFrames, buildSshArgv } from "../lib/acp.js";

test("완성된 줄만 뽑고 나머지는 다음을 위해 둔다", () => {
  const { frames, rest } = splitFrames('{"a":1}\n{"b":');
  assert.deepEqual(frames, [{ a: 1 }]);
  assert.equal(rest, '{"b":');
});

test("잘린 줄·빈 줄·프로토콜 밖 출력은 버린다", () => {
  const { frames, rest } = splitFrames("Warning: remote log line\n\n{\"ok\":true}\n");
  assert.deepEqual(frames, [{ ok: true }]);
  assert.equal(rest, "");
});

test("여러 줄을 한 번에 처리한다", () => {
  const { frames } = splitFrames('{"id":1,"result":{}}\n{"id":2,"result":{"sessions":[]}}\n');
  assert.equal(frames.length, 2);
  assert.deepEqual(frames[1].result, { sessions: [] });
});

test("ssh argv: 사용자·포트·명령이 반영되고 -t 가 없다", () => {
  const argv = buildSshArgv({ host: "192.168.0.36", user: "yoon", port: 2222 }, { remoteCommand: "/home/yoon/.local/bin/dsh --profile acp" });
  assert.equal(argv[0], "ssh");
  assert.ok(argv.includes("-p"));
  assert.ok(argv.includes("2222"));
  assert.ok(argv.includes("yoon@192.168.0.36"));
  assert.ok(argv.includes("/home/yoon/.local/bin/dsh --profile acp"));
  assert.ok(!argv.includes("-t"), "PTY 를 붙이면 NDJSON 이 망가진다");
  assert.ok(argv.includes("BatchMode=yes"), "비밀번호 프롬프트에서 걸리면 안 된다");
});

test("ssh argv: 사용자가 없으면 맨 주소, 포트 없으면 22", () => {
  const argv = buildSshArgv({ host: "box.local" });
  assert.ok(argv.includes("box.local"));
  assert.ok(argv.includes("22"));
  assert.ok(argv.includes("dsh --profile acp"));
});
