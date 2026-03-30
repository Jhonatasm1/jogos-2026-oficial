const CSV_URLS = [
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vQZcOOu3eivDQ7v0b6bxVCvxtNjhYFkbSq2I-tBevYwQ07jEaHCWff0j14eHE8BOR7EA7L1ko4RFIMu/pub?gid=268101817&single=true&output=csv",
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vQZcOOu3eivDQ7v0b6bxVCvxtNjhYFkbSq2I-tBevYwQ07jEaHCWff0j14eHE8BOR7EA7L1ko4RFIMu/gviz/tq?tqx=out:csv&gid=268101817"
];
const AUTO_REFRESH_MS = 10000;
const FETCH_TIMEOUT_MS = 15000;

const state = {
    headers: [],
    rows: [],
    filters: {},
    sortMode: "none",
    customSortColumn: "",
    customSortDirection: "asc",
    lastPayload: ""
};

const dom = {
    thead: document.getElementById("cabecalho-tabela"),
    tbody: document.getElementById("corpo-tabela"),
    status: document.getElementById("status-atualizacao"),
    updatedAt: document.getElementById("ultima-atualizacao"),
    sortMode: document.getElementById("sort-mode"),
    customSortWrap: document.getElementById("custom-sort"),
    customSortColumn: document.getElementById("sort-column"),
    customSortDirectionWrap: document.getElementById("custom-direction-wrap"),
    customSortDirection: document.getElementById("sort-direction"),
    refreshButton: document.getElementById("refresh-button")
};

function appendCacheBuster(url) {
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}t=${Date.now()}`;
}

function parseCSV(csvText) {
    const output = [];
    let row = [];
    let field = "";
    let inQuotes = false;

    for (let i = 0; i < csvText.length; i += 1) {
        const char = csvText[i];
        const next = csvText[i + 1];

        if (char === "\"") {
            if (inQuotes && next === "\"") {
                field += "\"";
                i += 1;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }

        if (char === "," && !inQuotes) {
            row.push(field.trim());
            field = "";
            continue;
        }

        if ((char === "\n" || char === "\r") && !inQuotes) {
            if (char === "\r" && next === "\n") {
                i += 1;
            }
            row.push(field.trim());
            output.push(row);
            row = [];
            field = "";
            continue;
        }

        field += char;
    }

    if (field.length > 0 || row.length > 0) {
        row.push(field.trim());
        output.push(row);
    }

    return output;
}

function normalizeText(value) {
    return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
}

function fixEncoding(value) {
    const text = String(value || "");
    if (!/[ÃÂâ€]/.test(text)) {
        return text;
    }

    try {
        return decodeURIComponent(escape(text));
    } catch {
        return text;
    }
}

function parseNumber(value) {
    const raw = String(value || "").trim();
    if (!raw) {
        return null;
    }

    let normalized = raw.replace(/\s+/g, "").replace(/[^\d,.-]/g, "");

    if (normalized.includes(",") && normalized.includes(".")) {
        if (normalized.lastIndexOf(",") > normalized.lastIndexOf(".")) {
            normalized = normalized.replace(/\./g, "").replace(/,/g, ".");
        } else {
            normalized = normalized.replace(/,/g, "");
        }
    } else if (normalized.includes(",")) {
        normalized = normalized.replace(/,/g, ".");
    }

    const cleaned = normalized.match(/-?\d+(\.\d+)?/);
    if (!cleaned) {
        return null;
    }

    const parsed = Number(cleaned[0]);
    return Number.isFinite(parsed) ? parsed : null;
}

function parseTimeToSeconds(value) {
    const raw = normalizeText(value);
    if (!raw) {
        return null;
    }

    const hhmmss = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (hhmmss) {
        const hours = Number(hhmmss[1]);
        const minutes = Number(hhmmss[2]);
        const seconds = hhmmss[3] ? Number(hhmmss[3]) : 0;
        return (hours * 3600) + (minutes * 60) + seconds;
    }

    const hMatch = raw.match(/(\d+(?:\.\d+)?)\s*h/);
    const mMatch = raw.match(/(\d+(?:\.\d+)?)\s*m/);
    const sMatch = raw.match(/(\d+(?:\.\d+)?)\s*s/);

    if (hMatch || mMatch || sMatch) {
        const hours = hMatch ? Number(hMatch[1]) : 0;
        const minutes = mMatch ? Number(mMatch[1]) : 0;
        const seconds = sMatch ? Number(sMatch[1]) : 0;
        return Math.round((hours * 3600) + (minutes * 60) + seconds);
    }

    return null;
}

function compareValues(a, b, direction, preferTime) {
    const firstRaw = String(a || "");
    const secondRaw = String(b || "");

    const firstTime = preferTime ? parseTimeToSeconds(firstRaw) : null;
    const secondTime = preferTime ? parseTimeToSeconds(secondRaw) : null;

    if (firstTime !== null && secondTime !== null) {
        return direction === "asc" ? firstTime - secondTime : secondTime - firstTime;
    }

    const firstNumber = parseNumber(firstRaw);
    const secondNumber = parseNumber(secondRaw);

    if (firstNumber !== null && secondNumber !== null) {
        return direction === "asc" ? firstNumber - secondNumber : secondNumber - firstNumber;
    }

    return direction === "asc"
        ? firstRaw.localeCompare(secondRaw, "pt-BR", { numeric: true, sensitivity: "base" })
        : secondRaw.localeCompare(firstRaw, "pt-BR", { numeric: true, sensitivity: "base" });
}

function findHeader(patterns) {
    return state.headers.find((header) => patterns.some((pattern) => pattern.test(normalizeText(header))));
}

function getPresetConfig(mode) {
    const personalHeader = findHeader([/avaliacao pessoal/, /avaliacao/, /nota pessoal/, /nota/, /score/]);
    const tempoHeader = findHeader([/tempo/, /duracao/, /duracao total/, /horas/, /time/]);
    const anoHeader = findHeader([/ano de lancamento/, /ano lancamento/, /lancamento/, /ano/]);
    const alphaHeader = findHeader([/jogo/, /titulo/, /nome/]);

    const presets = {
        "personal-desc": { header: personalHeader, direction: "desc", preferTime: false },
        "tempo-asc": { header: tempoHeader, direction: "asc", preferTime: true },
        "tempo-desc": { header: tempoHeader, direction: "desc", preferTime: true },
        "ano-desc": { header: anoHeader, direction: "desc", preferTime: false },
        "ano-asc": { header: anoHeader, direction: "asc", preferTime: false },
        "alfabetica-asc": { header: alphaHeader || state.headers[0], direction: "asc", preferTime: false },
        "alfabetica-desc": { header: alphaHeader || state.headers[0], direction: "desc", preferTime: false }
    };

    return presets[mode] || null;
}

function shouldUseSelectFilter(header) {
    const uniqueValues = Array.from(new Set(state.rows.map((row) => String(row[header] || "").trim()).filter(Boolean)));
    const isShortList = uniqueValues.length > 1 && uniqueValues.length <= 20;
    const shortValues = uniqueValues.every((value) => value.length <= 26);
    return isShortList && shortValues;
}

function renderHeaderAndFilters() {
    dom.thead.innerHTML = "";

    const headerRow = document.createElement("tr");
    state.headers.forEach((header) => {
        const th = document.createElement("th");
        th.textContent = header;
        headerRow.appendChild(th);
    });
    dom.thead.appendChild(headerRow);

    const filterRow = document.createElement("tr");
    filterRow.id = "linha-filtros";

    state.headers.forEach((header) => {
        const th = document.createElement("th");
        const existingValue = state.filters[header] || "";

        if (shouldUseSelectFilter(header)) {
            const select = document.createElement("select");
            const allOption = document.createElement("option");
            allOption.value = "";
            allOption.textContent = "Todos";
            select.appendChild(allOption);

            const uniqueValues = Array.from(new Set(state.rows.map((row) => String(row[header] || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }));
            uniqueValues.forEach((value) => {
                const option = document.createElement("option");
                option.value = value;
                option.textContent = value;
                select.appendChild(option);
            });

            select.value = existingValue;
            select.addEventListener("change", (event) => {
                state.filters[header] = event.target.value;
                renderTable();
            });
            th.appendChild(select);
        } else {
            const input = document.createElement("input");
            input.type = "text";
            input.placeholder = `Filtrar ${header}`;
            input.value = existingValue;
            input.addEventListener("input", (event) => {
                state.filters[header] = event.target.value;
                renderTable();
            });
            th.appendChild(input);
        }

        filterRow.appendChild(th);
    });

    dom.thead.appendChild(filterRow);
}

function renderSortColumnOptions() {
    dom.customSortColumn.innerHTML = "";

    state.headers.forEach((header) => {
        const option = document.createElement("option");
        option.value = header;
        option.textContent = header;
        dom.customSortColumn.appendChild(option);
    });

    if (!state.customSortColumn || !state.headers.includes(state.customSortColumn)) {
        state.customSortColumn = state.headers[0] || "";
    }

    dom.customSortColumn.value = state.customSortColumn;
}

function applyFilters(rows) {
    return rows.filter((row) => {
        return state.headers.every((header) => {
            const filterValue = String(state.filters[header] || "").trim();
            if (!filterValue) {
                return true;
            }

            const cellValue = String(row[header] || "");
            return normalizeText(cellValue).includes(normalizeText(filterValue));
        });
    });
}

function applySort(rows) {
    if (!rows.length) {
        return rows;
    }

    if (state.sortMode === "custom") {
        const header = state.customSortColumn || state.headers[0];
        const direction = state.customSortDirection || "asc";
        return [...rows].sort((a, b) => compareValues(a[header], b[header], direction, false));
    }

    if (state.sortMode === "none") {
        return rows;
    }

    const preset = getPresetConfig(state.sortMode);
    if (!preset || !preset.header) {
        return rows;
    }

    return [...rows].sort((a, b) => compareValues(a[preset.header], b[preset.header], preset.direction, preset.preferTime));
}

function renderTable() {
    dom.tbody.innerHTML = "";

    const filteredRows = applyFilters(state.rows);
    const sortedRows = applySort(filteredRows);

    if (!sortedRows.length) {
        const tr = document.createElement("tr");
        tr.className = "empty-state";
        const td = document.createElement("td");
        td.colSpan = state.headers.length || 1;
        td.textContent = "Nenhum registro encontrado para os filtros atuais.";
        tr.appendChild(td);
        dom.tbody.appendChild(tr);
        return;
    }

    sortedRows.forEach((row) => {
        const tr = document.createElement("tr");
        state.headers.forEach((header) => {
            const td = document.createElement("td");
            td.textContent = row[header] || "";
            tr.appendChild(td);
        });
        dom.tbody.appendChild(tr);
    });
}

function updateStatus(message, isError) {
    if (!dom.status || !dom.updatedAt) {
        return;
    }

    dom.status.textContent = message;
    dom.status.classList.toggle("is-error", Boolean(isError));
    dom.status.classList.toggle("is-success", !isError);

    const now = new Date();
    dom.updatedAt.textContent = `Ultima atualizacao: ${now.toLocaleTimeString("pt-BR")}`;
}

function normalizeRows(parsedRows) {
    const nonEmpty = parsedRows.filter((row) => row.some((cell) => String(cell || "").trim() !== ""));
    if (!nonEmpty.length) {
        return { headers: [], rows: [] };
    }

    const headers = nonEmpty[0].map((header, index) => {
        const text = fixEncoding(String(header || "").replace(/^\uFEFF/, "").trim());
        return text || `Coluna ${index + 1}`;
    });

    const rows = nonEmpty.slice(1).map((columns) => {
        const record = {};
        headers.forEach((header, index) => {
            record[header] = fixEncoding(String(columns[index] || "").trim());
        });
        return record;
    });

    return { headers, rows };
}

function keepValidFilters() {
    const nextFilters = {};
    state.headers.forEach((header) => {
        nextFilters[header] = state.filters[header] || "";
    });
    state.filters = nextFilters;
}

function updateCustomSortVisibility() {
    if (!dom.customSortWrap || !dom.customSortDirectionWrap) {
        return;
    }

    const isCustom = state.sortMode === "custom";
    dom.customSortWrap.hidden = !isCustom;
    dom.customSortDirectionWrap.hidden = !isCustom;
}

async function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        return response;
    } finally {
        clearTimeout(timer);
    }
}

async function fetchCsvPayload() {
    const errors = [];

    for (let i = 0; i < CSV_URLS.length; i += 1) {
        const sourceUrl = CSV_URLS[i];

        try {
            const response = await fetchWithTimeout(
                appendCacheBuster(sourceUrl),
                {
                    cache: "no-store",
                    mode: "cors"
                },
                FETCH_TIMEOUT_MS
            );

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const payload = await response.text();
            if (!payload.trim()) {
                throw new Error("resposta vazia");
            }

            return payload;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            errors.push(`fonte ${i + 1}: ${message}`);
        }
    }

    throw new Error(errors.join(" | "));
}

async function fetchRankingData() {
    try {
        const payload = await fetchCsvPayload();
        if (payload === state.lastPayload) {
            updateStatus("Sem alteracoes desde a ultima leitura.", false);
            return;
        }

        const parsedRows = parseCSV(payload);
        const normalized = normalizeRows(parsedRows);

        state.headers = normalized.headers;
        state.rows = normalized.rows;

        keepValidFilters();
        renderHeaderAndFilters();
        renderSortColumnOptions();
        renderTable();

        state.lastPayload = payload;
        updateStatus("Dados sincronizados com sucesso.", false);
    } catch (error) {
        console.error("Error fetching ranking data:", error);
        const reason = error instanceof Error ? error.message : String(error);
        updateStatus(`Falha ao atualizar dados da planilha (${reason}).`, true);
    }
}

function bindEvents() {
    if (!dom.sortMode || !dom.customSortColumn || !dom.customSortDirection || !dom.refreshButton) {
        return;
    }

    dom.sortMode.addEventListener("change", (event) => {
        state.sortMode = event.target.value;
        updateCustomSortVisibility();
        renderTable();
    });

    dom.customSortColumn.addEventListener("change", (event) => {
        state.customSortColumn = event.target.value;
        renderTable();
    });

    dom.customSortDirection.addEventListener("change", (event) => {
        state.customSortDirection = event.target.value;
        renderTable();
    });

    dom.refreshButton.addEventListener("click", () => {
        fetchRankingData();
    });
}

function init() {
    if (!dom.thead || !dom.tbody) {
        return;
    }

    bindEvents();
    updateCustomSortVisibility();
    fetchRankingData();

    // Google Sheets publicado em CSV nao envia evento push; atualizacao por polling.
    setInterval(fetchRankingData, AUTO_REFRESH_MS);
}

document.addEventListener("DOMContentLoaded", init);