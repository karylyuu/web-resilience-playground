import { pbkdf2Sync } from "node:crypto";
import type { RequestHandler } from "express";
import { transition } from "./telemetry";

export const catalog = [
  {
    key: "api-hold",
    label: "API 지연·대기",
    mechanism:
      "입력한 시간만큼 API 처리를 보류합니다. 시간을 비우면 해제할 때까지 대기합니다. 설정값과 실제 응답시간은 별도로 기록합니다.",
    scope: "JSON API · 최대 60초",
  },
  {
    key: "api-error",
    label: "API 오류 응답",
    mechanism:
      "JSON API가 HTTP 503을 반환합니다. 화면의 오류 처리를 관찰합니다.",
    scope: "JSON API",
  },
  {
    key: "connection-cut",
    label: "응답 연결 끊김",
    mechanism: "응답 전 HTTP 소켓을 닫습니다. 실제 패킷 손실과는 다릅니다.",
    scope: "로컬 서비스의 새 요청",
  },
  {
    key: "invalid-json",
    label: "응답 데이터 손상",
    mechanism:
      "JSON 응답을 잘린 본문으로 전송합니다. HTTP 성공과 파싱 실패를 구분합니다.",
    scope: "JSON API",
  },
  {
    key: "image-error",
    label: "이미지 전달 실패",
    mechanism:
      "로컬 이미지 요청에 HTTP 503을 반환합니다. 받은 이미지는 그대로 남을 수 있습니다.",
    scope: "실험 이미지 파일",
  },
  {
    key: "style-error",
    label: "스타일 파일 전달 실패",
    mechanism:
      "포털 전용 CSS 요청을 거절합니다. 새로 불러올 때 브라우저 기본 표현을 관찰합니다.",
    scope: "포털 CSS · 실험 패널 제외",
  },
  {
    key: "cpu-work",
    label: "CPU 연산 경합",
    mechanism:
      "서버 이벤트 루프에서 해시 연산을 반복합니다. CPU와 요청 지연을 함께 측정합니다.",
    scope: "서버 프로세스 · 최대 60초",
  },
  {
    key: "memory-work",
    label: "메모리 점유 증가",
    mechanism:
      "실제 버퍼 64 MiB를 할당하고 유지합니다. 해제 뒤 RSS 반환은 런타임에 달려 있습니다.",
    scope: "64 MiB 상한 · 최대 60초",
  },
] as const;

export type FaultKey = (typeof catalog)[number]["key"];
const enabled = new Map<FaultKey, number>();
const timers = new Map<FaultKey, NodeJS.Timeout>();
const waiting = new Set<() => void>();
let memory: Buffer[] = [];
let cpuTimer: NodeJS.Timeout | undefined;
let configuredDelayMs: number | null = null;

export function faultState() {
  return catalog.map((item) => ({
    ...item,
    enabled: enabled.has(item.key),
    expiresAt: enabled.get(item.key) ?? null,
    delayMs: item.key === "api-hold" ? configuredDelayMs : null,
  }));
}

export function hasFault(key: FaultKey) {
  return enabled.has(key);
}

function cpuWork() {
  if (!hasFault("cpu-work")) return;
  // Bounded real work, with a yield for the independent control routes.
  for (let batch = 0; batch < 4; batch++) {
    pbkdf2Sync("local-experiment", "resilience", 12000, 32, "sha256");
  }
  cpuTimer = setTimeout(cpuWork, 10);
}

export function setFault(
  key: FaultKey,
  active: boolean,
  reason = "사용자 변경",
  delayMs: number | null = null,
) {
  if (!catalog.some((item) => item.key === key))
    throw new Error("알 수 없는 장애 유형입니다.");
  if (active === enabled.has(key)) return;
  if (active) {
    if (key === "api-hold") configuredDelayMs = delayMs;
    enabled.set(key, Date.now() + 60000);
    timers.set(
      key,
      setTimeout(
        () => setFault(key, false, "60초 안전 제한으로 자동 해제"),
        60000,
      ),
    );
    if (key === "cpu-work") cpuWork();
    if (key === "memory-work")
      memory = Array.from({ length: 16 }, () =>
        Buffer.alloc(4 * 1024 * 1024, 0x61),
      );
  } else {
    enabled.delete(key);
    clearTimeout(timers.get(key));
    timers.delete(key);
    if (key === "api-hold") for (const release of [...waiting]) release();
    if (key === "cpu-work") clearTimeout(cpuTimer);
    if (key === "memory-work") memory = [];
  }
  const setting =
    key === "api-hold" && active
      ? ` (설정: ${configuredDelayMs === null ? "해제까지 대기" : `${configuredDelayMs} ms`})`
      : "";
  transition(
    [...enabled.keys()],
    `${reason}: ${key} ${active ? "ON" : "OFF"}${setting}`,
  );
}

export function releaseAll() {
  for (const key of [...enabled.keys()]) setFault(key, false, "전체 해제");
}

export const injectFault: RequestHandler = async (request, response, next) => {
  const isAsset = request.path.startsWith("/api/assets/");
  if (hasFault("api-hold") && !isAsset) {
    await new Promise<void>((resolve) => {
      let timer: NodeJS.Timeout | undefined;
      const release = () => {
        clearTimeout(timer);
        waiting.delete(release);
        response.off("close", release);
        resolve();
      };
      waiting.add(release);
      response.once("close", release);
      if (configuredDelayMs !== null)
        timer = setTimeout(release, configuredDelayMs);
    });
  }
  if (response.destroyed) return;
  if (hasFault("connection-cut")) {
    request.socket.destroy();
    return;
  }
  if (hasFault("api-error") && !isAsset) {
    response.status(503).json({
      message: "로컬 API가 503을 반환했습니다.",
      injected: "api-error",
    });
    return;
  }
  if (hasFault("invalid-json") && !isAsset) {
    response.type("json").send('{"items":[');
    return;
  }
  next();
};

export function allocatedMiB() {
  return memory.reduce((sum, block) => sum + block.length, 0) / 1024 / 1024;
}
