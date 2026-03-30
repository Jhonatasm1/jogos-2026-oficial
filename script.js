async function fetchRankingData() {
    const url = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQZcOOu3eivDQ7v0b6bxVCvxtNjhYFkbSq2I-tBevYwQ07jEaHCWff0j14eHE8BOR7EA7L1ko4RFIMu/pub?gid=268101817&single=true&output=csv';
    
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error('Network response was not ok');
        }
        const data = await response.text();
        const rows = data.split('\n').slice(1); // Skip the header row
        const tbody = document.getElementById('corpo-tabela');

        rows.forEach(row => {
            const columns = row.split(',');
            const tr = document.createElement('tr');
            columns.forEach(column => {
                const td = document.createElement('td');
                td.textContent = column.trim();
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
    } catch (error) {
        console.error('Fetch error:', error);
    }
}

document.addEventListener('DOMContentLoaded', fetchRankingData);