import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { hierarchy, tree as d3tree } from 'd3-hierarchy';
import { linkHorizontal } from 'd3-shape';
import { select } from 'd3-selection';
import { zoom, zoomIdentity } from 'd3-zoom';
import { ArrowsPointingOutIcon, ArrowPathIcon, XMarkIcon } from '@heroicons/react/24/outline';

/* d3-zoom pulls in d3-selection/d3-transition transitively. */

const LEVEL_COLORS = { 0: '#334155', 1: '#4F46E5', 2: '#10B981', 3: '#F59E0B' };
const ROW = 30;       // vertical spacing between sibling rows
const COL = 210;      // horizontal spacing between depth levels
const PILL_H = 24;

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

const TaxonomyTree = ({ taxonomy }) => {
    const containerRef = useRef(null);
    const gRef = useRef(null);
    const svgRef = useRef(null);
    const zoomRef = useRef(null);
    const [size, setSize] = useState({ w: 900, h: 560 });
    const [fullscreen, setFullscreen] = useState(false);
    const [collapsed, setCollapsed] = useState(() => new Set());
    const [hovered, setHovered] = useState(null);

    const root = useMemo(() => buildRoot(taxonomy), [taxonomy]);

    // Responsive sizing.
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const update = () => setSize({
            w: fullscreen ? Math.min(window.innerWidth - 80, 1160) : (el.offsetWidth || 900),
            h: fullscreen ? Math.max(window.innerHeight - 130, 480) : 560,
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
        // Apply collapse: hide children of collapsed nodes (keep the count).
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

    const activeIds = useMemo(() => {
        if (!hovered || !layout) return null;
        const node = layout.nodes.find((n) => n.__id === hovered);
        if (!node) return null;
        const ids = new Set();
        node.ancestors().forEach((a) => ids.add(a.__id));
        node.descendants().forEach((d) => ids.add(d.__id));
        return ids;
    }, [hovered, layout]);

    // Fit the tree into the viewport whenever layout or size changes.
    const fit = useCallback((animate) => {
        if (!layout || !svgRef.current || !zoomRef.current) return;
        const pad = 60;
        const treeW = (layout.maxY - layout.minY) + 200; // + label room on the right
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

    const toggle = useCallback((node) => {
        const hasKids = node.children || node._childCount;
        if (!hasKids || node.depth === 0) return;
        setCollapsed((prev) => {
            const next = new Set(prev);
            next.has(node.__id) ? next.delete(node.__id) : next.add(node.__id);
            return next;
        });
    }, []);

    useEffect(() => {
        if (!fullscreen) return;
        const onKey = (e) => e.key === 'Escape' && setFullscreen(false);
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [fullscreen]);

    if (!layout) {
        return <div className="p-10 text-center text-sm text-slate-400 bg-slate-50">Not enough taxonomy data to visualize.</div>;
    }

    const { w, h } = size;

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
                {/* Links */}
                {layout.links.map((lnk, i) => {
                    const on = !activeIds || activeIds.has(lnk.target.__id);
                    return (
                        <path key={i} d={linkGen(lnk)} fill="none"
                              stroke={on ? '#cbd5e1' : '#e8edf3'} strokeWidth={on ? 1.6 : 1}
                              style={{ transition: 'stroke .2s' }} />
                    );
                })}
                {/* Nodes */}
                {layout.nodes.map((n) => {
                    const on = !activeIds || activeIds.has(n.__id);
                    const color = n.data.color || LEVEL_COLORS[n.depth] || '#64748b';
                    const collapsedHere = n._childCount && !n.children;
                    const hasKids = !!(n.children || n._childCount);
                    if (n.depth === 0) {
                        return (
                            <g key={n.__id} transform={`translate(${n.y},${n.x})`}>
                                <circle r={10} fill={color} stroke="#fff" strokeWidth={2} filter="url(#tt2-shadow)" />
                                <text x={16} y={4} fontSize={12} fontWeight={800} fill="#334155">{n.data.name}</text>
                            </g>
                        );
                    }
                    const pw = pillWidth(n.data.name, n.depth);
                    return (
                        <g key={n.__id} transform={`translate(${n.y},${n.x})`} opacity={on ? 1 : 0.35}
                           style={{ transition: 'opacity .2s', cursor: hasKids ? 'pointer' : 'default' }}
                           onMouseEnter={() => setHovered(n.__id)} onMouseLeave={() => setHovered(null)}
                           onClick={() => toggle(n)}>
                            <rect x={0} y={-PILL_H / 2} rx={7} width={pw} height={PILL_H}
                                  fill={color} filter="url(#tt2-shadow)" />
                            <text x={11} y={4} fontSize={n.depth === 1 ? 12 : 11}
                                  fontWeight={n.depth === 1 ? 700 : 500} fill="#fff"
                                  style={{ pointerEvents: 'none', userSelect: 'none' }}>
                                {n.data.name.length > 24 ? n.data.name.slice(0, 23) + '…' : n.data.name}
                            </text>
                            {collapsedHere && (
                                <g transform={`translate(${pw + 9},0)`}>
                                    <circle r={9} fill="#fff" stroke={color} strokeWidth={1.5} />
                                    <text y={3.5} fontSize={9} fontWeight={800} fill={color} textAnchor="middle"
                                          style={{ pointerEvents: 'none' }}>{n._childCount}</text>
                                </g>
                            )}
                        </g>
                    );
                })}
            </g>
        </svg>
    );

    const controls = (
        <div className="absolute top-3 right-3 flex items-center gap-2 z-10">
            <button onClick={() => fit(true)} title="Fit to view"
                    className="w-8 h-8 rounded-lg bg-white/90 border border-slate-200 shadow-sm flex items-center justify-center text-slate-500 hover:text-slate-800 hover:bg-white">
                <ArrowPathIcon className="w-4 h-4" />
            </button>
            <button onClick={() => setFullscreen((f) => !f)} title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                    className="w-8 h-8 rounded-lg bg-white/90 border border-slate-200 shadow-sm flex items-center justify-center text-slate-500 hover:text-slate-800 hover:bg-white">
                {fullscreen ? <XMarkIcon className="w-4 h-4" /> : <ArrowsPointingOutIcon className="w-4 h-4" />}
            </button>
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

    if (fullscreen) {
        return (
            <div className="fixed inset-0 z-[100] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4"
                 onClick={() => setFullscreen(false)}>
                <div ref={containerRef} className="relative w-full max-w-6xl bg-white rounded-2xl shadow-2xl overflow-hidden"
                     onClick={(e) => e.stopPropagation()}>
                    {controls}{legend}{svg}
                </div>
            </div>
        );
    }

    return (
        <div ref={containerRef} className="relative w-full rounded-xl overflow-hidden border border-slate-200">
            {controls}{legend}{svg}
        </div>
    );
};

export default TaxonomyTree;
