"use client";
import Link from 'next/link';

export default function ConsultingIndexPage() {
    const tools = [
        {
            name: "MTG Review",
            path: "/consulting/review",
            description: "Upload MTG recordings for automated feedback and insights.",
            icon: "🎙️",
            color: "from-indigo-500 to-purple-500"
        },
        {
            name: "MTG SME Live",
            path: "/consulting/sme",
            description: "Real-time AI monitoring and text-based advise during meetings.",
            icon: "👂",
            color: "from-emerald-500 to-cyan-500"
        },
        {
            name: "Logic Mapper",
            path: "/consulting/logic-mapper",
            description: "Visualize logic trees and structures.",
            icon: "🧠",
            color: "from-blue-500 to-indigo-500"
        },
        {
            name: "Slide Polisher",
            path: "/consulting/slide-polisher",
            description: "Refine slide layouts and content.",
            icon: "✨",
            color: "from-pink-500 to-rose-500"
        },
        {
            name: "Visual Search",
            path: "/consulting/visual-search",
            description: "Search internal documents visually.",
            icon: "🔍",
            color: "from-amber-500 to-orange-500"
        },
        {
            name: "Batches",
            path: "/consulting/batches",
            description: "Manage data ingestion batches.",
            icon: "📦",
            color: "from-slate-500 to-gray-500"
        }
    ];

    return (
        <div className="min-h-screen bg-slate-950 text-slate-200 p-8 font-sans">
            <header className="mb-12 text-center">
                <h1 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-emerald-400 mb-4">
                    Consulting Suite
                </h1>
                <p className="text-slate-400 max-w-2xl mx-auto">
                    AI-powered tools to enhance consulting operations, analysis, and meetings.
                </p>
            </header>

            <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {tools.map((tool) => (
                    <Link href={tool.path} key={tool.path} className="group">
                        <div className="h-full bg-slate-900 border border-slate-800 rounded-2xl p-6 hover:border-slate-600 transition-all hover:shadow-2xl hover:-translate-y-1 relative overflow-hidden">
                            <div className={`absolute top-0 left-0 w-full h-1 bg-gradient-to-r ${tool.color}`}></div>
                            <div className="text-4xl mb-4 group-hover:scale-110 transition-transform duration-300 transform origin-left">
                                {tool.icon}
                            </div>
                            <h2 className="text-xl font-bold text-white mb-2 group-hover:text-blue-300 transition-colors">
                                {tool.name}
                            </h2>
                            <p className="text-sm text-slate-400">
                                {tool.description}
                            </p>
                        </div>
                    </Link>
                ))}
            </div>
        </div>
    );
}
