import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import ExcelJS from "exceljs";
import { XMLValidator } from "fast-xml-parser";
import { DEFAULT_VIDEO_ID, parseVideoId } from "../../frontend/src/video";

const port = 3197;
const root = `http://127.0.0.1:${port}`;
let server: ReturnType<typeof spawn>;
let directory: string;

test("YouTube 주소를 임베드 ID로 해석하고 잘못된 출처는 거부한다", () => {
  assert.equal(DEFAULT_VIDEO_ID, "ieGKMldpp-M");
  for (const value of [
    "ieGKMldpp-M",
    "https://www.youtube.com/watch?v=ieGKMldpp-M",
    "https://youtu.be/ieGKMldpp-M?si=example",
    "https://www.youtube.com/shorts/ieGKMldpp-M",
    "https://www.youtube-nocookie.com/embed/ieGKMldpp-M",
  ]) {
    assert.equal(parseVideoId(value), DEFAULT_VIDEO_ID);
  }
  for (const value of [
    "",
    "https://unrelated.example/watch?v=ieGKMldpp-M",
    "https://youtube.com.evil.example/watch?v=ieGKMldpp-M",
    "javascript:alert(1)",
    "https://www.youtube.com/playlist?list=abc",
  ]) {
    assert.equal(parseVideoId(value), null);
  }
});
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const get = async (route: string) => (await fetch(`${root}${route}`)).json();
const post = (route: string, body = {}, session?: string) =>
  fetch(`${root}${route}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(session ? { Authorization: `Bearer ${session}` } : {}),
    },
    body: JSON.stringify(body),
  });
const fault = async (key: string, enabled: boolean) => {
  const response = await post(`/api/lab/faults/${key}`, { enabled });
  assert.equal(response.status, 200);
};

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "resilience-test-"));
  server = spawn(process.execPath, ["--import", "tsx", "server.ts"], {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, PORT: String(port), DATA_DIR: directory },
    stdio: "pipe",
    windowsHide: true,
  });
  let logs = "";
  server.stderr?.on("data", (chunk) => {
    logs += chunk;
  });
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const data = await get("/api/lab");
      if (data.catalog?.length === 8) {
        ready = true;
        break;
      }
    } catch {
      /* Wait for owned test process. */
    }
    await pause(100);
  }
  assert.ok(ready, `Test API did not start: ${logs}`);
});

after(async () => {
  if (server && server.exitCode === null) {
    const exited = new Promise((resolve) => server.once("exit", resolve));
    server.kill();
    await exited;
  }
  if (
    directory &&
    path.dirname(directory) === path.resolve(tmpdir()) &&
    path.basename(directory).startsWith("resilience-test-")
  )
    await rm(directory, { recursive: true, force: true });
});

test("실제 요청 ID, 응답시간과 주입 전 표본을 기록한다", async () => {
  const response = await fetch(`${root}/api/pulse`);
  assert.equal(response.status, 200);
  const id = response.headers.get("x-request-id");
  await response.json();
  const lab = await get("/api/lab");
  const item = lab.requests.find((request: any) => request.id === id);
  assert.equal(item.phase, "baseline");
  assert.ok(item.durationMs >= 0);
  assert.equal(item.route, "/api/pulse");
  assert.equal(lab.comparisons[0].baseline.count, 1);
});

test("대기 게이트는 해제 전 완료되지 않고, 전환 교차 요청으로 기록된다", async () => {
  await fault("api-hold", true);
  let finished = false;
  const pending = fetch(`${root}/api/pulse`).then(async (response) => {
    finished = true;
    return response.json();
  });
  await pause(150);
  assert.equal(finished, false);
  assert.equal((await get("/api/lab")).inFlight, 1);
  assert.equal((await post("/api/lab/runs")).status, 409);
  await fault("api-hold", false);
  await pending;
  const lab = await get("/api/lab");
  assert.equal(lab.requests.at(-1).phase, "mixed");
  assert.equal(lab.inFlight, 0);
});

test("HTTP 오류와 200 응답 데이터 손상을 구분하고 제어 채널은 살아 있다", async () => {
  await fault("api-error", true);
  assert.equal((await fetch(`${root}/api/pulse`)).status, 503);
  assert.equal(
    (await get("/api/lab")).catalog.find(
      (item: any) => item.key === "api-error",
    ).enabled,
    true,
  );
  await fault("api-error", false);
  await fault("invalid-json", true);
  const malformed = await fetch(`${root}/api/pulse`);
  assert.equal(malformed.status, 200);
  await assert.rejects(() => malformed.json());
  await fault("invalid-json", false);
  assert.equal((await fetch(`${root}/api/pulse`)).status, 200);
});

test("사용자 지정 지연은 측정값을 만들지 않고 실제 요청을 늦춘다", async () => {
  await post("/api/lab/faults/api-hold", { enabled: true, delayMs: 120 });
  const response = await fetch(`${root}/api/pulse`);
  assert.equal(response.status, 200);
  const id = response.headers.get("x-request-id");
  await response.json();
  const sample = (await get("/api/lab")).requests.find(
    (item: any) => item.id === id,
  );
  assert.equal(sample.phase, "active");
  assert.ok(
    sample.durationMs >= 100,
    "The timer must actually defer processing; this is a mechanism assertion, not a health threshold.",
  );
  await fault("api-hold", false);
  assert.equal(
    (await post("/api/lab/faults/api-hold", { enabled: true, delayMs: -1 }))
      .status,
    400,
  );
});

test("이미지와 CSS 전달 장애는 독립적이며 해제 후 실제 파일이 전달된다", async () => {
  await fault("image-error", true);
  assert.equal((await fetch(`${root}/api/assets/cover.svg`)).status, 503);
  assert.equal((await fetch(`${root}/api/assets/portal.css`)).status, 200);
  await fault("image-error", false);
  assert.match(
    await (await fetch(`${root}/api/assets/cover.svg`)).text(),
    /<svg/,
  );
  await fault("style-error", true);
  assert.equal((await fetch(`${root}/api/assets/portal.css`)).status, 503);
  assert.equal((await fetch(`${root}/api/pulse`)).status, 200);
  await fault("style-error", false);
  assert.match(
    await (await fetch(`${root}/api/assets/portal.css`)).text(),
    /portal-skin/,
  );
});

test("연결 중단 요청은 완료 HTTP 코드가 아니라 disconnected로 기록된다", async () => {
  await fault("connection-cut", true);
  await assert.rejects(() => fetch(`${root}/api/pulse`));
  await fault("connection-cut", false);
  const sample = (await get("/api/lab")).requests.findLast(
    (item: any) => item.outcome === "disconnected",
  );
  assert.equal(sample.status, null);
  assert.equal((await get("/api/lab")).inFlight, 0);
});

test("실제 제한된 CPU/메모리 점유와 자원 표본을 수집한다", async () => {
  await fault("memory-work", true);
  await fault("cpu-work", true);
  await pause(1500);
  const lab = await get("/api/lab");
  assert.equal(lab.allocatedMiB, 64);
  assert.ok(lab.resources.length > 0);
  assert.ok(
    lab.resources.some(
      (sample: any) => sample.cpuPercent > 0 && sample.rssMiB > 0,
    ),
  );
  await post("/api/lab/release");
  assert.equal((await get("/api/lab")).allocatedMiB, 0);
});

test("인증, 글, 댓글, 공감은 서버 검증과 파일 저장을 거친다", async () => {
  assert.equal(
    (await post("/api/community", { text: "unauthorized" })).status,
    401,
  );
  assert.equal(
    (await post("/api/auth/login", { email: "wrong", password: "wrong" }))
      .status,
    401,
  );
  const profile = await (
    await post("/api/auth/login", {
      email: "demo@resilience.local",
      password: "resilience",
    })
  ).json();
  assert.equal(profile.name, "karylyuu");
  const created = await (
    await post("/api/community", { text: "실제 저장 테스트" }, profile.session)
  ).json();
  await post(
    `/api/community/${created.id}/comment`,
    { text: "실제 댓글" },
    profile.session,
  );
  await post(`/api/community/${created.id}/like`, {}, profile.session);
  const feed = await get("/api/community");
  assert.equal(feed.posts[0].likes, 1);
  assert.equal(feed.posts[0].comments[0].text, "실제 댓글");
  const saved = JSON.parse(
    await readFile(path.join(directory, "community.json"), "utf8"),
  );
  assert.equal(saved[0].text, "실제 저장 테스트");
});

test("새 관찰이 기존 기록을 덮지 않고 Excel에 원본과 네이티브 차트를 저장한다", async () => {
  const previous = await get("/api/lab");
  const next = await (await post("/api/lab/runs")).json();
  assert.notEqual(previous.runId, next.runId);
  assert.equal((await get("/api/lab")).requests.length, 0);
  await fetch(`${root}/api/pulse`);
  const response = await fetch(`${root}/api/lab/export?scope=session`);
  assert.equal(response.status, 200);
  const buffer = Buffer.from(await response.arrayBuffer());
  const zip = await JSZip.loadAsync(buffer);
  assert.ok(zip.file("xl/charts/chart1.xml"));
  for (const entry of [
    "xl/charts/chart1.xml",
    "xl/charts/chart2.xml",
    "xl/charts/chart3.xml",
    "xl/drawings/drawing1.xml",
    "xl/worksheets/sheet2.xml",
  ]) {
    assert.equal(
      XMLValidator.validate(await zip.file(entry)!.async("string")),
      true,
      entry,
    );
  }
  assert.match(
    await zip.file("xl/charts/chart1.xml")!.async("string"),
    /numCache/,
  );
  assert.match(
    await zip.file("xl/charts/chart3.xml")!.async("string"),
    /scatterChart/,
  );
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);
  assert.equal(workbook.worksheets.length, 8);
  assert.ok(
    workbook.getWorksheet("요청 원본")!.rowCount > previous.requests.length,
  );
  assert.equal(
    workbook.getWorksheet("요청 원본")!.getCell("G2").type,
    ExcelJS.ValueType.Number,
  );
  const compare = workbook.getWorksheet("경로별 비교")!;
  const runIds = new Set(compare.getColumn(8).values.slice(2));
  assert.ok(runIds.has(previous.runId) && runIds.has(next.runId));
});

test("외부 웹사이트의 제어 요청과 잘못된 장애 키를 거부한다", async () => {
  const response = await fetch(`${root}/api/lab/release`, {
    method: "POST",
    headers: { Origin: "https://unrelated.example" },
  });
  assert.equal(response.status, 403);
  assert.equal(
    (await post("/api/lab/faults/unknown", { enabled: true })).status,
    400,
  );
});
