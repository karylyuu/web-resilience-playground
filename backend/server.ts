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
import {
  addBrowserEvent,
  newRun,
  observeRequest,
  onContextChange,
  snapshot,
} from "./telemetry";
import { market, news } from "./providers";
import { exportWorkbook } from "./workbook";

const app = express();
const port = Number(process.env.PORT ?? 3000);
// 127.0.0.1 keeps the lab on this PC. Set HOST=0.0.0.0 to open it to other
// devices on the same network (Docker does this inside the container).
const host = process.env.HOST ?? "127.0.0.1";
// Built web app served by this same server, so one command runs everything.
const webDirectory =
  process.env.WEB_DIR ?? path.join(__dirname, "..", "frontend", "dist");
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
  // Only the lab's own page (same host) or a local dev server may call the API.
  // Other websites open in the same browser must not operate fault controls.
  const origin = request.headers.origin;
  if (origin) {
    let parsed: URL | undefined;
    try {
      parsed = new URL(origin);
    } catch {
      /* Invalid origins are rejected below. */
    }
    const sameHost = parsed?.host === request.headers.host;
    const loopback =
      parsed?.hostname === "localhost" || parsed?.hostname === "127.0.0.1";
    if (!sameHost && !loopback) {
      response
        .status(403)
        .json({ message: "실험 페이지에서만 사용할 수 있어요." });
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
const labState = () => ({
  ...snapshot(false, true),
  catalog: faultState(),
  allocatedMiB: allocatedMiB(),
});
app.get("/api/lab", (_request, response) => response.json(labState()));

// Live stream: the same state as /api/lab, pushed immediately when a fault
// changes and once per second otherwise. Browsers no longer need to refresh.
const streams = new Set<express.Response>();
let pendingChange: NodeJS.Immediate | undefined;
function broadcast(cause: "change" | "tick") {
  if (!streams.size) return;
  const message = `event: lab\ndata: ${JSON.stringify({ ...labState(), cause })}\n\n`;
  for (const stream of streams) stream.write(message);
}
onContextChange(() => {
  // "Release all" flips several faults in one call; send one combined update.
  if (pendingChange) return;
  pendingChange = setImmediate(() => {
    pendingChange = undefined;
    broadcast("change");
  });
});
const streamTimer = setInterval(() => broadcast("tick"), 1000);
streamTimer.unref();
app.get("/api/lab/stream", (request, response) => {
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  response.write(
    `retry: 2000\nevent: lab\ndata: ${JSON.stringify({ ...labState(), cause: "change" })}\n\n`,
  );
  streams.add(response);
  request.on("close", () => streams.delete(response));
});
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
      .json({ message: "알 수 없는 장애이거나 켜기/끄기 값이 없어요." });
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
        "지연 시간은 1~10,000 ms로 넣거나, 비워 두세요(끌 때까지 멈춤).",
    });
    return;
  }
  setFault(key, request.body.enabled, "직접 변경", delayMs);
  response.json({ catalog: faultState() });
});
app.post("/api/lab/release", (_request, response) => {
  releaseAll();
  response.json({ catalog: faultState() });
});
app.post("/api/lab/runs", (_request, response) => {
  if (faultState().some((fault) => fault.enabled)) {
    response.status(409).json({ message: "켜져 있는 장애를 먼저 꺼 주세요." });
    return;
  }
  if (snapshot().inFlight) {
    response
      .status(409)
      .json({ message: "응답을 기다리는 요청이 끝난 뒤에 시작해 주세요." });
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

// The lab's own web files are served here, before fault injection, so turning
// on a fault never breaks the lab page itself. Only /api paths are experiments.
const serveWeb = express.static(webDirectory);
app.use((request, response, next) => {
  if (request.path.startsWith("/api/")) {
    next();
    return;
  }
  serveWeb(request, response, () =>
    response
      .status(404)
      .type("text/plain; charset=utf-8")
      .send(
        "화면 파일이 없어요. 프로젝트 폴더에서 `npm run build`를 먼저 실행하세요. (개발 중이라면 frontend에서 `npm run dev`)",
      ),
  );
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
      .json({ message: "이메일 또는 비밀번호가 맞지 않아요." });
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
      .json({ message: "로그인이 필요해요. 다시 로그인해 주세요." });
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
    response.status(400).json({ message: "글은 1~1,000자로 써 주세요." });
    return;
  }
  if (posts.length >= 1000) {
    response
      .status(409)
      .json({ message: "글은 최대 1,000개까지 저장할 수 있어요." });
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
        .json({ message: "댓글은 1~500자, 글 하나에 200개까지 달 수 있어요." });
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
  response.status(404).json({ message: "없는 주소예요." }),
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
  const server = app.listen(port, host, () =>
    console.log(
      `re:silience → http://${host === "0.0.0.0" ? "localhost" : host}:${port}`,
    ),
  );
  server.on("error", (error) => {
    console.error(error);
    process.exitCode = 1;
  });
  const shutdown = () => {
    releaseAll();
    for (const stream of streams) stream.end();
    server.close(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

start().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
