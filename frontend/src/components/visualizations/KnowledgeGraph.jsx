import { useEffect, useRef, useState, useMemo } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { forceCollide, forceX, forceY } from 'd3-force';
import Card from '../ui/Card';
import Button from '../ui/Button';
import {
    ArrowsPointingOutIcon,
    MagnifyingGlassIcon,
    XMarkIcon,
    FunnelIcon,
} from '@heroicons/react/24/outline';

const FILTER_OPTIONS = [
    { key: 'all', label: 'All nodes' },
    { key: 'primary', label: '🟢 Primary coverage' },
    { key: 'gaps', label: '🟠 Gaps only' },
];

const KnowledgeGraph = ({ graphData }) => {
    const graphRef = useRef();
    const [dimensions, setDimensions] = useState({ width: 1200, height: 800 });
    const [selectedNode, setSelectedNode] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [filter, setFilter] = useState('all'); // 'all' | 'primary' | 'gaps'

    const hasGaps = useMemo(() => (graphData?.nodes || []).some(n => n.gap), [graphData]);

    // Filter graphData based on active filter
    const filteredGraphData = useMemo(() => {
        if (!graphData) return { nodes: [], links: [] };
        if (filter === 'all') return graphData;

        const keepNodes = new Set(
            graphData.nodes
                .filter(n => {
                    if (filter === 'primary') return !n.gap;
                    if (filter === 'gaps') return n.gap || n.type === 'domain';
                    return true;
                })
                .map(n => n.id)
        );

        return {
            nodes: graphData.nodes.filter(n => keepNodes.has(n.id)),
            links: graphData.links.filter(l => {
                const sid = typeof l.source === 'object' ? l.source.id : l.source;
                const tid = typeof l.target === 'object' ? l.target.id : l.target;
                return keepNodes.has(sid) && keepNodes.has(tid);
            }),
        };
    }, [graphData, filter]);

    useEffect(() => {
        const updateDimensions = () => {
            const container = document.getElementById('graph-container');
            if (container) {
                setDimensions({
                    width: container.offsetWidth,
                    height: Math.max(800, window.innerHeight * 0.75),
                });
            }
        };
        updateDimensions();
        window.addEventListener('resize', updateDimensions);
        setTimeout(() => { graphRef.current?.zoomToFit(400, 120); }, 1000);
        return () => window.removeEventListener('resize', updateDimensions);
    }, []);

    useEffect(() => {
        if (!graphRef.current) return;
        const timer = setTimeout(() => {
            const fg = graphRef.current;
            if (!fg) return;

            fg.d3Force('charge').strength(node => node.type === 'domain' ? -150 : -500).distanceMax(400);
            fg.d3Force('link')
                .distance(link => {
                    const st = typeof link.source === 'object' ? link.source.type : null;
                    const tt = typeof link.target === 'object' ? link.target.type : null;
                    if (st === 'domain' && tt === 'domain') return 80;
                    if (st === 'domain' || tt === 'domain') return 160;
                    return 100;
                })
                .strength(link => {
                    const st = typeof link.source === 'object' ? link.source.type : null;
                    const tt = typeof link.target === 'object' ? link.target.type : null;
                    return (st === 'domain' && tt === 'domain') ? 1.0 : 0.3;
                });
            fg.d3Force('x', forceX().x(0).strength(node => node.type === 'domain' ? 0.3 : 0.02));
            fg.d3Force('y', forceY().y(0).strength(node => node.type === 'domain' ? 0.3 : 0.02));
            fg.d3Force('center', null);
            fg.d3Force('collide', forceCollide().radius(node => Math.sqrt(node.size || 8) * 8 + 5).strength(0.8).iterations(2));
            fg.d3ReheatSimulation();
        }, 500);
        return () => clearTimeout(timer);
    }, [filteredGraphData]);

    useEffect(() => {
        if (!graphRef.current || !searchTerm) return;
        const match = filteredGraphData.nodes.find(n => n.label.toLowerCase().includes(searchTerm.toLowerCase()));
        if (match && match.x !== undefined) {
            graphRef.current.centerAt(match.x, match.y, 1000);
            graphRef.current.zoom(1.5, 1000);
        }
    }, [searchTerm, filteredGraphData]);

    const handleNodeClick = (node) => {
        setSelectedNode(node);
        if (graphRef.current) {
            graphRef.current.centerAt(node.x, node.y, 1000);
            graphRef.current.zoom(1.5, 1000);
        }
    };

    const handleReset = () => {
        graphRef.current?.zoomToFit(400, 120);
        setSelectedNode(null);
        setSearchTerm('');
    };

    const primaryCount = (graphData?.nodes || []).filter(n => !n.gap && n.type !== 'domain').length;
    const gapCount = (graphData?.nodes || []).filter(n => n.gap).length;

    return (
        <div className="space-y-6">
            {/* Header Controls */}
            <Card>
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                    <div>
                        <h2 className="text-2xl font-bold text-slate-800 mb-1">Knowledge Graph</h2>
                        <p className="text-sm text-slate-600">
                            {filteredGraphData.nodes.length} entities • {filteredGraphData.links.length} relationships
                        </p>
                    </div>
                    <div className="flex items-center gap-3 flex-wrap">
                        <div className="relative">
                            <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                            <input
                                type="text"
                                placeholder="Search..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="pl-9 pr-8 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 w-48"
                            />
                            {searchTerm && (
                                <button onClick={() => setSearchTerm('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                                    <XMarkIcon className="w-4 h-4" />
                                </button>
                            )}
                        </div>
                        <Button variant="outline" size="sm" onClick={handleReset}>
                            <ArrowsPointingOutIcon className="w-4 h-4 mr-1" />
                            Reset
                        </Button>
                    </div>
                </div>
            </Card>

            {/* Legend + Filter */}
            <Card className="bg-gradient-to-br from-slate-50 to-emerald-50/20">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    {/* Legend */}
                    <div>
                        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Legend</h3>
                        <div className="flex flex-wrap gap-4">
                            <div className="flex items-center gap-2">
                                <div className="w-4 h-4 rounded-full bg-emerald-500 border-2 border-white shadow-sm" />
                                <span className="text-sm font-semibold text-slate-700">Primary coverage</span>
                                <span className="text-xs text-slate-400 font-medium">({primaryCount})</span>
                            </div>
                            {hasGaps && (
                                <div className="flex items-center gap-2">
                                    <div className="w-4 h-4 rounded-full bg-amber-400 border-2 border-white shadow-sm" />
                                    <span className="text-sm font-semibold text-slate-700">Competitor gap</span>
                                    <span className="text-xs text-slate-400 font-medium">({gapCount} topics competitors have that you don't)</span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Filter buttons */}
                    {hasGaps && (
                        <div className="flex items-center gap-2">
                            <FunnelIcon className="w-4 h-4 text-slate-400 flex-shrink-0" />
                            {FILTER_OPTIONS.map(opt => (
                                <button
                                    key={opt.key}
                                    onClick={() => setFilter(opt.key)}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                        filter === opt.key
                                            ? 'bg-slate-800 text-white shadow-sm'
                                            : 'bg-white border border-slate-200 text-slate-600 hover:border-slate-300'
                                    }`}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </Card>

            {/* Graph Container */}
            <Card className="p-0 overflow-hidden">
                <div id="graph-container" className="bg-white" style={{ width: '100%', height: dimensions.height }}>
                    <ForceGraph2D
                        ref={graphRef}
                        graphData={filteredGraphData}
                        width={dimensions.width}
                        height={dimensions.height}
                        backgroundColor="#ffffff"
                        nodeRelSize={6}
                        nodeVal={node => node.size || 8}
                        nodeColor={node => node.color || '#3b82f6'}
                        nodeLabel={node => node.label}
                        linkColor={link => link.inferred ? '#fde68a' : '#94a3b8'}
                        linkWidth={link => link.inferred ? 1 : 2}
                        linkDashSegments={link => link.inferred ? [4, 4] : null}
                        linkDirectionalArrowLength={6}
                        linkDirectionalArrowRelPos={1}
                        linkDirectionalParticles={0}
                        linkCurvature={0.15}
                        linkLabel={link => link.label || ''}
                        linkCanvasObjectMode={() => 'after'}
                        linkCanvasObject={(link, ctx) => {
                            if (link.label) {
                                const start = link.source;
                                const end = link.target;
                                const textPos = { x: start.x + (end.x - start.x) / 2, y: start.y + (end.y - start.y) / 2 };
                                ctx.font = '10px Inter, Arial, sans-serif';
                                const textWidth = ctx.measureText(link.label).width;
                                ctx.fillStyle = 'rgba(255,255,255,0.95)';
                                ctx.fillRect(textPos.x - textWidth / 2 - 4, textPos.y - 8, textWidth + 8, 16);
                                ctx.textAlign = 'center';
                                ctx.textBaseline = 'middle';
                                ctx.fillStyle = link.inferred ? '#d97706' : '#64748b';
                                ctx.fillText(link.label, textPos.x, textPos.y);
                            }
                        }}
                        nodeCanvasObject={(node, ctx, globalScale) => {
                            const label = node.label || node.id;
                            const size = Math.sqrt(node.size || 8) * 6;
                            const isSearchMatch = searchTerm && label.toLowerCase().includes(searchTerm.toLowerCase());
                            const isGap = node.gap;

                            // Search highlight
                            if (isSearchMatch) {
                                ctx.beginPath();
                                ctx.arc(node.x, node.y, size + 4, 0, 2 * Math.PI);
                                ctx.strokeStyle = '#fbbf24';
                                ctx.lineWidth = 3;
                                ctx.stroke();
                            }

                            // Gap nodes: dashed border
                            if (isGap) {
                                ctx.save();
                                ctx.setLineDash([4, 3]);
                                ctx.beginPath();
                                ctx.arc(node.x, node.y, size + 3, 0, 2 * Math.PI);
                                ctx.strokeStyle = '#f59e0b';
                                ctx.lineWidth = 2;
                                ctx.stroke();
                                ctx.restore();
                            }

                            // Node circle
                            ctx.beginPath();
                            ctx.arc(node.x, node.y, size, 0, 2 * Math.PI);
                            ctx.fillStyle = node.color || '#3b82f6';
                            ctx.fill();

                            // White border
                            ctx.strokeStyle = '#ffffff';
                            ctx.lineWidth = 3;
                            ctx.stroke();

                            // Label
                            ctx.font = `${node.type === 'domain' ? '11px' : '10px'} Inter, Arial, sans-serif`;
                            ctx.textAlign = 'center';
                            ctx.textBaseline = 'middle';
                            ctx.fillStyle = '#ffffff';
                            const words = label.split(' ');
                            const maxWidth = size * 1.6;
                            let lines = [];
                            let currentLine = words[0];
                            for (let i = 1; i < words.length; i++) {
                                const testLine = currentLine + ' ' + words[i];
                                if (ctx.measureText(testLine).width > maxWidth) { lines.push(currentLine); currentLine = words[i]; }
                                else { currentLine = testLine; }
                            }
                            lines.push(currentLine);
                            const lineHeight = 12;
                            const startY = node.y - ((lines.length - 1) * lineHeight) / 2;
                            lines.forEach((line, i) => ctx.fillText(line, node.x, startY + i * lineHeight));
                        }}
                        d3AlphaDecay={0.02}
                        d3VelocityDecay={0.3}
                        warmupTicks={100}
                        cooldownTicks={200}
                        onNodeClick={handleNodeClick}
                        onNodeDragEnd={node => { node.fx = node.x; node.fy = node.y; }}
                    />

                    <div className="text-center py-3 bg-slate-50 border-t border-slate-100">
                        <p className="text-sm text-slate-500">
                            <span className="hidden sm:inline">💡 </span>
                            <span className="font-medium">Click and drag</span> nodes •{' '}
                            <span className="font-medium">Scroll</span> to zoom •{' '}
                            <span className="font-medium">Click</span> for details
                            {hasGaps && <span className="ml-2 text-amber-600 font-semibold">• 🟠 Dashed = competitor gap</span>}
                        </p>
                    </div>
                </div>
                <br></br>
            </Card>

            {/* Selected Node Info */}
            {selectedNode && (
                <Card className="bg-white border-2 border-emerald-200 shadow-xl">
                    <div className="space-y-4">
                        <div className="flex items-start justify-between pb-3 border-b border-slate-200">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full border-2 border-white shadow-md flex items-center justify-center" style={{ backgroundColor: selectedNode.color }}>
                                    <span className="text-white font-bold text-sm">{selectedNode.label.charAt(0).toUpperCase()}</span>
                                </div>
                                <div>
                                    <h3 className="text-xl font-bold text-slate-900">{selectedNode.label}</h3>
                                    <p className="text-sm text-slate-500 capitalize mt-0.5 flex items-center gap-2">
                                        {selectedNode.type} Entity
                                        {selectedNode.gap && (
                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 border border-amber-200 text-amber-700 rounded-full text-xs font-bold">
                                                🟠 Gap — competitor has this
                                            </span>
                                        )}
                                    </p>
                                    {selectedNode.gap && selectedNode.source_url && (
                                        <p className="text-xs text-slate-400 mt-1">From: <span className="font-medium text-slate-600">{selectedNode.source_url}</span></p>
                                    )}
                                </div>
                            </div>
                            <button onClick={() => setSelectedNode(null)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-all">
                                <XMarkIcon className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-2">
                                <div className="bg-blue-50 rounded-lg p-3">
                                    <div className="text-2xl font-bold text-blue-600">
                                        {filteredGraphData.links.filter(l => l.source.id === selectedNode.id || l.target.id === selectedNode.id).length}
                                    </div>
                                    <div className="text-xs text-slate-600 mt-1">Total Links</div>
                                </div>
                                <div className="bg-emerald-50 rounded-lg p-3">
                                    <div className="text-2xl font-bold text-emerald-600">{selectedNode.size || 8}</div>
                                    <div className="text-xs text-slate-600 mt-1">Importance</div>
                                </div>
                            </div>

                            <div>
                                <h4 className="text-sm font-semibold text-slate-700 mb-2">Related Entities</h4>
                                <div className="space-y-2 max-h-40 overflow-y-auto">
                                    {filteredGraphData.links
                                        .filter(l => l.source.id === selectedNode.id || l.target.id === selectedNode.id)
                                        .slice(0, 5)
                                        .map((link, idx) => {
                                            const relatedNode = link.source.id === selectedNode.id ? link.target : link.source;
                                            return (
                                                <div key={idx} className="flex items-center gap-2 p-2 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer" onClick={() => handleNodeClick(relatedNode)}>
                                                    <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: relatedNode.color }} />
                                                    <div className="flex-1 min-w-0">
                                                        <div className="text-sm font-medium text-slate-900 truncate">{relatedNode.label}</div>
                                                        {link.label && <div className="text-xs text-slate-500 truncate">{link.label}</div>}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                </div>
                            </div>

                            <div className="pt-3 border-t border-slate-200">
                                <div className="flex items-center justify-between text-xs text-slate-500">
                                    <span>Node ID: {selectedNode.id}</span>
                                    <span className="capitalize">{selectedNode.type}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </Card>
            )}
        </div>
    );
};

export default KnowledgeGraph;
