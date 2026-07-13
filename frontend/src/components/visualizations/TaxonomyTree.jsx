import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { hierarchy, tree as d3tree } from 'd3-hierarchy';
import { linkHorizontal } from 'd3-shape';
import { select } from 'd3-selection';
import { zoom, zoomIdentity } from 'd3-zoom';
import {
    ArrowsPointingOutIcon, ArrowPathIcon, XMarkIcon,
    MagnifyingGlassIcon, ArrowsPointingInIcon, ArrowDownTrayIcon, PlusIcon,
} from '@heroicons/react/24/outline';

/* d3-zoom pulls in d3-selection/d3-transition transitively. */

const LEVEL_COLORS = { 0: '#334155', 1: '#4F46E5', 2: '#10B981', 3: '#F59E0B' };
const LEVEL_LABEL = { 0: 'Root', 1: 'Category', 2: 'Subcategory', 3: 'Topic' };
const ROW = 30;       // vertical spacing between sibling rows
const COL = 210;      // horizontal spacing between depth levels
const PILL_H = 24;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* Nested {name, level, color, children} tree from the flat taxonomy list. */
function buildRoot(taxonomy) {
    if (!taxonomy || taxonomy.length === 0) return null;
    const byKey = new Map(taxonomy.map((n) => [`${n.level}:${n.name}`, n]));
    const seen = new Set();
    const make = (n) => {
        const key = `${n.level}:${n.name}`;
        if (seen.has(key)) return null;
        seen.add(key);
        const kids = (n.children || [])
            .map((c) => byKey.get(`${n.level + 1}:${c}`)).filter(Boolean).map(make).filter(Boolean);
        return { name: n.name, level: n.level, color: n.color, children: kids };
    };
    const l1 = taxonomy.filter((n) => n.level === 1).map(make).filter(Boolean);
    if (l1.length === 0) return null;
    return { name: 'Topical Map', level: 0, color: LEVEL_COLORS[0], children: l1 };
}

const pillWidth = (name, level) =>
    level === 0 ? 20 : Math.min(180, Math.max(58, name.length * (level === 1 ? 7.6 : 6.8) + 22));
const truncate = (name) => (name.length > 24 ? name.slice(0, 23) + '…' : name);

const TaxonomyTree = ({ taxonomy }) => {
    const containerRef = useRef(null);
    const gRef = useRef(null);
    const svgRef = useRef(null);
    const zoomRef = useRef(null);
    const [size, setSize] = useState({ w: 900, h: 560 });
    const [fullscreen, setFullscreen] = useState(false);
    const [collapsed, setCollapsed] = useState(() => new Set());
    const [hovered, setHovered] = useState(null);
    const [tip, setTip] = useState(null); // { name, level, x, y }
    const [query, setQuery] = useState('');

    const root = useMemo(() => buildRoot(taxonomy), [taxonomy]);

    // All node ids + the depth-1 (category) ids — used by expand/collapse-all.
    const ids = useMemo(() => {
        if (!root) return { categories: [] };
        const h = hierarchy(root);
        h.each((d) => { d.__id = d.ancestors().map((a) => a.data.name).reverse().join('›'); });
        return { categories: h.descendants().filter((d) => d.depth === 1 && d.children).map((d) => d.__id) };
    }, [root]);

    // Responsive sizing.
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const update = () => setSize({
            w: fullscreen ? Math.min(window.innerWidth - 80, 1160) : (el.offsetWidth || 900),
            h: fullscreen ? Math.max(window.innerHeight - 150, 460) : 560,
        });
        update();
        const ro = new ResizeObserver(update);
        ro.observe(el);
        window.addEventListener('resize', update);
        return () => { ro.disconnect(); window.removeEventListener('resize', update); };
    }, [fullscreen]);

    // Layout (recomputed when collapse state changes).
    const layout = useMemo(() => {
        if (!root) return null;
        const h = hierarchy(root);
        h.each((d) => { d.__id = d.ancestors().map((a) => a.data.name).reverse().join('›'); });
        h.each((d) => {
            if (collapsed.has(d.__id) && d.children) { d._childCount = d.children.length; d.children = null; }
        });
        d3tree().nodeSize([ROW, COL])(h);
        const nodes = h.descendants();
        const links = h.links();
        const xs = nodes.map((n) => n.x);
        const ys = nodes.map((n) => n.y);
        return {
            nodes, links,
            minX: Math.min(...xs), maxX: Math.max(...xs),
            minY: Math.min(...ys), maxY: Math.max(...ys),
        };
    }, [root, collapsed]);

    const linkGen = useMemo(() => linkHorizontal().x((d) => d.y).y((d) => d.x), []);

    // Search matches (over ALL node names, regardless of collapse).
    const matchIds = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q || !layout) return null;
        const s = new Set();
        layout.nodes.forEach((n) => { if (n.data.name.toLowerCase().includes(q)) s.add(n.__id); });
        return s;
    }, [query, layout]);

    // Hover branch (ancestors + descendants) for highlight — only when not searching.
    const branchIds = useMemo(() => {
        if (matchIds || !hovered || !layout) return null;
        const node = layout.nodes.find((n) => n.__id === hovered);
        if (!node) return null;
        const s = new Set();
        node.ancestors().forEach((a) => s.add(a.__id));
        node.descendants().forEach((d) => s.add(d.__id));
        return s;
    }, [hovered, layout, matchIds]);

    // Fit the tree into the viewport.
    const fit = useCallback((animate) => {
        if (!layout || !svgRef.current || !zoomRef.current) return;
        const pad = 60;
        const treeW = (layout.maxY - layout.minY) + 200;
        const treeH = (layout.maxX - layout.minX) + PILL_H * 2;
        const scale = Math.min(1.1, Math.min((size.w - pad) / treeW, (size.h - pad) / treeH));
        const tx = pad / 2 - layout.minY * scale;
        const ty = size.h / 2 - ((layout.minX + layout.maxX) / 2) * scale;
        const t = zoomIdentity.translate(tx, ty).scale(scale);
        const sel = select(svgRef.current);
        if (animate && typeof sel.transition === 'function') sel.transition().duration(450).call(zoomRef.current.transform, t);
        else sel.call(zoomRef.current.transform, t);
    }, [layout, size]);

    // Wire zoom + fit.
    useEffect(() => {
        if (!svgRef.current || !gRef.current) return;
        const svg = select(svgRef.current);
        const g = select(gRef.current);
        const zb = zoom().scaleExtent([0.3, 2.5]).on('zoom', (e) => g.attr('transform', e.transform));
        zoomRef.current = zb;
        svg.call(zb);
        fit(false);
        return () => svg.on('.zoom', null);
    }, [layout, size]); // eslint-disable-line react-hooks/exhaustive-deps

    // When a search yields matches, expand everything so the matches are visible.
    useEffect(() => {
        if (query.trim() && matchIds && matchIds.size) setCollapsed(new Set());
    }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

    const toggle = useCallback((node) => {
        const hasKids = node.children || node._childCount;
        if (!hasKids || node.depth === 0) return;
        setCollapsed((prev) => {
            const next = new Set(prev);
            next.has(node.__id) ? next.delete(node.__id) : next.add(node.__id);
            return next;
        });
    }, []);

    const expandAll = useCallback(() => setCollapsed(new Set()), []);
    const collapseAll = useCallback(() => setCollapsed(new Set(ids.categories)), [ids]);

    useEffect(() => {
        if (!fullscreen) return;
        const onKey = (e) => e.key === 'Escape' && setFullscreen(false);
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [fullscreen]);

    // ── Full-tree PNG export (renders the whole current tree, not the zoomed view) ──
    const downloadPng = useCallback(() => {
        if (!layout) return;
        const P = 44, LABEL_ROOM = 210;
        const offX = -layout.minY + P;
        const offY = -layout.minX + P;
        const W = (layout.maxY - layout.minY) + LABEL_ROOM + P * 2;
        const H = (layout.maxX - layout.minX) + P * 2 + PILL_H * 2;

        const linkStr = layout.links
            .map((l) => `<path d="${linkGen(l)}" fill="none" stroke="#cbd5e1" stroke-width="1.6"/>`).join('');
        const nodeStr = layout.nodes.map((n) => {
            const color = n.data.color || LEVEL_COLORS[n.depth] || '#64748b';
            if (n.depth === 0) {
                return `<g transform="translate(${n.y},${n.x})"><circle r="10" fill="${color}" stroke="#fff" stroke-width="2"/>`
                    + `<text x="16" y="4" font-size="12" font-weight="800" fill="#334155" font-family="sans-serif">${esc(n.data.name)}</text></g>`;
            }
            const pw = pillWidth(n.data.name, n.depth);
            const collapsedHere = n._childCount && !n.children;
            const badge = collapsedHere
                ? `<g transform="translate(${pw + 9},0)"><circle r="9" fill="#fff" stroke="${color}" stroke-width="1.5"/>`
                  + `<text y="3.5" font-size="9" font-weight="800" fill="${color}" text-anchor="middle" font-family="sans-serif">${n._childCount}</text></g>`
                : '';
            return `<g transform="translate(${n.y},${n.x})"><rect x="0" y="${-PILL_H / 2}" rx="7" width="${pw}" height="${PILL_H}" fill="${color}"/>`
                + `<text x="11" y="4" font-size="${n.depth === 1 ? 12 : 11}" font-weight="${n.depth === 1 ? 700 : 500}" fill="#fff" font-family="sans-serif">${esc(truncate(n.data.name))}</text>${badge}</g>`;
        }).join('');

        const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
            + `<rect width="${W}" height="${H}" fill="#ffffff"/><g transform="translate(${offX},${offY})">${linkStr}${nodeStr}</g></svg>`;

        const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
            const scale = 2;
            const canvas = document.createElement('canvas');
            canvas.width = W * scale; canvas.height = H * scale;
            const ctx = canvas.getContext('2d');
            ctx.scale(scale, scale);
            ctx.drawImage(img, 0, 0);
            URL.revokeObjectURL(url);
            canvas.toBlob((png) => {
                if (!png) return;
                const a = document.createElement('a');
                a.href = URL.createObjectURL(png);
                a.download = 'topical-map.png';
                a.click();
                setTimeout(() => URL.revokeObjectURL(a.href), 1000);
            }, 'image/png');
        };
        img.src = url;
    }, [layout, linkGen]);

    if (!layout) {
        return <div className="p-10 text-center text-sm text-slate-400 bg-slate-50">Not enough taxonomy data to visualize.</div>;
    }

    const { w, h } = size;
    const btn = 'w-8 h-8 rounded-lg bg-white/90 border border-slate-200 shadow-sm flex items-center justify-center text-slate-500 hover:text-slate-800 hover:bg-white transition-colors';

    const svg = (
        <svg ref={svgRef} width={w} height={h} className="block cursor-grab active:cursor-grabbing" style={{ touchAction: 'none' }}>
            <defs>
                <radialGradient id="tt2-bg" cx="30%" cy="0%" r="120%">
                    <stop offset="0%" stopColor="#ffffff" />
                    <stop offset="100%" stopColor="#eef2f7" />
                </radialGradient>
                <filter id="tt2-shadow" x="-40%" y="-40%" width="180%" height="180%">
                    <feDropShadow dx="0" dy="1" stdDeviation="1.2" floodColor="#0f172a" floodOpacity="0.16" />
                </filter>
            </defs>
            <rect width={w} height={h} fill="url(#tt2-bg)" />
            <g ref={gRef}>
                {layout.links.map((lnk, i) => {
                    const dim = matchIds ? false : (branchIds && !branchIds.has(lnk.target.__id));
                    return (
                        <path key={i} d={linkGen(lnk)} fill="none"
                              stroke={dim ? '#e8edf3' : '#cbd5e1'} strokeWidth={dim ? 1 : 1.6}
                              opacity={matchIds ? 0.5 : 1} style={{ transition: 'stroke .2s, opacity .2s' }} />
                    );
                })}
                {layout.nodes.map((n) => {
                    const color = n.data.color || LEVEL_COLORS[n.depth] || '#64748b';
                    const collapsedHere = n._childCount && !n.children;
                    const hasKids = !!(n.children || n._childCount);
                    const isMatch = matchIds ? matchIds.has(n.__id) : null;
                    const dim = matchIds ? !isMatch : (branchIds && !branchIds.has(n.__id));
                    if (n.depth === 0) {
                        return (
                            <g key={n.__id} transform={`translate(${n.y},${n.x})`} opacity={dim ? 0.25 : 1}>
                                <circle r={10} fill={color} stroke="#fff" strokeWidth={2} filter="url(#tt2-shadow)" />
                                <text x={16} y={4} fontSize={12} fontWeight={800} fill="#334155">{n.data.name}</text>
                            </g>
                        );
                    }
                    const pw = pillWidth(n.data.name, n.depth);
                    return (
                        <g key={n.__id} transform={`translate(${n.y},${n.x})`} opacity={dim ? 0.22 : 1}
                           style={{ transition: 'opacity .2s', cursor: hasKids ? 'pointer' : 'default' }}
                           onMouseEnter={(e) => { setHovered(n.__id); const r = containerRef.current.getBoundingClientRect(); setTip({ name: n.data.name, level: n.depth, x: e.clientX - r.left, y: e.clientY - r.top }); }}
                           onMouseMove={(e) => { const r = containerRef.current.getBoundingClientRect(); setTip((t) => t && { ...t, x: e.clientX - r.left, y: e.clientY - r.top }); }}
                           onMouseLeave={() => { setHovered(null); setTip(null); }}
                           onClick={() => toggle(n)}>
                            {isMatch && <rect x={-3} y={-PILL_H / 2 - 3} rx={9} width={pw + 6} height={PILL_H + 6} fill="none" stroke={color} strokeWidth={2.5} opacity={0.55} />}
                            <rect x={0} y={-PILL_H / 2} rx={7} width={pw} height={PILL_H} fill={color} filter="url(#tt2-shadow)" />
                            <text x={11} y={4} fontSize={n.depth === 1 ? 12 : 11} fontWeight={n.depth === 1 ? 700 : 500}
                                  fill="#fff" style={{ pointerEvents: 'none', userSelect: 'none' }}>
                                {truncate(n.data.name)}
                            </text>
                            {collapsedHere && (
                                <g transform={`translate(${pw + 9},0)`}>
                                    <circle r={9} fill="#fff" stroke={color} strokeWidth={1.5} />
                                    <text y={3.5} fontSize={9} fontWeight={800} fill={color} textAnchor="middle" style={{ pointerEvents: 'none' }}>{n._childCount}</text>
                                </g>
                            )}
                        </g>
                    );
                })}
            </g>
        </svg>
    );

    const header = (
        <div className="absolute top-0 left-0 right-0 flex items-center justify-between gap-2 px-3 py-2.5 z-10 pointer-events-none">
            <div className="relative pointer-events-auto">
                <MagnifyingGlassIcon className="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search topics…"
                    className="w-40 sm:w-56 pl-8 pr-7 py-1.5 rounded-lg bg-white/95 border border-slate-200 shadow-sm text-sm outline-none focus:border-indigo-300"
                />
                {query && (
                    <button onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                        <XMarkIcon className="w-3.5 h-3.5" />
                    </button>
                )}
            </div>
            <div className="flex items-center gap-2 pointer-events-auto">
                <button onClick={expandAll} title="Expand all" className={btn}><PlusIcon className="w-4 h-4" /></button>
                <button onClick={collapseAll} title="Collapse all" className={btn}><ArrowsPointingInIcon className="w-4 h-4" /></button>
                <button onClick={() => fit(true)} title="Fit to view" className={btn}><ArrowPathIcon className="w-4 h-4" /></button>
                <button onClick={downloadPng} title="Download PNG" className={btn}><ArrowDownTrayIcon className="w-4 h-4" /></button>
                <button onClick={() => setFullscreen((f) => !f)} title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'} className={btn}>
                    {fullscreen ? <XMarkIcon className="w-4 h-4" /> : <ArrowsPointingOutIcon className="w-4 h-4" />}
                </button>
            </div>
        </div>
    );

    const legend = (
        <div className="absolute bottom-3 left-3 flex items-center gap-3 z-10 bg-white/85 backdrop-blur px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
            {[[1, 'Category'], [2, 'Subcategory'], [3, 'Topic']].map(([lvl, label]) => (
                <div key={lvl} className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: LEVEL_COLORS[lvl] }} />
                    <span className="text-[11px] font-semibold text-slate-500">{label}</span>
                </div>
            ))}
            <span className="text-[11px] text-slate-400 hidden sm:inline">· click a node to collapse/expand</span>
        </div>
    );

    const tooltip = tip && (
        <div className="absolute z-20 pointer-events-none px-2.5 py-1.5 rounded-lg bg-slate-900 text-white shadow-lg max-w-[260px]"
             style={{ left: Math.min(tip.x + 12, w - 220), top: Math.max(tip.y - 44, 6) }}>
            <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: LEVEL_COLORS[tip.level] === '#0f172a' ? '#93c5fd' : '#c7d2fe' }}>{LEVEL_LABEL[tip.level]}</p>
            <p className="text-[12px] font-semibold leading-snug">{tip.name}</p>
        </div>
    );

    const inner = <>{header}{legend}{tooltip}{svg}</>;

    if (fullscreen) {
        return (
            <div className="fixed inset-0 z-[100] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4"
                 onClick={() => setFullscreen(false)}>
                <div ref={containerRef} className="relative w-full max-w-6xl bg-white rounded-2xl shadow-2xl overflow-hidden"
                     onClick={(e) => e.stopPropagation()}>
                    {inner}
                </div>
            </div>
        );
    }

    return (
        <div ref={containerRef} className="relative w-full rounded-xl overflow-hidden border border-slate-200">
            {inner}
        </div>
    );
};

export default TaxonomyTree;
