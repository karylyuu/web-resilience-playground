export const phaseLabels = {
  baseline: "장애 전",
  active: "장애 중",
  recovery: "해제 후",
  mixed: "전환 중",
};
export const phaseColors = {
  baseline: "#92bcb0",
  active: "#f6a174",
  recovery: "#a4a5ef",
  mixed: "#85858e",
};

/** Friendly names for the routes people see in the lab. */
const routeNames: Record<string, string> = {
  "/api/pulse": "연결 확인",
  "/api/feed": "뉴스",
  "/api/search": "검색",
  "/api/market": "시세·환율",
  "/api/community": "카페",
  "/api/auth/login": "로그인",
  "/api/auth/logout": "로그아웃",
  "/api/assets/cover.svg": "이미지",
  "/api/assets/portal.css": "스타일(CSS)",
};
export function routeName(route: string) {
  const path = route.includes(" ") ? route.split(" ").slice(1).join(" ") : route;
  if (routeNames[path]) return routeNames[path];
  if (path.startsWith("/api/community/")) return "카페 글 반응";
  return path;
}

const browserKinds: Record<string, string> = {
  "data-received": "데이터 받음",
  "request-error": "요청 실패",
  "image-loaded": "이미지 표시됨",
  "image-error": "이미지 못 받음",
  "style-loaded": "스타일 적용됨",
  "style-error": "스타일 못 받음",
};
export const browserKindName = (kind: string) => browserKinds[kind] ?? kind;
