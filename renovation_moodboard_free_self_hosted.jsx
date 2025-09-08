import React, { useEffect, useMemo, useRef, useState } from "react";

// ------------------------------
// Renovation Moodboard (Free)
// Single-file React app you can host anywhere (GitHub Pages/Netlify)
// - Paste TikTok, Instagram, YouTube links — they render inline
// - Autoplay on scroll for YouTube (muted) via IFrame API
// - Clean grid, categories (Living Room, Kitchen, Bathroom, Bedroom, Backyard, Other)
// - Add notes, search, filter by category
// - Local-only: data saves to your browser (localStorage)
// - Import/Export JSON for backup or sharing
// ------------------------------

const DEFAULT_CATEGORIES = [
  "Living Room",
  "Kitchen",
  "Bathroom",
  "Bedroom",
  "Backyard",
  "Other",
];

const LS_KEY = "moodboard-data-v1";

function detectProvider(url) {
  if (!url) return "link";
  const u = url.toLowerCase();
  if (u.includes("youtube.com") || u.includes("youtu.be")) return "youtube";
  if (u.includes("tiktok.com")) return "tiktok";
  if (u.includes("instagram.com")) return "instagram";
  if (u.includes("facebook.com") || u.includes("fb.watch")) return "facebook";
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
      // Fallback for shorts or embed formats
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts[0] === "shorts" && parts[1]) return parts[1];
      if (parts[0] === "embed" && parts[1]) return parts[1];
    }
  } catch (_) {}
  return "";
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
  document.body.appendChild(s);
}

function ensureFbRoot() {
  if (!document.getElementById("fb-root")) {
    const r = document.createElement("div");
    r.id = "fb-root";
    document.body.appendChild(r);
  }
}

function YouTubeCard({ item, observe }) {
  const vid = getYouTubeId(item.url);
  const iframeRef = useRef(null);

  useEffect(() => {
    if (!vid) return;
    // YouTube Iframe API not strictly necessary for postMessage commands,
    // but enablejsapi=1 is required.
    observe(iframeRef);
  }, [vid, observe]);

  if (!vid) return (
    <FallbackLinkCard item={item} note="Couldn’t parse YouTube ID." />
  );

  const src = `https://www.youtube.com/embed/${vid}?enablejsapi=1&rel=0&mute=1&playsinline=1`;
  return (
    <div className="bg-white rounded-2xl shadow p-2">
      <div className="aspect-video w-full overflow-hidden rounded-xl">
        <iframe
          ref={iframeRef}
          id={`yt-${item.id}`}
          title={item.title || "YouTube"}
          src={src}
          frameBorder="0"
          allow="autoplay; encrypted-media; picture-in-picture; clipboard-write"
          allowFullScreen
          className="w-full h-full"
          data-ytid={vid}
        />
      </div>
      <CardMeta item={item} />
    </div>
  );
}

function TikTokCard({ item }) {
  useEffect(() => {
    injectScriptOnce("https://www.tiktok.com/embed.js", "tiktok-embed-js");
  }, []);

  return (
    <div className="bg-white rounded-2xl shadow p-2">
      <div className="w-full rounded-xl overflow-hidden">
        {/* TikTok official embed */}
        <blockquote className="tiktok-embed" cite={item.url} data-video-id="" style={{ maxWidth: "605px", minWidth: "325px" }}>
          <section>
            <a href={item.url} target="_blank" rel="noreferrer noopener" className="underline">Open TikTok</a>
          </section>
        </blockquote>
      </div>
      <CardMeta item={item} />
    </div>
  );
}

function InstagramCard({ item }) {
  useEffect(() => {
    injectScriptOnce("https://www.instagram.com/embed.js", "instagram-embed-js");
    ensureFbRoot();
    injectScriptOnce("https://connect.facebook.net/en_US/sdk.js#xfbml=1&version=v18.0", "facebook-jssdk");
    // Reprocess embeds when items mount
    const tryProcess = () => {
      // eslint-disable-next-line no-undef
      if (window.instgrm && window.instgrm.Embeds) {
        window.instgrm.Embeds.process();
      }
    };
    const id = setTimeout(tryProcess, 200);
    return () => clearTimeout(id);
  }, []);

  return (
    <div className="bg-white rounded-2xl shadow p-2">
      <div className="w-full rounded-xl overflow-hidden">
        {/* Instagram official embed */}
        <blockquote className="instagram-media" data-instgrm-permalink={`${item.url}?utm_source=ig_embed&utm_campaign=loading`} data-instgrm-version="14" style={{ background: "#fff", border: 0, margin: 0, padding: 0 }}>
          <a href={item.url} target="_blank" rel="noreferrer noopener">View on Instagram</a>
        </blockquote>
      </div>
      <CardMeta item={item} />
    </div>
  );
}

function FacebookCard({ item }) {
  const containerRef = useRef(null);
  const playerRef = useRef(null);
  const id = useMemo(() => `fbv-${item.id}`, [item.id]);
  const obsRef = useRef(null);

  useEffect(() => {
    ensureFbRoot();
    injectScriptOnce("https://connect.facebook.net/en_US/sdk.js#xfbml=1&version=v18.0", "facebook-jssdk");

    const subscribeWhenReady = () => {
      if (window.FB && window.FB.Event && window.FB.Event.subscribe) {
        window.FB.Event.subscribe("xfbml.ready", (msg) => {
          try {
            if (msg.type === "video" && msg.id === id) {
              playerRef.current = msg.instance;
              try { playerRef.current.mute && playerRef.current.mute(); } catch {}
            }
          } catch {}
        });
      } else {
        setTimeout(subscribeWhenReady, 250);
      }
    };
    subscribeWhenReady();

    const parseWhenReady = () => {
      if (window.FB && window.FB.XFBML && containerRef.current) {
        window.FB.XFBML.parse(containerRef.current);
      } else {
        setTimeout(parseWhenReady, 250);
      }
    };
    parseWhenReady();

    obsRef.current = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const visible = entry.isIntersecting && entry.intersectionRatio > 0.6;
        const p = playerRef.current;
        if (p && typeof p.play === "function" && typeof p.pause === "function") {
          try {
            if (visible) { p.mute && p.mute(); p.play(); } else { p.pause(); }
          } catch {}
        }
      });
    }, { threshold: [0, 0.6, 1] });

    const el = containerRef.current;
    if (el) obsRef.current.observe(el);
    return () => { obsRef.current && obsRef.current.disconnect(); };
  }, [id]);

  return (
    <div ref={containerRef} className="bg-white rounded-2xl shadow p-2">
      <div className="w-full rounded-xl overflow-hidden">
        {/* Facebook Video embed requires the video post to be PUBLIC */}
        <div id={id} className="fb-video" data-href={item.url} data-width="auto" data-allowfullscreen="true" data-autoplay="false"></div>
      </div>
      <CardMeta item={item} />
    </div>
  );
}

function ImageCard({ item }) {
  return (
    <div className="bg-white rounded-2xl shadow p-2">
      <div className="w-full rounded-xl overflow-hidden">
        <img src={item.url} alt={item.title || "image"} className="w-full h-auto" />
      </div>
      <CardMeta item={item} />
    </div>
  );
}

function LinkCard({ item }) {
  return (
    <div className="bg-white rounded-2xl shadow p-2">
      <div className="w-full rounded-xl overflow-hidden aspect-video grid place-items-center border">
        <a href={item.url} target="_blank" rel="noreferrer noopener" className="underline text-sm">Open Link</a>
      </div>
      <CardMeta item={item} />
    </div>
  );
}

function FallbackLinkCard({ item, note }) {
  return (
    <div className="bg-white rounded-2xl shadow p-2">
      <div className="w-full rounded-xl overflow-hidden aspect-video grid place-items-center border">
        <div className="text-center px-3">
          <p className="text-sm font-medium">{note}</p>
          <a href={item.url} target="_blank" rel="noreferrer noopener" className="underline text-sm">Open Link</a>
        </div>
      </div>
      <CardMeta item={item} />
    </div>
  );
}

function CardMeta({ item }) {
  return (
    <div className="px-1 pt-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold leading-tight">{item.title || "Untitled"}</h3>
          <p className="text-xs text-gray-500">{item.category}</p>
        </div>
        <a href={item.url} target="_blank" rel="noreferrer noopener" className="text-xs underline shrink-0">Open</a>
      </div>
      {item.notes && <p className="text-xs mt-1 text-gray-700 whitespace-pre-wrap">{item.notes}</p>}
    </div>
  );
}

function AddItemForm({ categories, onAdd, onCreateCategory }) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [cat, setCat] = useState(categories[0] || "Other");
  const [newCat, setNewCat] = useState("");

  const add = () => {
    if (!url.trim()) return;
    const provider = detectProvider(url.trim());
    const item = {
      id: crypto.randomUUID(),
      url: url.trim(),
      provider,
      title: title.trim(),
      notes: notes.trim(),
      category: cat,
      addedAt: Date.now(),
    };
    onAdd(item);
    setUrl("");
    setTitle("");
    setNotes("");
  };

  const createCat = () => {
    const n = newCat.trim();
    if (!n) return;
    onCreateCategory(n);
    setCat(n);
    setNewCat("");
  };

  return (
    <div className="bg-white rounded-2xl shadow p-4 space-y-3">
      <h2 className="text-lg font-semibold">Add item</h2>
      <div className="grid gap-2">
        <label className="text-xs">Link (TikTok, Instagram, Facebook, YouTube, image, or any URL)</label>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." className="border rounded-xl px-3 py-2" />
      </div>
      <div className="grid gap-2">
        <label className="text-xs">Title (optional)</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="E.g., Cozy L-shaped couch" className="border rounded-xl px-3 py-2" />
      </div>
      <div className="grid gap-2">
        <label className="text-xs">Notes (optional)</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Measurements, price, color, ideas..." className="border rounded-xl px-3 py-2 min-h-[80px]" />
      </div>
      <div className="grid gap-2">
        <label className="text-xs">Category</label>
        <div className="flex gap-2">
          <select value={cat} onChange={(e) => setCat(e.target.value)} className="border rounded-xl px-3 py-2">
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="New category" className="border rounded-xl px-3 py-2 flex-1" />
          <button onClick={createCat} className="px-3 py-2 rounded-xl bg-gray-900 text-white">Add Category</button>
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={add} className="px-4 py-2 rounded-xl bg-gray-900 text-white">Save</button>
        <button onClick={() => { setUrl(""); setTitle(""); setNotes(""); }} className="px-4 py-2 rounded-xl border">Clear</button>
      </div>
    </div>
  );
}

function Toolbar({ categories, activeCategory, setActiveCategory, query, setQuery, onExport, onImport, onReset }) {
  const fileRef = useRef(null);

  const handleImport = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const json = JSON.parse(ev.target.result);
        onImport(json);
      } catch {
        alert("Invalid JSON file");
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="bg-white rounded-2xl shadow p-4 flex flex-wrap items-center gap-3">
      <select value={activeCategory} onChange={(e) => setActiveCategory(e.target.value)} className="border rounded-xl px-3 py-2">
        <option value="All">All rooms</option>
        {categories.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search title/notes" className="border rounded-xl px-3 py-2 min-w-[240px]" />
      <div className="ml-auto flex gap-2">
        <button onClick={onExport} className="px-3 py-2 rounded-xl border">Export JSON</button>
        <input type="file" accept="application/json" className="hidden" ref={fileRef} onChange={handleImport} />
        <button onClick={() => fileRef.current?.click()} className="px-3 py-2 rounded-xl border">Import JSON</button>
        <button onClick={onReset} className="px-3 py-2 rounded-xl border">Reset (Clear All)</button>
      </div>
    </div>
  );
}

function Grid({ items, observe }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {items.map((item) => (
        <CardSwitcher key={item.id} item={item} observe={observe} />
      ))}
    </div>
  );
}

function CardSwitcher({ item, observe }) {
  switch (item.provider) {
    case "youtube":
      return <YouTubeCard item={item} observe={observe} />;
    case "tiktok":
      return <TikTokCard item={item} />;
    case "instagram":
      return <InstagramCard item={item} />;
    case "facebook":
      return <FacebookCard item={item} />;
    case "image":
      return <ImageCard item={item} />;
    default:
      return <LinkCard item={item} />;
  }
}


function useYouTubeAutoplayObserver() {
  const iframes = useRef(new Set());
  const obs = useRef(null);

  useEffect(() => {
    const handle = (entries) => {
      entries.forEach((entry) => {
        const iframe = entry.target;
        const visible = entry.isIntersecting && entry.intersectionRatio > 0.6;
        const cmd = visible ? "playVideo" : "pauseVideo";
        try {
          iframe.contentWindow?.postMessage(
            JSON.stringify({ event: "command", func: cmd, args: [] }),
            "*"
          );
        } catch {}
      });
    };
    obs.current = new IntersectionObserver(handle, { threshold: [0, 0.6, 1] });
    return () => {
      obs.current?.disconnect();
    };
  }, []);

  const observe = (iframeRef) => {
    const el = iframeRef.current;
    if (!el) return;
    // ensure we track
    if (!iframes.current.has(el)) {
      iframes.current.add(el);
      obs.current?.observe(el);
    }
  };

  return observe;
}

export default function App() {
  const [store, setStore] = useLocalStorageState(LS_KEY, {
    categories: DEFAULT_CATEGORIES,
    items: [],
  });
  const [activeCategory, setActiveCategory] = useState("All");
  const [query, setQuery] = useState("");
  const observe = useYouTubeAutoplayObserver();

  // Load embed helpers once
  useEffect(() => {
    // These scripts are injected by the specific cards too — here we simply ensure they're present
    injectScriptOnce("https://www.tiktok.com/embed.js", "tiktok-embed-js");
    injectScriptOnce("https://www.instagram.com/embed.js", "instagram-embed-js");
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return store.items
      .filter((it) => activeCategory === "All" || it.category === activeCategory)
      .filter((it) => !q || (it.title?.toLowerCase().includes(q) || it.notes?.toLowerCase().includes(q)))
      .sort((a, b) => b.addedAt - a.addedAt);
  }, [store.items, activeCategory, query]);

  const onAdd = (item) => setStore((s) => ({ ...s, items: [item, ...s.items] }));

  const onCreateCategory = (name) => setStore((s) => {
    if (s.categories.includes(name)) return s;
    return { ...s, categories: [...s.categories, name] };
  });

  const onExport = () => {
    const blob = new Blob([JSON.stringify(store, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "renovation-moodboard.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const onImport = (json) => {
    if (!json || typeof json !== "object") return;
    setStore({
      categories: Array.isArray(json.categories) && json.categories.length > 0 ? json.categories : DEFAULT_CATEGORIES,
      items: Array.isArray(json.items) ? json.items : [],
    });
  };

  const onReset = () => {
    if (confirm("Clear all items and categories?")) {
      setStore({ categories: DEFAULT_CATEGORIES, items: [] });
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100">
      <header className="sticky top-0 z-10 backdrop-blur bg-white/80 border-b">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center gap-3">
          <div className="text-2xl font-bold">🏡 Renovation Moodboard</div>
          <div className="text-sm text-gray-500">Save ideas for Living Room, Kitchen, Bathroom, Bedroom, Backyard…</div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 grid lg:grid-cols-3 gap-6">
        <section className="lg:col-span-2 space-y-4">
          <Toolbar
            categories={store.categories}
            activeCategory={activeCategory}
            setActiveCategory={setActiveCategory}
            query={query}
            setQuery={setQuery}
            onExport={onExport}
            onImport={onImport}
            onReset={onReset}
          />
          <Grid items={filtered} observe={observe} />
        </section>

        <aside className="space-y-4">
          <AddItemForm categories={store.categories} onAdd={onAdd} onCreateCategory={onCreateCategory} />
          <div className="bg-white rounded-2xl shadow p-4">
            <h3 className="text-base font-semibold mb-2">Tips</h3>
            <ul className="list-disc pl-5 text-sm space-y-1 text-gray-700">
              <li>Paste full post URLs from TikTok/Instagram/Facebook/YouTube — they’ll show inline (Facebook must be a PUBLIC post/video).</li>
              <li>YouTube clips auto‑play (muted) when 60% in view; pause when scrolled away.</li>
              <li>Use <b>Export JSON</b> regularly to back up or move boards between browsers.</li>
              <li>Use categories as rooms (add more as needed: Office, Entryway, Nursery, etc.).</li>
              <li>For images, paste direct links ending with .jpg/.png/.webp/.gif.</li>
            </ul>
          </div>
        </aside>
      </main>

      <footer className="max-w-7xl mx-auto px-4 pb-10 text-xs text-gray-500">
        <p>Local-only, private. No accounts, no servers. Host as a static page if you want access from phone/laptop.</p>
      </footer>
    </div>
  );
}
