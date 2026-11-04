/**
 * 원격 DSH 에 붙어 세션 목록을 읽어온다.
 *
 * 방식은 이미 실증된 것을 그대로 쓴다: `ssh <호스트> dsh --profile acp` 를
 * 자식으로 띄우고, 그 표준 입출력으로 ACP(JSON-RPC, 한 줄에 한 메시지)를
 * 나눈다. 붙이는 명령은 initialize + session/list 둘 뿐이라 상시 연결이
 * 필요 없고, 목록을 읽은 뒤 자식을 끝낸다.
 *
 * 주의 두 가지
 *  - `-t`(의사 터미널)를 붙이면 안 된다. PTY가 개행이 섞인 줄을 망가뜨린다.
 *  - 원격의 비로그인 셸 PATH 에 dsh 가 없으면 붙지 않는다. 그럴 때는
 *    remoteCommand 에 절대 경로를 넣는다 (예: /home/yoon/.local/bin/dsh).
 */

import { spawn } from "node:child_process";

/** NDJSON 버퍼에서 완성된 줄만 뽑는다. 순수 함수라 테스트 대상. */
export function splitFrames(buffer) {
  const frames = [];
  let rest = buffer;
  let index;
  while ((index = rest.indexOf("\n")) >= 0) {
    const line = rest.slice(0, index).trim();
    rest = rest.slice(index + 1);
    if (!line) continue;
    try {
      frames.push(JSON.parse(line));
    } catch {
      // 반대로 잘려 들어오거나 프로토콜 밖의 출력(원격 로그 등)은 버린다.
    }
  }
  return { frames, rest };
}

/** ssh argv 를 만든다. 호스트·사용자는 hosts.js 에서 이미 검증된 값만 온다. */
export function buildSshArgv(host, { sshBin = "ssh", remoteCommand = "dsh --profile acp" } = {}) {
  const target = host.user ? `${host.user}@${host.host}` : host.host;
  return [
    sshBin,
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=10",
    "-o", "StrictHostKeyChecking=accept-new",
    "-p", String(host.port || 22),
    target,
    remoteCommand,
  ];
}

/**
 * 원격 세션 목록. 실패를 던지지 않고 { sessions, error } 로 돌려준다 —
 * 사이드바가 죽지 않고 상태를 보여줄 수 있게.
 */
export function listRemoteSessions(host, { sshBin, remoteCommand, timeoutMs = 20000, cwd } = {}) {
  return new Promise((resolve) => {
    let argv;
    let child;
    try {
      argv = buildSshArgv(host, { sshBin, remoteCommand });
      child = spawn(argv[0], argv.slice(1), { stdio: ["pipe", "pipe", "pipe"] });
    } catch (error) {
      resolve({ sessions: [], error: `ssh 를 시작하지 못했습니다: ${error.message}` });
      return;
    }

    let buffer = "";
    let nextId = 1;
    let settled = false;
    let stderr = "";
    const pending = new Map();

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.stdin.end(); } catch { /* 이미 닫힘 */ }
      child.kill("SIGTERM");
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({ sessions: [], error: `응답이 없습니다 (${Math.round(timeoutMs / 1000)}초). 원격에 dsh 가 설치되어 있고 PATH 에 있는지 확인하세요.` });
    }, timeoutMs);

    const send = (method, params, onResult) => {
      const id = nextId++;
      pending.set(id, onResult);
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      const { frames, rest } = splitFrames(buffer);
      buffer = rest;
      for (const frame of frames) {
        // 에이전트가 이쪽에게 요청을 보내는 경우(권한 요청 등)는 목록 읽기에서
        // 쓸 일이 없으므로 빈 결과로 넘긴다.
        if (frame.id !== undefined && frame.method) {
          child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: frame.id, result: {} }) + "\n");
          continue;
        }
        if (frame.id !== undefined && pending.has(frame.id)) {
          const done = pending.get(frame.id);
          pending.delete(frame.id);
          done(frame);
        }
      }
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-2000);
    });

    child.on("error", (error) => finish({ sessions: [], error: `접속 실패: ${error.message}` }));
    child.on("exit", (code) => {
      if (!settled) finish({ sessions: [], error: stderr.trim() || `원격 응답 없이 끝났습니다 (종료 코드 ${code}).` });
    });

    send("initialize", { protocolVersion: 0, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } } }, (init) => {
      if (init.error) {
        finish({ sessions: [], error: `악수 실패: ${init.error.message ?? "원격이 initialize 를 거부했습니다."}` });
        return;
      }
      const caps = init.result?.agentCapabilities?.sessionCapabilities ?? {};
      if (!caps.list) {
        finish({ sessions: [], error: "원격 DSH 가 세션 목록을 지원하지 않습니다." });
        return;
      }
      // session/list 는 cwd 를 요구한다. 명부의 경로를 쓰고, 비우면 원격 HOME 을
      // 쓸 수 있게 user 로 추측한 값을 넣는다.
      const wantedCwd = cwd ?? host.cwd ?? (host.user ? `/home/${host.user}` : undefined);
      const params = { mcpServers: [] };
      if (wantedCwd) params.cwd = wantedCwd;
      send("session/list", params, (list) => {
        if (list.error) {
          finish({
            sessions: [],
            error: list.error.message === "Invalid params"
              ? "세션 목록을 위한 경로를 확인해야 합니다. 호스트의 작업 경로를 채워주세요."
              : `목록 조회 실패: ${list.error.message ?? "알 수 없음"}`,
          });
          return;
        }
        const sessions = (list.result?.sessions ?? []).map((s) => ({
          sessionId: String(s.sessionId ?? ""),
          cwd: typeof s.cwd === "string" ? s.cwd : (wantedCwd ?? ""),
        }));
        finish({ sessions });
      });
    });
  });
}
