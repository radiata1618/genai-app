"use client";

import React, { useState, useEffect } from 'react';

export default function QuizPage() {
    const [gameState, setGameState] = useState('setup'); // setup, playing, result
    const [filters, setFilters] = useState({ manufacturer: '', bodyType: '' });
    const [questions, setQuestions] = useState([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [score, setScore] = useState(0);
    const [selectedOption, setSelectedOption] = useState(null);
    const [isCorrect, setIsCorrect] = useState(null);
    const [wrongAnswers, setWrongAnswers] = useState([]);

    // Fetch options for filters (mock or API)
    // For simplicity, hardcoding common ones or fetching if backend supports
    const manufacturers = ["Toyota", "Honda", "Nissan", "Mazda", "Subaru", "Mitsubishi", "Suzuki", "Daihatsu", "Lexus"];
    const bodyTypes = ["SUV", "Sedan", "Minivan", "Compact", "K-Car", "Coupe", "Wagon"];

    const startQuiz = async () => {
        try {
            // Build query string
            const params = new URLSearchParams();
            if (filters.manufacturer) params.append('manufacturer', filters.manufacturer);
            if (filters.bodyType) params.append('body_type', filters.bodyType);

            const res = await fetch(`http://localhost:8000/api/car-quiz/questions?${params.toString()}&limit=5`);
            const data = await res.json();

            if (data.length === 0) {
                alert("No questions found for these conditions.");
                return;
            }

            setQuestions(data);
            setCurrentIndex(0);
            setScore(0);
            setWrongAnswers([]);
            setGameState('playing');
        } catch (e) {
            console.error(e);
            alert("Failed to start quiz.");
        }
    };

    const answerQuestion = (option) => {
        if (selectedOption) return; // Prevent double click

        const currentQ = questions[currentIndex];
        const correct = option === currentQ.correct_answer;

        setSelectedOption(option);
        setIsCorrect(correct);

        if (correct) {
            setScore(s => s + 1);
        } else {
            setWrongAnswers(prev => [...prev, currentQ]);
        }

        // Auto next after delay
        setTimeout(() => {
            setSelectedOption(null);
            setIsCorrect(null);
            if (currentIndex < questions.length - 1) {
                setCurrentIndex(c => c + 1);
            } else {
                setGameState('result');
            }
        }, 1500);
    };

    const restart = () => {
        setGameState('setup');
        setFilters({ manufacturer: '', bodyType: '' });
    };

    // --- RENDER ---

    if (gameState === 'setup') {
        return (
            <div className="max-w-2xl mx-auto p-8 bg-white rounded-xl shadow-lg border border-slate-100 mt-10">
                <h1 className="text-4xl font-bold text-center mb-8 text-slate-800">Car Model Quiz</h1>
                <div className="space-y-6">
                    <div>
                        <label className="block text-slate-700 font-semibold mb-2">Manufacturer (Optional)</label>
                        <select
                            className="w-full border border-slate-300 rounded-lg p-3 focus:ring-2 focus:ring-cyan-500 outline-none"
                            value={filters.manufacturer}
                            onChange={(e) => setFilters({ ...filters, manufacturer: e.target.value })}
                        >
                            <option value="">All</option>
                            {manufacturers.map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-slate-700 font-semibold mb-2">Body Type (Optional)</label>
                        <select
                            className="w-full border border-slate-300 rounded-lg p-3 focus:ring-2 focus:ring-cyan-500 outline-none"
                            value={filters.bodyType}
                            onChange={(e) => setFilters({ ...filters, bodyType: e.target.value })}
                        >
                            <option value="">All</option>
                            {bodyTypes.map(b => <option key={b} value={b}>{b}</option>)}
                        </select>
                    </div>
                    <button
                        onClick={startQuiz}
                        className="w-full bg-cyan-600 text-white font-bold py-4 rounded-xl hover:bg-cyan-700 transition shadow-md text-lg"
                    >
                        Start Quiz
                    </button>
                </div>
            </div>
        );
    }

    if (gameState === 'playing') {
        const question = questions[currentIndex];
        return (
            <div className="max-w-4xl mx-auto p-4 flex flex-col items-center">
                <div className="w-full flex justify-between items-center mb-4">
                    <span className="font-bold text-slate-500">Q {currentIndex + 1} / {questions.length}</span>
                    <span className="font-bold text-cyan-600">Score: {score}</span>
                </div>

                {/* Image Area */}
                <div className="w-full max-w-2xl h-64 md:h-96 bg-black rounded-xl overflow-hidden shadow-lg mb-8 relative">
                    {question.image_url ? (
                        <img src={question.image_url} alt="Mystery Car" className="w-full h-full object-contain" />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-white">No Image Available</div>
                    )}

                    {/* Feedback Overlay */}
                    {selectedOption && (
                        <div className={`absolute inset-0 flex items-center justify-center bg-black/60 z-10 animate-fade-in`}>
                            {isCorrect ? (
                                <div className="text-green-400 text-9xl font-bold drop-shadow-lg">◯</div>
                            ) : (
                                <div className="text-red-500 text-9xl font-bold drop-shadow-lg">✕</div>
                            )}
                        </div>
                    )}
                </div>

                {/* Options */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-2xl">
                    {question.options.map((opt, i) => {
                        let btnClass = "bg-white border-2 border-slate-200 text-slate-700 hover:border-cyan-400 hover:bg-cyan-50";
                        if (selectedOption) {
                            if (opt === question.correct_answer) btnClass = "bg-green-100 border-green-500 text-green-800 font-bold";
                            else if (opt === selectedOption && !isCorrect) btnClass = "bg-red-100 border-red-500 text-red-800";
                            else btnClass = "bg-slate-50 border-slate-200 text-slate-400";
                        }

                        return (
                            <button
                                key={i}
                                onClick={() => answerQuestion(opt)}
                                disabled={!!selectedOption}
                                className={`p-4 rounded-xl text-lg font-medium transition shadow-sm ${btnClass}`}
                            >
                                {opt}
                            </button>
                        );
                    })}
                </div>

                {selectedOption && (
                    <div className="mt-6 text-xl text-slate-800 font-bold">
                        Answer: {question.correct_answer}
                    </div>
                )}
            </div>
        );
    }

    if (gameState === 'result') {
        return (
            <div className="max-w-3xl mx-auto p-8 bg-white rounded-xl shadow-lg border border-slate-100 mt-10 text-center">
                <h2 className="text-3xl font-bold text-slate-800 mb-2">Quiz Completed!</h2>
                <p className="text-slate-500 mb-8">Here is your result</p>

                <div className="text-6xl font-black text-cyan-600 mb-8">
                    {score} <span className="text-3xl text-slate-400 font-normal">/ {questions.length}</span>
                </div>

                <button onClick={restart} className="bg-cyan-600 text-white px-8 py-3 rounded-xl font-bold hover:bg-cyan-700 transition">
                    Play Again
                </button>

                {wrongAnswers.length > 0 && (
                    <div className="mt-12 text-left">
                        <h3 className="text-xl font-bold text-slate-700 mb-4 border-b pb-2">Review Wrong Answers</h3>
                        <div className="grid gap-6">
                            {wrongAnswers.map((q, i) => (
                                <div key={i} className="flex gap-4 p-4 bg-red-50 rounded-lg border border-red-100">
                                    <div className="w-32 h-20 bg-black rounded overflow-hidden flex-shrink-0">
                                        <img src={q.image_url} className="w-full h-full object-cover" />
                                    </div>
                                    <div>
                                        <div className="text-sm text-red-500 font-bold mb-1">Qusetion {questions.indexOf(q) + 1}</div>
                                        <div className="font-bold text-slate-800">{q.correct_answer}</div>
                                        <div className="text-sm text-slate-500">Model Code: {q.car_data.model_code}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        );
    }

    return null;
}
