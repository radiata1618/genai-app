import React from 'react';
import DatePicker, { registerLocale } from 'react-datepicker';
import ja from 'date-fns/locale/ja';
import "react-datepicker/dist/react-datepicker.css";

// Register Japanese locale
registerLocale('ja', ja);

const CustomDatePicker = ({ selected, onChange, placeholderText, className, ...props }) => {
    return (
        <div className="custom-datepicker-wrapper">
            <DatePicker
                selected={selected ? new Date(selected) : null}
                onChange={(date) => {
                    // Convert to YYYY-MM-DD string for internal state if needed,
                    // or just pass the Date object. 
                    // The parent component expects a string usually, let's normalize.
                    // But react-datepicker gives a Date object.
                    // We'll pass the Date object up, and let the parent handle conversion if it wants string.
                    // OR better: handle the conversion here if the app uses strings like '2025-12-09'.

                    if (!date) {
                        onChange('');
                        return;
                    }
                    const year = date.getFullYear();
                    const month = String(date.getMonth() + 1).padStart(2, '0');
                    const day = String(date.getDate()).padStart(2, '0');
                    const dateStr = `${year}-${month}-${day}`;
                    onChange(dateStr);
                }}
                dateFormat="yyyy/MM/dd"
                locale="ja"
                placeholderText={placeholderText}
                className={className}
                calendarStartDay={1} // Monday start
                isClearable
                showPopperArrow={false}
                {...props}
            />
        </div>
    );
};

export default CustomDatePicker;
