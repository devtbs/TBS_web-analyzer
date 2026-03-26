import { QuestionMarkCircleIcon, BookOpenIcon, ChatBubbleLeftRightIcon, EnvelopeIcon } from '@heroicons/react/24/outline';

const FAQ = [
    {
        q: 'How do I start a new analysis?',
        a: 'Go to New Analysis, enter a website URL, choose your data source (Search Console or Manual), then click Analyze.',
    },
    {
        q: 'How long does an analysis take?',
        a: 'Most analyses complete within 30–60 seconds depending on the size of the website and number of pages crawled.',
    },
    {
        q: 'Can I re-run an analysis?',
        a: 'Yes! Open any past analysis from History and click "Re-analyze" to run it again with fresh data.',
    },
    {
        q: 'How do I export results?',
        a: 'On the Results page, use the Export button in the top-right corner to download as CSV or PDF.',
    },
];

const RESOURCES = [
    { icon: BookOpenIcon,             label: 'Documentation',   desc: 'Full API & feature reference',  href: '#' },
    { icon: ChatBubbleLeftRightIcon,  label: 'Community',       desc: 'Ask questions & share tips',    href: '#' },
    { icon: EnvelopeIcon,             label: 'Contact Support', desc: 'Get help from our team',        href: '#' },
];

export default function Help() {
    return (
        <div className="min-h-screen bg-[#0f0f0f] text-white p-8">
            {/* Header */}
            <div className="mb-8">
                <div className="flex items-center gap-3 mb-1">
                    <QuestionMarkCircleIcon className="w-6 h-6 text-[#888]" />
                    <h1 className="text-2xl font-bold text-white tracking-tight">Help & Support</h1>
                </div>
                <p className="text-sm text-[#555] ml-9">Find answers and get in touch</p>
            </div>

            <div className="max-w-3xl space-y-10">
                {/* Quick links */}
                <div className="grid grid-cols-3 gap-4">
                    {RESOURCES.map(({ icon: Icon, label, desc, href }) => (
                        <a
                            key={label}
                            href={href}
                            className="flex flex-col gap-3 p-4 rounded-xl border border-white/[0.07] bg-white/[0.03] hover:bg-white/[0.06] transition-colors group"
                        >
                            <div className="w-9 h-9 rounded-lg bg-indigo-600/20 flex items-center justify-center">
                                <Icon className="w-5 h-5 text-indigo-400" />
                            </div>
                            <div>
                                <p className="text-sm font-bold text-white group-hover:text-indigo-300 transition-colors">{label}</p>
                                <p className="text-xs text-[#555] mt-0.5">{desc}</p>
                            </div>
                        </a>
                    ))}
                </div>

                {/* FAQ */}
                <div>
                    <h2 className="text-base font-bold text-white mb-4">Frequently Asked Questions</h2>
                    <div className="space-y-3">
                        {FAQ.map(({ q, a }) => (
                            <div key={q} className="p-4 rounded-xl border border-white/[0.07] bg-white/[0.03] space-y-1.5">
                                <p className="text-sm font-semibold text-white">{q}</p>
                                <p className="text-sm text-[#666] leading-relaxed">{a}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
