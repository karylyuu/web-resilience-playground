import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  DEFAULT_VIDEO_ID,
  DEFAULT_VIDEO_TITLE,
  parseVideoId,
  rememberVideo,
  restoreVideo,
} from "./video";
import { api, number, recordBrowser, time, useLive } from "./api";
import type { Feed, MarketData, Post, Profile } from "./types";

export function News({
  query = "",
  compact = false,
}: {
  query?: string;
  compact?: boolean;
}) {
  const path = query
    ? `/api/search?q=${encodeURIComponent(query)}`
    : "/api/feed";
  const feed = useLive<Feed>(path, 60000);
  return (
    <section className="news-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">FROM THE SOURCES</p>
          <h2>{query ? `“${query}” 검색 결과` : "지금, 읽을 거리"}</h2>
        </div>
        <button onClick={feed.refresh} disabled={feed.loading}>
          {feed.loading ? "불러오는 중…" : "새로 받기 ↻"}
        </button>
      </div>
      <p className="data-note">
        연합뉴스 · BBC · CoinDesk 기사를 1분마다 확인해요.
      </p>
      {feed.error && (
        <ErrorNote
          message={feed.error}
          stale={Boolean(feed.data)}
          retry={feed.refresh}
        />
      )}
      {!feed.data && feed.loading && (
        <div className="skeleton-row">
          <i />
          <i />
          <i />
        </div>
      )}
      <div className={`news-grid ${compact ? "compact" : ""}`}>
        {feed.data?.items.slice(0, compact ? 4 : 24).map((story, index) => (
          <a
            className="story"
            key={story.id}
            href={story.url}
            target="_blank"
            rel="noreferrer"
          >
            <div className="story-index">
              {String(index + 1).padStart(2, "0")}
              <span>↗</span>
            </div>
            <small>
              {story.category} · {story.source}
            </small>
            <h3>{story.title}</h3>
            <time>
              {story.publishedAt
                ? new Date(story.publishedAt).toLocaleString("ko-KR")
                : "발행 시각 없음"}
            </time>
          </a>
        ))}
      </div>
      {feed.data?.items.length === 0 && (
        <p className="empty-state">
          검색 결과가 없어요. 지금 받아 온 기사 제목에서만 찾아요.
        </p>
      )}
      <div className="provider-notes">
        {feed.data?.providers.map((provider) => (
          <p key={provider.name}>
            <a href={provider.source} target="_blank" rel="noreferrer">
              {provider.name}
            </a>{" "}
            · 마지막 갱신 {time(provider.receivedAt)}
            {provider.stale ? ` · 이전 내용 표시 / ${provider.error}` : ""}
          </p>
        ))}
      </div>
    </section>
  );
}

export function Market({ compact = false }: { compact?: boolean }) {
  const market = useLive<MarketData>("/api/market", 15000);
  return (
    <section className="market-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">MARKET / SOURCE CONNECTED</p>
          <h2>시세와 환율</h2>
        </div>
        <button onClick={market.refresh} disabled={market.loading}>
          {market.loading ? "불러오는 중…" : "새로 받기 ↻"}
        </button>
      </div>
      {market.error && (
        <ErrorNote
          message={market.error}
          stale={Boolean(market.data)}
          retry={market.refresh}
        />
      )}
      <p className="data-note">
        업비트 원화 시세 · 15초마다 갱신 · 전일 대비
      </p>
      <div className="ticker-grid">
        {market.data?.coins?.data.map((coin) => (
          <article className="ticker" key={coin.symbol}>
            <p>
              {coin.symbol}
              <span>KRW</span>
            </p>
            <strong>₩{number(coin.price, 0)}</strong>
            <b className={coin.changePercent >= 0 ? "positive" : "negative"}>
              {coin.changePercent >= 0 ? "+" : ""}
              {number(coin.changePercent, 2)}%
            </b>
            <small>거래소 시각 {time(coin.at)}</small>
          </article>
        ))}
      </div>
      {!market.data?.coins && (
        <p className="empty-state">
          {market.loading
            ? "시세 불러오는 중…"
            : "시세를 받아 오지 못했어요."}
        </p>
      )}
      {market.data?.coins && (
        <p className="data-note">
          출처{" "}
          <a href="https://upbit.com" target="_blank" rel="noreferrer">
            Upbit
          </a>{" "}
          · 갱신 {time(market.data.coins.receivedAt)}
          {market.data.coins.stale &&
            ` · 이전 시세 / ${market.data.coins.error}`}
        </p>
      )}
      {!compact && (
        <>
          <h3 className="subheading">환율</h3>
          <p className="data-note">
            유럽중앙은행(ECB)의 하루 기준 환율이에요.
          </p>
          <div className="fx-grid">
            {market.data?.fx?.data.map((fx) => (
              <article key={fx.symbol}>
                <span>{fx.symbol}</span>
                <strong>{number(fx.price, 2)} 원</strong>
                <small>
                  1 {fx.symbol.split("/")[0]} 기준 · {fx.date}
                </small>
              </article>
            ))}
          </div>
          {!market.data?.fx && (
            <p className="empty-state">환율을 불러오는 중이거나 받아 오지 못했어요.</p>
          )}
          {market.data?.fx && (
            <p className="data-note">
              <a href={market.data.fx.source} target="_blank" rel="noreferrer">
                원본 환율 데이터 ↗
              </a>
              {market.data.fx.stale && ` · 이전 자료 / ${market.data.fx.error}`}
            </p>
          )}
          <News compact query="" />
        </>
      )}
      {market.data?.errors.map((error) => (
        <p className="data-note negative" key={error}>
          {error}
        </p>
      ))}
    </section>
  );
}

export function MapView() {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const marker = useRef<L.Marker | null>(null);
  const circle = useRef<L.Circle | null>(null);
  const [message, setMessage] = useState(
    "지도를 끌거나 확대해 보세요. 처음 위치는 서울시청이에요.",
  );
  const [locating, setLocating] = useState(false);
  const [coordinates, setCoordinates] = useState({
    latitude: "37.5665",
    longitude: "126.9780",
  });
  useEffect(() => {
    if (!element.current) return;
    const instance = L.map(element.current).setView([37.5665, 126.978], 13);
    map.current = instance;
    const tiles = L.tileLayer(
      "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      },
    ).addTo(instance);
    tiles.on("tileerror", () =>
      setMessage(
        "지도 일부를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.",
      ),
    );
    return () => {
      instance.remove();
      map.current = null;
    };
  }, []);
  const move = (latitude: number, longitude: number, accuracy?: number) => {
    if (!map.current) return;
    marker.current?.remove();
    circle.current?.remove();
    marker.current = L.marker([latitude, longitude], {
      icon: L.divIcon({
        className: "location-pin",
        html: "<span>●</span>",
        iconSize: [24, 24],
      }),
    }).addTo(map.current);
    if (accuracy)
      circle.current = L.circle([latitude, longitude], {
        radius: accuracy,
        color: "#df865d",
      }).addTo(map.current);
    map.current.setView([latitude, longitude], 15);
    setCoordinates({
      latitude: latitude.toFixed(5),
      longitude: longitude.toFixed(5),
    });
    setMessage(
      accuracy
        ? `현재 위치로 이동했어요. (오차 약 ${number(accuracy, 0)}m)`
        : "입력한 좌표로 이동했어요.",
    );
  };
  const locate = () => {
    if (!navigator.geolocation) {
      setMessage("이 브라우저에서는 위치 기능을 쓸 수 없어요.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        move(
          position.coords.latitude,
          position.coords.longitude,
          position.coords.accuracy,
        );
        setLocating(false);
      },
      (error) => {
        setMessage(`현재 위치를 가져오지 못했어요: ${error.message}`);
        setLocating(false);
      },
      { timeout: 10000, enableHighAccuracy: true },
    );
  };
  const submitCoordinates = (event: FormEvent) => {
    event.preventDefault();
    const latitude = Number(coordinates.latitude);
    const longitude = Number(coordinates.longitude);
    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 ||
      Math.abs(longitude) > 180
    ) {
      setMessage("위도는 -90~90, 경도는 -180~180 사이로 입력해 주세요.");
      return;
    }
    move(latitude, longitude);
  };
  return (
    <section>
      <div className="section-heading">
        <div>
          <p className="eyebrow">EXPLORE YOUR SURROUNDINGS</p>
          <h2>지도</h2>
        </div>
        <button onClick={locate} disabled={locating}>
          {locating ? "위치 확인 중…" : "내 위치 사용 ⌖"}
        </button>
      </div>
      <p className="data-note">
        위치 권한은 버튼을 누를 때만 물어봐요.
      </p>
      <div
        className="interactive-map"
        ref={element}
        aria-label="확대와 이동이 가능한 지도"
      />
      <p role="status" className="data-note">
        {message}
      </p>
      <form className="coordinate-form" onSubmit={submitCoordinates}>
        <label>
          위도
          <input
            aria-label="위도"
            value={coordinates.latitude}
            onChange={(event) =>
              setCoordinates({ ...coordinates, latitude: event.target.value })
            }
          />
        </label>
        <label>
          경도
          <input
            aria-label="경도"
            value={coordinates.longitude}
            onChange={(event) =>
              setCoordinates({ ...coordinates, longitude: event.target.value })
            }
          />
        </label>
        <button>좌표로 이동</button>
      </form>
      <p className="scope-label">
        지도는 OpenStreetMap에서 바로 받아 오기 때문에 장애의 영향을 받지
        않아요.
      </p>
    </section>
  );
}

export function VideoView() {
  const [id, setId] = useState(restoreVideo);
  const [draft, setDraft] = useState(
    () => `https://www.youtube.com/watch?v=${restoreVideo()}`,
  );
  const [playerRevision, setPlayerRevision] = useState(0);
  const [error, setError] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = parseVideoId(draft);
    if (!value) {
      setError("YouTube 영상 주소를 넣어 주세요.");
      return;
    }
    setId(value);
    rememberVideo(value);
    setPlayerRevision((revision) => revision + 1);
    setError("");
  };
  return (
    <section>
      <p className="eyebrow">LISTEN / WATCH / STAY A LITTLE</p>
      <h2>영상</h2>
      <div className="video-frame">
        <iframe
          key={`${id}-${playerRevision}`}
          src={`https://www.youtube-nocookie.com/embed/${id}`}
          title="YouTube 영상 플레이어"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
        />
      </div>
      <div className="video-caption">
        <div>
          <h3>
            {id === DEFAULT_VIDEO_ID
              ? DEFAULT_VIDEO_TITLE
              : "선택한 YouTube 영상"}
          </h3>
          <p className="data-note">영상 ID: {id}</p>
        </div>
        <a
          href={`https://www.youtube.com/watch?v=${id}`}
          target="_blank"
          rel="noreferrer"
        >
          YouTube에서 열기 ↗
        </a>
      </div>
      <form className="video-form" onSubmit={submit}>
        <label>
          보고 싶은 YouTube 링크
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="https://www.youtube.com/watch?v=…"
          />
        </label>
        <button>영상 바꾸기</button>
      </form>
      {error && <p role="alert">{error}</p>}
      <p className="scope-label">
        영상은 YouTube에서 바로 재생되기 때문에 장애의 영향을 받지 않아요.
        영상에 따라 재생이 막혀 있을 수 있어요.
      </p>
    </section>
  );
}

export function Community({
  profile,
  openLogin,
}: {
  profile: Profile | null;
  openLogin: () => void;
}) {
  const feed = useLive<{ posts: Post[] }>("/api/community", 4000);
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const action = async (path: string, text?: string) => {
    if (!profile) {
      openLogin();
      return false;
    }
    setBusy(true);
    setMessage("");
    try {
      await api(path, {
        method: "POST",
        headers: { Authorization: `Bearer ${profile.session}` },
        body: JSON.stringify({ text }),
      });
      feed.refresh();
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "글을 올리지 못했어요.");
      return false;
    } finally {
      setBusy(false);
    }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (await action("/api/community", draft)) setDraft("");
  };
  return (
    <section>
      <p className="eyebrow">SMALL TALKS, REAL CONNECTIONS</p>
      <h2>카페</h2>
      <p className="data-note">
        새 글은 4초마다 확인해요.
      </p>
      {profile ? (
        <form className="post-form" onSubmit={submit}>
          <label>
            {profile.name}의 이야기
            <textarea
              required
              maxLength={1000}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="오늘의 음악, 발견한 장소, 관찰한 변화를 남겨 보세요."
            />
          </label>
          <button disabled={busy || !draft.trim()}>
            {busy ? "전송 중…" : "기록 남기기 ↗"}
          </button>
        </form>
      ) : (
        <button onClick={openLogin}>로그인하고 글 남기기</button>
      )}
      {message && <ErrorNote message={message} />}
      {feed.error && (
        <ErrorNote
          message={feed.error}
          stale={Boolean(feed.data)}
          retry={feed.refresh}
        />
      )}
      {feed.data?.posts.length === 0 && (
        <p className="empty-state">
          아직 글이 없어요. 첫 글을 남겨 보세요.
        </p>
      )}
      <div className="posts">
        {feed.data?.posts.map((post) => (
          <article key={post.id}>
            <div>
              <b>{post.author}</b>
              <time>{new Date(post.at).toLocaleString("ko-KR")}</time>
            </div>
            <p>{post.text}</p>
            <button
              disabled={busy}
              onClick={() => action(`/api/community/${post.id}/like`)}
            >
              공감 {post.likes}
            </button>
            <div className="comments">
              {post.comments.map((comment, index) => (
                <p key={index}>
                  <b>{comment.author}</b> {comment.text}
                </p>
              ))}
            </div>
            <CommentForm
              disabled={busy}
              submit={(text) =>
                action(`/api/community/${post.id}/comment`, text)
              }
            />
          </article>
        ))}
      </div>
    </section>
  );
}

function CommentForm({
  submit,
  disabled,
}: {
  submit: (text: string) => Promise<boolean>;
  disabled: boolean;
}) {
  const [text, setText] = useState("");
  return (
    <form
      className="comment-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (await submit(text)) setText("");
      }}
    >
      <input
        aria-label="댓글"
        placeholder="댓글 남기기"
        maxLength={500}
        required
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <button disabled={disabled}>등록</button>
    </form>
  );
}

export function ErrorNote({
  message,
  stale = false,
  retry,
}: {
  message: string;
  stale?: boolean;
  retry?: () => void;
}) {
  return (
    <div className="service-error" role="status">
      <strong>
        {stale
          ? "새 내용을 받지 못해 이전 내용을 보여 주고 있어요."
          : "불러오지 못했어요."}
      </strong>
      <p>{message}</p>
      {retry && <button onClick={retry}>다시 시도</button>}
    </div>
  );
}

export function LabImage({ version }: { version: number }) {
  const [failed, setFailed] = useState(false);
  const [requestId] = useState(() => crypto.randomUUID());
  const started = useRef(0);
  useEffect(() => {
    started.current = performance.now();
  }, [version]);
  return (
    <div className="cover-art">
      <img
        src={`/api/assets/cover.svg?v=${version}&rid=${requestId}`}
        alt="연결된 궤도를 표현한 실험용 그래픽"
        onLoad={() => {
          setFailed(false);
          recordBrowser(
            "image-loaded",
            "/api/assets/cover.svg",
            "이미지 디코딩·로드 완료",
            performance.now() - started.current,
            requestId,
          );
        }}
        onError={() => {
          setFailed(true);
          recordBrowser(
            "image-error",
            "/api/assets/cover.svg",
            "브라우저 img error 이벤트",
            performance.now() - started.current,
            requestId,
          );
        }}
      />
      {failed && <span>이미지를 불러오지 못했어요.</span>}
      <small>실험용 이미지</small>
    </div>
  );
}
