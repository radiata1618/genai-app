"use client";

import React from 'react';

/**
 * StarRating Component
 * @param {number} value - Current rating (0-5)
 * @param {function} onChange - Callback when a star is clicked. If not provided, read-only mode.
 * @param {string} label - Optional label for the rating
 * @param {string} colorClass - Tailwind text color class for stars (default: text-yellow-400)
 */
export default function StarRating({ value = 0, onChange, label, colorClass = "text-yellow-400" }) {
    const isReadOnly = !onChange;

    return (
        <div className="flex flex-col">
            {label && <label className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">{label}</label>}
            <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((star) => (
                    <button
                        key={star}
                        type="button"
                        onClick={() => !isReadOnly && onChange(star)}
                        disabled={isReadOnly}
                        className={`text-2xl transition-transform ${isReadOnly ? 'cursor-default' : 'cursor-pointer hover:scale-110 active:scale-95'
                            } ${star <= value ? colorClass : 'text-slate-200'
                            }`}
                        aria-label={`${star} Stars`}
                    >
                        ★
                    </button>
                ))}
                {/* Optional: helper text for meaning? */}
                {/* <span className="text-xs text-slate-300 ml-2">({value || 0}/5)</span> */}
            </div>
        </div>
    );
}
