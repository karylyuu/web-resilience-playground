import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { api, recordBrowser, setObservationScope, time, useLive } from "./api";
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
import type { Diagnostic, Profile } from "./types";
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
  const [styleMessage, setStyleMessage] = useState("포털 스타일 수신 중");
  const lab = useLive<Diagnostic>("/api/lab", 1500);
  const pulse = useLive<{ serverAt: string; uptimeSeconds: number }>(
    "/api/pulse",
    3000,
  );

  useEffect(() => {
    if (lab.data) setObservationScope(lab.data);
  }, [lab.data]);
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
    const requestId = crypto.randomUUID();
    link.href = `/api/assets/portal.css?v=${assetVersion}&rid=${requestId}`;
    const start = performance.now();
    link.onload = () => {
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
      setStyleMessage(
        "포털 스타일 파일 수신 실패. 아래 포털은 CSS 없이 표시될 수 있습니다.",
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
      link.remove();
    };
  }, [assetVersion]);

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
        error instanceof Error ? error.message : "로그아웃 요청 실패",
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
              <i /> LIVE SERVICE / 실험 대상
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
                placeholder="뉴스의 제목, 출처, 관심사를 검색하세요"
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
                      <p className="eyebrow">연결의 일상, 변화의 관찰.</p>
                      <h1>
                        Life stays
                        <br />
                        <em>connected.</em>
                      </h1>
                      <p className="cover-copy">
                        평범하게 흐르던 서비스.
                        <br />
                        연결이 달라지면, 무엇이 달라질까요?
                      </p>
                      <button onClick={() => navigate("news")}>
                        살아 있는 웹 둘러보기 <span>↗</span>
                      </button>
                    </div>
                    <LabImage key={assetVersion} version={assetVersion} />
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
                    <p className="eyebrow">
                      SERVER CONNECTION / 실제 연결 확인
                    </p>
                    <h3>
                      {pulse.loading
                        ? "서버의 다음 응답을 기다리는 중…"
                        : pulse.error
                          ? "새 응답을 받지 못했습니다."
                          : "서버에서 도착한 지금."}
                    </h3>
                    <p>
                      서버 시각 <b>{time(pulse.data?.serverAt)}</b> · 브라우저
                      수신 {time(pulse.receivedAt)}
                    </p>
                  </div>
                  <button onClick={pulse.refresh} disabled={pulse.loading}>
                    연결 확인 ↻
                  </button>
                  <small>
                    이 요청은 3초 간격의 관측용 API입니다. 뉴스·시세와 구분해
                    기록됩니다.
                  </small>
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
                <h2>페이지를 찾을 수 없습니다.</h2>
                <button onClick={() => navigate("home")}>홈으로</button>
              </section>
            )}
            <footer className="portal-footer">
              <span>re:silience.</span>
              <p>서비스는 실제로 요청하고, 관찰은 있는 그대로 기록합니다.</p>
              <small>
                로컬 장애 주입은 외부 뉴스·거래소·지도·YouTube 서버를 공격하지
                않습니다.
              </small>
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
      setError(failure instanceof Error ? failure.message : "로그인 실패");
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
      <h2>다시, 연결.</h2>
      <p className="muted">실험용 로컬 계정으로 로그인하세요.</p>
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
          {busy ? "인증 요청 중…" : "로그인 →"}
        </button>
      </form>
      <small>
        demo@resilience.local / resilience
        <br />
        표시 이름 karylyuu · 세션 유효시간 1시간
        <br />
        공개 데모 계정입니다. 실제 개인정보를 입력하지 마세요.
      </small>
    </dialog>
  );
}

export default App;
