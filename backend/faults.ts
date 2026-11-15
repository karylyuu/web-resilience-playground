import { pbkdf2Sync } from "node:crypto";
import type { RequestHandler } from "express";
import { transition } from "./telemetry";

export const catalog = [
  {
    key: "api-hold",
    label: "API 응답 지연",
    mechanism:
      "서버가 입력한 시간만큼 기다렸다가 응답해요. 시간을 비우면 장애를 끌 때까지 응답하지 않아요.",
    scope: "뉴스·시세·카페 등 데이터 요청",
  },
  {
    key: "api-error",
    label: "API 오류 응답",
    mechanism: "서버가 데이터 대신 '503 일시적 오류'를 돌려줘요.",
    scope: "뉴스·시세·카페 등 데이터 요청",
  },
  {
    key: "connection-cut",
    label: "연결 끊김",
    mechanism: "서버가 응답하기 전에 연결을 끊어 버려요.",
    scope: "이 서비스의 모든 새 요청",
  },
  {
    key: "invalid-json",
    label: "깨진 데이터",
    mechanism:
      "응답은 '성공(200)'인데 내용이 중간에 잘려 있어요. 화면이 데이터를 읽지 못해요.",
    scope: "뉴스·시세·카페 등 데이터 요청",
  },
  {
    key: "image-error",
    label: "이미지 전달 실패",
    mechanism: "홈 화면의 그림 파일을 보내지 않아요.",
    scope: "홈 화면 그림",
  },
  {
    key: "style-error",
    label: "스타일(CSS) 전달 실패",
    mechanism:
      "화면 디자인 파일(CSS)을 보내지 않아요. 글자와 배치가 기본 모양으로 바뀌어요.",
    scope: "서비스 화면 디자인 · 실험 패널은 제외",
  },
  {
    key: "cpu-work",
    label: "서버 CPU 과부하",
    mechanism:
      "서버가 무거운 계산을 계속 돌려서 다른 요청을 처리할 여유가 줄어들어요.",
    scope: "실험 서버 프로그램",
  },
  {
    key: "memory-work",
    label: "서버 메모리 점유",
    mechanism: "서버가 메모리 64 MiB를 붙잡고 놓지 않아요.",
    scope: "최대 64 MiB",
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
  reason = "직접 변경",
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
        () => setFault(key, false, "60초가 지나 자동으로 꺼짐"),
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
      ? ` (설정: ${configuredDelayMs === null ? "끌 때까지 멈춤" : `${configuredDelayMs} ms`})`
      : "";
  transition(
    [...enabled.keys()],
    `${reason}: ${key} ${active ? "ON" : "OFF"}${setting}`,
  );
}

export function releaseAll() {
  for (const key of [...enabled.keys()]) setFault(key, false, "모두 끄기");
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
      message: "서버가 일시적으로 응답할 수 없어요. (503)",
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
