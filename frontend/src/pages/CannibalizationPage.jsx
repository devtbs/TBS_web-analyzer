import InsightTablePage, { num, pos } from '../components/seo/InsightTablePage';
import { CannibalSummary } from '../components/seo/InsightSummaries';

const competingPage = (child) => (
    <div className="flex items-center justify-between gap-4 text-[12px] py-1 border-b border-slate-100 last:border-0">
        <a href={child.page} target="_blank" rel="noreferrer"
            className="text-slate-600 hover:text-emerald-600 truncate max-w-[360px]" title={child.page}>
            {child.page}
        </a>
        <div className="flex items-center gap-4 flex-shrink-0 font-bold">
            <span className="text-amber-600">pos {pos(child.position)}</span>
            <span className="text-slate-700">{num(child.clicks)} clicks</span>
            <span className="text-slate-500">{num(child.impressions)} impr</span>
        </div>
    </div>
);

export default function CannibalizationPage() {
    return (
        <InsightTablePage
            title="Keyword Cannibalization"
            subtitle="Keywords where two or more of your pages compete — splitting clicks"
            emptyText="No cannibalization found — each keyword is handled by a single page. 👍"
            cachePrefix="cannibal"
            csvName="cannibalization.csv"
            endpoint={(prop, days) => `/auth/gsc/cannibalization/${encodeURIComponent(prop)}?days=${days}`}
            responseKey="queries"
            searchKey="query"
            summary={CannibalSummary}
            defaultSort={{ key: 'total_impressions', dir: 'desc' }}
            expand={{ childKey: 'pages', render: competingPage }}
            columns={[
                { key: 'query', label: 'Keyword' },
                { key: 'page_count', label: 'Competing Pages', align: 'right', render: r => <span className="text-[13px] font-black text-rose-600">{r.page_count}</span> },
                { key: 'total_clicks', label: 'Total Clicks', align: 'right', render: r => <span className="text-[13px] font-bold text-slate-800">{num(r.total_clicks)}</span> },
                { key: 'total_impressions', label: 'Total Impressions', align: 'right', render: r => <span className="text-[13px] font-bold text-slate-700">{num(r.total_impressions)}</span> },
            ]}
        />
    );
}
