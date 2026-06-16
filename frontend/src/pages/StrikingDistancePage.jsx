import InsightTablePage, { num, pct, pos } from '../components/seo/InsightTablePage';
import { StrikingSummary } from '../components/seo/InsightSummaries';

const Url = (v) => (
    <a href={v} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
        className="text-[12px] text-slate-500 hover:text-emerald-600 truncate block max-w-[280px]" title={v}>
        {v}
    </a>
);

export default function StrikingDistancePage() {
    return (
        <InsightTablePage
            title="Striking Distance"
            subtitle="Keywords at positions 4–20 — one push from page one"
            emptyText="No striking-distance keywords found. Great — most of your keywords are already on page one!"
            cachePrefix="striking"
            csvName="striking_distance.csv"
            endpoint={(prop, days) => `/auth/gsc/striking-distance/${encodeURIComponent(prop)}?days=${days}`}
            responseKey="keywords"
            searchKey="query"
            summary={StrikingSummary}
            defaultSort={{ key: 'impressions', dir: 'desc' }}
            columns={[
                { key: 'query', label: 'Keyword' },
                { key: 'page', label: 'Page', render: r => Url(r.page) },
                { key: 'position', label: 'Position', align: 'right', render: r => <span className="text-[13px] font-bold text-amber-600">{pos(r.position)}</span> },
                { key: 'impressions', label: 'Impressions', align: 'right', render: r => <span className="text-[13px] font-bold text-slate-800">{num(r.impressions)}</span> },
                { key: 'clicks', label: 'Clicks', align: 'right', render: r => <span className="text-[13px] font-bold text-slate-700">{num(r.clicks)}</span> },
                { key: 'ctr', label: 'CTR', align: 'right', render: r => <span className="text-[13px] font-bold text-slate-600">{pct(r.ctr)}</span> },
                { key: 'potential_clicks', label: 'Potential +Clicks', align: 'right', render: r => <span className="text-[13px] font-black text-emerald-600">+{num(r.potential_clicks)}</span> },
            ]}
        />
    );
}
