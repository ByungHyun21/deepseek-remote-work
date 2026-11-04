/**
 * deepseek-remote-work — 호스트 반쪽.
 *
 * 하는 일 두 가지:
 *  1. 호스트 명부를 `$DSH_HOME/remote-work/hosts.json` 에 영속한다.
 *  2. `/remote-work/api/*` 라우트로 명부와 원격 세션 목록을 내어준다.
 *     목록은 요청마다 `ssh <호스트> dsh --profile acp` 를 잠깐 붙였다 뗀다.
 *
 * 화면(사이드바)은 lib/client.js 가 슬롯에 붙이고, 이 파일은 브라우저를 모른다.
 *
 * 이 라우트는 로그인한 브라우저가 붙을 수 있는 **원격 머신에 ssh 를 보내는**
 * 끝점이다. DSH 웹 표면 자체를 신뢰하는 사설망 배치를 전제로 하고, 명부에
 * 들어갈 수 있는 값은 hosts.js 에서 strict 하게 검증한다.
 */

import z from "@deepseek-ai/schemastery";
import fs from "node:fs";
import { dshHomePath } from "@deepseek-ai/dsh-home-paths";
import { createHostsStore } from "../lib/hosts.js";
import { listRemoteSessions } from "../lib/acp.js";

export const name = "deepseek-remote-work";
export const inject = ["webServer"];

export const Config = z.object({
  /** ssh + ACP 왕복 전체 상한 (ms). */
  timeoutMs: z.number().int().min(2000).max(120000).default(25000).volatile(),
  sshBin: z.string().default("ssh").volatile(),
  /** 원격에서 실행할 명령. 비로그인 셸 PATH 에 dsh 가 없으면 절대 경로를 넣는다. */
  remoteCommand: z.string().default("dsh --profile acp").volatile(),
  maxHosts: z.number().int().min(1).max(50).default(12).volatile(),
});

const ROUTE = "/remote-work";

/** 설정 값이 관측 가능 형태든 일반 값이든 읽을 수 있게 한다. */
function pick(value, fallback) {
  const raw = value && typeof value.get === "function" ? value.get() : value;
  return raw === undefined || raw === null || raw === "" ? fallback : raw;
}

function send(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    "cache-control": "no-store",
  });
  res.end(text);
}

/** 본문 상한을 걸고 JSON 을 읽는다. 초과/파싱 실패는 null. */
function readJson(req, limitBytes = 32 * 1024) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        req.destroy();
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });
}

export function apply(ctx, config) {
  const store = createHostsStore({
    file: dshHomePath("remote-work", "hosts.json"),
    fs,
    maxHosts: Number(pick(config?.maxHosts, 12)),
  });

  // 같은 호스트에 목록 요청이 몰리면 ssh 가 중복으로 뜬다. 진행 중이면 기다리게 한다.
  const inflight = new Map();

  const options = () => ({
    sshBin: String(pick(config?.sshBin, "ssh")),
    remoteCommand: String(pick(config?.remoteCommand, "dsh --profile acp")),
    timeoutMs: Number(pick(config?.timeoutMs, 25000)),
  });

  const sessionsOf = (host) => {
    const key = host.id;
    const running = inflight.get(key);
    if (running) return running;
    const call = listRemoteSessions(host, options()).finally(() => inflight.delete(key));
    inflight.set(key, call);
    return call;
  };

  const handler = async (req, res) => {
    let url;
    try {
      url = new URL(req.url ?? "/", "http://remote-work");
    } catch {
      return send(res, 400, { error: "잘못된 요청입니다." });
    }
    const path = url.pathname.slice(ROUTE.length).replace(/^\/+/, "");

    // GET /remote-work/api/hosts
    if (req.method === "GET" && path === "api/hosts") {
      return send(res, 200, { hosts: store.list() });
    }

    // POST /remote-work/api/hosts  {op:'add'|'remove', ...}
    if (req.method === "POST" && path === "api/hosts") {
      const body = await readJson(req);
      if (!body) return send(res, 400, { error: "본문을 읽을 수 없습니다." });
      if (body.op === "add") {
        const { host, error } = store.add(body);
        return error ? send(res, 400, { error }) : send(res, 200, { host, hosts: store.list() });
      }
      if (body.op === "remove") {
        const removed = store.remove(body.id);
        return send(res, removed ? 200 : 404, removed ? { hosts: store.list() } : { error: "호스트를 찾지 못했습니다." });
      }
      return send(res, 400, { error: "알 수 없는 요청입니다." });
    }

    // GET /remote-work/api/sessions?host=<id>
    if (req.method === "GET" && path === "api/sessions") {
      const host = store.get(url.searchParams.get("host") ?? "");
      if (!host) return send(res, 404, { error: "호스트를 찾지 못했습니다." });
      const { sessions, error } = await sessionsOf(host);
      return send(res, error ? 502 : 200, error ? { error } : { host: { id: host.id, label: host.label, host: host.host, cwd: host.cwd }, sessions });
    }

    return send(res, 404, { error: "없습니다." });
  };

  ctx.effect(() => ctx.webServer.register({ kind: "prefix", path: ROUTE, handler }), "deepseek-remote-work: api");
}
