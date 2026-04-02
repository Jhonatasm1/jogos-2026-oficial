const CSV_URLS = [
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vQZcOOu3eivDQ7v0b6bxVCvxtNjhYFkbSq2I-tBevYwQ07jEaHCWff0j14eHE8BOR7EA7L1ko4RFIMu/pub?gid=268101817&single=true&output=csv",
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vQZcOOu3eivDQ7v0b6bxVCvxtNjhYFkbSq2I-tBevYwQ07jEaHCWff0j14eHE8BOR7EA7L1ko4RFIMu/gviz/tq?tqx=out:csv&gid=268101817"
];
const AUTO_REFRESH_MS = 10000;
const FETCH_TIMEOUT_MS = 15000;
const TIER_DB_NAME = "theGameOfUsTierDB";
const TIER_DB_VERSION = 1;
const TIER_STATE_STORE = "tier_state";
const TIER_ASSET_STORE = "tier_assets";
const TIER_STATE_ID = "main";
const TIER_SAVE_DEBOUNCE_MS = 450;

const state = {
    headers: [],
    rows: [],
    filters: {},
    overviewFilters: {
        plataforma: "",
        multiplayer: "",
        anoConclusao: ""
    },
    sortMode: "none",
    customSortColumn: "",
    customSortDirection: "asc",
    lastPayload: "",
    charts: {},
    tierList: {
        initialized: false,
        dbPromise: null,
        loaded: false,
        loadAttempted: false,
        saveTimer: null,
        objectUrls: [],
        nextId: 1,
        title: "Tier List de Jogos",
        labelWidth: 72,
        labels: {
            S: "S",
            A: "A",
            B: "B",
            C: "C",
            D: "D",
            E: "E",
            F: "F",
            "Don\u0027t know": "Don\u0027t know",
            "Doesn\u0027t count": "Doesn\u0027t count"
        },
        tiers: {
            S: [],
            A: [],
            B: [],
            C: [],
            D: [],
            E: [],
            F: [],
            "Don\u0027t know": [],
            "Doesn\u0027t count": []
        },
        pool: []
    },
    resolvedHeaders: {
        jogo: null,
        status: null,
        tempo: null,
        avaliacao: null,
        plataforma: null,
        multiplayer: null,
        anoConclusao: null,
        anoLancamento: null
    }
};

const dom = {
    thead: document.getElementById("cabecalho-tabela"),
    tbody: document.getElementById("corpo-tabela"),
    status: document.getElementById("status-atualizacao"),
    updatedAt: document.getElementById("ultima-atualizacao"),
    refreshButton: document.getElementById("refresh-button"),
    filterPlataforma: document.getElementById("filter-plataforma"),
    filterMultiplayer: document.getElementById("filter-multiplayer"),
    filterAnoConclusao: document.getElementById("filter-ano-conclusao"),
    filtersTop: document.getElementById("filters-top"),
    tabsContainer: document.querySelector(".tabs-container"),
    tabsNav: document.querySelector(".tabs-nav"),
    tabBtns: document.querySelectorAll(".tab-btn"),
    tabContents: document.querySelectorAll(".tab-content")
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
    if (!/\uFFFD/.test(text)) {
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
    if (!raw) return null;

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
    if (!cleaned) return null;

    const parsed = Number(cleaned[0]);
    return Number.isFinite(parsed) ? parsed : null;
}

function parseTimeToSeconds(value) {
    const raw = normalizeText(value);
    if (!raw) return null;

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

    const numericOnly = parseNumber(value);
    if (numericOnly !== null) {
        return Math.round(numericOnly * 3600);
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

function findHeaderByKeywords(keywords) {
    return state.headers.find((header) => {
        const normalizedHeader = normalizeText(header);
        return keywords.every((keyword) => normalizedHeader.includes(normalizeText(keyword)));
    });
}

function resolveHeaders() {
    state.resolvedHeaders = {
        jogo: findHeader([/jogo/, /titulo/, /nome/]),
        status: findHeader([/status/, /estado/, /situacao/]),
        tempo: findHeader([/tempo/, /duracao/, /duracao total/, /horas/, /time/]),
        avaliacao: findHeader([/avaliacao pessoal/, /avaliacao/, /nota pessoal/, /nota/, /score/]),
        plataforma: findHeader([/plataforma/, /platform/]),
        multiplayer: findHeader([/multiplayer/, /multijogador/, /multi jogador/, /co-op/, /coop/, /online/]),
        anoConclusao:
            findHeader([/ano de conclusao/, /ano conclusao/, /ano.*conclus/, /conclusao/, /ano que concluiu/, /finalizado em/]) ||
            findHeaderByKeywords(["ano", "conclusao"]),
        anoLancamento: findHeader([/ano de lancamento/, /ano lancamento/, /lancamento/, /^ano$/])
    };
}

function getRowValue(row, header) {
    if (!row || !header) return "";
    return String(row[header] || "").trim();
}

function normalizeYesNo(value) {
    const text = normalizeText(value);
    if (!text) return "";

    if (["sim", "yes", "y", "true", "verdadeiro", "1"].includes(text)) return "Sim";
    if (["nao", "no", "n", "false", "falso", "0"].includes(text)) return "N\u00e3o";

    if (text.includes("solo") || text.includes("single")) return "N\u00e3o";
    if (text.includes("coop") || text.includes("co-op") || text.includes("online") || text.includes("multijogador") || text.includes("multiplayer")) return "Sim";

    return value;
}

function getRowMultiplayerType(row) {
    const multiplayerHeader = state.resolvedHeaders.multiplayer;
    const primaryRaw = getRowValue(row, multiplayerHeader);

    // Prefer the dedicated multiplayer column; if empty, fallback to row text.
    const fallbackRaw = state.headers.map((header) => getRowValue(row, header)).join(" ");
    const raw = primaryRaw || fallbackRaw;
    const text = normalizeText(raw);

    if (!text) return "";

    const pvpTokens = ["pvp", "versus", "x1", "1v1", "competitivo", "ranked", "ranqueada", "arena"];
    const coopTokens = ["coop", "co-op", "co op", "cooperativo", "multiplayer", "multijogador", "online coop", "online cooperativo"];
    const soloTokens = ["solo", "single player", "singleplayer", "campanha", "historia", "offline", "nao", "false", "0"];

    if (pvpTokens.some((token) => text.includes(token))) return "PVP";
    if (coopTokens.some((token) => text.includes(token))) return "COOP";
    if (soloTokens.some((token) => text.includes(token))) return "SOLO";

    // If it explicitly says "sim" for multiplayer but no subtype, classify as COOP by default.
    if (["sim", "yes", "true", "1"].some((token) => text === token || text.includes(`${token} `) || text.includes(` ${token}`))) {
        return "COOP";
    }

    return "";
}

function extractYear(value) {
    const text = String(value || "");
    const match = text.match(/(19\d{2}|20\d{2}|21\d{2})/);
    return match ? match[1] : "";
}

function extractYears(value) {
    const text = String(value || "");
    const matches = text.match(/(19\d{2}|20\d{2}|21\d{2})/g);
    return matches || [];
}

function getAvailableCompletionYears(rows) {
    const anoHeader = state.resolvedHeaders.anoConclusao;
    if (!anoHeader) return [];

    const years = new Set();
    rows.forEach((row) => {
        const raw = getRowValue(row, anoHeader);
        const extracted = extractYears(raw);
        extracted.forEach((year) => years.add(year));
    });

    return Array.from(years).sort((a, b) => Number(b) - Number(a));
}

function getOverviewFilteredRows() {
    const { plataforma, multiplayer, anoConclusao } = state.overviewFilters;
    const headers = state.resolvedHeaders;

    return state.rows.filter((row) => {
        if (plataforma) {
            const rowPlat = getRowValue(row, headers.plataforma);
            if (normalizeText(rowPlat) !== normalizeText(plataforma)) return false;
        }

        if (multiplayer) {
            const rowMultiType = getRowMultiplayerType(row);
            if (normalizeText(rowMultiType) !== normalizeText(multiplayer)) return false;
        }

        if (anoConclusao) {
            const rowYearRaw = getRowValue(row, headers.anoConclusao);
            const rowYear = extractYear(rowYearRaw);
            if (rowYear !== anoConclusao) return false;
        }

        return true;
    });
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
    if (!dom.thead) return;

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
    if (!dom.customSortColumn) return;

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

function updateOverviewFilterSelects() {
    const headers = state.resolvedHeaders;

    if (dom.filterPlataforma) {
        const values = headers.plataforma
            ? Array.from(new Set(state.rows.map((row) => getRowValue(row, headers.plataforma)).filter(Boolean))).sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }))
            : [];

        dom.filterPlataforma.innerHTML = '<option value="">Todas<\/option>';
        values.forEach((value) => {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = value;
            dom.filterPlataforma.appendChild(option);
        });
        dom.filterPlataforma.value = state.overviewFilters.plataforma || "";
    }

    if (dom.filterMultiplayer) {
        dom.filterMultiplayer.innerHTML = "";

        const options = [
            { value: "", label: "Todos" },
            { value: "SOLO", label: "SOLO" },
            { value: "COOP", label: "COOP" },
            { value: "PVP", label: "PvP" }
        ];

        options.forEach((entry) => {
            const option = document.createElement("option");
            option.value = entry.value;
            option.textContent = entry.label;
            dom.filterMultiplayer.appendChild(option);
        });

        dom.filterMultiplayer.value = state.overviewFilters.multiplayer || "";
    }

    if (dom.filterAnoConclusao) {
        const values = getAvailableCompletionYears(state.rows);

        dom.filterAnoConclusao.innerHTML = '<option value="">Todos<\/option>';
        values.forEach((value) => {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = value;
            dom.filterAnoConclusao.appendChild(option);
        });
        dom.filterAnoConclusao.value = state.overviewFilters.anoConclusao || "";
    }
}

function applyFilters(rows) {
    return rows.filter((row) => {
        return state.headers.every((header) => {
            const filterValue = String(state.filters[header] || "").trim();
            if (!filterValue) return true;

            const cellValue = String(row[header] || "");
            return normalizeText(cellValue).includes(normalizeText(filterValue));
        });
    });
}

function applySort(rows) {
    if (!rows.length) return rows;

    if (state.sortMode === "custom") {
        const header = state.customSortColumn || state.headers[0];
        const direction = state.customSortDirection || "asc";
        return [...rows].sort((a, b) => compareValues(a[header], b[header], direction, false));
    }

    if (state.sortMode === "none") return rows;

    const preset = getPresetConfig(state.sortMode);
    if (!preset || !preset.header) return rows;

    return [...rows].sort((a, b) => compareValues(a[preset.header], b[preset.header], preset.direction, preset.preferTime));
}

function renderTable() {
    if (!dom.tbody) return;

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
    if (!dom.status || !dom.updatedAt) return;

    dom.status.textContent = message;
    dom.status.classList.toggle("is-error", Boolean(isError));
    dom.status.classList.toggle("is-success", !isError);

    const now = new Date();
    dom.updatedAt.textContent = `Ultima atualizacao: ${now.toLocaleTimeString("pt-BR")}`;
}

function normalizeRows(parsedRows) {
    const nonEmpty = parsedRows.filter((row) => row.some((cell) => String(cell || "").trim() !== ""));
    if (!nonEmpty.length) return { headers: [], rows: [] };

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
    if (!dom.customSortWrap || !dom.customSortDirectionWrap) return;
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
                { cache: "no-store", mode: "cors" },
                FETCH_TIMEOUT_MS
            );

            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const payload = await response.text();
            if (!payload.trim()) throw new Error("resposta vazia");

            return payload;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            errors.push(`fonte ${i + 1}: ${message}`);
        }
    }

    throw new Error(errors.join(" | "));
}

function renderVisaoGeral() {
    const rows = getOverviewFilteredRows();
    const headers = state.resolvedHeaders;

    const totalJogosEl = document.getElementById("total-jogos");
    const totalConcluidosEl = document.getElementById("total-concluidos");
    const totalJogandoEl = document.getElementById("total-jogando");
    const totalPendentesEl = document.getElementById("total-pendentes");

    if (totalJogosEl) totalJogosEl.textContent = String(rows.length);

    const statusCount = {};

    rows.forEach(row => {
        const stat = String(row[headers.status] || "").trim();
        if (stat) statusCount[stat] = (statusCount[stat] || 0) + 1;
    });

    const getCountExact = (word) => {
        const key = Object.keys(statusCount).find(k => k.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() === word);
        return key ? statusCount[key] : 0;
    };

    const concluidos = getCountExact("concluido");
    const jogando = getCountExact("jogando");
    const pendentes = getCountExact("pendente");

    if (totalConcluidosEl) totalConcluidosEl.textContent = String(concluidos);
    if (totalJogandoEl) totalJogandoEl.textContent = String(jogando);
    if (totalPendentesEl) totalPendentesEl.textContent = String(pendentes);

    renderCharts(rows, statusCount);
}

function renderCharts(rows, statusCount) {
    const ctxSetores = document.getElementById("chart-status-setores");
    const ctxStatus = document.getElementById("chart-status");

    if (!ctxSetores || !ctxStatus || typeof Chart === "undefined") return;

    const doughnutConfig = [
        { key: "pendente", label: "Pendente", color: "#ffcc00" }, // Amarelo
        { key: "concluido", label: "Conclu\u00eddo", color: "#d4a853" }, // Dourado
        { key: "pausado", label: "Pausado", color: "#ff9800" }, // Laranja
        { key: "dropado", label: "Dropado", color: "#e06c75" }, // Vermelho
        { key: "jogando", label: "Jogando", color: "#1a9fda" }, // Safira
        { key: "iniciado", label: "Iniciado", color: "#56b6c2" } // Ciano
    ];

    const doughnutLabels = [];
    const doughnutData = [];
    const doughnutColors = [];

    doughnutConfig.forEach(config => {
        const statusKey = Object.keys(statusCount).find(k => k.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() === config.key);
        const count = statusKey ? statusCount[statusKey] : 0;
        if (count > 0) {
            doughnutLabels.push(config.label);
            doughnutData.push(count);
            doughnutColors.push(config.color);
        }
    });

    if (state.charts.plat) state.charts.plat.destroy(); // Safely clear old var if exists
    if (state.charts.setores) state.charts.setores.destroy();
    
    state.charts.setores = new Chart(ctxSetores, {
        type: "doughnut",
        data: {
            labels: doughnutLabels,
            datasets: [{
                data: doughnutData,
                backgroundColor: doughnutColors,
                borderColor: "#0f1419",
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: { 
                legend: { labels: { color: "#d4a853" } },
                title: { display: true, text: "STATUS", color: "#d4a853", font: { size: 16 } }
            }
        }
    });

    const barConfigMap = {
        pendente: { label: "Pendente", color: "#ffcc00" },
        concluido: { label: "Conclu\u00eddo", color: "#4a90e2" },
        pausado: { label: "Pausado", color: "#ff9800" },
        dropado: { label: "Dropado", color: "#e06c75" },
        jogando: { label: "Jogando", color: "#1a9fda" },
        iniciado: { label: "Iniciado", color: "#56b6c2" },
        outros: { label: "Outros", color: "#ff1493" }
    };

    const anosMap = {};

    rows.forEach(row => {
        const anoRaw = getRowValue(row, state.resolvedHeaders.anoLancamento);
        const ano = extractYear(anoRaw) || "Desconhecido";
        
        const statRaw = getRowValue(row, state.resolvedHeaders.status);
        const statKey = String(statRaw || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
        
        let mappedKey = "outros";
        if (Object.keys(barConfigMap).includes(statKey) && statKey !== "outros") {
            mappedKey = statKey;
        }

        if (!anosMap[ano]) {
            anosMap[ano] = { pendente: 0, concluido: 0, pausado: 0, dropado: 0, jogando: 0, iniciado: 0, outros: 0 };
        }
        anosMap[ano][mappedKey]++;
    });

    const labelsAnos = Object.keys(anosMap).sort((a, b) => {
        if (a === "Desconhecido") return 1;
        if (b === "Desconhecido") return -1;
        return Number(a) - Number(b);
    });

    const datasetsBar = Object.keys(barConfigMap).map(key => {
        return {
            label: barConfigMap[key].label,
            data: labelsAnos.map(ano => anosMap[ano][key]),
            backgroundColor: barConfigMap[key].color,
            borderColor: barConfigMap[key].color,
            borderWidth: 1
        };
    }).filter(dataset => dataset.data.some(val => val > 0));

    if (state.charts.status) state.charts.status.destroy();
    state.charts.status = new Chart(ctxStatus, {
        type: "bar",
        data: {
            labels: labelsAnos,
            datasets: datasetsBar
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: { 
                legend: { labels: { color: "#d4a853" } },
                title: { display: true, text: "LAN\u00c7AMENTO POR STATUS", color: "#d4a853", font: { size: 16 } }
            },
            scales: {
                y: { stacked: true, ticks: { color: "#d4a853" }, grid: { color: "rgba(212, 168, 83, 0.1)" } },
                x: { stacked: true, ticks: { color: "#d4a853" }, grid: { color: "rgba(212, 168, 83, 0.1)" } }
            }
        }
    });
}

function formatHoursCompact(totalSeconds) {
    const hours = Math.round((Number(totalSeconds) || 0) / 3600);
    return `${hours}h`;
}

function getCoverFromRow(row, title) {
    const coverHeader = findHeader([/capa/, /imagem/, /image/, /cover/, /thumb/]);
    const rawCover = coverHeader ? String(row[coverHeader] || "").trim() : "";

    if (/^https?:\/\//i.test(rawCover)) {
        return rawCover;
    }

    const normalizedTitle = normalizeText(title);
    if (normalizedTitle.includes("sekiro")) return "sekiro.png";
    if (normalizedTitle.includes("cuphead")) return "cuphead.png";
    if (normalizedTitle.includes("last of us") || normalizedTitle.includes("tlou")) return "tlou.png";

    return "";
}

function createTierItem(title, src, isUploaded) {
    const item = {
        id: `tier-item-${state.tierList.nextId}`,
        title: title || "Sem titulo",
        src,
        isUploaded: Boolean(isUploaded)
    };
    state.tierList.nextId += 1;
    return item;
}

function createTierItemFromUpload(file) {
    const title = String(file.name || "Imagem").replace(/\.[^/.]+$/, "");
    const src = URL.createObjectURL(file);
    state.tierList.objectUrls.push(src);

    return {
        id: `tier-item-${state.tierList.nextId++}`,
        title,
        src,
        isUploaded: true,
        blob: file
    };
}

function revokeTierObjectUrl(url) {
    if (!url || !String(url).startsWith("blob:")) return;
    URL.revokeObjectURL(url);
    state.tierList.objectUrls = state.tierList.objectUrls.filter((entry) => entry !== url);
}

function revokeAllTierObjectUrls() {
    state.tierList.objectUrls.forEach((url) => {
        URL.revokeObjectURL(url);
    });
    state.tierList.objectUrls = [];
}

function idbRequestToPromise(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function openTierDatabase() {
    if (state.tierList.dbPromise) return state.tierList.dbPromise;

    state.tierList.dbPromise = new Promise((resolve, reject) => {
        if (typeof indexedDB === "undefined") {
            reject(new Error("IndexedDB indisponivel"));
            return;
        }

        const request = indexedDB.open(TIER_DB_NAME, TIER_DB_VERSION);

        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(TIER_STATE_STORE)) {
                db.createObjectStore(TIER_STATE_STORE, { keyPath: "id" });
            }
            if (!db.objectStoreNames.contains(TIER_ASSET_STORE)) {
                db.createObjectStore(TIER_ASSET_STORE, { keyPath: "id" });
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });

    return state.tierList.dbPromise;
}

async function ensurePersistableTierBlob(item) {
    if (!item || !item.isUploaded) return;
    if (item.blob instanceof Blob) return;
    if (!String(item.src || "").startsWith("blob:")) return;

    try {
        const response = await fetch(item.src);
        item.blob = await response.blob();
    } catch {
        // Ignore; item may not be persistable if blob extraction fails.
    }
}

async function saveTierListNow() {
    try {
        const db = await openTierDatabase();

        const allItems = [];
        const seen = new Set();
        const tierKeys = Object.keys(state.tierList.tiers);

        tierKeys.forEach((tierKey) => {
            state.tierList.tiers[tierKey].forEach((item) => {
                if (item && !seen.has(item.id)) {
                    seen.add(item.id);
                    allItems.push(item);
                }
            });
        });

        state.tierList.pool.forEach((item) => {
            if (item && !seen.has(item.id)) {
                seen.add(item.id);
                allItems.push(item);
            }
        });

        await Promise.all(allItems.map((item) => ensurePersistableTierBlob(item)));

        const persistableIds = new Set();
        const assetRecords = allItems
            .map((item) => {
                const sourceType = item.isUploaded ? "blob" : "url";

                if (sourceType === "blob" && !(item.blob instanceof Blob)) {
                    return null;
                }

                persistableIds.add(item.id);

                if (sourceType === "blob") {
                    return {
                        id: item.id,
                        title: item.title,
                        sourceType,
                        blob: item.blob,
                        isUploaded: true
                    };
                }

                return {
                    id: item.id,
                    title: item.title,
                    sourceType,
                    src: item.src,
                    isUploaded: false
                };
            })
            .filter(Boolean);

        const stateRecord = {
            id: TIER_STATE_ID,
            title: state.tierList.title,
            labelWidth: state.tierList.labelWidth,
            labels: state.tierList.labels,
            tiers: Object.fromEntries(
                tierKeys.map((tierKey) => [
                    tierKey,
                    state.tierList.tiers[tierKey]
                        .map((item) => item.id)
                        .filter((id) => persistableIds.has(id))
                ])
            ),
            pool: state.tierList.pool
                .map((item) => item.id)
                .filter((id) => persistableIds.has(id))
        };

        await new Promise((resolve, reject) => {
            const tx = db.transaction([TIER_ASSET_STORE, TIER_STATE_STORE], "readwrite");
            const assetsStore = tx.objectStore(TIER_ASSET_STORE);
            const stateStore = tx.objectStore(TIER_STATE_STORE);

            const clearReq = assetsStore.clear();
            clearReq.onerror = () => reject(clearReq.error);
            clearReq.onsuccess = () => {
                assetRecords.forEach((record) => assetsStore.put(record));
                stateStore.put(stateRecord);
            };

            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    } catch (error) {
        console.warn("Falha ao salvar tier list:", error);
    }
}

function scheduleTierListSave() {
    if (state.tierList.saveTimer) {
        clearTimeout(state.tierList.saveTimer);
    }

    state.tierList.saveTimer = setTimeout(() => {
        state.tierList.saveTimer = null;
        saveTierListNow();
    }, TIER_SAVE_DEBOUNCE_MS);
}

async function loadTierListFromStorage() {
    try {
        const db = await openTierDatabase();

        const [savedState, savedAssets] = await Promise.all([
            new Promise((resolve, reject) => {
                const tx = db.transaction(TIER_STATE_STORE, "readonly");
                const req = tx.objectStore(TIER_STATE_STORE).get(TIER_STATE_ID);
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => reject(req.error);
            }),
            new Promise((resolve, reject) => {
                const tx = db.transaction(TIER_ASSET_STORE, "readonly");
                const req = tx.objectStore(TIER_ASSET_STORE).getAll();
                req.onsuccess = () => resolve(req.result || []);
                req.onerror = () => reject(req.error);
            })
        ]);

        if (!savedState) return false;

        revokeAllTierObjectUrls();

        const assetMap = new Map();
        savedAssets.forEach((record) => {
            if (!record || !record.id) return;

            if (record.sourceType === "blob" && record.blob instanceof Blob) {
                const blobUrl = URL.createObjectURL(record.blob);
                state.tierList.objectUrls.push(blobUrl);
                assetMap.set(record.id, {
                    id: record.id,
                    title: record.title || "Imagem",
                    src: blobUrl,
                    isUploaded: true,
                    blob: record.blob
                });
                return;
            }

            assetMap.set(record.id, {
                id: record.id,
                title: record.title || "Imagem",
                src: record.src || "",
                isUploaded: false
            });
        });

        const tierKeys = Object.keys(state.tierList.tiers);
        tierKeys.forEach((tierKey) => {
            const ids = Array.isArray(savedState.tiers?.[tierKey]) ? savedState.tiers[tierKey] : [];
            state.tierList.tiers[tierKey] = ids.map((id) => assetMap.get(id)).filter(Boolean);
        });

        const poolIds = Array.isArray(savedState.pool) ? savedState.pool : [];
        state.tierList.pool = poolIds.map((id) => assetMap.get(id)).filter(Boolean);

        state.tierList.title = String(savedState.title || "Tier List de Jogos");
        state.tierList.labelWidth = Number(savedState.labelWidth) || 72;
        state.tierList.labels = {
            ...state.tierList.labels,
            ...(savedState.labels || {})
        };

        const idsFromAssets = savedAssets
            .map((entry) => String(entry.id || ""))
            .map((id) => Number(id.replace("tier-item-", "")))
            .filter((n) => Number.isFinite(n));
        const maxId = idsFromAssets.length ? Math.max(...idsFromAssets) : 0;
        state.tierList.nextId = Math.max(state.tierList.nextId, maxId + 1);

        return true;
    } catch (error) {
        console.warn("Falha ao carregar tier list:", error);
        return false;
    }
}

function getTierColor(tierKey) {
    const colors = {
        S: "#ff7a7a",
        A: "#f2b976",
        B: "#f3d97b",
        C: "#ecf07b",
        D: "#adea73",
        E: "#78e976",
        F: "#76dfdb",
        "Don't know": "#76a9df",
        "Doesn't count": "#7f7ae2"
    };
    return colors[tierKey] || "#d4a853";
}

function getTierContainerByName(name) {
    if (name === "pool") return state.tierList.pool;
    return state.tierList.tiers[name] || null;
}

function removeTierItemById(itemId) {
    const fromPoolIndex = state.tierList.pool.findIndex((item) => item.id === itemId);
    if (fromPoolIndex >= 0) {
        const [removed] = state.tierList.pool.splice(fromPoolIndex, 1);
        return removed;
    }

    const tierNames = Object.keys(state.tierList.tiers);
    for (let i = 0; i < tierNames.length; i += 1) {
        const tierName = tierNames[i];
        const tierArr = state.tierList.tiers[tierName];
        const itemIndex = tierArr.findIndex((item) => item.id === itemId);
        if (itemIndex >= 0) {
            const [removed] = tierArr.splice(itemIndex, 1);
            return removed;
        }
    }

    return null;
}

function renderTierList() {
    const board = document.getElementById("bi-tier-board");
    const boardWrap = document.getElementById("bi-tier-board-wrap");
    const pool = document.getElementById("bi-tier-pool");
    const titleInput = document.getElementById("bi-tier-title-input");
    if (!board || !boardWrap || !pool) return;

    boardWrap.style.setProperty("--bi-tier-label-width", `${state.tierList.labelWidth}px`);
    board.style.setProperty("--bi-tier-label-width", `${state.tierList.labelWidth}px`);

    if (titleInput && titleInput.value !== state.tierList.title) {
        titleInput.value = state.tierList.title;
    }

    board.innerHTML = "";

    Object.keys(state.tierList.tiers).forEach((tierKey) => {
        const row = document.createElement("div");
        row.className = "bi-tier-row";

        const label = document.createElement("div");
        label.className = "bi-tier-label";
        label.style.background = getTierColor(tierKey);

        const labelInput = document.createElement("textarea");
        labelInput.className = "bi-tier-label-input";
        labelInput.dataset.tierKey = tierKey;
        labelInput.value = state.tierList.labels[tierKey] || tierKey;
        labelInput.setAttribute("aria-label", `Nome do tier ${tierKey}`);
        labelInput.rows = 2;
        label.appendChild(labelInput);

        const dropzone = document.createElement("div");
        dropzone.className = "bi-tier-dropzone";
        dropzone.dataset.target = tierKey;

        state.tierList.tiers[tierKey].forEach((item) => {
            const itemEl = document.createElement("div");
            itemEl.className = "bi-tier-item";
            itemEl.draggable = true;
            itemEl.dataset.itemId = item.id;
            itemEl.title = item.title;
            itemEl.innerHTML = `<img src="${item.src}" alt="${item.title}">`;
            dropzone.appendChild(itemEl);
        });

        row.appendChild(label);
        row.appendChild(dropzone);
        board.appendChild(row);
    });

    pool.innerHTML = "";
    pool.dataset.target = "pool";
    state.tierList.pool.forEach((item) => {
        const itemEl = document.createElement("div");
        itemEl.className = "bi-tier-item";
        itemEl.draggable = true;
        itemEl.dataset.itemId = item.id;
        itemEl.title = item.title;
        itemEl.innerHTML = `<img src="${item.src}" alt="${item.title}">`;
        pool.appendChild(itemEl);
    });
}

async function exportTierListToPng() {
    const tierBlock = document.getElementById("bi-tier-block");
    const exportBtn = document.getElementById("bi-tier-export-png");

    if (!tierBlock || !exportBtn) return;

    if (typeof window.html2canvas !== "function") {
        alert("Exportacao de PNG indisponivel no momento.");
        return;
    }

    const originalLabel = exportBtn.textContent;
    exportBtn.disabled = true;
    exportBtn.textContent = "Exportando...";

    try {
        const canvas = await window.html2canvas(tierBlock, {
            backgroundColor: "#0b1110",
            useCORS: true,
            scale: 2,
            logging: false
        });

        const imageData = canvas.toDataURL("image/png");

        const now = new Date();
        const fileName = `tier-list-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}.png`;

        const link = document.createElement("a");
        link.href = imageData;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
    } catch (error) {
        console.error("Erro ao exportar PNG:", error);
        alert("Nao foi possivel exportar o PNG agora.");
    } finally {
        exportBtn.disabled = false;
        exportBtn.textContent = originalLabel;
    }
}

function bindTierListEvents() {
    if (state.tierList.initialized) return;

    const section = document.getElementById("bi-tier-block") || document;
    const uploadInput = document.getElementById("bi-tier-upload");
    const exportPngBtn = document.getElementById("bi-tier-export-png");
    const titleInput = document.getElementById("bi-tier-title-input");
    const boardWrap = document.getElementById("bi-tier-board-wrap");
    const resizer = document.getElementById("bi-tier-resizer");
    const board = document.getElementById("bi-tier-board");
    const pool = document.getElementById("bi-tier-pool");
    const trash = document.getElementById("bi-tier-trash");

    if (!uploadInput || !exportPngBtn || !titleInput || !boardWrap || !resizer || !board || !pool || !trash) return;

    const activateOver = (element) => element?.classList.add("is-over");
    const deactivateOver = (element) => element?.classList.remove("is-over");

    const handleDragStart = (event) => {
        const target = event.target.closest(".bi-tier-item");
        if (!target) return;
        event.dataTransfer.setData("text/plain", target.dataset.itemId || "");
        event.dataTransfer.effectAllowed = "move";
    };

    const handleDragOver = (event) => {
        const target = event.target.closest(".bi-tier-dropzone, .bi-tier-pool, .bi-tier-trash");
        if (!target) return;
        event.preventDefault();
        activateOver(target);
    };

    const handleDragLeave = (event) => {
        const target = event.target.closest(".bi-tier-dropzone, .bi-tier-pool, .bi-tier-trash");
        if (!target) return;
        deactivateOver(target);
    };

    const handleDrop = (event) => {
        const target = event.target.closest(".bi-tier-dropzone, .bi-tier-pool, .bi-tier-trash");
        if (!target) return;
        event.preventDefault();
        deactivateOver(target);

        const itemId = event.dataTransfer.getData("text/plain");
        if (!itemId) return;

        const movedItem = removeTierItemById(itemId);
        if (!movedItem) return;

        if (target.classList.contains("bi-tier-trash")) {
            if (movedItem.isUploaded && movedItem.src.startsWith("blob:")) {
                revokeTierObjectUrl(movedItem.src);
            }
            renderTierList();
            scheduleTierListSave();
            return;
        }

        const targetName = target.dataset.target;
        const targetContainer = getTierContainerByName(targetName);
        if (!targetContainer) return;

        targetContainer.push(movedItem);
        renderTierList();
        scheduleTierListSave();
    };

    const handleUpload = (event) => {
        const files = Array.from(event.target.files || []);
        files.forEach((file) => {
            if (!file.type.startsWith("image/")) return;
            state.tierList.pool.push(createTierItemFromUpload(file));
        });

        renderTierList();
        scheduleTierListSave();
        uploadInput.value = "";
    };

    const handleTitleEdit = (event) => {
        const value = String(event.target.value || "").trim();
        state.tierList.title = value || "Tier List de Jogos";
        if (!value) event.target.value = state.tierList.title;
        scheduleTierListSave();
    };

    const handleTierLabelEdit = (event) => {
        const target = event.target;
        if (!target.classList.contains("bi-tier-label-input")) return;
        const tierKey = target.dataset.tierKey;
        if (!tierKey) return;

        const value = String(target.value || "").trim();
        state.tierList.labels[tierKey] = value || tierKey;
        if (!value) target.value = tierKey;
        scheduleTierListSave();
    };

    let isResizing = false;
    let startX = 0;
    let startWidth = state.tierList.labelWidth;

    const beginResize = (clientX) => {
        isResizing = true;
        startX = clientX;
        startWidth = state.tierList.labelWidth;
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
    };

    const applyResize = (clientX) => {
        if (!isResizing) return;
        const delta = clientX - startX;
        const next = Math.min(220, Math.max(72, startWidth + delta));
        state.tierList.labelWidth = next;
        boardWrap.style.setProperty("--bi-tier-label-width", `${next}px`);
        board.style.setProperty("--bi-tier-label-width", `${next}px`);
        scheduleTierListSave();
    };

    const endResize = () => {
        if (!isResizing) return;
        isResizing = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
    };

    section.addEventListener("dragstart", handleDragStart);
    section.addEventListener("dragover", handleDragOver);
    section.addEventListener("dragleave", handleDragLeave);
    section.addEventListener("drop", handleDrop);
    section.addEventListener("change", handleTierLabelEdit);
    section.addEventListener("input", handleTierLabelEdit);
    uploadInput.addEventListener("change", handleUpload);
    exportPngBtn.addEventListener("click", exportTierListToPng);
    titleInput.addEventListener("change", handleTitleEdit);
    titleInput.addEventListener("input", handleTitleEdit);

    resizer.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        beginResize(event.clientX);
    });

    window.addEventListener("pointermove", (event) => {
        applyResize(event.clientX);
    });

    window.addEventListener("pointerup", () => {
        endResize();
    });

    state.tierList.initialized = true;
}

function seedTierPool(topByTime) {
    const seen = new Set();
    state.tierList.pool.forEach((item) => seen.add(item.title.toLowerCase()));
    Object.keys(state.tierList.tiers).forEach((tierName) => {
        state.tierList.tiers[tierName].forEach((item) => seen.add(item.title.toLowerCase()));
    });

    let addedCount = 0;

    topByTime.slice(0, 20).forEach((item) => {
        if (!item) return;
        const title = String(item.jogo || "Sem titulo").trim();
        const key = title.toLowerCase();
        if (!title || seen.has(key)) return;

        const src = getCoverFromRow(item.row, title);
        if (!src) return;

        seen.add(key);
        state.tierList.pool.push(createTierItem(title, src, false));
        addedCount += 1;
    });

    return addedCount;
}

function renderBiGamer() {
    const rows = getOverviewFilteredRows();
    const headers = state.resolvedHeaders;
    const dificuldadeHeader = findHeader([/dificuldade/, /difficulty/]);

    const totalEl = document.getElementById("bi-total");
    const concluidosEl = document.getElementById("bi-concluidos");
    const jogandoEl = document.getElementById("bi-jogando");
    const pendentesEl = document.getElementById("bi-pendentes");
    const horasJogadasEl = document.getElementById("bi-horas-jogadas");
    const horasPendentesEl = document.getElementById("bi-horas-pendentes");
    const mediaGameplayEl = document.getElementById("bi-media-gameplay");
    const mediaZeradosEl = document.getElementById("bi-media-zerados");
    const soloMaisJogadoEl = document.getElementById("bi-solo-mais-jogado");
    const difComumEl = document.getElementById("bi-dif-comum");
    const difHorasEl = document.getElementById("bi-dif-horas");
    const taxaEl = document.getElementById("bi-taxa-conclusao");
    const notaMediaEl = document.getElementById("bi-nota-media");
    const topPlataformaEl = document.getElementById("bi-top-plataforma");
    const topMultiEl = document.getElementById("bi-top-multi");
    const topJogosEl = document.getElementById("bi-top-jogos");
    const chartEl = document.getElementById("chart-bi-plataforma");

    if (!totalEl || !concluidosEl || !jogandoEl || !pendentesEl || !horasJogadasEl || !horasPendentesEl || !mediaGameplayEl || !mediaZeradosEl || !soloMaisJogadoEl || !difComumEl || !difHorasEl || !taxaEl || !notaMediaEl || !topPlataformaEl || !topMultiEl || !topJogosEl) {
        return;
    }

    const statusStats = { concluidos: 0, jogando: 0, pendentes: 0 };
    const plataformaCount = {};
    const multiplayerCount = {};
    const dificuldadeCount = {};
    const dificuldadeHoras = {};

    let segundosJogados = 0;
    let segundosPendentes = 0;
    let notaSum = 0;
    let notaCount = 0;

    const tempoRows = rows.map((row) => {
        const jogoNome = getRowValue(row, headers.jogo) || "Desconhecido";
        const seconds = parseTimeToSeconds(getRowValue(row, headers.tempo)) || 0;
        const st = normalizeText(getRowValue(row, headers.status));
        const jogoNomeLower = normalizeText(jogoNome);
        const isCS2 = jogoNomeLower.includes("counter strike 2") || jogoNomeLower.includes("counter-strike 2");
        const multiType = normalizeText(getRowMultiplayerType(row));

        const isJogado = st === "concluido" || st === "dropado" || st === "jogando";
        const isPendente = st === "iniciado" || st === "logo jogo" || st === "logo" || st === "pausado" || st === "pendente";

        if (seconds > 0) {
            if (isJogado) segundosJogados += seconds;
            if (isPendente) segundosPendentes += seconds;
        }

        return {
            row,
            jogo: jogoNome,
            seconds,
            st,
            isJogado,
            isPendente,
            isSolo: multiType === "solo",
            isCS2
        };
    });

    rows.forEach((row) => {
        const status = normalizeText(getRowValue(row, headers.status));
        const tempo = parseTimeToSeconds(getRowValue(row, headers.tempo)) || 0;
        const plataforma = getRowValue(row, headers.plataforma) || "N/A";
        const multiType = getRowMultiplayerType(row) || "N/A";
        const nota = parseNumber(getRowValue(row, headers.avaliacao));
        const dificuldade = String(row[dificuldadeHeader] || "").trim();

        if (status === "concluido") statusStats.concluidos += 1;
        if (status === "jogando") statusStats.jogando += 1;
        if (status === "pendente") statusStats.pendentes += 1;

        plataformaCount[plataforma] = (plataformaCount[plataforma] || 0) + 1;
        multiplayerCount[multiType] = (multiplayerCount[multiType] || 0) + 1;

        if (dificuldade) {
            dificuldadeCount[dificuldade] = (dificuldadeCount[dificuldade] || 0) + 1;
            dificuldadeHoras[dificuldade] = (dificuldadeHoras[dificuldade] || 0) + tempo;
        }

        if (nota !== null) {
            notaSum += nota;
            notaCount += 1;
        }
    });

    const total = rows.length;
    const taxa = total ? ((statusStats.concluidos / total) * 100) : 0;
    const notaMedia = notaCount ? (notaSum / notaCount) : 0;

    const topPlataforma = Object.entries(plataformaCount).sort((a, b) => b[1] - a[1])[0]?.[0] || "-";
    const topMulti = Object.entries(multiplayerCount).sort((a, b) => b[1] - a[1])[0]?.[0] || "-";
    const topDificuldadeComum = Object.entries(dificuldadeCount).sort((a, b) => b[1] - a[1])[0]?.[0] || "-";
    const topDificuldadeHoras = Object.entries(dificuldadeHoras).sort((a, b) => b[1] - a[1])[0]?.[0] || "-";

    const jogadosSemCS = tempoRows.filter((item) => item.seconds > 0 && item.isJogado && !item.isCS2);
    const mediaGameplay = jogadosSemCS.length > 0
        ? jogadosSemCS.reduce((acc, item) => acc + item.seconds, 0) / jogadosSemCS.length
        : 0;

    const concluidos = tempoRows.filter((item) => item.seconds > 0 && item.st === "concluido");
    const mediaZerados = concluidos.length > 0
        ? concluidos.reduce((acc, item) => acc + item.seconds, 0) / concluidos.length
        : 0;

    const soloMaisJogado = tempoRows
        .filter((item) => item.seconds > 0 && item.isJogado && item.isSolo)
        .sort((a, b) => b.seconds - a.seconds)[0]?.jogo || "-";

    totalEl.textContent = String(total);
    concluidosEl.textContent = String(statusStats.concluidos);
    jogandoEl.textContent = String(statusStats.jogando);
    pendentesEl.textContent = String(statusStats.pendentes);
    horasJogadasEl.textContent = formatHoursCompact(segundosJogados);
    horasPendentesEl.textContent = formatHoursCompact(segundosPendentes);
    mediaGameplayEl.textContent = formatHoursCompact(mediaGameplay);
    mediaZeradosEl.textContent = formatHoursCompact(mediaZerados);
    soloMaisJogadoEl.textContent = soloMaisJogado;
    difComumEl.textContent = topDificuldadeComum;
    difHorasEl.textContent = topDificuldadeHoras;
    taxaEl.textContent = `${taxa.toFixed(1)}%`;
    notaMediaEl.textContent = notaCount ? notaMedia.toFixed(1) : "-";
    topPlataformaEl.textContent = topPlataforma;
    topMultiEl.textContent = topMulti;

    const topByTime = tempoRows
        .filter((item) => item.seconds > 0)
        .sort((a, b) => b.seconds - a.seconds)
        .slice(0, 8);

    topJogosEl.innerHTML = "";
    topByTime.forEach((item) => {
        const row = document.createElement("div");
        row.className = "bi-top-item";
        row.innerHTML = `<span>${item.jogo}</span><strong>${formatHoursCompact(item.seconds)}</strong>`;
        topJogosEl.appendChild(row);
    });

    bindTierListEvents();

    if (!state.tierList.loadAttempted) {
        state.tierList.loadAttempted = true;
        loadTierListFromStorage().then((loaded) => {
            state.tierList.loaded = true;

            if (!loaded) {
                const added = seedTierPool(topByTime);
                if (added > 0) scheduleTierListSave();
            }

            renderTierList();
        });
    } else {
        if (state.tierList.loaded) {
            const added = seedTierPool(topByTime);
            if (added > 0) scheduleTierListSave();
        }
        renderTierList();
    }

    if (chartEl && typeof Chart !== "undefined") {
        const platEntries = Object.entries(plataformaCount).sort((a, b) => b[1] - a[1]).slice(0, 6);
        const labels = platEntries.map(([label]) => label);
        const values = platEntries.map(([, value]) => value);

        if (state.charts.biPlataforma) state.charts.biPlataforma.destroy();
        state.charts.biPlataforma = new Chart(chartEl, {
            type: "bar",
            data: {
                labels,
                datasets: [{
                    label: "Jogos",
                    data: values,
                    backgroundColor: ["#d4a853", "#c9952a", "#1a9fda", "#00d4ff", "#a07830", "#f0c95c"],
                    borderWidth: 0,
                    borderRadius: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: { display: false },
                    title: {
                        display: true,
                        text: "Distribuicao por plataforma",
                        color: "#d0d5dd",
                        font: { size: 15 }
                    }
                },
                scales: {
                    y: { ticks: { color: "#d4a853" }, grid: { color: "rgba(212, 168, 83, 0.12)" } },
                    x: { ticks: { color: "#d4a853" }, grid: { display: false } }
                }
            }
        });
    }
}

function renderTempoJogo() {
    const tempoHeader = state.resolvedHeaders.tempo;
    const jogoHeader = state.resolvedHeaders.jogo;
    const statusHeader = state.resolvedHeaders.status;

    const ctxTopTempo = document.getElementById("chart-top-tempo");
    const ctxCurtosZerados = document.getElementById("chart-curtos-zerados");

    if (!tempoHeader || !jogoHeader || !statusHeader) return;

    let segundosJogados = 0;
    let segundosPendentes = 0;

    const parsedRows = getOverviewFilteredRows().map(row => {
        const tempoRaw = String(row[tempoHeader] || "");
        const seconds = parseTimeToSeconds(tempoRaw) || 0;
        
        let formattedTempo = tempoRaw;
        if (/^[\d,.-]+$/.test(tempoRaw.trim())) {
            formattedTempo += "h";
        }

        const jogoNome = String(row[jogoHeader] || "Desconhecido");
        const jogoNomeLower = normalizeText(jogoNome);
        const statusReal = String(row[statusHeader] || "");
        const st = normalizeText(statusReal);
        const isCS2 = jogoNomeLower.includes("counter strike 2") || jogoNomeLower.includes("counter-strike 2");
        const multiType = normalizeText(getRowMultiplayerType(row));

        const isJogado = st === "concluido" || st === "dropado" || st === "jogando";
        const isPendente = st === "iniciado" || st === "logo jogo" || st === "logo" || st === "pausado" || st === "pendente";

        if (seconds > 0) {
            if (isJogado) {
                segundosJogados += seconds;
            }
            if (isPendente) {
                segundosPendentes += seconds;
            }
        }

        return {
            row: row,
            jogo: jogoNome,
            isCS2: isCS2,
            st: st,
            isJogado: isJogado,
            isSolo: multiType === "solo",
            tempoRaw: formattedTempo,
            seconds: seconds
        };
    }).filter(item => item.seconds > 0);

    const totalHorasJogadasEl = document.getElementById("total-horas-jogadas");
    if (totalHorasJogadasEl) {
        totalHorasJogadasEl.textContent = Math.floor(segundosJogados / 3600) + "h";
    }

    const totalHorasPendentesEl = document.getElementById("total-horas-pendentes");
    if (totalHorasPendentesEl) {
        totalHorasPendentesEl.textContent = Math.floor(segundosPendentes / 3600) + "h";
    }

    const jogadosSemCS = parsedRows.filter(item => item.isJogado && !item.isCS2).sort((a, b) => b.seconds - a.seconds);

    const mediaGameplayEl = document.getElementById("media-gameplay");
    if (mediaGameplayEl) {
        const totalSegundosSemCS = jogadosSemCS.reduce((acc, item) => acc + item.seconds, 0);
        const mediaGameplay = jogadosSemCS.length > 0 ? totalSegundosSemCS / jogadosSemCS.length : 0;
        mediaGameplayEl.textContent = Math.floor(mediaGameplay / 3600) + "h";
    }

    const concluidos = parsedRows.filter(item => item.st === "concluido");
    const mediaZeradosEl = document.getElementById("media-zerados");
    if (mediaZeradosEl) {
        const totalSegundosZerados = concluidos.reduce((acc, item) => acc + item.seconds, 0);
        const mediaZerados = concluidos.length > 0 ? totalSegundosZerados / concluidos.length : 0;
        mediaZeradosEl.textContent = Math.floor(mediaZerados / 3600) + "h";
    }

    const soloMaisJogadoEl = document.getElementById("solo-mais-jogado");
    if (soloMaisJogadoEl) {
        const jogosSoloJogados = parsedRows.filter(item => item.isJogado && item.isSolo).sort((a,b) => b.seconds - a.seconds);
        soloMaisJogadoEl.textContent = jogosSoloJogados.length > 0 ? jogosSoloJogados[0].jogo : "-";
    }

    if (ctxTopTempo && typeof Chart !== "undefined") {
        const top10Jogados = jogadosSemCS.slice(0, 10);
        const labels10 = top10Jogados.map(item => item.jogo.length > 20 ? item.jogo.substring(0, 17) + "..." : item.jogo);
        const data10 = top10Jogados.map(item => (item.seconds / 3600).toFixed(1));

        if (state.charts.tempoTop) state.charts.tempoTop.destroy();
        state.charts.tempoTop = new Chart(ctxTopTempo, {
            type: "bar",
            data: {
                labels: labels10,
                datasets: [{
                    label: "Horas Jogadas",
                    data: data10,
                    backgroundColor: "#1a9fda",
                    borderColor: "#0080b0",
                    borderWidth: 1
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: { display: false },
                    title: { display: true, text: "TOP 10 JOGOS MAIS JOGADOS", color: "#d4a853", font: { size: 16 } }
                },
                scales: {
                    y: { ticks: { color: "#d4a853" }, grid: { display: false } },
                    x: { ticks: { color: "#d4a853" }, grid: { color: "rgba(212, 168, 83, 0.1)" } }
                }
            }
        });
    }

    if (ctxCurtosZerados && typeof Chart !== "undefined") {
        const concluidosAsc = parsedRows.filter(item => item.st === "concluido").sort((a, b) => a.seconds - b.seconds);
        const top10Curtos = concluidosAsc.slice(0, 10);
        const labelsCurtos = top10Curtos.map(item => item.jogo.length > 20 ? item.jogo.substring(0, 17) + "..." : item.jogo);
        const dataCurtos = top10Curtos.map(item => (item.seconds / 3600).toFixed(1));

        if (state.charts.tempoCurtos) state.charts.tempoCurtos.destroy();
        state.charts.tempoCurtos = new Chart(ctxCurtosZerados, {
            type: "bar",
            data: {
                labels: labelsCurtos,
                datasets: [{
                    label: "Horas Jogadas",
                    data: dataCurtos,
                    backgroundColor: "#00d4ff",
                    borderColor: "#1a9fda",
                    borderWidth: 1
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: { display: false },
                    title: { display: true, text: "TOP 10 JOGOS MAIS CURTOS ZERADOS", color: "#d4a853", font: { size: 16 } }
                },
                scales: {
                    y: { ticks: { color: "#d4a853" }, grid: { display: false } },
                    x: { ticks: { color: "#d4a853" }, grid: { color: "rgba(212, 168, 83, 0.1)" } }
                }
            }
        });
    }

    const listaTempo = document.getElementById("lista-tempo");
    if (listaTempo) {
        listaTempo.innerHTML = "";
        const top30 = jogadosSemCS.slice(0, 30);
        top30.forEach(item => {
            const div = document.createElement("div");
            div.className = "list-item";
            div.innerHTML = `<div class="list-item-title">${item.jogo}</div><div class="list-item-value">${item.tempoRaw}</div>`;
            listaTempo.appendChild(div);
        });
    }
}


function renderDificuldade() {
    const dificuldadeHeader = findHeader([/dificuldade/, /difficulty/]);
    const tempoHeader = state.resolvedHeaders.tempo;
    
    const grid = document.getElementById("grid-dificuldade");
    const ctxDifBar = document.getElementById("chart-dificuldade-bar");
    const divDifHoras = document.getElementById("chart-dificuldade-horas");

    if (!grid) return;
    grid.innerHTML = "";

    const dificCount = {};
    const dificHoras = {};
    let totalJogosAvaliados = 0;

    getOverviewFilteredRows().forEach(row => {
        const dif = String(row[dificuldadeHeader] || "").trim();
        const tempoRaw = String(row[tempoHeader] || "");
        const seconds = parseTimeToSeconds(tempoRaw) || 0;

        if (dif) {
            dificCount[dif] = (dificCount[dif] || 0) + 1;
            dificHoras[dif] = (dificHoras[dif] || 0) + seconds;
            totalJogosAvaliados++;
        }
    });

    const difTotalEl = document.getElementById("dif-total");
    if (difTotalEl) difTotalEl.textContent = totalJogosAvaliados;

    const sortedDifs = Object.entries(dificCount).sort((a, b) => b[1] - a[1]);
    
    const difComumEl = document.getElementById("dif-comum");
    if (difComumEl) {
        difComumEl.textContent = sortedDifs.length > 0 ? sortedDifs[0][0] : "-";
    }

    const sortedHoras = Object.entries(dificHoras).sort((a, b) => b[1] - a[1]);
    const difHorasEl = document.getElementById("dif-horas");
    if (difHorasEl) {
        difHorasEl.textContent = sortedHoras.length > 0 ? sortedHoras[0][0] : "-";
    }

    if (ctxDifBar && typeof Chart !== "undefined") {
        const treemapData = sortedDifs.map(item => ({ name: item[0], value: item[1] }));

        if (state.charts.dificuldadeBar) state.charts.dificuldadeBar.destroy();
        state.charts.dificuldadeBar = new Chart(ctxDifBar, {
            type: "treemap",
            data: {
                datasets: [{
                    tree: treemapData,
                    key: "value",
                    labels: {
                        display: true,
                        formatter: (ctx) => {
                            const data = ctx.raw._data;
                            if (data && data.name) {
                                return [data.name, String(data.value)];
                            }
                            return "";
                        },
                        font: [{ size: 14, weight: 'bold' }, { size: 12 }],
                        color: "#fff"
                    },
                    backgroundColor: (ctx) => {
                        const levelColors = {
                            "BASTA TER CÉREBRO": "#2ecc71",
                            "MAMÃO COM AÇÚCAR": "#f1c40f",
                            "MÉDIO": "#3498db",
                            "PRECISA DE UM ESFORÇO": "#e67e22",
                            "REALMENTE TRABALHOSO": "#e74c3c",
                            "SEKIRO": "#8e44ad"
                        };
                        const label = ctx.raw ? ctx.raw._data.name : "";
                        return levelColors[label] || "#2a2530";
                    },
                    borderColor: "var(--bg-2)",
                    borderWidth: 2,
                    spacing: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: { display: false },
                    title: { display: true, text: "JOGOS POR DIFICULDADE", color: "#d4a853", font: { size: 16 } },
                    tooltip: {
                        callbacks: {
                            title: () => "",
                            label: (ctx) => {
                                const data = ctx.raw._data;
                                return data ? `${data.name}: ${data.value} jogos` : "";
                            }
                        }
                    }
                }
            }
        });
    }

    if (divDifHoras && typeof google !== "undefined") {
          google.charts.load("current", {packages:["corechart"]});
          const drawChart = () => {
              const dataTable = new google.visualization.DataTable();
              dataTable.addColumn("string", "Dificuldade");
              dataTable.addColumn("number", "Horas");

              const levelColors = {
                  "BASTA TER CÉREBRO": "#2ecc71",
                  "MAMÃO COM AÇÚCAR": "#f1c40f",
                  "MÉDIO": "#3498db",
                  "PRECISA DE UM ESFORÇO": "#e67e22",
                  "REALMENTE TRABALHOSO": "#e74c3c",
                  "SEKIRO": "#8e44ad"
              };

              const colorsArr = [];
              sortedHoras.forEach(item => {
                  const hours = parseFloat((item[1] / 3600).toFixed(1));
                  dataTable.addRow([item[0], hours]);
                  colorsArr.push(levelColors[item[0]] || "#2a2530");
              });

              const options = {
                  title: "HORAS POR DIFICULDADE",
                  is3D: true,
                  backgroundColor: "transparent",
                  colors: colorsArr,
                  titleTextStyle: { color: "#d4a853", fontSize: 16, bold: true },
                  legend: { position: "right", textStyle: { color: "#d4a853" } },
                  chartArea: { width: "100%", height: "80%" }
              };

              const chart = new google.visualization.PieChart(divDifHoras);
              chart.draw(dataTable, options);
          };
          google.charts.setOnLoadCallback(drawChart);
      }

    Object.entries(dificCount).sort((a, b) => b[1] - a[1]).forEach(([dif, count]) => {
        const secs = dificHoras[dif] || 0;
        const stringHoras = formatSecondsToTime(secs);
        const card = document.createElement("div");
        card.className = "dificuldade-card";
        card.innerHTML = `<strong>${dif}</strong><span>${stringHoras} horas</span>`;
        grid.appendChild(card);
    });

    // Show hardcore games (SEKIRO e REALMENTE TRABALHOSO)
    const listSekiro = document.getElementById("list-sekiro");
    const listTrabalhoso = document.getElementById("list-trabalhoso");
    
    if (listSekiro && listTrabalhoso) {
        listSekiro.innerHTML = "";
        listTrabalhoso.innerHTML = "";
        
        const titleHeader = findHeader([/jogo/, /titulo/, /nome/]);
        
        const sekiroGames = [];
        const trabalhosoGames = [];
        
        getOverviewFilteredRows().forEach(row => {
            const dif = String(row[dificuldadeHeader] || "").trim().toUpperCase();
            const name = String(row[titleHeader] || "").trim();
            if (dif === "SEKIRO") sekiroGames.push(name);
            if (dif === "REALMENTE TRABALHOSO") trabalhosoGames.push(name);
        });
        
        if (sekiroGames.length === 0) listSekiro.innerHTML = "<span class='hardcore-game-item'>Nenhum no momento</span>";
        else sekiroGames.forEach(jogo => {
            const el = document.createElement("div");
            el.className = "hardcore-game-item";
            el.textContent = jogo;
            listSekiro.appendChild(el);
        });
        
        if (trabalhosoGames.length === 0) listTrabalhoso.innerHTML = "<span class='hardcore-game-item'>Nenhum no momento</span>";
        else trabalhosoGames.forEach(jogo => {
            const el = document.createElement("div");
            el.className = "hardcore-game-item";
            el.textContent = jogo;
            listTrabalhoso.appendChild(el);
        });
    }
}

function renderPlataforma() {
    const platHeader = findHeader([/plataforma/, /platform/]);
    const grid = document.getElementById("grid-plataforma");
    if (!grid) return;
    grid.innerHTML = "";

    const platCount = {};
    getOverviewFilteredRows().forEach(row => {
        const plat = String(row[platHeader] || "").trim();
        if (plat) platCount[plat] = (platCount[plat] || 0) + 1;
    });

    Object.entries(platCount).sort((a, b) => b[1] - a[1]).forEach(([plat, count]) => {
        const item = document.createElement("div");
        item.className = "platform-item";
        item.innerHTML = `<strong>${count}<\/strong><span>${plat}<\/span>`;
        grid.appendChild(item);
    });
}

function renderAvaliacao() {
    const avaliacaoHeader = findHeader([/avaliacao pessoal/, /avaliacao/, /nota/]);
    const jogoHeader = findHeader([/jogo/, /titulo/, /nome/]);

    const lista = document.getElementById("lista-avaliacao");
    if (!lista) return;
    lista.innerHTML = "";

    const sorted = [...getOverviewFilteredRows()].sort((a, b) => {
        const avaA = parseNumber(a[avaliacaoHeader] || "") || 0;
        const avaB = parseNumber(b[avaliacaoHeader] || "") || 0;
        return avaB - avaA;
    });

    sorted.slice(0, 20).forEach(row => {
        const item = document.createElement("div");
        item.className = "list-item";
        const ava = String(row[avaliacaoHeader] || "");
        const jogo = String(row[jogoHeader] || "");
        item.innerHTML = `
            <div class="list-item-title">${jogo}<\/div>
            <div class="list-item-value">${ava}<\/div>
        `;
        lista.appendChild(item);
    });
}

function switchTab(tabId) {
    dom.tabBtns.forEach(btn => btn.classList.remove("active"));
    dom.tabContents.forEach(content => content.classList.remove("active"));

    const targetBtn = document.querySelector(`[data-tab="${tabId}"]`);
    const targetContent = document.getElementById(tabId);
    if (!targetBtn || !targetContent) return;

    targetBtn.classList.add("active");
    targetContent.classList.add("active");

    // Alternate background between tabs
    const bg2Tabs = ["bi-gamer", "dificuldade", "avaliacao", "tabela"];
    document.body.classList.toggle("bg-2", bg2Tabs.includes(tabId));

    if (dom.filtersTop) {
        dom.filtersTop.hidden = tabId === "tabela";
    }

    if (tabId === "visao-geral") {
        renderVisaoGeral();
    } else if (tabId === "bi-gamer") {
        renderBiGamer();
    } else if (tabId === "tempo-jogo") {
        renderTempoJogo();
    } else if (tabId === "dificuldade") {
        renderDificuldade();
    } else if (tabId === "plataforma") {
        renderPlataforma();
    } else if (tabId === "avaliacao") {
        renderAvaliacao();
    }
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
        resolveHeaders();

        keepValidFilters();

        // Keep data updates resilient even if some UI blocks are not present.
        renderHeaderAndFilters();
        renderSortColumnOptions();
        updateOverviewFilterSelects();
        renderTable();
        renderVisaoGeral();

        const activeTab = document.querySelector(".tab-btn.active")?.getAttribute("data-tab") || "visao-geral";
        if (activeTab === "bi-gamer") {
            renderBiGamer();
        }

        state.lastPayload = payload;
        updateStatus("Dados sincronizados com sucesso.", false);
    } catch (error) {
        console.error("Error fetching ranking data:", error);
        const reason = error instanceof Error ? error.message : String(error);
        updateStatus(`Falha ao atualizar dados da planilha (${reason}).`, true);
    }
}

function bindEvents() {
    if (dom.sortMode) {
        dom.sortMode.addEventListener("change", (event) => {
            state.sortMode = event.target.value;
            updateCustomSortVisibility();
            renderTable();
        });
    }

    if (dom.customSortColumn) {
        dom.customSortColumn.addEventListener("change", (event) => {
            state.customSortColumn = event.target.value;
            renderTable();
        });
    }

    if (dom.customSortDirection) {
        dom.customSortDirection.addEventListener("change", (event) => {
            state.customSortDirection = event.target.value;
            renderTable();
        });
    }

    if (dom.filterPlataforma) {
        dom.filterPlataforma.addEventListener("change", (event) => {
            state.overviewFilters.plataforma = event.target.value;
            const activeTab = document.querySelector(".tab-btn.active")?.getAttribute("data-tab") || "visao-geral";
            switchTab(activeTab);
        });
    }

    if (dom.filterMultiplayer) {
        dom.filterMultiplayer.addEventListener("change", (event) => {
            state.overviewFilters.multiplayer = event.target.value;
            const activeTab = document.querySelector(".tab-btn.active")?.getAttribute("data-tab") || "visao-geral";
            switchTab(activeTab);
        });
    }

    if (dom.filterAnoConclusao) {
        dom.filterAnoConclusao.addEventListener("change", (event) => {
            state.overviewFilters.anoConclusao = event.target.value;
            const activeTab = document.querySelector(".tab-btn.active")?.getAttribute("data-tab") || "visao-geral";
            switchTab(activeTab);
        });
    }

    if (dom.refreshButton) {
        dom.refreshButton.addEventListener("click", () => {
            fetchRankingData();
        });
    }

    dom.tabBtns.forEach(btn => {
        btn.addEventListener("click", (e) => {
            const tabId = e.target.getAttribute("data-tab");
            switchTab(tabId);
        });
    });
}

function init() {
    if (!dom.thead || !dom.tbody) return;

    bindEvents();
    updateCustomSortVisibility();
    if (dom.filtersTop) dom.filtersTop.hidden = false;
    fetchRankingData();

    setInterval(fetchRankingData, AUTO_REFRESH_MS);
}

window.addEventListener("beforeunload", () => {
    if (state.tierList.saveTimer) {
        clearTimeout(state.tierList.saveTimer);
        state.tierList.saveTimer = null;
        saveTierListNow();
    }
    revokeAllTierObjectUrls();
});

document.addEventListener("DOMContentLoaded", init);

