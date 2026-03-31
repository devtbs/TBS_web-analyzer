import { useState } from 'react';
import { Cog6ToothIcon, UserCircleIcon, BellIcon, ShieldCheckIcon } from '@heroicons/react/24/outline';

const TABS = [
    { id: 'profile',       label: 'Profile',        icon: UserCircleIcon },
    { id: 'notifications', label: 'Notifications',  icon: BellIcon },
    { id: 'security',      label: 'Security',       icon: ShieldCheckIcon },
];

export default function Settings() {
    const [activeTab, setActiveTab] = useState('profile');

    return (
        <div className="min-h-screen bg-[#0f0f0f] text-white p-8">
            {/* Header */}
            <div className="mb-8">
                <div className="flex items-center gap-3 mb-1">
                    <Cog6ToothIcon className="w-6 h-6 text-[#888]" />
                    <h1 className="text-2xl font-bold text-white tracking-tight">Settings</h1>
                </div>
                <p className="text-sm text-[#555] ml-9">Manage your account preferences</p>
            </div>

            <div className="flex gap-8 max-w-4xl">
                {/* Sidebar tabs */}
                <nav className="flex flex-col gap-0.5 w-44 flex-shrink-0">
                    {TABS.map(({ id, label, icon: Icon }) => (
                        <button
                            key={id}
                            onClick={() => setActiveTab(id)}
                            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-left transition-all duration-150 outline-none ${
                                activeTab === id
                                    ? 'bg-white/10 text-white'
                                    : 'text-[#666] hover:text-[#aaa] hover:bg-white/5'
                            }`}
                        >
                            <Icon className="w-4 h-4 flex-shrink-0" />
                            {label}
                        </button>
                    ))}
                </nav>

                {/* Content panel */}
                <div className="flex-1 rounded-xl border border-white/[0.07] bg-white/[0.03] p-6 space-y-6">
                    {activeTab === 'profile' && (
                        <>
                            <h2 className="text-base font-bold text-white">Profile Information</h2>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs font-semibold text-[#666] mb-1.5 uppercase tracking-wide">Display Name</label>
                                    <input
                                        type="text"
                                        placeholder="Your name"
                                        className="w-full px-3 py-2.5 rounded-lg bg-white/[0.05] border border-white/[0.08] text-sm text-white placeholder-[#444] focus:outline-none focus:border-white/20 transition-colors"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-[#666] mb-1.5 uppercase tracking-wide">Email</label>
                                    <input
                                        type="email"
                                        placeholder="you@example.com"
                                        className="w-full px-3 py-2.5 rounded-lg bg-white/[0.05] border border-white/[0.08] text-sm text-white placeholder-[#444] focus:outline-none focus:border-white/20 transition-colors"
                                    />
                                </div>
                                <button className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition-colors">
                                    Save Changes
                                </button>
                            </div>
                        </>
                    )}

                    {activeTab === 'notifications' && (
                        <>
                            <h2 className="text-base font-bold text-white">Notification Preferences</h2>
                            <div className="space-y-4">
                                {['Analysis complete', 'Weekly digest', 'New features'].map(item => (
                                    <div key={item} className="flex items-center justify-between py-2 border-b border-white/[0.05]">
                                        <span className="text-sm text-[#aaa]">{item}</span>
                                        <div className="w-9 h-5 rounded-full bg-emerald-600 flex items-center cursor-pointer px-0.5">
                                            <div className="w-4 h-4 rounded-full bg-white ml-auto" />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </>
                    )}

                    {activeTab === 'security' && (
                        <>
                            <h2 className="text-base font-bold text-white">Security</h2>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs font-semibold text-[#666] mb-1.5 uppercase tracking-wide">New Password</label>
                                    <input
                                        type="password"
                                        placeholder="••••••••"
                                        className="w-full px-3 py-2.5 rounded-lg bg-white/[0.05] border border-white/[0.08] text-sm text-white placeholder-[#444] focus:outline-none focus:border-white/20 transition-colors"
                                    />
                                </div>
                                <button className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition-colors">
                                    Update Password
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
