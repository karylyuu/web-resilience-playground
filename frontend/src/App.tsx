import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  api,
  recordBrowser,
  time,
  useAssetRevision,
  useLabStream,
  useLive,
} from "./api";
import { Lab } from "./Lab";
import {
  Community,
  ErrorNote,
  LabImage,
  MapView,
  Market,
  News,
  VideoView,
} from "./Portal";
import type { Profile } from "./types";
import "./App.css";

const navigation = [
  ["home", "홈"],
  ["news", "뉴스"],
  ["market", "시세·환율"],
  ["map", "지도"],
  ["video", "영상"],
  ["community", "카페"],
];
function currentPage() {
  return window.location.hash.slice(1) || "home";
}

function App() {
  const [page, setPage] = useState(currentPage);
  const [now, setNow] = useState(() => new Date());
  const [query, setQuery] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [assetVersion, setAssetVersion] = useState(0);
  const [styleMessage, setStyleMessage] = useState("");
  const lab = useLabStream();
  // Manual reloads and fault changes both re-request the image and stylesheet.
  const assetRevision = useAssetRevision();
  const assetKey = assetVersion + assetRevision;
  const pulse = useLive<{ serverAt: string; uptimeSeconds: number }>(
    "/api/pulse",
    3000,
  );

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    const change = () => setPage(currentPage());
    window.addEventListener("hashchange", change);
    return () => {
      clearInterval(timer);
      window.removeEventListener("hashchange", change);
    };
  }, []);
  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.dataset.portalStyle = "";
    const requestId = crypto.randomUUID();
    link.href = `/api/assets/portal.css?v=${assetKey}&rid=${requestId}`;
    const start = performance.now();
    // Keep the current stylesheet until the new request settles, so a reload
    // that succeeds does not flash an unstyled page.
    const settle = () =>
      document
        .querySelectorAll("link[data-portal-style]")
        .forEach((other) => other !== link && other.remove());
    link.onload = () => {
      settle();
      setStyleMessage("");
      recordBrowser(
        "style-loaded",
        "/api/assets/portal.css",
        "link load 이벤트 · 포털 CSS 적용",
        performance.now() - start,
        requestId,
      );
    };
    link.onerror = () => {
      settle();
      setStyleMessage(
        "스타일 파일(CSS)을 받지 못해서 화면이 기본 모양으로 보이고 있어요.",
      );
      recordBrowser(
        "style-error",
        "/api/assets/portal.css",
        "link error 이벤트 · 스타일을 적용하지 못함",
        performance.now() - start,
        requestId,
      );
    };
    document.head.append(link);
    return () => {
      link.onload = null;
      link.onerror = null;
    };
  }, [assetKey]);
  useEffect(
    () => () =>
      document
        .querySelectorAll("link[data-portal-style]")
        .forEach((link) => link.remove()),
    [],
  );

  const navigate = (next: string) => {
    window.location.hash = next;
    setPage(next);
  };
  const search = (event: FormEvent) => {
    event.preventDefault();
    if (!query.trim()) return;
    setSearchQuery(query.trim());
    navigate("search");
  };
  const logout = async () => {
    try {
      await api("/api/auth/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${profile?.session}` },
      });
      setProfile(null);
    } catch (error) {
      setStyleMessage(
        error instanceof Error ? error.message : "로그아웃하지 못했어요.",
      );
    }
  };

  return (
    <main>
      <header className="site-header">
        <button
          className="wordmark"
          onClick={() => navigate("home")}
          aria-label="RESILIENCE 홈"
        >
          re<span>:</span>silience<span className="brand-period">.</span>
        </button>
        <nav aria-label="서비스 메뉴">
          {navigation.map(([id, label]) => (
            <button
              key={id}
              className={page === id ? "selected" : ""}
              onClick={() => navigate(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="header-account">
          <time>{now.toLocaleTimeString("ko-KR", { hour12: false })}</time>
          {profile ? (
            <>
              <span>{profile.name}</span>
              <button onClick={logout}>로그아웃</button>
            </>
          ) : (
            <button onClick={() => setLoginOpen(true)}>로그인 ↗</button>
          )}
        </div>
      </header>
      <div className="workspace">
        <div className="service-column">
          <div className="service-boundary">
            <span>
              <i /> 실험 대상 서비스
            </span>
            <button onClick={() => setAssetVersion((value) => value + 1)}>
              이미지·스타일 다시 받기 ↻
            </button>
          </div>
          <div className="service-toolbar">
            <form className="search" onSubmit={search}>
              <span aria-hidden="true">⌕</span>
              <input
                aria-label="뉴스 검색"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="뉴스 검색"
              />
              <button aria-label="검색 실행">검색 ↗</button>
            </form>
          </div>
          {styleMessage && (
            <p className="asset-warning" role="status">
              {styleMessage}
            </p>
          )}
          <div className="portal-skin" key={page}>
            {page === "home" && (
              <>
                <section className="cover">
                  <div className="cover-top">
                    <span>THE RESILIENCE PROJECT</span>
                    <span>LOCAL EDITION / 01</span>
                  </div>
                  <div className="cover-body">
                    <div>
                      <p className="eyebrow">웹 복원력 실험실</p>
                      <h1>
                        Life stays
                        <br />
                        <em>connected.</em>
                      </h1>
                      <p className="cover-copy">
                        평소처럼 쓰던 서비스에 장애가 생기면
                        <br />
                        화면에서는 무슨 일이 일어날까요?
                      </p>
                      <button onClick={() => navigate("news")}>
                        서비스 둘러보기 <span>↗</span>
                      </button>
                    </div>
                    <LabImage key={assetKey} version={assetKey} />
                  </div>
                  <div className="cover-bottom">
                    <span>READ. EXPLORE. OBSERVE.</span>
                    <span>SCROLL TO DISCOVER ↓</span>
                  </div>
                </section>
                <div className="quick-links">
                  {navigation.slice(1).map(([id, label], index) => (
                    <button key={id} onClick={() => navigate(id)}>
                      <small>0{index + 1}</small>
                      <span>{label}</span>
                      <b>↗</b>
                    </button>
                  ))}
                </div>
                <section className="pulse-card">
                  <div>
                    <p className="eyebrow">서버 연결 확인</p>
                    <h3>
                      {pulse.loading
                        ? "서버 응답을 기다리는 중…"
                        : pulse.error
                          ? "서버에서 응답이 오지 않아요."
                          : "서버와 연결되어 있어요."}
                    </h3>
                    <p>
                      서버 시각 <b>{time(pulse.data?.serverAt)}</b> · 받은 시각{" "}
                      {time(pulse.receivedAt)}
                    </p>
                  </div>
                  <button onClick={pulse.refresh} disabled={pulse.loading}>
                    연결 확인 ↻
                  </button>
                  <small>3초마다 자동으로 확인해요.</small>
                </section>
                {pulse.error && (
                  <ErrorNote
                    message={pulse.error}
                    stale={Boolean(pulse.data)}
                    retry={pulse.refresh}
                  />
                )}
                <News compact />
                <Market compact />
              </>
            )}
            {page === "news" && <News />}
            {page === "search" && (
              <News key={searchQuery} query={searchQuery} />
            )}
            {page === "market" && <Market />}
            {page === "map" && <MapView />}
            {page === "video" && <VideoView />}
            {page === "community" && (
              <Community
                profile={profile}
                openLogin={() => setLoginOpen(true)}
              />
            )}
            {!navigation.some(([id]) => id === page) && page !== "search" && (
              <section>
                <h2>페이지를 찾을 수 없어요.</h2>
                <button onClick={() => navigate("home")}>홈으로</button>
              </section>
            )}
            <footer className="portal-footer">
              <span>re:silience.</span>
              <p>웹 복원력 실험실 · 2026 CLP</p>
            </footer>
          </div>
        </div>
        <Lab data={lab.data} error={lab.error} refresh={lab.refresh} />
      </div>
      {loginOpen && (
        <LoginDialog
          close={() => setLoginOpen(false)}
          complete={(value) => {
            setProfile(value);
            setLoginOpen(false);
          }}
        />
      )}
    </main>
  );
}

function LoginDialog({
  close,
  complete,
}: {
  close: () => void;
  complete: (profile: Profile) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [email, setEmail] = useState("demo@resilience.local");
  const [password, setPassword] = useState("resilience");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      complete(
        await api<Profile>("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        }),
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "로그인하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <dialog
      className="login-dialog"
      ref={dialog}
      onCancel={close}
      aria-label="로그인"
    >
      <button className="dialog-close" onClick={close} aria-label="로그인 닫기">
        ×
      </button>
      <p className="eyebrow">YOUR PERSONAL SPACE</p>
      <h2>로그인</h2>
      <p className="muted">실험용 계정이 미리 채워져 있어요.</p>
      <form onSubmit={submit}>
        <label>
          이메일
          <input
            autoFocus
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label>
          비밀번호
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
        <button className="login-submit" disabled={busy}>
          {busy ? "로그인 중…" : "로그인 →"}
        </button>
      </form>
      <small>
        demo@resilience.local / resilience
        <br />
        표시 이름 karylyuu · 세션 유효시간 1시간
        <br />
        실제 개인정보는 넣지 마세요.
      </small>
    </dialog>
  );
}

export default App;
