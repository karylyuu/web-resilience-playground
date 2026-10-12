import express from "express";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  allocatedMiB,
  catalog,
  faultState,
  hasFault,
  injectFault,
  releaseAll,
  setFault,
} from "./faults";
import type { FaultKey } from "./faults";
import { addBrowserEvent, newRun, observeRequest, snapshot } from "./telemetry";
import { market, news } from "./providers";
import { exportWorkbook } from "./workbook";

const app = express();
const port = Number(process.env.PORT ?? 3000);
const dataDirectory = process.env.DATA_DIR ?? path.join(__dirname, "data");
const communityFile = path.join(dataDirectory, "community.json");
const sessions = new Map<string, number>();
type Post = {
  id: string;
  author: string;
  text: string;
  at: string;
  likes: string[];
  comments: { author: string; text: string; at: string }[];
};
let posts: Post[] = [];
let persistence: Promise<void> = Promise.resolve();

app.disable("x-powered-by");
app.use((request, response, next) => {
  // The lab is loopback-only. Cross-origin scripts must not operate fault controls.
  const origin = request.headers.origin;
  if (origin) {
    let hostname = "";
    try {
      hostname = new URL(origin).hostname;
    } catch {
      /* Invalid origins are rejected below. */
    }
    if (hostname !== "localhost" && hostname !== "127.0.0.1") {
      response
        .status(403)
        .json({ message: "로컬 실험 페이지에서만 접근할 수 있습니다." });
      return;
    }
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    response.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Client-Request-Id",
    );
    response.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, DELETE, OPTIONS",
    );
    response.setHeader(
      "Access-Control-Expose-Headers",
      "X-Request-Id, X-Experiment-Run, X-Experiment-Segment, X-Experiment-Phase",
    );
  }
  response.setHeader("Cache-Control", "no-store");
  if (request.method === "OPTIONS") {
    response.sendStatus(204);
    return;
  }
  next();
});
app.use(express.json({ limit: "64kb" }));

// Control and observation paths are deliberately not passed through fault injection.
app.get("/api/lab", (_request, response) =>
  response.json({
    ...snapshot(false, true),
    catalog: faultState(),
    allocatedMiB: allocatedMiB(),
  }),
);
app.post("/api/lab/browser", (request, response) => {
  addBrowserEvent(request.body ?? {});
  response.sendStatus(204);
});
app.post("/api/lab/faults/:key", (request, response) => {
  const key = request.params.key as FaultKey;
  if (
    !catalog.some((item) => item.key === key) ||
    typeof request.body?.enabled !== "boolean"
  ) {
    response
      .status(400)
      .json({ message: "유효한 장애 유형과 enabled 값이 필요합니다." });
    return;
  }
  const delayMs = request.body.delayMs ?? null;
  if (
    key === "api-hold" &&
    delayMs !== null &&
    (typeof delayMs !== "number" ||
      !Number.isFinite(delayMs) ||
      delayMs < 1 ||
      delayMs > 10000)
  ) {
    response.status(400).json({
      message:
        "API 지연은 1~10,000 ms 또는 빈 값(해제까지 대기)으로 설정하세요. 범위는 안전 제한입니다.",
    });
    return;
  }
  setFault(key, request.body.enabled, "사용자 변경", delayMs);
  response.json({ catalog: faultState() });
});
app.post("/api/lab/release", (_request, response) => {
  releaseAll();
  response.json({ catalog: faultState() });
});
app.post("/api/lab/runs", (_request, response) => {
  if (faultState().some((fault) => fault.enabled)) {
    response.status(409).json({ message: "진행 중인 장애를 먼저 해제하세요." });
    return;
  }
  if (snapshot().inFlight) {
    response
      .status(409)
      .json({ message: "진행 중 요청이 끝난 뒤 새 관찰을 시작하세요." });
    return;
  }
  response.json({ runId: newRun() });
});
app.get("/api/lab/export", async (request, response) => {
  const data = snapshot(request.query.scope === "session");
  const buffer = await exportWorkbook(data);
  response.setHeader(
    "Content-Disposition",
    `attachment; filename="resilience-${Date.now()}.xlsx"`,
  );
  response
    .type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    .send(buffer);
});

app.use(observeRequest, injectFault);

app.get("/api/pulse", (_request, response) =>
  response.json({
    serverAt: new Date().toISOString(),
    uptimeSeconds: process.uptime(),
  }),
);
app.get(["/api/feed", "/api/search"], async (request, response) => {
  response.json(
    await news(
      String(request.query.q ?? "")
        .trim()
        .slice(0, 200),
    ),
  );
});
app.get("/api/market", async (_request, response) => {
  const data = await market();
  if (!data.coins && !data.fx) {
    response.status(502).json({ message: data.errors.join(" / ") });
    return;
  }
  response.json(data);
});

app.get("/api/assets/portal.css", (_request, response) => {
  if (hasFault("style-error")) {
    response.status(503).type("text/plain").send("Stylesheet delivery failed");
    return;
  }
  response.type("css").sendFile(path.join(__dirname, "public", "portal.css"));
});
app.get("/api/assets/cover.svg", (_request, response) => {
  if (hasFault("image-error")) {
    response.status(503).send("Image delivery failed");
    return;
  }
  response.type("svg").sendFile(path.join(__dirname, "public", "cover.svg"));
});

app.post("/api/auth/login", (request, response) => {
  if (
    request.body?.email !== "demo@resilience.local" ||
    request.body?.password !== "resilience"
  ) {
    response
      .status(401)
      .json({ message: "이메일 또는 비밀번호가 일치하지 않습니다." });
    return;
  }
  for (const [token, expires] of sessions)
    if (expires < Date.now()) sessions.delete(token);
  const session = randomUUID();
  sessions.set(session, Date.now() + 3600000);
  response.json({ name: "karylyuu", session });
});
app.post("/api/auth/logout", (request, response) => {
  sessions.delete(
    (request.headers.authorization ?? "").replace(/^Bearer /, ""),
  );
  response.sendStatus(204);
});

function authorize(
  request: express.Request,
  response: express.Response,
  next: express.NextFunction,
) {
  const token = (request.headers.authorization ?? "").replace(/^Bearer /, "");
  if ((sessions.get(token) ?? 0) < Date.now()) {
    response
      .status(401)
      .json({ message: "로그인 세션이 필요합니다. 다시 로그인하세요." });
    return;
  }
  next();
}

function persist() {
  const content = JSON.stringify(posts, null, 2);
  const next = persistence
    .catch(() => {})
    .then(async () => {
      await mkdir(dataDirectory, { recursive: true });
      await writeFile(`${communityFile}.tmp`, content, "utf8");
      await rename(`${communityFile}.tmp`, communityFile);
    });
  persistence = next;
  return next;
}

app.get("/api/community", (_request, response) =>
  response.json({
    posts: posts.map((post) => ({ ...post, likes: post.likes.length })),
  }),
);
app.post("/api/community", authorize, async (request, response) => {
  const text = String(request.body?.text ?? "").trim();
  if (!text || text.length > 1000) {
    response.status(400).json({ message: "글은 1~1000자로 입력하세요." });
    return;
  }
  if (posts.length >= 1000) {
    response
      .status(409)
      .json({ message: "로컬 보관 한도 1,000개에 도달했습니다." });
    return;
  }
  const post: Post = {
    id: randomUUID(),
    author: "karylyuu",
    text,
    at: new Date().toISOString(),
    likes: [],
    comments: [],
  };
  posts.unshift(post);
  try {
    await persist();
  } catch (error) {
    posts = posts.filter((item) => item.id !== post.id);
    throw error;
  }
  response.status(201).json({ ...post, likes: 0 });
});
app.post("/api/community/:id/:action", authorize, async (request, response) => {
  const post = posts.find((item) => item.id === request.params.id);
  if (!post) {
    response.sendStatus(404);
    return;
  }
  if (request.params.action === "like") {
    post.likes = post.likes.includes("karylyuu") ? [] : ["karylyuu"];
  } else if (request.params.action === "comment") {
    const text = String(request.body?.text ?? "").trim();
    if (!text || text.length > 500 || post.comments.length >= 200) {
      response
        .status(400)
        .json({ message: "댓글은 1~500자, 글당 최대 200개입니다." });
      return;
    }
    post.comments.push({
      text,
      author: "karylyuu",
      at: new Date().toISOString(),
    });
  } else {
    response.sendStatus(404);
    return;
  }
  await persist();
  response.json({ ...post, likes: post.likes.length });
});

app.use((_request, response) =>
  response.status(404).json({ message: "경로를 찾을 수 없습니다." }),
);
app.use(
  (
    error: Error,
    _request: express.Request,
    response: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error(error.message);
    if (!response.headersSent)
      response.status(502).json({ message: error.message });
  },
);

async function start() {
  try {
    posts = JSON.parse(await readFile(communityFile, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const server = app.listen(port, "127.0.0.1", () =>
    console.log(`RESILIENCE API http://127.0.0.1:${port}`),
  );
  server.on("error", (error) => {
    console.error(error);
    process.exitCode = 1;
  });
  const shutdown = () => {
    releaseAll();
    server.close(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

start().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
