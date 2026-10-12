import ExcelJS from "exceljs";
import JSZip from "jszip";
import { snapshot } from "./telemetry";

type Snapshot = ReturnType<typeof snapshot>;
const phaseNames = {
  baseline: "주입 전",
  active: "주입 중",
  recovery: "해제 후",
  mixed: "전환 교차",
};
const xml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[character]!,
  );

function addSheet(
  book: ExcelJS.Workbook,
  name: string,
  headers: string[],
  rows: ExcelJS.CellValue[][],
) {
  const sheet = book.addWorksheet(name);
  sheet.addRow(headers);
  sheet.addRows(rows);
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = {
    from: "A1",
    to: { row: Math.max(1, rows.length + 1), column: headers.length },
  };
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF203A35" },
  };
  sheet.getRow(1).height = 28;
  sheet.columns.forEach((column, index) => {
    column.width = index === 0 ? 25 : 23;
  });
  sheet.eachRow((row, number) => {
    if (number > 1) row.height = 23;
    row.eachCell((cell) => {
      if (cell.value instanceof Date) cell.numFmt = "yyyy-mm-dd hh:mm:ss.000";
      if (typeof cell.value === "number") cell.numFmt = "0.00";
    });
  });
  return sheet;
}

// ExcelJS owns cells/styles; this small OOXML layer adds editable native XY charts.
// Chart ranges reference the exported samples. No picture or synthesized history is used.
async function addNativeCharts(buffer: ExcelJS.Buffer, data: Snapshot) {
  const zip = await JSZip.loadAsync(buffer as unknown as Uint8Array);
  const definitions = [
    {
      title: "완료 시각별 서버 응답시간",
      sheet: "요청 원본",
      x: "B",
      y: "G",
      count: data.requests.length,
      xTitle: "요청 완료 시각 (UTC)",
      yTitle: "응답시간 (ms)",
      time: true,
      lines: true,
    },
    {
      title: "시간별 서버 CPU 사용량",
      sheet: "자원 원본",
      x: "A",
      y: "E",
      count: data.resources.length,
      xTitle: "측정 시각 (UTC)",
      yTitle: "CPU % (100 = 1코어)",
      time: true,
      lines: true,
    },
    {
      title: "동시 요청 수와 응답시간",
      sheet: "요청 원본",
      x: "I",
      y: "G",
      count: data.requests.length,
      xTitle: "요청 시작 시 동시 요청 수",
      yTitle: "응답시간 (ms)",
      time: false,
      lines: false,
    },
  ];
  let overrides = "";
  let drawing =
    '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">';
  let relationships =
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
  definitions.forEach((chart, index) => {
    const number = index + 1;
    const range = (column: string) =>
      xml(
        `'${chart.sheet}'!$${column}$2:$${column}$${Math.max(2, chart.count + 1)}`,
      );
    const richTitle = (title: string) =>
      `<c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${xml(title)}</a:t></a:r></a:p></c:rich></c:tx>`;
    const serialDate = (value: string) => Date.parse(value) / 86400000 + 25569;
    const xValues =
      index === 1
        ? data.resources.map((item) => serialDate(item.at))
        : data.requests.map((item) =>
            index === 0 ? serialDate(item.endedAt) : item.concurrent,
          );
    const yValues =
      index === 1
        ? data.resources.map((item) => item.cpuPercent)
        : data.requests.map((item) => item.durationMs);
    const numericReference = (column: string, values: number[]) => `<c:numRef>
      <c:f>${range(column)}</c:f>
      <c:numCache>
        <c:formatCode>General</c:formatCode>
        <c:ptCount val="${values.length}"/>
        ${values.map((value, point) => `<c:pt idx="${point}"><c:v>${value}</c:v></c:pt>`).join("\n")}
      </c:numCache>
    </c:numRef>`;
    const axis = (
      id: number,
      cross: number,
      position: string,
      title: string,
      date = false,
    ) =>
      `<c:valAx><c:axId val="${id}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="${position}"/><c:title>${richTitle(title)}</c:title><c:numFmt formatCode="${date ? "hh:mm:ss" : "0.0"}" sourceLinked="0"/><c:crossAx val="${cross}"/><c:crosses val="autoZero"/></c:valAx>`;
    zip.file(
      `xl/charts/chart${number}.xml`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:title>${richTitle(chart.title)}</c:title>
          <c:plotArea>
            <c:layout/>
            <c:scatterChart>
              <c:scatterStyle val="${chart.lines ? "lineMarker" : "marker"}"/>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:v>실측 표본</c:v></c:tx>
                <c:marker><c:symbol val="circle"/><c:size val="4"/></c:marker>
                <c:xVal>${numericReference(chart.x, xValues)}</c:xVal>
                <c:yVal>${numericReference(chart.y, yValues)}</c:yVal>
              </c:ser>
              <c:axId val="10"/><c:axId val="20"/>
            </c:scatterChart>
            ${axis(10, 20, "b", chart.xTitle, chart.time)}
            ${axis(20, 10, "l", chart.yTitle)}
          </c:plotArea>
          <c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/>
        </c:chart>
      </c:chartSpace>`,
    );
    const top = 3 + index * 19;
    drawing += `<xdr:twoCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${top}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>11</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${top + 18}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${number}" name="Chart ${number}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId${number}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`;
    relationships += `<Relationship Id="rId${number}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${number}.xml"/>`;
    overrides += `<Override PartName="/xl/charts/chart${number}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`;
  });
  zip.file("xl/drawings/drawing1.xml", `${drawing}</xdr:wsDr>`);
  zip.file(
    "xl/drawings/_rels/drawing1.xml.rels",
    `${relationships}</Relationships>`,
  );
  zip.file(
    "xl/worksheets/_rels/sheet2.xml.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdCharts" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>',
  );
  const worksheet = await zip.file("xl/worksheets/sheet2.xml")!.async("string");
  zip.file(
    "xl/worksheets/sheet2.xml",
    worksheet.replace(
      "</worksheet>",
      '<drawing r:id="rIdCharts"/></worksheet>',
    ),
  );
  const types = await zip.file("[Content_Types].xml")!.async("string");
  zip.file(
    "[Content_Types].xml",
    types.replace(
      "</Types>",
      `${overrides}<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`,
    ),
  );
  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}

export async function exportWorkbook(data: Snapshot) {
  const book = new ExcelJS.Workbook();
  book.creator = "RESILIENCE local lab";
  book.created = new Date(data.capturedAt);
  const summary = addSheet(
    book,
    "읽는 방법",
    ["항목", "내용"],
    [
      ["내보낸 시각 (UTC)", new Date(data.capturedAt)],
      ["현재 관찰 ID", data.runId],
      ["자료", "이 서버 세션에서 실제 수집한 요청, 자원, 브라우저 이벤트"],
      [
        "단계",
        "주입 전 / 주입 중 / 해제 후. 전환을 가로지른 요청은 전환 교차로 분리.",
      ],
      [
        "비교",
        "동일 경로·메서드별 평균. 표본 없는 단계는 빈칸. HTTP 오류와 브라우저 해석 오류는 별도.",
      ],
      [
        "해석",
        "동시 변화는 인과 증명이 아님. 외부 공급자·캐시·요청 종류·표본 수를 함께 확인.",
      ],
      [
        "CPU",
        "서버 프로세스 CPU 시간 / 실제 경과시간. 100% = 논리 코어 1개. 시스템 전체 CPU 아님.",
      ],
      [
        "메모리",
        "RSS는 실제 프로세스 상주 메모리. 버퍼 해제 후 즉시 감소하지 않을 수 있음.",
      ],
      [
        "브라우저",
        "API 완료/실패 및 이미지·CSS 수신 이벤트. YouTube 내부 재생 상태는 측정 불가.",
      ],
      [
        "안전 제한",
        "장애 최대 60초, 버퍼 최대 64 MiB. 고갈/OOM·실제 패킷 손실은 재현하지 않음.",
      ],
      [
        "표본 보관",
        `유형별 ${data.retentionLimit}개 메모리 보관. 세션 누락 표본 ${data.dropped}개. 서버 재시작 전 저장 필요.`,
      ],
      [
        "복원",
        "해제 후 성공한 요청과 소요시간은 증거로 제공. 복원 완료 자동 판정은 하지 않음.",
      ],
    ],
  );
  summary.getColumn(2).width = 105;
  summary.getColumn(2).alignment = { wrapText: true, vertical: "middle" };
  summary.eachRow((row) => {
    row.height = 36;
  });
  const charts = book.addWorksheet("관측 차트");
  charts.getCell("A1").value = "실측 요청·자원 차트 (원본 셀에 연결됨)";
  charts.getCell("A1").font = { size: 16, bold: true };
  charts.getCell("A2").value =
    "표본이 없으면 차트도 비어 있습니다. 시각은 UTC. 비교 표에서 단계별 차이를 확인하세요.";

  addSheet(
    book,
    "경로별 비교",
    [
      "요청 경로",
      "단계",
      "표본 수",
      "평균 응답 ms",
      "실패 %",
      "주입 전 대비 ms",
      "주입 전 대비 실패 pp",
      "관찰 ID",
    ],
    data.comparisons.flatMap((comparison) =>
      (["baseline", "active", "recovery", "mixed"] as const).map((phase) => {
        const value = comparison[phase];
        return [
          comparison.route,
          phaseNames[phase],
          value.count,
          value.meanMs,
          value.failurePercent,
          phase !== "mixed" &&
          value.meanMs !== null &&
          comparison.baseline.meanMs !== null
            ? value.meanMs - comparison.baseline.meanMs
            : null,
          phase !== "mixed" &&
          value.failurePercent !== null &&
          comparison.baseline.failurePercent !== null
            ? value.failurePercent - comparison.baseline.failurePercent
            : null,
          comparison.runId,
        ];
      }),
    ),
  );
  addSheet(
    book,
    "요청 원본",
    [
      "시작 UTC",
      "완료 UTC",
      "관찰 ID",
      "단계",
      "경로",
      "메서드",
      "응답 ms",
      "HTTP 상태",
      "동시 요청",
      "전송 결과",
      "요청 ID",
      "시작 구간",
      "종료 구간",
      "시작 장애",
    ],
    data.requests.map((item) => [
      new Date(item.startedAt),
      new Date(item.endedAt),
      item.runId,
      phaseNames[item.phase],
      item.route,
      item.method,
      item.durationMs,
      item.status,
      item.concurrent,
      item.outcome,
      item.id,
      item.startSegment,
      item.endSegment,
      item.faults.join(", "),
    ]),
  );
  addSheet(
    book,
    "자원 원본",
    [
      "측정 UTC",
      "관찰 ID",
      "단계",
      "구간",
      "CPU %",
      "RSS MiB",
      "Heap MiB",
      "루프 지연 ms",
      "진행 요청",
      "장애",
    ],
    data.resources.map((item) => [
      new Date(item.at),
      item.runId,
      phaseNames[item.phase],
      item.segment,
      item.cpuPercent,
      item.rssMiB,
      item.heapMiB,
      item.eventLoopDelayMs,
      item.inFlight,
      item.faults.join(", "),
    ]),
  );
  addSheet(
    book,
    "브라우저 관찰",
    [
      "수신 UTC",
      "관찰 ID",
      "단계",
      "종류",
      "경로",
      "경과 ms",
      "요청 ID",
      "상세",
    ],
    data.browserEvents.map((item) => [
      new Date(item.at),
      item.runId,
      phaseNames[item.phase],
      item.kind,
      item.route,
      item.durationMs,
      item.requestId,
      item.detail,
    ]),
  );
  addSheet(
    book,
    "장애 전환",
    ["시각 UTC", "관찰 ID", "단계", "구간", "변경 이유", "활성 장애"],
    data.transitions.map((item) => [
      new Date(item.at),
      item.runId,
      phaseNames[item.phase],
      item.segment,
      item.reason,
      item.faults.join(", "),
    ]),
  );
  addSheet(
    book,
    "설정 구간별 비교",
    [
      "관찰 ID",
      "구간",
      "단계",
      "요청 경로",
      "활성 장애",
      "표본 수",
      "평균 ms",
      "실패 %",
    ],
    data.segments.map((item) => [
      item.runId,
      item.segment,
      phaseNames[item.phase],
      item.route,
      item.faults.join(", "),
      item.count,
      item.meanMs,
      item.failurePercent,
    ]),
  );
  return addNativeCharts(await book.xlsx.writeBuffer(), data);
}
