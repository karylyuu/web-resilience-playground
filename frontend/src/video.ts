export const DEFAULT_VIDEO_ID = "ieGKMldpp-M";
export const DEFAULT_VIDEO_TITLE = "灰色と青 — yurisa cover";

export function parseVideoId(input: string): string | null {
  const value = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(value)) return value;

  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    let candidate: string | null = null;

    if (url.hostname === "youtu.be") {
      candidate = url.pathname.split("/")[1] ?? null;
    } else if (
      [
        "youtube.com",
        "www.youtube.com",
        "m.youtube.com",
        "www.youtube-nocookie.com",
      ].includes(url.hostname)
    ) {
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0] === "watch") candidate = url.searchParams.get("v");
      if (["embed", "shorts", "live"].includes(parts[0]))
        candidate = parts[1] ?? null;
    }

    return candidate && /^[A-Za-z0-9_-]{11}$/.test(candidate)
      ? candidate
      : null;
  } catch {
    return null;
  }
}

export function restoreVideo(): string {
  try {
    return (
      parseVideoId(sessionStorage.getItem("resilience.selected-video") ?? "") ??
      DEFAULT_VIDEO_ID
    );
  } catch {
    return DEFAULT_VIDEO_ID;
  }
}

export function rememberVideo(id: string) {
  try {
    sessionStorage.setItem("resilience.selected-video", id);
  } catch {
    // Storage is optional. The currently selected video still plays in memory.
  }
}
