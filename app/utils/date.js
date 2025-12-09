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
