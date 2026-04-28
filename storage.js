const STORAGE_KEY = 'runTrackerSessions';

function getSessions() {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
}

function saveSession(sessionData) {
    const sessions = getSessions();
    sessions.push({
        ...sessionData,
        id: Date.now(),
        date: new Date().toISOString()
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
    renderHistory();
}

function clearSessions() {
    if (confirm('Are you sure you want to clear all recorded sessions?')) {
        localStorage.removeItem(STORAGE_KEY);
        renderHistory();
    }
}

function formatDuration(seconds) {
    if (isNaN(seconds) || seconds < 0) return '00:00';
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

function formatDate(isoString) {
    const d = new Date(isoString);
    return d.toLocaleString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

function renderHistory() {
    const tbody = document.getElementById('history-tbody');
    const sessions = getSessions();

    if (sessions.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="px-6 py-4 text-center text-gray-500 italic">No runs recorded yet.</td></tr>`;
        return;
    }

    // Sort newest first
    sessions.sort((a, b) => b.id - a.id);

    tbody.innerHTML = sessions.map(s => `
        <tr class="hover:bg-gray-50">
            <td class="px-6 py-4 whitespace-nowrap">${formatDate(s.date)}</td>
            <td class="px-6 py-4">${formatDuration(s.durationSeconds)}</td>
            <td class="px-6 py-4">${(s.distance / 1000).toFixed(2)} km</td>
            <td class="px-6 py-4">${s.avgSpeed ? s.avgSpeed.toFixed(2) : '0.00'} km/h</td>
            <td class="px-6 py-4">${s.calories || '--'}</td>
        </tr>
    `).join('');
}

// Initial render
document.addEventListener('DOMContentLoaded', () => {
    renderHistory();
    const btnClear = document.getElementById('btn-clear-history');
    if (btnClear) {
        btnClear.addEventListener('click', clearSessions);
    }
});