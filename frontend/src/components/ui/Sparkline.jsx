// A small, static chart keeps the portfolio independent of the analytics chart bundle.
export default function Sparkline({ values, label }) {
    const numbers = values.map(v => Number.isFinite(Number(v)) ? Number(v) : 0);
    const min = Math.min(0, ...numbers);
    const range = Math.max(...numbers) - min || 1;
    const points = numbers.map((v, i) => `${4 + i * 292 / Math.max(1, numbers.length - 1)},${46 - (v - min) / range * 40}`).join(' ');
    return <svg viewBox="0 0 300 50" preserveAspectRatio="none" className="h-full w-full" role="img" aria-label={label}>
        <polygon points={`4,50 ${points} 296,50`} fill="#d1fae5" />
        <polyline points={points} fill="none" stroke="#059669" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>;
}
