import { XMLParser } from "fast-xml-parser";
import { createHash } from "node:crypto";

type Cached<T> = {
  data: T;
  receivedAt: string;
  source: string;
  stale: boolean;
  error: string | null;
};
const cache = new Map<string, Cached<unknown>>();
const pending = new Map<string, Promise<Cached<unknown>>>();
const retryAt = new Map<string, number>();

async function source<T>(
  key: string,
  url: string,
  ttl: number,
  parse: (response: Response) => Promise<T>,
): Promise<Cached<T>> {
  const previous = cache.get(key) as Cached<T> | undefined;
  if (
    previous &&
    Date.now() - Date.parse(previous.receivedAt) < ttl &&
    !previous.stale
  )
    return previous;
  if ((retryAt.get(key) ?? 0) > Date.now()) {
    if (previous) return previous;
    throw new Error(`${key}: 외부 공급자 재시도 대기 중`);
  }
  const running = pending.get(key);
  if (running) return running as Promise<Cached<T>>;
  const task = (async () => {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(8000),
        headers: { "User-Agent": "ResilienceLocalLab/1.0" },
      });
      if (!response.ok) throw new Error(`${key}: HTTP ${response.status}`);
      const data = await parse(response);
      const result = {
        data,
        receivedAt: new Date().toISOString(),
        source: url,
        stale: false,
        error: null,
      };
      cache.set(key, result);
      return result;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "외부 데이터 수신 실패";
      retryAt.set(key, Date.now() + 30000);
      if (!previous) throw new Error(message);
      const result = { ...previous, stale: true, error: message };
      cache.set(key, result);
      return result;
    } finally {
      pending.delete(key);
    }
  })();
  pending.set(key, task);
  return task;
}

export type Story = {
  id: string;
  title: string;
  url: string;
  publishedAt: string | null;
  source: string;
  category: string;
};
const feeds = [
  {
    name: "연합뉴스",
    category: "최신 뉴스",
    url: "https://www.yna.co.kr/rss/news.xml",
  },
  {
    name: "BBC Technology",
    category: "테크",
    url: "https://feeds.bbci.co.uk/news/technology/rss.xml",
  },
  {
    name: "CoinDesk",
    category: "디지털 자산",
    url: "https://www.coindesk.com/arc/outboundfeeds/rss/",
  },
];

export async function news(query = "") {
  const results = await Promise.allSettled(
    feeds.map((feed) =>
      source(feed.name, feed.url, 60000, async (response) => {
        const parser = new XMLParser({
          ignoreAttributes: false,
          processEntities: false,
        });
        const parsed = parser.parse(await response.text());
        const raw = parsed?.rss?.channel?.item;
        if (!raw) throw new Error(`${feed.name}: RSS 항목 없음`);
        return (Array.isArray(raw) ? raw : [raw])
          .slice(0, 12)
          .flatMap((item): Story[] => {
            const url = String(item.link ?? "").replace(/&amp;/g, "&");
            if (!/^https:\/\//.test(url)) return [];
            const timestamp = Date.parse(String(item.pubDate ?? ""));
            return [
              {
                id: createHash("sha256").update(url).digest("hex").slice(0, 16),
                title: String(item.title ?? "")
                  .replace(/<[^>]*>/g, "")
                  .slice(0, 250),
                url,
                publishedAt: Number.isFinite(timestamp)
                  ? new Date(timestamp).toISOString()
                  : null,
                source: feed.name,
                category: feed.category,
              },
            ];
          });
      }),
    ),
  );
  const providers = results.map((result, index) =>
    result.status === "fulfilled"
      ? { name: feeds[index].name, ...result.value, data: undefined }
      : {
          name: feeds[index].name,
          source: feeds[index].url,
          receivedAt: null,
          stale: true,
          error: String(result.reason?.message ?? result.reason),
        },
  );
  const items = results
    .flatMap((result) =>
      result.status === "fulfilled" ? result.value.data : [],
    )
    .filter((item) =>
      `${item.title} ${item.category} ${item.source}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    )
    .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
  if (results.every((result) => result.status === "rejected"))
    throw new Error(providers.map((provider) => provider.error).join(" / "));
  return { items, providers };
}

export async function market() {
  const coins = source(
    "Upbit",
    "https://api.upbit.com/v1/ticker?markets=KRW-BTC,KRW-ETH,KRW-XRP",
    5000,
    async (response) => {
      const values = (await response.json()) as Array<{
        market: string;
        trade_price: number;
        signed_change_rate: number;
        timestamp: number;
      }>;
      if (
        !Array.isArray(values) ||
        !values.every((value) => Number.isFinite(value.trade_price))
      )
        throw new Error("Upbit: 시세 형식 오류");
      return values.map((value) => ({
        symbol: value.market,
        price: value.trade_price,
        changePercent: value.signed_change_rate * 100,
        at: new Date(value.timestamp).toISOString(),
      }));
    },
  );
  const fx = source(
    "Frankfurter ECB",
    "https://api.frankfurter.dev/v2/rates?base=EUR&quotes=USD,JPY,KRW&providers=ecb",
    3600000,
    async (response) => {
      const values = (await response.json()) as Array<{
        date: string;
        base: string;
        quote: string;
        rate: number;
      }>;
      if (
        !Array.isArray(values) ||
        values.length !== 3 ||
        !values.every((value) => value.rate > 0 && value.base === "EUR") ||
        new Set(values.map((value) => value.date)).size !== 1
      )
        throw new Error("Frankfurter: 환율 형식 오류");
      const won = values.find((value) => value.quote === "KRW");
      if (
        !won ||
        !values.some((value) => value.quote === "USD") ||
        !values.some((value) => value.quote === "JPY")
      )
        throw new Error("Frankfurter: 통화 누락");
      return values
        .filter((value) => value.quote !== "KRW")
        .map((value) => ({
          symbol: `${value.quote}/KRW`,
          price: won.rate / value.rate,
          date: value.date,
        }));
    },
  );
  const [coinResult, fxResult] = await Promise.allSettled([coins, fx]);
  return {
    coins: coinResult.status === "fulfilled" ? coinResult.value : null,
    fx: fxResult.status === "fulfilled" ? fxResult.value : null,
    errors: [coinResult, fxResult].flatMap((result) =>
      result.status === "rejected"
        ? [String(result.reason?.message ?? result.reason)]
        : [],
    ),
  };
}
