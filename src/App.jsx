import React, { useEffect, useMemo, useRef, useState } from "react";

// ------------------------------
// Config
// ------------------------------
const DEFAULT_CATEGORIES = ["Living Room", "Kitchen", "Bathroom", "Bedroom", "Backyard", "Other"];
const LS_KEY = "moodboard-data-v1";

// ------------------------------
// Utilities
// ------------------------------
function detectProvider(url) {
  if (!url) return "link";
  const u = url.toLowerCase();
  if (u.includes("youtube.com") || u.includes("youtu.be")) return "youtube";
  if (u.includes("tiktok.com")) return "tiktok";
  if (u.includes("instagram.com")) return "instagram";
  if (u.includes("facebook.com") || u.includes("fb.watch")) return "facebook";
  if (u.includes("vimeo.com")) return "vimeo";
  if (/(\.mp4|\.webm|\.ogg)(\?|$)/i.test(u)) return "filevideo";
  if (/(\.png|\.jpg|\.jpeg|\.webp|\.gif)(\?|$)/i.test(u)) return "image";
  return "link";
}
function getYouTubeId(url) {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") return u.pathname.slice(1);
    if (u.hostname.includes("youtube.com")) {
      const v = u.searchParams.get("v");
      if (v) return v;
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts[0] === "shorts" && parts[1]) return parts[1];
      if (parts[0] === "embed" && parts[1]) return parts[1];
    }
  } catch {}
  return "";
}
function getVimeoId(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes("vimeo.com")) {
      const parts = u.pathname.split("/").filter(Boolean);
      const idx = parts[0] === "video" ? 1 : 0;
      if (parts[idx]) return parts[idx];
    }
  } catch {}
  return "";
}
function getTikTokId(url) {
  const m = String(url).match(/\/video\/(\d+)/);
  return m ? m[1] : "";
}
function useLocalStorageState(key, initialValue) {
  const [state, setState] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : initialValue;
    } catch {
      return initialValue;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {}
  }, [key, state]);
  return [state, setState];
}
function injectScriptOnce(src, id) {
  if (document.getElementById(id)) return;
  const s = document.createElement("script");
  s.src = src;
  s.async = true;
  s.id = id;
  document.head.appendChild(s);
}

// ------------------------------
// YouTube IFrame API + Intersection (robust autoplay)
// ------------------------------
function loadYouTubeAPI() {
  if (window.YT?.Player) return Promise.resolve();
  return new Promise((resolve) => {
    if (window._ytApiLoading) {
      window._ytApiLoading.push(resolve);
      return;
    }
    window._ytApiLoading = [resolve];
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.async = true;
    document.head.appendChild(s);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      window._ytApiLoading.forEach((fn) => fn());
      window._ytApiLoading = null;
    };
  });
}
function useYouTubePlayers() {
  const players = useRef(new Map()); // mountEl -> { player, ready, wantPlay }
  const ioRef = useRef(null);

  useEffect(() => {
    ioRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach(({ target, isIntersecting, intersectionRatio }) => {
          const vis = isIntersecting && intersectionRatio >= 0.6;
          const rec = players.current.get(target);
          if (!rec) return;
          rec.wantPlay = vis;
          if (rec.ready) {
            try {
              if (vis) {
                rec.player.mute?.();
                rec.player.playVideo();
              } else {
                rec.player.pauseVideo();
              }
            } catch {}
          }
        });
      },
      { threshold: [0, 0.6, 1] }
    );
    return () => ioRef.current?.disconnect();
  }, []);

  const register = React.useCallback(async (mountEl, videoId) => {
    if (!mountEl || !videoId) return;
    ioRef.current?.observe(mountEl);
    await loadYouTubeAPI();

    const player = new window.YT.Player(mountEl, {
      videoId,
      playerVars: {
        playsinline: 1,
        rel: 0,
        modestbranding: 1,
        origin: location.origin, // critical on hosted sites
        mute: 1,
        autoplay: 0
      },
      events: {
        onReady: (e) => {
          const rec = players.current.get(mountEl);
          if (!rec) return;
          rec.ready = true;
          try {
            e.target.mute?.();
            if (rec.wantPlay) e.target.playVideo();
          } catch {}
        }
      }
    });

    players.current.set(mountEl, { player, ready: false, wantPlay: false });
  }, []);

  return register;
}

// ------------------------------
// Vimeo autoplay via Player API
// ------------------------------
function useVimeoAutoplay(iframeRef) {
  useEffect(() => {
    const el = iframeRef.current;
    if (!el) return;
    injectScriptOnce("https://player.vimeo.com/api/player.js", "vimeo-player-js");
    let player = null,
      io = null,
      tick = null;

    const init = () => {
      if (!window.Vimeo?.Player) {
        tick = setTimeout(init, 200);
        return;
      }
      player = new window.Vimeo.Player(el);
      try {
        player.setVolume?.(0);
      } catch {}
      io = new IntersectionObserver(
        (entries) => {
          entries.forEach(({ isIntersecting, intersectionRatio }) => {
            const vis = isIntersecting && intersectionRatio >= 0.6;
            try {
              vis ? player.play() : player.pause();
            } catch {}
          });
        },
        { threshold: [0, 0.6, 1] }
      );
      io.observe(el);
    };
    init();

    return () => {
      if (io) io.disconnect();
      if (tick) clearTimeout(tick);
    };
  }, [iframeRef]);
}

// ------------------------------
// Facebook helpers + Card (plugins, no SDK)
// ------------------------------
function normalizeFacebookForEmbed(input) {
  if (!input) return { href: "", type: "unknown", reason: "no-url" };
  let url = String(input).trim();
  url = url.replace(/^https?:\/\/m\.facebook\.com/i, "https://www.facebook.com");
  url = url.replace(/^http:/i, "https:");

  // fb.watch short links
  if (/^https?:\/\/fb\.watch\//i.test(url)) {
    try {
      const u = new URL(url);
      const v = u.searchParams.get("v");
      if (v) return { href: `https://www.facebook.com/watch/?v=${v}`, type: "video" };
    } catch {}
    return { href: url, type: "short", reason: "shortlink" };
  }

  const watchV = url.match(/\/watch\/?\?[^#]*v=(\d+)/i);
  if (watchV) return { href: `https://www.facebook.com/watch/?v=${watchV[1]}`, type: "video" };

  const pageVideo = url.match(/facebook\.com\/[^\/?#]+\/videos\/(\d+)/i);
  if (pageVideo) return { href: url, type: "video" };

  if (/facebook\.com\/reels?\//i.test(url)) return { href: url, type: "post" };

  if (
    /facebook\.com\/[^\/?#]+\/posts\//i.test(url) ||
    /facebook\.com\/permalink\.php/i.test(url) ||
    /facebook\.com\/story\.php/i.test(url)
  ) {
    return { href: url, type: "post" };
  }
  return { href: url, type: "post" };
}

// ------------------------------
// Cards
// ------------------------------
function YouTubeCard({ item, register }) {
  const vid = getYouTubeId(item.url);
  const mountRef = useRef(null);

  useEffect(() => {
    if (vid && mountRef.current) register(mountRef.current, vid);
  }, [vid, register]);

  if (!vid) return <FallbackLinkCard item={item} note="Couldn’t parse YouTube ID." />;

  return (
    <div className="media" style={{ display: "block" }}>
      <div ref={mountRef} title="YouTube" />
    </div>
  );
}
function VimeoCard({ item }) {
  const id = getVimeoId(item.url);
  const iframeRef = useRef(null);
  useVimeoAutoplay(iframeRef);
  if (!id) return <FallbackLinkCard item={item} note="Couldn’t parse Vimeo ID." />;
  const src = `https://player.vimeo.com/video/${id}?muted=1&pip=1&playsinline=1`;
  return (
    <div className="media">
      <iframe ref={iframeRef} src={src} title="Vimeo" allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen />
    </div>
  );
}
function TikTokCard({ item }) {
  const id = getTikTokId(item.url);
  if (!id) return <FallbackLinkCard item={item} note="Paste a TikTok video URL" />;
  const src = `https://www.tiktok.com/embed/v2/video/${id}`;
  return (
    <div className="media">
      <iframe src={src} title="TikTok" allow="autoplay; encrypted-media; picture-in-picture; clipboard-write" allowFullScreen />
    </div>
  );
}
function InstagramCard({ item }) {
  useEffect(() => {
    injectScriptOnce("https://www.instagram.com/embed.js", "instgrm-embed");
    const t = setTimeout(() => window.instgrm?.Embeds?.process(), 80);
    return () => clearTimeout(t);
  }, [item.url]);

  return (
    <div className="media" style={{ display: "block" }}>
      <blockquote className="instagram-media" data-instgrm-permalink={item.url} data-instgrm-version="14" style={{ margin: 0, width: "100%" }} />
    </div>
  );
}
function FacebookCard({ item }) {
  const { href, type, reason } = normalizeFacebookForEmbed(item.url);

  if (reason === "shortlink") {
    return (
      <div className="media" style={{ display: "grid", placeItems: "center", padding: 16 }}>
        <div style={{ textAlign: "center", color: "var(--muted)" }}>
          That’s an <b>fb.watch</b> short link. Open it and copy the full post/video URL (e.g. /videos/… or watch/?v=…).<br />
          <a href={item.url} target="_blank" rel="noreferrer">Open on Facebook</a>
        </div>
      </div>
    );
  }

  const base = type === "video"
    ? "https://www.facebook.com/plugins/video.php"
    : "https://www.facebook.com/plugins/post.php";
  const src = `${base}?href=${encodeURIComponent(href)}&show_text=false&width=560`;

  return (
    <div className="media" style={{ display: "block" }}>
      <iframe
        title="Facebook"
        src={src}
        style={{ width: "100%", height: "100%" }}
        allow="autoplay; encrypted-media; clipboard-write; picture-in-picture; web-share"
        allowFullScreen
      />
    </div>
  );
}
function ImageCard({ item }) {
  return (
    <div className="media">
      <img src={item.url} alt="" loading="lazy" />
    </div>
  );
}
function FileVideoCard({ item }) {
  const videoRef = useRef(null);
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach(({ isIntersecting, intersectionRatio }) => {
          const vis = isIntersecting && intersectionRatio >= 0.6;
          try {
            vis ? el.play() : el.pause();
          } catch {}
        });
      },
      { threshold: [0, 0.6, 1] }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div className="media">
      <video ref={videoRef} src={item.url} controls loop muted playsInline />
    </div>
  );
}
function LinkCard({ item }) {
  return (
    <div className="media" style={{ display: "grid", placeItems: "center", padding: 16 }}>
      <div className="url">
        <a href={item.url} target="_blank" rel="noreferrer">
          {item.url}
        </a>
      </div>
    </div>
  );
}
function FallbackLinkCard({ item, note }) {
  return (
    <div className="media" style={{ display: "grid", placeItems: "center", padding: 16 }}>
      <div className="url" style={{ textAlign: "center" }}>
        <div style={{ marginBottom: 8, color: "var(--muted)" }}>{note}</div>
        <a href={item.url} target="_blank" rel="noreferrer">
          {item.url}
        </a>
      </div>
    </div>
  );
}
function MediaCard({ item, register }) {
  switch (item.provider) {
    case "youtube":
      return <YouTubeCard item={item} register={register} />;
    case "vimeo":
      return <VimeoCard item={item} />;
    case "tiktok":
      return <TikTokCard item={item} />;
    case "instagram":
      return <InstagramCard item={item} />;
    case "facebook":
      return <FacebookCard item={item} />;
    case "image":
      return <ImageCard item={item} />;
    case "filevideo":
      return <FileVideoCard item={item} />;
    default:
      return <LinkCard item={item} />;
  }
}

// ------------------------------
// App
// ------------------------------
export default function App() {
  const [items, setItems] = useLocalStorageState(LS_KEY, []);
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [category, setCategory] = useState(DEFAULT_CATEGORIES[0]);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("All");

  const register = useYouTubePlayers();

  const categories = useMemo(() => {
    const base = new Set(DEFAULT_CATEGORIES);
    for (const it of items) base.add(it.category);
    return Array.from(base);
  }, [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((it) => {
      const catOk = catFilter === "All" || it.category === catFilter;
      const qOk = !q || it.url.toLowerCase().includes(q) || (it.note || "").toLowerCase().includes(q);
      return catOk && qOk;
    });
  }, [items, search, catFilter]);

  function addItem(e) {
    e?.preventDefault?.();
    if (!url) return;
    const provider = detectProvider(url);
    const it = {
      id: Date.now() + "-" + Math.random().toString(36).slice(2, 7),
      url,
      note,
      category,
      provider,
      createdAt: new Date().toISOString()
    };
    setItems([it, ...items]);
    setUrl("");
    setNote("");
  }
  function removeItem(id) {
    setItems(items.filter((x) => x.id !== id));
  }
  function exportJSON() {
    const blob = new Blob([JSON.stringify(items, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "moodboard.json";
    a.click();
    URL.revokeObjectURL(url);
  }
  function importJSON(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (Array.isArray(data)) setItems(data);
        else if (Array.isArray(data.items)) setItems(data.items);
        else alert("Invalid JSON");
      } catch {
        alert("Invalid JSON");
      }
    };
    reader.readAsText(file);
  }

  return (
    <>
      <header className="app-header">
        <div className="wrap">
          <h1>
            Renovation Moodboard <span className="badge">local-only</span>
          </h1>
          <div className="kicker">
            Paste TikTok / Instagram / YouTube / Vimeo / Facebook links — add notes — search &amp; filter. Use Export/Import JSON to
            sync.
          </div>
        </div>
      </header>

      <main className="wrap">
        <section style={{ paddingTop: 12 }}>
          <form className="controls" onSubmit={addItem}>
            <input
              type="url"
              placeholder="Paste link (YouTube, TikTok, Instagram, Facebook, Vimeo, image, .mp4…)"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
            />
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <button type="submit">Add</button>
            <button type="button" className="secondary" onClick={exportJSON}>
              Export JSON
            </button>
            <label
              className="ghost"
              style={{ display: "inline-block", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--border)", cursor: "pointer" }}
            >
              Import JSON
              <input type="file" accept="application/json" style={{ display: "none" }} onChange={(e) => importJSON(e.target.files[0])} />
            </label>
            <textarea placeholder="Optional note…" value={note} onChange={(e) => setNote(e.target.value)} />
          </form>

          <div className="toolbar">
            <input type="search" placeholder="Search notes or links…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <div className="right">
              <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
                <option>All</option>
                {categories.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  if (confirm("Clear all items?")) setItems([]);
                }}
              >
                Clear all
              </button>
            </div>
          </div>
        </section>

        <section className="grid">
          {filtered.length === 0 && (
            <div className="empty card" style={{ gridColumn: "1 / -1", padding: 24 }}>
              No items yet. Paste a link above and hit “Add”.
            </div>
          )}
          {filtered.map((item) => (
            <article key={item.id} className="card">
              <MediaCard item={item} register={register} />
              <div className="content">
                <div className="meta">
                  <span className="tag">{item.category}</span>
                  <div className="row-actions">
                    <a
                      className="ghost"
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      style={{ textDecoration: "none", padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", color: "var(--muted)" }}
                    >
                      Open
                    </a>
                    <button className="danger" onClick={() => removeItem(item.id)}>
                      Delete
                    </button>
                  </div>
                </div>
                {item.note ? <div className="note">{item.note}</div> : null}
                <div className="url">
                  <a href={item.url} target="_blank" rel="noreferrer">
                    {item.url}
                  </a>
                </div>
              </div>
            </article>
          ))}
        </section>
      </main>
    </>
  );
}
