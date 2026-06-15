import InsightTablePage, { num, pos, PosDelta } from '../components/seo/InsightTablePage';
import { DecaySummary } from '../components/seo/InsightSummaries';

const Url = (v) => (
    <a href={v} target="_blank" rel="noreferrer"
        className="text-[13px] font-semibold text-slate-700 hover:text-emerald-600 truncate block max-w-[420px]" title={v}>
        {v}
    </a>
);

export default function ContentDecayPage() {
    return (
        <InsightTablePage
            title="Content Decay"
            subtitle="Pages losing clicks vs the previous period — catch decline early"
            emptyText="No declining pages found — nothing is decaying this period. 🎉"
            cachePrefix="decay"
            csvName="content_decay.csv"
            endpoint={(prop, days) => `/auth/gsc/content-decay/${encodeURIComponent(prop)}?days=${days}`}
            responseKey="pages"
            searchKey="page"
            summary={DecaySummary}
            defaultSort={{ key: 'clicks_lost', dir: 'desc' }}
            columns={[
                { key: 'page', label: 'Page', render: r => Url(r.page) },
                { key: 'prev_clicks', label: 'Prev Clicks', align: 'right', render: r => <span className="text-[13px] font-bold text-slate-500">{num(r.prev_clicks)}</span> },
                { key: 'clicks', label: 'Now', align: 'right', render: r => <span className="text-[13px] font-bold text-slate-800">{num(r.clicks)}</span> },
                { key: 'clicks_lost', label: 'Clicks Lost', align: 'right', render: r => <span className="text-[13px] font-black text-rose-600">−{num(r.clicks_lost)}</span> },
                { key: 'clicks_change_pct', label: 'Change', align: 'right', render: r => <span className="text-[13px] font-bold text-rose-500">{r.clicks_change_pct}%</span> },
                { key: 'position', label: 'Position', align: 'right', render: r => <span className="text-[13px] font-bold text-slate-700">{pos(r.position)}</span> },
                { key: 'position_change', label: 'Pos Δ', align: 'right', render: r => <PosDelta value={r.position_change} /> },
            ]}
        />
    );
}
