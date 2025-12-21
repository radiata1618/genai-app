/**
 * Format a date string or object to "YYYY/MM/DD"
 * @param {string|Date} date - The date to format
 * @returns {string} Formatted date string or original value if invalid
 */
export const formatDate = (date) => {
    if (!date) return '';

    const d = new Date(date);
    if (isNaN(d.getTime())) return date;

    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');

    return `${year}/${month}/${day}`;
};

/**
 * Get current date in JST (Japan Standard Time)
 * Returns a Date object representing the current time in JST
 */
export const getNowJST = () => {
    // Create a date object with the current UTC time
    const now = new Date();

    // convert to JST (UTC + 9)
    // We use toLocaleString to robustly get the time in JST
    const jstStr = now.toLocaleString("en-US", { timeZone: "Asia/Tokyo" });
    return new Date(jstStr);
};

/**
 * Get "Today" date string in JST (YYYY-MM-DD)
 * @returns {string}
 */
export const getTodayJST = () => {
    const jstDate = getNowJST();
    const year = jstDate.getFullYear();
    const month = String(jstDate.getMonth() + 1).padStart(2, '0');
    const day = String(jstDate.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

/**
 * Get "Today" as a Date object at 00:00:00 JST
 * Useful for DatePicker initialization
 */
export const getTodayDateJST = () => {
    const todayStr = getTodayJST();
    return new Date(todayStr); // Browser's local time interpretation of YYYY-MM-DD is usually 00:00
};

/**
 * Normalize a date string to YYYY-MM-DD (replacing slashes)
 */
export const normalizeDateStr = (dateStr) => {
    if (!dateStr) return getTodayJST();
    return dateStr.replace(/\//g, '-');
}
