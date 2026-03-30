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
    resolvedHeaders: {
        jogo: null,
        status: null,
        tempo: null,
        avaliacao: null,
        plataforma: null,
        multiplayer: null,
        anoConclusao: null
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

function resolveHeaders() {
    state.resolvedHeaders = {
        jogo: findHeader([/jogo/, /titulo/, /nome/]),
        status: findHeader([/status/, /estado/, /situacao/]),
        tempo: findHeader([/tempo/, /duracao/, /duracao total/, /horas/, /time/]),
        avaliacao: findHeader([/avaliacao pessoal/, /avaliacao/, /nota pessoal/, /nota/, /score/]),
        plataforma: findHeader([/plataforma/, /platform/]),
        multiplayer: findHeader([/multiplayer/, /multijogador/, /multi jogador/, /co-op/, /coop/, /online/]),
        anoConclusao: findHeader([/ano de conclusao/, /ano conclusao/, /conclusao/, /ano que concluiu/, /finalizado em/])
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
    if (["nao", "não", "no", "n", "false", "falso", "0"].includes(text)) return "Não";

    if (text.includes("solo") || text.includes("single")) return "Não";
    if (text.includes("coop") || text.includes("co-op") || text.includes("online") || text.includes("multijogador") || text.includes("multiplayer")) return "Sim";

    return value;
}

function extractYear(value) {
    const text = String(value || "");
    const match = text.match(/(19\d{2}|20\d{2}|21\d{2})/);
    return match ? match[1] : "";
}

function isConcluidoByStatus(statusValue) {
    const status = normalizeText(statusValue);
    if (!status) return false;

    const concluidoTokens = ["concluido", "concluida", "completado", "completada", "finalizado", "finalizada", "zerado", "zerada", "platinado", "platinada", "100"];
    const pendenteTokens = ["pendente", "backlog", "nao iniciado", "não iniciado", "quero comprar", "wishlist", "jogando", "em andamento", "pausado"];

    if (pendenteTokens.some((token) => status.includes(token))) {
        return false;
    }

    return concluidoTokens.some((token) => status.includes(token));
}

function isJogandoByStatus(statusValue) {
    const status = normalizeText(statusValue);
    if (!status) return false;
    const jogandoTokens = ["jogando", "em andamento", "in progress", "iniciando", "atual", "ativo", "pausado", "talvez eu jogue"];
    return jogandoTokens.some((token) => status.includes(token));
}

function isPendenteByStatus(statusValue) {
    const status = normalizeText(statusValue);
    if (!status) return true;
    const pendenteTokens = ["pendente", "quero comprar", "nao iniciado", "não iniciado", "wishlist", "backlog", "so de graca", "só de graça", "talvez eu jogue", "descartado"];
    if (isConcluidoByStatus(statusValue) || isJogandoByStatus(statusValue)) return false;
    return pendenteTokens.some((token) => status.includes(token));
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
            const rowMultiRaw = getRowValue(row, headers.multiplayer);
            const rowMulti = normalizeYesNo(rowMultiRaw);
            if (normalizeText(rowMulti) !== normalizeText(multiplayer)) return false;
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
        const values = headers.multiplayer
            ? Array.from(new Set(state.rows.map((row) => normalizeYesNo(getRowValue(row, headers.multiplayer))).filter(Boolean))).sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }))
            : [];

        dom.filterMultiplayer.innerHTML = '<option value="">Todos<\/option>';
        values.forEach((value) => {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = value;
            dom.filterMultiplayer.appendChild(option);
        });
        dom.filterMultiplayer.value = state.overviewFilters.multiplayer || "";
    }

    if (dom.filterAnoConclusao) {
        const values = headers.anoConclusao
            ? Array.from(new Set(state.rows.map((row) => extractYear(getRowValue(row, headers.anoConclusao))).filter(Boolean))).sort((a, b) => Number(b) - Number(a))
            : [];

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

    let concluidos = 0;
    let jogando = 0;
    let pendentes = 0;

    rows.forEach((row) => {
        const status = getRowValue(row, headers.status);
        const anoConclusao = extractYear(getRowValue(row, headers.anoConclusao));

        const concluido = isConcluidoByStatus(status) || Boolean(anoConclusao);
        const emJogo = isJogandoByStatus(status) && !concluido;
        const pendente = !concluido && !emJogo && isPendenteByStatus(status);

        if (concluido) concluidos += 1;
        if (emJogo) jogando += 1;
        if (pendente) pendentes += 1;
    });

    if (totalConcluidosEl) totalConcluidosEl.textContent = String(concluidos);
    if (totalJogandoEl) totalJogandoEl.textContent = String(jogando);
    if (totalPendentesEl) totalPendentesEl.textContent = String(pendentes);

    renderCharts(rows, headers.plataforma, headers.status);
}

function renderCharts(rows, platHeader, statusHeader) {
    const ctxPlat = document.getElementById("chart-plataformas");
    const ctxStatus = document.getElementById("chart-status");

    if (!ctxPlat || !ctxStatus || typeof Chart === "undefined") return;

    const platCount = {};
    const statusCount = {};

    rows.forEach(row => {
        const plat = String(row[platHeader] || "").trim();
        const stat = String(row[statusHeader] || "").trim();
        if (plat) platCount[plat] = (platCount[plat] || 0) + 1;
        if (stat) statusCount[stat] = (statusCount[stat] || 0) + 1;
    });

    const colors = ["#5a9d6a", "#d4896e", "#ffb84d", "#cc6b6b", "#a8c5d5", "#5a9d6a"];

    if (state.charts.plat) state.charts.plat.destroy();
    state.charts.plat = new Chart(ctxPlat, {
        type: "doughnut",
        data: {
            labels: Object.keys(platCount),
            datasets: [{
                data: Object.values(platCount),
                backgroundColor: colors.slice(0, Object.keys(platCount).length),
                borderColor: "#0f1419",
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: { legend: { labels: { color: "#a8c5d5" } } }
        }
    });

    if (state.charts.status) state.charts.status.destroy();
    state.charts.status = new Chart(ctxStatus, {
        type: "bar",
        data: {
            labels: Object.keys(statusCount),
            datasets: [{
                label: "Quantidade",
                data: Object.values(statusCount),
                backgroundColor: "#5a9d6a",
                borderColor: "#3d7550",
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: { legend: { labels: { color: "#a8c5d5" } } },
            scales: {
                y: { ticks: { color: "#a8c5d5" }, grid: { color: "#1f3849" } },
                x: { ticks: { color: "#a8c5d5" }, grid: { color: "#1f3849" } }
            }
        }
    });
}

function renderTempoJogo() {
    const tempoHeader = findHeader([/tempo/, /duracao/, /horas/]);
    const jogoHeader = findHeader([/jogo/, /titulo/, /nome/]);

    const lista = document.getElementById("lista-tempo");
    if (!lista) return;
    lista.innerHTML = "";

    const sorted = [...state.rows].sort((a, b) => {
        const tempoA = parseTimeToSeconds(a[tempoHeader] || "") || 0;
        const tempoB = parseTimeToSeconds(b[tempoHeader] || "") || 0;
        return tempoB - tempoA;
    });

    sorted.slice(0, 20).forEach(row => {
        const item = document.createElement("div");
        item.className = "list-item";
        const tempo = String(row[tempoHeader] || "");
        const jogo = String(row[jogoHeader] || "");
        item.innerHTML = `
            <div class="list-item-title">${jogo}<\/div>
            <div class="list-item-value">${tempo}<\/div>
        `;
        lista.appendChild(item);
    });
}

function renderDificuldade() {
    const dificuldadeHeader = findHeader([/dificuldade/, /difficulty/]);
    const grid = document.getElementById("grid-dificuldade");
    if (!grid) return;
    grid.innerHTML = "";

    const dificCount = {};
    state.rows.forEach(row => {
        const dif = String(row[dificuldadeHeader] || "").trim();
        if (dif) dificCount[dif] = (dificCount[dif] || 0) + 1;
    });

    Object.entries(dificCount).forEach(([dif, count]) => {
        const card = document.createElement("div");
        card.className = "dificuldade-card";
        card.innerHTML = `<strong>${dif}<\/strong><span>${count} jogos<\/span>`;
        grid.appendChild(card);
    });
}

function renderPlataforma() {
    const platHeader = findHeader([/plataforma/, /platform/]);
    const grid = document.getElementById("grid-plataforma");
    if (!grid) return;
    grid.innerHTML = "";

    const platCount = {};
    state.rows.forEach(row => {
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

    const sorted = [...state.rows].sort((a, b) => {
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

    if (dom.filtersTop) {
        dom.filtersTop.hidden = tabId !== "visao-geral";
    }

    if (tabId === "visao-geral") {
        renderVisaoGeral();
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
            renderVisaoGeral();
        });
    }

    if (dom.filterMultiplayer) {
        dom.filterMultiplayer.addEventListener("change", (event) => {
            state.overviewFilters.multiplayer = event.target.value;
            renderVisaoGeral();
        });
    }

    if (dom.filterAnoConclusao) {
        dom.filterAnoConclusao.addEventListener("change", (event) => {
            state.overviewFilters.anoConclusao = event.target.value;
            renderVisaoGeral();
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

document.addEventListener("DOMContentLoaded", init);
