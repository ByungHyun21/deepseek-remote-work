/**
 * 호스트 명부 저장소 — 순수 로직 (fs 는 주입받을 때만 쓴다).
 *
 * 두 가지를 구분하는 것이 이 플러그인의 전제다.
 *  - 호스트 **명부**는 서버에 영속한다. 모든 기기가 같은 목록을 본다.
 *  - 지금 **선택한** 호스트는 브라우저 로컬 상태다. 폰에서 골랐다고 PC 화면이
 *    따라 바뀌면 안 되므로 selected 는 여기 저장하지 않는다.
 *
 * 자격 증명(비밀번호·키 경로)은 이 파일에 저장하지 않는다. ssh 의 자기 설정
 * (~/.ssh/config, ssh-agent, authorized_keys)을 쓰도록 두고, 명부에는
 * 접근 좌표만 담는다.
 */

import { randomBytes } from "node:crypto";
import { dirname } from "node:path";

export const SCHEMA_VERSION = 1;

/** ssh 인자 주입을 막기 위한 안전한 토큰. `-`로 시작하지 않는다. */
const TOKEN_RE = /^[A-Za-z0-9._-]+$/;

/** `-`로 시작하면 ssh 가 옵션으로 오해한다. 명부 파일을 직접 편집한 경우까지 막는다. */
export function isSafeToken(value) {
  return typeof value === "string" && TOKEN_RE.test(value) && !value.startsWith("-");
}

/** 제어 문자(0x00–0x1f, 0x7f) 또는 역슬래시가 있는지 본다. 유니코드와 공백은 허용. */
export function hasBadPathChar(value) {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 32 || code === 127 || value[i] === "\\") return true;
  }
  return false;
}

export function newId() {
  return randomBytes(6).toString("base64url").slice(0, 8);
}

/** 명부에 넣을 값을 검증한다. 통과하면 정규화된 값, 실패하면 사유. */
export function validateHost(input = {}) {
  const label = String(input.label ?? "").trim().slice(0, 40);
  const host = String(input.host ?? "").trim();
  const user = String(input.user ?? "").trim();
  const port = input.port === undefined || input.port === null || input.port === "" ? 22 : Number(input.port);
  const cwd = String(input.cwd ?? "").trim().slice(0, 500);

  if (!label) return { error: "이름을 입력하세요." };
  if (!host) return { error: "주소를 입력하세요." };
  if (host.startsWith("-")) return { error: "주소는 - 로 시작할 수 없습니다." };
  if (!isSafeToken(host)) return { error: "주소에는 문자, 숫자, . _ - 만 쓸 수 있습니다." };
  if (user && !isSafeToken(user)) return { error: "사용자 이름에는 문자, 숫자, . _ - 만 쓸 수 있습니다." };
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { error: "포트가 올바르지 않습니다." };
  if (cwd && hasBadPathChar(cwd)) return { error: "경로에 제어 문자나 역슬래시는 쓸 수 없습니다." };

  return { value: { id: newId(), label, host, user, port, cwd, addedAt: Date.now() } };
}

/** 저장된 문서를 검증하며 읽는다. 망가진 파일은 빈 명부로 되돌린다. */
export function parseDocument(raw) {
  const empty = { version: SCHEMA_VERSION, hosts: [] };
  if (!raw) return empty;
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch {
    return empty;
  }
  if (!doc || !Array.isArray(doc.hosts)) return empty;
  const hosts = doc.hosts
    .filter((h) => h && typeof h.id === "string" && isSafeToken(h.host))
    .map((h) => ({
      id: h.id.slice(0, 16),
      label: String(h.label ?? h.host).slice(0, 40),
      host: h.host,
      user: isSafeToken(h.user) ? h.user : "",
      port: Number.isInteger(h.port) && h.port > 0 && h.port < 65536 ? h.port : 22,
      cwd: typeof h.cwd === "string" ? h.cwd.slice(0, 500) : "",
      addedAt: Number(h.addedAt) || 0,
    }));
  return { version: SCHEMA_VERSION, hosts };
}

/** fs 를 주입받아 도메인 로직만 테스트할 수 있게 한다. */
export function createHostsStore({ file, fs, maxHosts = 12 }) {
  let doc = { version: SCHEMA_VERSION, hosts: [] };
  let loaded = false;

  const save = () => {
    // 첫 저장은 디렉터리가 없어서 실패할 수 있다. 쓰기 직전에 만든다 (0700).
    fs.mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    // 원자적 교체: 반쯤 쓰인 파일이 남지 않게 tmp + rename.
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(doc, null, 2) + "\n", { mode: 0o600 });
    fs.renameSync(tmp, file);
  };

  return {
    load() {
      if (loaded) return doc;
      loaded = true;
      try {
        doc = parseDocument(fs.readFileSync(file, "utf8"));
      } catch {
        doc = { version: SCHEMA_VERSION, hosts: [] };
      }
      return doc;
    },
    list() {
      return this.load().hosts.map(({ id, label, host, user, port, cwd }) => ({ id, label, host, user, port, cwd }));
    },
    get(id) {
      return this.load().hosts.find((h) => h.id === String(id)) ?? null;
    },
    add(input) {
      this.load();
      if (doc.hosts.length >= maxHosts) return { error: `호스트는 최대 ${maxHosts}개입니다.` };
      const { value, error } = validateHost(input);
      if (error) return { error };
      if (doc.hosts.some((h) => h.host === value.host && h.user === value.user && h.port === value.port)) {
        return { error: "같은 주소의 호스트가 이미 있습니다." };
      }
      doc.hosts.push(value);
      save();
      return { host: value };
    },
    remove(id) {
      this.load();
      const before = doc.hosts.length;
      doc.hosts = doc.hosts.filter((h) => h.id !== String(id));
      if (doc.hosts.length === before) return false;
      save();
      return true;
    },
  };
}
