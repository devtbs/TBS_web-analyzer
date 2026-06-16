import InsightTablePage, { num, pct, pos } from '../components/seo/InsightTablePage';
import { CtrSummary } from '../components/seo/InsightSummaries';

const PositionPill = (v) => (
    <span className="inline-flex items-center justify-center min-w-[34px] px-2 py-0.5 rounded-full bg-slate-100 text-[12px] font-bold text-slate-600">
        {pos(v)}
    </span>
);

const VsExpected = (v) => {
    if (v == null) return <span className="text-slate-300">—</span>;
    const up = v >= 0;
    return (
        <span className={`text-[13px] font-bold ${up ? 'text-emerald-600' : 'text-rose-500'}`}>
            {up ? '+' : ''}{v.toFixed(1)}%
        </span>
    );
};

export default function CtrOpportunitiesPage() {
    return (
        <InsightTablePage
            title="CTR Analysis"
            subtitle="Your click-through rate vs the benchmark for each position"
            emptyText="No query data found for this period."
            cachePrefix="ctr_analysis"
            csvName="ctr_analysis.csv"
            endpoint={(prop, days) => `/auth/gsc/ctr-opportunities/${encodeURIComponent(prop)}?days=${days}`}
            responseKey="queries"
            searchKey="query"
            summary={CtrSummary}
            defaultSort={{ key: 'vs_expected', dir: 'asc' }}
            columns={[
                { key: 'query', label: 'Query' },
                { key: 'position', label: 'Position', align: 'right', render: r => PositionPill(r.position) },
                { key: 'ctr', label: 'CTR', align: 'right', render: r => <span className="text-[13px] font-bold text-slate-800">{pct(r.ctr)}</span> },
                { key: 'expected_ctr', label: 'Expected', align: 'right', render: r => <span className="text-[13px] font-bold text-slate-400">{pct(r.expected_ctr)}</span> },
                { key: 'vs_expected', label: 'vs Expected', align: 'right', render: r => VsExpected(r.vs_expected) },
                { key: 'clicks', label: 'Clicks', align: 'right', render: r => <span className="text-[13px] font-bold text-slate-700">{num(r.clicks)}</span> },
                { key: 'impressions', label: 'Impressions', align: 'right', render: r => <span className="text-[13px] font-bold text-slate-700">{num(r.impressions)}</span> },
            ]}
        />
    );
}
