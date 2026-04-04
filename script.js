const TIER_DB_NAME = "theGameOfUsTierDB";
const TIER_DB_VERSION = 1;
const TIER_STATE_STORE = "tier_state";
const TIER_ASSET_STORE = "tier_assets";
const TIER_STATE_ID = "main";
const TIER_SAVE_DEBOUNCE_MS = 450;
const AVALIACAO_SCALE = [
    { key: "obra de arte", label: "Obra de arte", score: 10, color: "#7e78ff" },
    { key: "nivel altissimo", label: "Nivel Altissimo", score: 9, color: "#8789ed" },
    { key: "muito bom", label: "Muito bom", score: 8, color: "#9db7d5" },
    { key: "legalzinho", label: "Legalzinho", score: 6.5, color: "#b0bfd1" },
    { key: "intermediario", label: "Intermediario", score: 5, color: "#9eafc0" },
    { key: "fraco", label: "Fraco", score: 3.5, color: "#cfb1bc" },
    { key: "decepcionante", label: "Decepcionante", score: 2, color: "#ef9ea5" }
];

const STEAM_API_BASE = "https://yxt-backend.onrender.com/steam-library/";
const STEAM_SEARCH_API_BASE = "https://yxt-backend.onrender.com/steam-search";
const STEAM_LIBRARY_STORAGE_KEY = "yxt_library";
const STEAM_LIBRARY_STEAM_ID_KEY = "yxt_library_steam_id";
const MANUAL_GAME_STORAGE_KEY = "yxt_manual_games";
const DEFAULT_GAME_COVER_PLACEHOLDER = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" fill="#111827"/><rect x="20" y="20" width="600" height="320" rx="18" fill="#0f1419" stroke="#d4a853" stroke-width="2" stroke-dasharray="10 10"/><text x="50%" y="48%" text-anchor="middle" fill="#d4a853" font-family="sans-serif" font-size="30" font-weight="700">No Cover</text><text x="50%" y="58%" text-anchor="middle" fill="#8fa3bf" font-family="sans-serif" font-size="15">Use AppID, URL or upload an image</text></svg>'
);
const DEFAULT_STEAM_METADATA = {
    status: "",
    avaliacao: "",
    multiplayer: "",
    prioridade: "",
    anoConclusao: "",
    plataforma: "Steam",
    expectativaHoras: "",
    dificuldade: "",
    anoLancamento: "",
    comentarios: ""
};

const state = {
    overviewFilters: {
        status: "",
        plataforma: "",
        multiplayer: "",
        anoConclusao: ""
    },
    charts: {},
    tierList: {
        initialized: false,
        dbPromise: null,
        loaded: false,
        loadAttempted: false,
        saveTimer: null,
        objectUrls: [],
        nextId: 1,
        title: "MAKE YOUR TIERLIST",
        labelWidth: 72,
        labels: {
            S: "ABSOLUTE VIDEOGAME",
            A: "N\u00cdVEL ALT\u00cdSSIMO",
            B: "EXCELENTE",
            C: "MUITO BOM",
            D: "BOM",
            E: "MEDIANO",
            F: "DECEPCIONOU",
            "Don\u0027t know": "FRACO",
            "Doesn\u0027t count": "\u00c9 PRA RIR OU SOFRER"
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
    }
};

const steamState = {
    library: [],
    steamId: "",
    selectedAppId: null
};

const manualGameState = {
    library: [],
    selectedGameId: null
};

const gameEditorState = {
    libraryType: "",
    gameId: null,
    pendingCoverSrc: null
};

const dom = {
    status: document.getElementById("status-atualizacao"),
    updatedAt: document.getElementById("ultima-atualizacao"),
    refreshButton: document.getElementById("refresh-button"),
    filterStatus: document.getElementById("filter-status"),
    filterPlataforma: document.getElementById("filter-plataforma"),
    filterMultiplayer: document.getElementById("filter-multiplayer"),
    filterAnoConclusao: document.getElementById("filter-ano-conclusao"),
    filtersTop: document.getElementById("filters-top"),
    tabsContainer: document.querySelector(".tabs-container"),
    tabsNav: document.querySelector(".tabs-nav"),
    tabBtns: document.querySelectorAll(".tab-btn"),
    tabContents: document.querySelectorAll(".tab-content")
};

/* ====================== UTILITIES ====================== */

function normalizeText(value) {
    return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
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

function formatRatingScore(value) {
    if (!Number.isFinite(value)) return "-";
    const hasFraction = Math.abs(value % 1) > 0.0001;
    return value.toLocaleString("pt-BR", {
        minimumFractionDigits: hasFraction ? 1 : 0,
        maximumFractionDigits: 1
    });
}

function parsePersonalRating(value) {
    const raw = String(value || "").trim();
    if (!raw) return null;

    const normalized = normalizeText(raw);
    const mapped = AVALIACAO_SCALE.find((entry) => normalized === entry.key || normalized.includes(entry.key));

    if (mapped) {
        return {
            key: mapped.key,
            label: mapped.label,
            score: mapped.score,
            color: mapped.color,
            mapped: true
        };
    }

    const numeric = parseNumber(raw);
    if (numeric !== null) {
        const closest = [...AVALIACAO_SCALE].sort((a, b) =>
            Math.abs(a.score - numeric) - Math.abs(b.score - numeric)
        )[0];
        return {
            key: closest.key,
            label: closest.label,
            score: numeric,
            color: closest.color,
            mapped: true
        };
    }

    return {
        key: "raw",
        label: raw,
        score: 0,
        color: "#93a5bc",
        mapped: false
    };
}

function seededRandomFromString(value) {
    const text = String(value || "");
    let hash = 2166136261;

    for (let i = 0; i < text.length; i += 1) {
        hash ^= text.charCodeAt(i);
        hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }

    return (hash >>> 0) / 4294967295;
}

function clampNumber(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function calcularPercentilFicticio(meuTempoSegundos, mediaGlobalSegundos, ruidoSeed) {
    if (!Number.isFinite(meuTempoSegundos) || !Number.isFinite(mediaGlobalSegundos) || mediaGlobalSegundos <= 0) {
        return 50;
    }

    const relacao = (meuTempoSegundos - mediaGlobalSegundos) / mediaGlobalSegundos;
    let percentil = 45 + (relacao * 130);

    if (relacao <= -0.35) percentil -= 8;
    if (relacao >= 0.35) percentil += 8;

    const jitter = ((Number(ruidoSeed) || 0) - 0.5) * 8;
    percentil += jitter;

    return Math.round(clampNumber(percentil, 3, 95));
}

function formatHoursCompact(totalSeconds) {
    const hours = Math.round((Number(totalSeconds) || 0) / 3600);
    return `${hours}h`;
}

function formatSecondsToTime(totalSeconds) {
    const safeSeconds = Math.max(0, Number(totalSeconds) || 0);
    const hours = Math.floor(safeSeconds / 3600);
    const minutes = Math.floor((safeSeconds % 3600) / 60);

    if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h`;
    if (minutes > 0) return `${minutes}m`;
    return "0h";
}

function escapeHtml(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(reader.error || new Error("Falha ao ler arquivo."));
        reader.readAsDataURL(file);
    });
}

function getResolvedGameCover(game) {
    if (game?.coverSrc) return game.coverSrc;
    if (game?.appid) return getGameCover(game);
    return DEFAULT_GAME_COVER_PLACEHOLDER;
}

async function searchSteamGameByName(name) {
    const response = await fetch(`${STEAM_SEARCH_API_BASE}?q=${encodeURIComponent(String(name || "").trim())}`);
    if (!response.ok) throw new Error(`Erro ${response.status}`);
    const data = await response.json();
    if (!data?.found || !data?.game?.appid) return null;
    return {
        appid: String(data.game.appid),
        name: String(data.game.name || ""),
        cover: String(data.game.cover || "")
    };
}

/* ====================== LIBRARY DATA ACCESS ====================== */

function getLibrary() {
    const merged = [...steamState.library, ...manualGameState.library];
    if (merged.length > 0) return merged;
    try {
        const raw = localStorage.getItem(STEAM_LIBRARY_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function getFilteredLibrary() {
    const { status, plataforma, multiplayer, anoConclusao } = state.overviewFilters;
    const library = getLibrary();

    return library.filter((game) => {
        const meta = game.metadata || {};
        if (status && (meta.status || "") !== status) return false;
        if (plataforma && (meta.plataforma || "") !== plataforma) return false;
        if (multiplayer && (meta.multiplayer || "") !== multiplayer) return false;
        if (anoConclusao && String(meta.anoConclusao || "") !== anoConclusao) return false;
        return true;
    });
}

function updateFilterSelects() {
    const library = getLibrary();

    if (dom.filterStatus) {
        const values = [...new Set(library.map(g => (g.metadata?.status || "").trim()).filter(Boolean))]
            .sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }));
        dom.filterStatus.innerHTML = '<option value="">Todos<\/option>';
        values.forEach(v => {
            const opt = document.createElement("option");
            opt.value = v;
            opt.textContent = v;
            dom.filterStatus.appendChild(opt);
        });
        dom.filterStatus.value = state.overviewFilters.status || "";
    }

    if (dom.filterPlataforma) {
        const values = [...new Set(library.map(g => (g.metadata?.plataforma || "").trim()).filter(Boolean))]
            .sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }));
        dom.filterPlataforma.innerHTML = '<option value="">Todas<\/option>';
        values.forEach(v => {
            const opt = document.createElement("option");
            opt.value = v;
            opt.textContent = v;
            dom.filterPlataforma.appendChild(opt);
        });
        dom.filterPlataforma.value = state.overviewFilters.plataforma || "";
    }

    if (dom.filterMultiplayer) {
        const values = [...new Set(library.map(g => (g.metadata?.multiplayer || "").trim()).filter(Boolean))].sort();
        dom.filterMultiplayer.innerHTML = '<option value="">Todos<\/option>';
        values.forEach(v => {
            const opt = document.createElement("option");
            opt.value = v;
            opt.textContent = v;
            dom.filterMultiplayer.appendChild(opt);
        });
        dom.filterMultiplayer.value = state.overviewFilters.multiplayer || "";
    }

    if (dom.filterAnoConclusao) {
        const values = [...new Set(library.map(g => String(g.metadata?.anoConclusao || "").trim()).filter(Boolean))]
            .sort((a, b) => Number(b) - Number(a));
        dom.filterAnoConclusao.innerHTML = '<option value="">Todos<\/option>';
        values.forEach(v => {
            const opt = document.createElement("option");
            opt.value = v;
            opt.textContent = v;
            dom.filterAnoConclusao.appendChild(opt);
        });
        dom.filterAnoConclusao.value = state.overviewFilters.anoConclusao || "";
    }
}

/* ====================== STATUS ====================== */

function updateStatus(message, isError) {
    if (!dom.status || !dom.updatedAt) return;

    dom.status.textContent = message;
    dom.status.classList.toggle("is-error", Boolean(isError));
    dom.status.classList.toggle("is-success", !isError);

    const now = new Date();
    dom.updatedAt.textContent = `Ultima atualizacao: ${now.toLocaleTimeString("pt-BR")}`;
}

/* ====================== RENDER: VISAO GERAL ====================== */

function renderVisaoGeral() {
    const games = getFilteredLibrary();

    const totalJogosEl = document.getElementById("total-jogos");
    const totalConcluidosEl = document.getElementById("total-concluidos");
    const totalJogandoEl = document.getElementById("total-jogando");
    const totalPendentesEl = document.getElementById("total-pendentes");

    if (totalJogosEl) totalJogosEl.textContent = String(games.length);

    const statusCount = {};
    games.forEach(game => {
        const stat = (game.metadata?.status || "").trim();
        if (stat) statusCount[stat] = (statusCount[stat] || 0) + 1;
    });

    const getCountNorm = (word) => {
        const key = Object.keys(statusCount).find(k => normalizeText(k) === word);
        return key ? statusCount[key] : 0;
    };

    if (totalConcluidosEl) totalConcluidosEl.textContent = String(getCountNorm("concluido"));
    if (totalJogandoEl) totalJogandoEl.textContent = String(getCountNorm("jogando"));
    if (totalPendentesEl) totalPendentesEl.textContent = String(getCountNorm("pendente"));

    renderCharts(games, statusCount);
}

function renderCharts(games, statusCount) {
    const ctxSetores = document.getElementById("chart-status-setores");
    const ctxStatus = document.getElementById("chart-status");

    if (!ctxSetores || !ctxStatus || typeof Chart === "undefined") return;

    const doughnutConfig = [
        { key: "pendente", label: "Pendente", color: "#ffcc00" },
        { key: "concluido", label: "Conclu\u00eddo", color: "#d4a853" },
        { key: "pausado", label: "Pausado", color: "#ff9800" },
        { key: "dropado", label: "Dropado", color: "#e06c75" },
        { key: "jogando", label: "Jogando", color: "#1a9fda" },
        { key: "iniciado", label: "Iniciado", color: "#00d4ff" }
    ];

    const doughnutLabels = [];
    const doughnutData = [];
    const doughnutColors = [];

    doughnutConfig.forEach(config => {
        const statusKey = Object.keys(statusCount).find(k => normalizeText(k) === config.key);
        const count = statusKey ? statusCount[statusKey] : 0;
        if (count > 0) {
            doughnutLabels.push(config.label);
            doughnutData.push(count);
            doughnutColors.push(config.color);
        }
    });

    if (state.charts.plat) state.charts.plat.destroy();
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
        concluido: { label: "Conclu\u00eddo", color: "#d4a853" },
        pausado: { label: "Pausado", color: "#ff9800" },
        dropado: { label: "Dropado", color: "#e06c75" },
        jogando: { label: "Jogando", color: "#1a9fda" },
        iniciado: { label: "Iniciado", color: "#00d4ff" },
        outros: { label: "Outros", color: "#ff1493" }
    };

    const anosMap = {};

    games.forEach(game => {
        const ano = String(game.metadata?.anoLancamento || "").trim() || "Desconhecido";
        const statKey = normalizeText(game.metadata?.status || "");

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

    const datasetsBar = Object.keys(barConfigMap).map(key => ({
        label: barConfigMap[key].label,
        data: labelsAnos.map(ano => anosMap[ano][key]),
        backgroundColor: barConfigMap[key].color,
        borderColor: barConfigMap[key].color,
        borderWidth: 1
    })).filter(dataset => dataset.data.some(val => val > 0));

    if (state.charts.status) state.charts.status.destroy();
    state.charts.status = new Chart(ctxStatus, {
        type: "bar",
        data: { labels: labelsAnos, datasets: datasetsBar },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { labels: { color: "#d4a853" } },
                title: { display: true, text: "LAN\u00c7AMENTO POR STATUS", color: "#d4a853", font: { size: 16 } }
            },
            scales: {
                y: { stacked: true, ticks: { color: "#d4a853", stepSize: 2 }, grid: { color: "rgba(212, 168, 83, 0.1)" } },
                x: { stacked: true, ticks: { color: "#d4a853" }, grid: { color: "rgba(212, 168, 83, 0.1)" } }
            }
        }
    });
}

/* ====================== RENDER: BI GAMER ====================== */

function renderBiGamer() {
    const games = getFilteredLibrary();

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

    const tempoGames = games.map((game) => {
        const name = game.name || "Desconhecido";
        const seconds = Math.round((game.playtime_hours || 0) * 3600);
        const st = normalizeText(game.metadata?.status || "");
        const nameLower = normalizeText(name);
        const isCS2 = nameLower.includes("counter strike 2") || nameLower.includes("counter-strike 2");
        const mpRaw = normalizeText(game.metadata?.multiplayer || "");
        const isSolo = mpRaw === "nao" || mpRaw === "";

        const isJogado = st === "concluido" || st === "dropado" || st === "jogando";
        const isPendente = st === "pendente" || st === "pausado";

        if (seconds > 0) {
            if (isJogado) segundosJogados += seconds;
            if (isPendente) segundosPendentes += seconds;
        }

        return { game, name, seconds, st, isJogado, isPendente, isSolo, isCS2 };
    });

    games.forEach((game) => {
        const status = normalizeText(game.metadata?.status || "");
        const tempo = Math.round((game.playtime_hours || 0) * 3600);
        const plataforma = (game.metadata?.plataforma || "").trim() || "N/A";
        const multiType = (game.metadata?.multiplayer || "").trim() || "N/A";
        const nota = parseNumber(game.metadata?.avaliacao);
        const dificuldade = (game.metadata?.dificuldade || "").trim();

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

    const total = games.length;
    const taxa = total ? ((statusStats.concluidos / total) * 100) : 0;
    const notaMedia = notaCount ? (notaSum / notaCount) : 0;

    const topPlataforma = Object.entries(plataformaCount).sort((a, b) => b[1] - a[1])[0]?.[0] || "-";
    const topMulti = Object.entries(multiplayerCount).sort((a, b) => b[1] - a[1])[0]?.[0] || "-";
    const topDificuldadeComum = Object.entries(dificuldadeCount).sort((a, b) => b[1] - a[1])[0]?.[0] || "-";
    const topDificuldadeHoras = Object.entries(dificuldadeHoras).sort((a, b) => b[1] - a[1])[0]?.[0] || "-";

    const jogadosSemCS = tempoGames.filter((item) => item.seconds > 0 && item.isJogado && !item.isCS2);
    const mediaGameplay = jogadosSemCS.length > 0
        ? jogadosSemCS.reduce((acc, item) => acc + item.seconds, 0) / jogadosSemCS.length
        : 0;

    const concluidos = tempoGames.filter((item) => item.seconds > 0 && item.st === "concluido");
    const mediaZerados = concluidos.length > 0
        ? concluidos.reduce((acc, item) => acc + item.seconds, 0) / concluidos.length
        : 0;

    const soloMaisJogado = tempoGames
        .filter((item) => item.seconds > 0 && item.isJogado && item.isSolo)
        .sort((a, b) => b.seconds - a.seconds)[0]?.name || "-";

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

    const topByTime = tempoGames
        .filter((item) => item.seconds > 0)
        .sort((a, b) => b.seconds - a.seconds)
        .slice(0, 8);

    const tierSeedCandidates = getLibrary()
        .filter((game) => Number(game.playtime_hours) > 0)
        .sort((a, b) => (Number(b.playtime_hours) || 0) - (Number(a.playtime_hours) || 0))
        .map((game) => ({
            game,
            name: game.name || "Sem titulo",
            seconds: Math.round((Number(game.playtime_hours) || 0) * 3600)
        }));

    topJogosEl.innerHTML = "";
    topByTime.forEach((item) => {
        const row = document.createElement("div");
        row.className = "bi-top-item";
        row.innerHTML = `<span>${item.name}</span><strong>${formatHoursCompact(item.seconds)}</strong>`;
        topJogosEl.appendChild(row);
    });

    bindTierListEvents();

    if (!state.tierList.loadAttempted) {
        state.tierList.loadAttempted = true;
        loadTierListFromStorage().then((loaded) => {
            state.tierList.loaded = true;

            if (!loaded) {
                const added = seedTierPool(tierSeedCandidates);
                if (added > 0) scheduleTierListSave();
            }

            renderTierList();
        });
    } else {
        if (state.tierList.loaded) {
            const added = seedTierPool(tierSeedCandidates);
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

/* ====================== RENDER: TEMPO DE JOGO ====================== */

function renderTempoJogo() {
    const games = getFilteredLibrary();
    const ctxTopTempo = document.getElementById("chart-top-tempo");
    const ctxCurtosZerados = document.getElementById("chart-curtos-zerados");

    let segundosJogados = 0;
    let segundosPendentes = 0;

    const parsedGames = games.map(game => {
        const name = game.name || "Desconhecido";
        const seconds = Math.round((game.playtime_hours || 0) * 3600);
        const nameLower = normalizeText(name);
        const st = normalizeText(game.metadata?.status || "");
        const isCS2 = nameLower.includes("counter strike 2") || nameLower.includes("counter-strike 2");
        const mpRaw = normalizeText(game.metadata?.multiplayer || "");
        const isSolo = mpRaw === "nao" || mpRaw === "";

        const isJogado = st === "concluido" || st === "dropado" || st === "jogando";
        const isPendente = st === "pendente" || st === "pausado";

        if (seconds > 0) {
            if (isJogado) segundosJogados += seconds;
            if (isPendente) segundosPendentes += seconds;
        }

        return { game, name, seconds, st, isJogado, isPendente, isSolo, isCS2 };
    }).filter(item => item.seconds > 0);

    const totalHorasJogadasEl = document.getElementById("total-horas-jogadas");
    if (totalHorasJogadasEl) {
        totalHorasJogadasEl.textContent = Math.floor(segundosJogados / 3600) + "h";
    }

    const totalHorasPendentesEl = document.getElementById("total-horas-pendentes");
    if (totalHorasPendentesEl) {
        totalHorasPendentesEl.textContent = Math.floor(segundosPendentes / 3600) + "h";
    }

    const jogadosSemCS = parsedGames.filter(item => item.isJogado && !item.isCS2).sort((a, b) => b.seconds - a.seconds);

    const mediaGameplayEl = document.getElementById("media-gameplay");
    if (mediaGameplayEl) {
        const totalSegundosSemCS = jogadosSemCS.reduce((acc, item) => acc + item.seconds, 0);
        const mediaGameplay = jogadosSemCS.length > 0 ? totalSegundosSemCS / jogadosSemCS.length : 0;
        mediaGameplayEl.textContent = Math.floor(mediaGameplay / 3600) + "h";
    }

    const concluidosList = parsedGames.filter(item => item.st === "concluido");
    const mediaZeradosEl = document.getElementById("media-zerados");
    if (mediaZeradosEl) {
        const totalSegundosZerados = concluidosList.reduce((acc, item) => acc + item.seconds, 0);
        const mediaZerados = concluidosList.length > 0 ? totalSegundosZerados / concluidosList.length : 0;
        mediaZeradosEl.textContent = Math.floor(mediaZerados / 3600) + "h";
    }

    const soloMaisJogadoEl = document.getElementById("solo-mais-jogado");
    if (soloMaisJogadoEl) {
        const jogosSoloJogados = parsedGames.filter(item => item.isJogado && item.isSolo).sort((a, b) => b.seconds - a.seconds);
        soloMaisJogadoEl.textContent = jogosSoloJogados.length > 0 ? jogosSoloJogados[0].name : "-";
    }

    if (ctxTopTempo && typeof Chart !== "undefined") {
        const top10Jogados = jogadosSemCS.slice(0, 10);
        const labels10 = top10Jogados.map(item => item.name.length > 20 ? item.name.substring(0, 17) + "..." : item.name);
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
        const concluidosAsc = parsedGames.filter(item => item.st === "concluido").sort((a, b) => a.seconds - b.seconds);
        const top10Curtos = concluidosAsc.slice(0, 10);
        const labelsCurtos = top10Curtos.map(item => item.name.length > 20 ? item.name.substring(0, 17) + "..." : item.name);
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
            div.innerHTML = `<div class="list-item-title">${item.name}</div><div class="list-item-value">${formatHoursCompact(item.seconds)}</div>`;
            listaTempo.appendChild(div);
        });
    }
}

/* ====================== RENDER: DIFICULDADE ====================== */

function renderDificuldade() {
    const grid = document.getElementById("grid-dificuldade");
    const ctxDifBar = document.getElementById("chart-dificuldade-bar");
    const divDifHoras = document.getElementById("chart-dificuldade-horas");

    if (!grid) return;
    grid.innerHTML = "";

    const dificCount = {};
    const dificHoras = {};
    let totalJogosAvaliados = 0;

    getFilteredLibrary().forEach(game => {
        const dif = (game.metadata?.dificuldade || "").trim();
        const seconds = Math.round((game.playtime_hours || 0) * 3600);

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

    const levelColors = {
        "Basta ter cerebro": "#1a7a42",
        "Mamao com acucar": "#c9952a",
        "Medio": "#1a6fa8",
        "Precisa de esforco": "#b85d18",
        "Realmente trabalhoso": "#a83232",
        "Nivel Sekiro": "#6a2e8a"
    };

    const levelHover = {
        "Basta ter cerebro": "#24a058",
        "Mamao com acucar": "#e0aa3a",
        "Medio": "#2488c8",
        "Precisa de esforco": "#d47020",
        "Realmente trabalhoso": "#cc4040",
        "Nivel Sekiro": "#8838a8"
    };

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
                        overflow: "fit",
                        formatter: (ctx) => {
                            const data = ctx.raw._data;
                            if (!data || !data.name) return "";
                            const w = ctx.raw.w || 0;
                            const h = ctx.raw.h || 0;
                            const name = data.name;
                            const val = String(data.value);
                            if (w < 50 || h < 30) return [val];
                            const words = name.split(" ");
                            const lines = [];
                            let cur = "";
                            const maxChars = Math.max(6, Math.floor(w / 8));
                            for (const word of words) {
                                if (cur && (cur.length + 1 + word.length) > maxChars) {
                                    lines.push(cur);
                                    cur = word;
                                } else {
                                    cur = cur ? cur + " " + word : word;
                                }
                            }
                            if (cur) lines.push(cur);
                            lines.push(val);
                            return lines;
                        },
                        font: (ctx) => {
                            const w = ctx.raw ? (ctx.raw.w || 0) : 0;
                            const h = ctx.raw ? (ctx.raw.h || 0) : 0;
                            const small = w < 70 || h < 50;
                            const nameFont = { size: small ? 10 : 13, weight: "bold", family: "'Syne', sans-serif" };
                            const valFont = { size: small ? 9 : 12, family: "'Manrope', sans-serif" };
                            return [nameFont, nameFont, nameFont, nameFont, valFont];
                        },
                        color: "#f0ebe3",
                        align: "center",
                        position: "middle"
                    },
                    backgroundColor: (ctx) => {
                        const label = ctx.raw ? ctx.raw._data.name : "";
                        return levelColors[label] || "#1a1c26";
                    },
                    hoverBackgroundColor: (ctx) => {
                        const label = ctx.raw ? ctx.raw._data.name : "";
                        return levelHover[label] || "#2a2530";
                    },
                    borderColor: "#d4a853",
                    borderWidth: 2,
                    borderRadius: 6,
                    spacing: 3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: { display: false },
                    title: {
                        display: true,
                        text: "JOGOS POR DIFICULDADE",
                        color: "#f0c95c",
                        font: { size: 18, weight: 'bold', family: "'Cinzel', serif" },
                        padding: { top: 10, bottom: 14 }
                    },
                    tooltip: {
                        backgroundColor: "rgba(12, 13, 20, 0.92)",
                        borderColor: "#d4a853",
                        borderWidth: 1,
                        titleColor: "#f0c95c",
                        bodyColor: "#f0ebe3",
                        bodyFont: { family: "'Manrope', sans-serif" },
                        cornerRadius: 6,
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
        google.charts.load("current", { packages: ["corechart"] });
        const drawChart = () => {
            const dataTable = new google.visualization.DataTable();
            dataTable.addColumn("string", "Dificuldade");
            dataTable.addColumn("number", "Horas");

            const colorsArr = [];
            sortedHoras.forEach(item => {
                const hours = parseFloat((item[1] / 3600).toFixed(1));
                dataTable.addRow([item[0], hours]);
                colorsArr.push(levelColors[item[0]] || "#1a1c26");
            });

            const options = {
                title: "HORAS POR DIFICULDADE",
                is3D: true,
                backgroundColor: "transparent",
                colors: colorsArr,
                titleTextStyle: { color: "#f0c95c", fontSize: 18, bold: true, fontName: "Cinzel" },
                legend: { position: "right", textStyle: { color: "#f0ebe3", fontName: "Manrope", fontSize: 12 } },
                pieSliceBorderColor: "#d4a853",
                pieSliceTextStyle: { color: "#f0ebe3", fontName: "Manrope", fontSize: 12 },
                tooltip: { textStyle: { color: "#f0ebe3", fontName: "Manrope" }, showColorCode: true },
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

    const difficultyBlocks = [
        { key: "nivel sekiro", listId: "list-sekiro", label: "Nivel Sekiro" },
        { key: "realmente trabalhoso", listId: "list-trabalhoso", label: "Realmente trabalhoso" },
        { key: "precisa de esforco", listId: "list-esforco", label: "Precisa de esforco" },
        { key: "medio", listId: "list-medio", label: "Medio" },
        { key: "mamao com acucar", listId: "list-mamao", label: "Mamao com acucar" },
        { key: "basta ter cerebro", listId: "list-cerebro", label: "Basta ter cerebro" }
    ];

    const difficultyGroups = difficultyBlocks.reduce((accumulator, block) => {
        accumulator[block.key] = [];
        return accumulator;
    }, {});

    const getDifficultyBucket = (value) => {
        const normalized = normalizeText(value);
        if (!normalized) return null;

        if (normalized.includes("sekiro")) return "nivel sekiro";
        if (normalized.includes("realmente trabalhoso")) return "realmente trabalhoso";
        if (normalized.includes("precisa de") && normalized.includes("esforco")) return "precisa de esforco";
        if (normalized.includes("mamao")) return "mamao com acucar";
        if (normalized.includes("basta ter cerebro")) return "basta ter cerebro";
        if (normalized === "medio" || normalized.includes("medio")) return "medio";

        return null;
    };

    getFilteredLibrary().forEach((game) => {
        const difficultyValue = (game.metadata?.dificuldade || "").trim();
        const name = (game.name || "").trim();
        const seconds = Math.round((game.playtime_hours || 0) * 3600);
        const bucket = getDifficultyBucket(difficultyValue);

        if (!name || !bucket) return;

        difficultyGroups[bucket].push({ name, seconds });
    });

    const fillList = (list, gamesList, levelLabel) => {
        if (!list) return;

        list.innerHTML = "";
        const items = [...gamesList]
            .sort((first, second) => (second.seconds - first.seconds) || first.name.localeCompare(second.name, "pt-BR", { sensitivity: "base" }))
            .slice(0, 3);

        if (items.length === 0) {
            const empty = document.createElement("div");
            empty.className = "dif-empty";
            empty.textContent = "Nenhum no momento";
            list.appendChild(empty);
            return;
        }

        items.forEach((itemData) => {
            const el = document.createElement("div");
            el.className = "dif-game-item";
            const nameSpan = document.createElement("span");
            nameSpan.className = "dif-game-name";
            nameSpan.textContent = itemData.name;

            const metaWrap = document.createElement("span");
            metaWrap.className = "dif-game-meta";

            const hoursSpan = document.createElement("span");
            hoursSpan.className = "dif-game-hours";
            hoursSpan.textContent = formatSecondsToTime(itemData.seconds);

            const levelSpan = document.createElement("span");
            levelSpan.className = "dif-game-level";
            levelSpan.textContent = levelLabel;

            metaWrap.appendChild(hoursSpan);
            metaWrap.appendChild(levelSpan);

            el.appendChild(nameSpan);
            el.appendChild(metaWrap);
            list.appendChild(el);
        });
    };

    difficultyBlocks.forEach((block) => {
        fillList(document.getElementById(block.listId), difficultyGroups[block.key], block.label);
    });
}

/* ====================== RENDER: PLATAFORMA ====================== */

function renderPlataforma() {
    const grid = document.getElementById("grid-plataforma");
    const totalJogosEl = document.getElementById("pl-total-jogos");
    const totalPlataformasEl = document.getElementById("pl-total-plataformas");
    const liderEl = document.getElementById("pl-lider");
    const liderPercentEl = document.getElementById("pl-lider-percent");
    const mediaJogosEl = document.getElementById("pl-media-jogos");
    const singletonsEl = document.getElementById("pl-singletons");
    const horasTopEl = document.getElementById("pl-horas-top");
    const kpiTopEl = document.getElementById("pl-kpi-top");
    const kpiHorasEl = document.getElementById("pl-kpi-horas");
    const kpiTop3El = document.getElementById("pl-kpi-top3");
    const chartEl = document.getElementById("chart-plataforma-distribuicao");

    if (!grid || !totalJogosEl || !totalPlataformasEl || !liderEl || !liderPercentEl || !mediaJogosEl || !singletonsEl || !horasTopEl || !kpiTopEl || !kpiHorasEl || !kpiTop3El) {
        return;
    }

    grid.innerHTML = "";

    const platCount = {};
    const platHours = {};
    const games = getFilteredLibrary();

    games.forEach((game) => {
        const plat = (game.metadata?.plataforma || "").trim() || "N/A";
        platCount[plat] = (platCount[plat] || 0) + 1;

        const seconds = Math.round((game.playtime_hours || 0) * 3600);
        platHours[plat] = (platHours[plat] || 0) + seconds;
    });

    const sortedPlatforms = Object.entries(platCount)
        .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0], "pt-BR", { sensitivity: "base" }));

    const totalJogos = games.length;
    const totalPlataformas = sortedPlatforms.length;
    const [topPlatform, topCount] = sortedPlatforms[0] || ["-", 0];
    const topShare = totalJogos > 0 ? (topCount / totalJogos) * 100 : 0;
    const mediaPorPlataforma = totalPlataformas > 0 ? totalJogos / totalPlataformas : 0;
    const singletonCount = sortedPlatforms.filter(([, count]) => count === 1).length;

    const topByHours = Object.entries(platHours)
        .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0], "pt-BR", { sensitivity: "base" }))[0] || ["-", 0];
    const [topHoursPlatform, topHoursSeconds] = topByHours;

    const top3Count = sortedPlatforms.slice(0, 3).reduce((acc, [, count]) => acc + count, 0);
    const top3Share = totalJogos > 0 ? (top3Count / totalJogos) * 100 : 0;

    totalJogosEl.textContent = String(totalJogos);
    totalPlataformasEl.textContent = String(totalPlataformas);
    liderEl.textContent = topPlatform;
    liderPercentEl.textContent = totalJogos > 0 ? `${topShare.toFixed(1)}% (${topCount})` : "-";
    mediaJogosEl.textContent = totalPlataformas > 0 ? mediaPorPlataforma.toFixed(1) : "-";
    singletonsEl.textContent = String(singletonCount);
    horasTopEl.textContent = topHoursSeconds > 0 ? `${topHoursPlatform} \u2022 ${formatHoursCompact(topHoursSeconds)}` : "-";

    kpiTopEl.textContent = totalJogos > 0 ? `${topPlatform} (${topCount})` : "-";
    kpiHorasEl.textContent = topHoursSeconds > 0 ? formatHoursCompact(topHoursSeconds) : "-";
    kpiTop3El.textContent = totalJogos > 0 ? `${top3Share.toFixed(1)}%` : "-";

    if (!sortedPlatforms.length) {
        const empty = document.createElement("p");
        empty.className = "platform-empty";
        empty.textContent = "Nenhuma plataforma encontrada para os filtros atuais.";
        grid.appendChild(empty);
    } else {
        sortedPlatforms.forEach(([plat, count], index) => {
            const percentage = totalJogos > 0 ? (count / totalJogos) * 100 : 0;
            const jogosLabel = count === 1 ? "jogo" : "jogos";

            const item = document.createElement("article");
            item.className = "platform-item";

            const main = document.createElement("div");
            main.className = "platform-item-main";

            const rank = document.createElement("span");
            rank.className = "platform-item-rank";
            rank.textContent = `#${index + 1}`;

            const labels = document.createElement("div");
            labels.className = "platform-item-labels";

            const nameEl = document.createElement("strong");
            nameEl.textContent = plat;

            const detailEl = document.createElement("span");
            detailEl.textContent = `${count} ${jogosLabel} \u2022 ${percentage.toFixed(1)}%`;

            labels.appendChild(nameEl);
            labels.appendChild(detailEl);
            main.appendChild(rank);
            main.appendChild(labels);

            const hoursEl = document.createElement("div");
            hoursEl.className = "platform-item-meta";
            hoursEl.textContent = formatHoursCompact(platHours[plat] || 0);

            item.appendChild(main);
            item.appendChild(hoursEl);
            grid.appendChild(item);
        });
    }

    if (chartEl && typeof Chart !== "undefined") {
        if (state.charts.plataformaDistribuicao) {
            state.charts.plataformaDistribuicao.destroy();
        }

        if (sortedPlatforms.length) {
            const chartData = sortedPlatforms.slice(0, 8);
            state.charts.plataformaDistribuicao = new Chart(chartEl, {
                type: "bar",
                data: {
                    labels: chartData.map(([plat]) => plat),
                    datasets: [{
                        label: "Jogos",
                        data: chartData.map(([, count]) => count),
                        backgroundColor: ["#d4a853", "#c9952a", "#1a9fda", "#00d4ff", "#a07830", "#f0c95c", "#6bc6e6", "#8b6c2f"],
                        borderRadius: 8,
                        borderWidth: 0
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: true,
                    indexAxis: "y",
                    plugins: {
                        legend: { display: false },
                        title: {
                            display: true,
                            text: "DISTRIBUICAO POR PLATAFORMA",
                            color: "#d4a853",
                            font: { size: 16 }
                        }
                    },
                    scales: {
                        x: {
                            beginAtZero: true,
                            ticks: { color: "#cdc7bc" },
                            grid: { color: "rgba(212, 168, 83, 0.14)" }
                        },
                        y: {
                            ticks: { color: "#cdc7bc" },
                            grid: { display: false }
                        }
                    }
                }
            });
        } else {
            state.charts.plataformaDistribuicao = null;
        }
    }
}

/* ====================== RENDER: AVALIACAO ====================== */

function renderAvaliacao() {
    const lista = document.getElementById("lista-avaliacao");
    const totalJogosEl = document.getElementById("av-total-jogos");
    const notaMediaEl = document.getElementById("av-nota-media");
    const melhorFaixaEl = document.getElementById("av-melhor-faixa");
    const faixaDominanteEl = document.getElementById("av-faixa-dominante");
    const jogosExcelenciaEl = document.getElementById("av-jogos-excelencia");
    const jogosFracosEl = document.getElementById("av-jogos-fracos");
    const top1El = document.getElementById("av-kpi-top1");
    const coberturaEl = document.getElementById("av-kpi-cobertura");
    const variacaoEl = document.getElementById("av-kpi-variacao");
    const chartEl = document.getElementById("chart-avaliacao-distribuicao");

    if (!lista || !totalJogosEl || !notaMediaEl || !melhorFaixaEl || !faixaDominanteEl || !jogosExcelenciaEl || !jogosFracosEl || !top1El || !coberturaEl || !variacaoEl) {
        return;
    }

    lista.innerHTML = "";

    const games = getFilteredLibrary();
    const avaliados = games
        .map((game) => {
            const jogo = (game.name || "").trim() || "Sem titulo";
            const tempoSegundos = Math.round((game.playtime_hours || 0) * 3600);
            const parsed = parsePersonalRating(game.metadata?.avaliacao);
            if (!parsed) return null;
            return { jogo, tempoSegundos, ...parsed };
        })
        .filter(Boolean);

    const sorted = [...avaliados].sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (b.tempoSegundos !== a.tempoSegundos) return b.tempoSegundos - a.tempoSegundos;
        return a.jogo.localeCompare(b.jogo, "pt-BR", { sensitivity: "base" });
    });

    const totalAvaliados = sorted.length;
    const totalRows = games.length;
    const scoreSum = sorted.reduce((acc, item) => acc + item.score, 0);
    const mediaScore = totalAvaliados ? (scoreSum / totalAvaliados) : 0;
    const topItem = sorted[0] || null;
    const bottomItem = sorted[sorted.length - 1] || null;

    const faixaCounts = {};
    sorted.forEach((item) => {
        faixaCounts[item.label] = (faixaCounts[item.label] || 0) + 1;
    });
    const faixaDominante = Object.entries(faixaCounts)
        .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0], "pt-BR", { sensitivity: "base" }))[0] || null;

    const excelenciaCount = sorted.filter((item) => item.score >= 9).length;
    const fracosCount = sorted.filter((item) => item.score <= 3.5).length;

    totalJogosEl.textContent = String(totalAvaliados);
    notaMediaEl.textContent = totalAvaliados ? formatRatingScore(mediaScore) : "-";
    melhorFaixaEl.textContent = topItem ? `${topItem.label} (${formatRatingScore(topItem.score)})` : "-";
    faixaDominanteEl.textContent = faixaDominante ? `${faixaDominante[0]} (${faixaDominante[1]})` : "-";
    jogosExcelenciaEl.textContent = String(excelenciaCount);
    jogosFracosEl.textContent = String(fracosCount);

    top1El.textContent = topItem ? `${topItem.jogo} (${topItem.label})` : "-";
    coberturaEl.textContent = totalRows > 0 ? `${((totalAvaliados / totalRows) * 100).toFixed(1)}%` : "-";
    variacaoEl.textContent = topItem && bottomItem
        ? `${formatRatingScore(topItem.score)} -> ${formatRatingScore(bottomItem.score)}`
        : "-";

    if (!sorted.length) {
        const empty = document.createElement("p");
        empty.className = "rating-empty";
        empty.textContent = "Nenhuma avaliacao encontrada para os filtros atuais.";
        lista.appendChild(empty);
    } else {
        sorted.forEach((item, index) => {
            const row = document.createElement("article");
            row.className = "rating-item";

            const main = document.createElement("div");
            main.className = "rating-item-main";

            const rank = document.createElement("span");
            rank.className = "rating-item-rank";
            rank.textContent = `#${index + 1}`;

            const labels = document.createElement("div");
            labels.className = "rating-item-labels";

            const gameEl = document.createElement("strong");
            gameEl.textContent = item.jogo;

            const chip = document.createElement("span");
            chip.className = "rating-chip";
            chip.style.setProperty("--rating-chip-bg", item.color);
            chip.textContent = item.label;

            labels.appendChild(gameEl);
            labels.appendChild(chip);
            main.appendChild(rank);
            main.appendChild(labels);

            const score = document.createElement("div");
            score.className = "rating-item-score";
            score.textContent = formatRatingScore(item.score);

            row.appendChild(main);
            row.appendChild(score);
            lista.appendChild(row);
        });
    }

    if (chartEl && typeof Chart !== "undefined") {
        if (state.charts.avaliacaoDistribuicao) {
            state.charts.avaliacaoDistribuicao.destroy();
        }

        if (!sorted.length) {
            state.charts.avaliacaoDistribuicao = null;
            return;
        }

        const counts = Object.fromEntries(AVALIACAO_SCALE.map((entry) => [entry.key, 0]));
        let outrosCount = 0;

        sorted.forEach((item) => {
            if (Object.prototype.hasOwnProperty.call(counts, item.key)) {
                counts[item.key] += 1;
            } else {
                outrosCount += 1;
            }
        });

        const chartLabels = AVALIACAO_SCALE.map((entry) => entry.label.toUpperCase());
        const chartValues = AVALIACAO_SCALE.map((entry) => counts[entry.key]);
        const chartColors = AVALIACAO_SCALE.map((entry) => entry.color);

        if (outrosCount > 0) {
            chartLabels.push("OUTROS");
            chartValues.push(outrosCount);
            chartColors.push("#93a5bc");
        }

        state.charts.avaliacaoDistribuicao = new Chart(chartEl, {
            type: "bar",
            data: {
                labels: chartLabels,
                datasets: [{
                    label: "Jogos",
                    data: chartValues,
                    backgroundColor: chartColors,
                    borderRadius: 8,
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                indexAxis: "y",
                plugins: {
                    legend: { display: false },
                    title: {
                        display: true,
                        text: "AVALIACAO PESSOAL - DISTRIBUICAO",
                        color: "#d4a853",
                        font: { size: 16 }
                    }
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        ticks: { color: "#cdc7bc" },
                        grid: { color: "rgba(212, 168, 83, 0.14)" }
                    },
                    y: {
                        ticks: { color: "#cdc7bc" },
                        grid: { display: false }
                    }
                }
            }
        });
    }
}

/* ====================== RENDER: USER RANKING ====================== */

function simularEstatisticasGlobais(games) {
    if (!Array.isArray(games)) return [];

    return games
        .map((game, index) => {
            const jogo = game.name || `Jogo ${index + 1}`;
            const meuTempoSegundos = Math.round((game.playtime_hours || 0) * 3600);

            if (meuTempoSegundos <= 0) return null;

            const seedBase = `${normalizeText(jogo)}|${meuTempoSegundos}|${index}`;
            const fatorGlobal = 0.8 + (seededRandomFromString(`${seedBase}|global`) * 0.5);
            const mediaGlobalSegundos = Math.max(300, Math.round(meuTempoSegundos * fatorGlobal));
            const diferencaSegundos = mediaGlobalSegundos - meuTempoSegundos;
            const percentil = calcularPercentilFicticio(
                meuTempoSegundos,
                mediaGlobalSegundos,
                seededRandomFromString(`${seedBase}|percentil`)
            );

            let impacto = "Voce igualou a media mundial, ficando no Top 50%.";
            if (diferencaSegundos > 0) {
                impacto = `Voce zerou ${formatSecondsToTime(diferencaSegundos)} mais rapido que a media mundial, entrando para o Top ${percentil}%.`;
            } else if (diferencaSegundos < 0) {
                impacto = `Voce levou ${formatSecondsToTime(Math.abs(diferencaSegundos))} a mais que a media mundial, ficando no Top ${percentil}%.`;
            }

            return {
                jogo,
                meuTempoSegundos,
                mediaGlobalSegundos,
                diferencaSegundos,
                percentil,
                impacto
            };
        })
        .filter(Boolean)
        .sort((a, b) => {
            if (a.percentil !== b.percentil) return a.percentil - b.percentil;
            if (b.diferencaSegundos !== a.diferencaSegundos) return b.diferencaSegundos - a.diferencaSegundos;
            return a.jogo.localeCompare(b.jogo, "pt-BR", { sensitivity: "base" });
        });
}

function renderUserRanking() {
    const grid = document.getElementById("user-ranking-grid");
    const totalJogosEl = document.getElementById("ur-total-jogos");
    const percentilMedioEl = document.getElementById("ur-percentil-medio");
    const jogosTop20El = document.getElementById("ur-jogos-top20");
    const maisRapidoEl = document.getElementById("ur-mais-rapido");
    const maisLentoEl = document.getElementById("ur-mais-lento");
    const kpiMelhorEl = document.getElementById("ur-kpi-melhor");
    const kpiMediaEl = document.getElementById("ur-kpi-media");
    const kpiImpactoEl = document.getElementById("ur-kpi-impacto");

    if (!grid || !totalJogosEl || !percentilMedioEl || !jogosTop20El || !maisRapidoEl || !maisLentoEl || !kpiMelhorEl || !kpiMediaEl || !kpiImpactoEl) {
        return;
    }

    grid.innerHTML = "";

    const filteredGames = getFilteredLibrary();
    const ranking = simularEstatisticasGlobais(filteredGames);
    const totalJogos = ranking.length;

    if (!totalJogos) {
        totalJogosEl.textContent = "0";
        percentilMedioEl.textContent = "-";
        jogosTop20El.textContent = "0";
        maisRapidoEl.textContent = "-";
        maisLentoEl.textContent = "-";
        kpiMelhorEl.textContent = "-";
        kpiMediaEl.textContent = "-";
        kpiImpactoEl.textContent = "Sem dados suficientes";

        const empty = document.createElement("p");
        empty.className = "user-ranking-empty";
        empty.textContent = "Nao foi possivel simular estatisticas globais para os jogos atuais.";
        grid.appendChild(empty);
        return;
    }

    const percentilMedio = ranking.reduce((acc, item) => acc + item.percentil, 0) / totalJogos;
    const jogosTop20 = ranking.filter((item) => item.percentil <= 20).length;
    const maiorVantagem = [...ranking].filter((item) => item.diferencaSegundos > 0).sort((a, b) => b.diferencaSegundos - a.diferencaSegundos)[0] || null;
    const maiorDesafio = [...ranking].filter((item) => item.diferencaSegundos < 0).sort((a, b) => a.diferencaSegundos - b.diferencaSegundos)[0] || null;
    const melhorPosicao = ranking[0];
    const mediaDiferencaSegundos = Math.round(ranking.reduce((acc, item) => acc + item.diferencaSegundos, 0) / totalJogos);

    totalJogosEl.textContent = String(totalJogos);
    percentilMedioEl.textContent = `Top ${percentilMedio.toFixed(1)}%`;
    jogosTop20El.textContent = String(jogosTop20);
    maisRapidoEl.textContent = maiorVantagem
        ? `${maiorVantagem.jogo} (${formatSecondsToTime(maiorVantagem.diferencaSegundos)})`
        : "-";
    maisLentoEl.textContent = maiorDesafio
        ? `${maiorDesafio.jogo} (${formatSecondsToTime(Math.abs(maiorDesafio.diferencaSegundos))})`
        : "-";

    kpiMelhorEl.textContent = `${melhorPosicao.jogo} (Top ${melhorPosicao.percentil}%)`;
    if (mediaDiferencaSegundos > 0) {
        kpiMediaEl.textContent = `${formatSecondsToTime(mediaDiferencaSegundos)} mais rapido`;
    } else if (mediaDiferencaSegundos < 0) {
        kpiMediaEl.textContent = `${formatSecondsToTime(Math.abs(mediaDiferencaSegundos))} mais lento`;
    } else {
        kpiMediaEl.textContent = "No ritmo da media global";
    }

    if (percentilMedio <= 20) {
        kpiImpactoEl.textContent = "Perfil elite da comunidade";
    } else if (percentilMedio <= 40) {
        kpiImpactoEl.textContent = "Desempenho acima da media";
    } else if (percentilMedio <= 60) {
        kpiImpactoEl.textContent = "Bom espaco para subir no ranking";
    } else {
        kpiImpactoEl.textContent = "Modo hardcore de evolucao ativado";
    }

    ranking.forEach((item, index) => {
        const card = document.createElement("article");
        card.className = "user-ranking-card";

        if (item.diferencaSegundos > 0) {
            card.classList.add("is-faster");
        } else if (item.diferencaSegundos < 0) {
            card.classList.add("is-slower");
        } else {
            card.classList.add("is-even");
        }

        const top = document.createElement("div");
        top.className = "user-ranking-card-top";

        const title = document.createElement("h4");
        title.textContent = `${index + 1}. ${item.jogo}`;

        const badge = document.createElement("span");
        badge.className = "user-ranking-badge";
        badge.textContent = `Top ${item.percentil}%`;

        top.appendChild(title);
        top.appendChild(badge);

        const times = document.createElement("div");
        times.className = "user-ranking-times";

        const meuTempoBlock = document.createElement("div");
        meuTempoBlock.className = "user-ranking-time-block";
        meuTempoBlock.innerHTML = `
            <span class="user-ranking-time-label">Seu tempo</span>
            <strong class="user-ranking-time-value">${formatSecondsToTime(item.meuTempoSegundos)}</strong>
        `;

        const mediaBlock = document.createElement("div");
        mediaBlock.className = "user-ranking-time-block";
        mediaBlock.innerHTML = `
            <span class="user-ranking-time-label">Media global</span>
            <strong class="user-ranking-time-value">${formatSecondsToTime(item.mediaGlobalSegundos)}</strong>
        `;

        times.appendChild(meuTempoBlock);
        times.appendChild(mediaBlock);

        const delta = document.createElement("div");
        delta.className = "user-ranking-delta";
        if (item.diferencaSegundos > 0) {
            delta.textContent = `${formatSecondsToTime(item.diferencaSegundos)} mais rapido que a media`;
        } else if (item.diferencaSegundos < 0) {
            delta.textContent = `${formatSecondsToTime(Math.abs(item.diferencaSegundos))} mais lento que a media`;
        } else {
            delta.textContent = "Mesmo ritmo da media global";
        }

        const impact = document.createElement("p");
        impact.className = "user-ranking-impact";
        impact.textContent = item.impacto;

        card.appendChild(top);
        card.appendChild(times);
        card.appendChild(delta);
        card.appendChild(impact);
        grid.appendChild(card);
    });
}

/* ====================== CENTRAL UPDATE ====================== */

function updateDashboards() {
    updateFilterSelects();
    const library = getLibrary();
    updateStatus(`${library.length} jogos na biblioteca.`, false);

    const activeTab = document.querySelector(".tab-btn.active")?.getAttribute("data-tab") || "bi-gamer";
    if (activeTab === "visao-geral") renderVisaoGeral();
    else if (activeTab === "bi-gamer") renderBiGamer();
    else if (activeTab === "tempo-jogo") renderTempoJogo();
    else if (activeTab === "dificuldade") renderDificuldade();
    else if (activeTab === "plataforma") renderPlataforma();
    else if (activeTab === "avaliacao") renderAvaliacao();
    else if (activeTab === "user-ranking") renderUserRanking();
}

/* ====================== TIER LIST ====================== */

function getGameCover(game) {
    if (!game || !game.appid) return "";
    return `https://cdn.akamai.steamstatic.com/steam/apps/${game.appid}/header.jpg`;
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

        state.tierList.title = String(savedState.title || "MAKE YOUR TIERLIST");
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
        state.tierList.title = value || "MAKE YOUR TIERLIST";
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

    topByTime.forEach((item) => {
        if (!item) return;
        const title = String(item.name || "Sem titulo").trim();
        const key = title.toLowerCase();
        if (!title || seen.has(key)) return;

        const src = getGameCover(item.game);
        if (!src) return;

        seen.add(key);
        state.tierList.pool.push(createTierItem(title, src, false));
        addedCount += 1;
    });

    return addedCount;
}

/* ====================== STEAM LIBRARY ====================== */

function getSteamModalElements() {
    return {
        overlay: document.getElementById("steam-modal-overlay"),
        closeBtn: document.getElementById("steam-modal-close"),
        cancelBtn: document.getElementById("steam-modal-cancel"),
        deleteBtn: document.getElementById("steam-modal-delete"),
        form: document.getElementById("steam-metadata-form"),
        gameName: document.getElementById("steam-modal-game-name"),
        gameHours: document.getElementById("steam-modal-game-hours"),
        playtimeHours: document.getElementById("meta-playtime-hours"),
        appid: document.getElementById("meta-appid"),
        status: document.getElementById("meta-status"),
        avaliacao: document.getElementById("meta-avaliacao"),
        multiplayer: document.getElementById("meta-multiplayer"),
        prioridade: document.getElementById("meta-prioridade"),
        anoConclusao: document.getElementById("meta-ano-conclusao"),
        plataforma: document.getElementById("meta-plataforma"),
        expectativaHoras: document.getElementById("meta-expectativa-horas"),
        dificuldade: document.getElementById("meta-dificuldade"),
        anoLancamento: document.getElementById("meta-ano-lancamento"),
        comentarios: document.getElementById("meta-comentarios"),
        coverPreview: document.getElementById("meta-cover-preview"),
        coverUrl: document.getElementById("meta-cover-url"),
        coverFile: document.getElementById("meta-cover-file"),
        coverClear: document.getElementById("meta-cover-clear")
    };
}

function normalizeSteamGame(game, currentMetadata, currentCoverSrc, currentPlaytimeOverride, currentPlaytimeOverridden) {
    const mergedMetadata = {
        ...DEFAULT_STEAM_METADATA,
        ...(currentMetadata || {}),
        ...(game.metadata || {})
    };

    const hasOverride = currentPlaytimeOverride !== undefined || Boolean(game.playtime_overridden);
    const resolvedPlaytime = currentPlaytimeOverride !== undefined
        ? Number(currentPlaytimeOverride)
        : Number(game.playtime_hours);

    return {
        appid: game.appid,
        name: game.name || "Desconhecido",
        playtime_hours: Number.isFinite(resolvedPlaytime) ? resolvedPlaytime : 0,
        playtime_overridden: currentPlaytimeOverride !== undefined
            ? Boolean(currentPlaytimeOverridden)
            : hasOverride,
        metadata: mergedMetadata,
        coverSrc: String(currentCoverSrc || game.coverSrc || "")
    };
}

function saveSteamLibraryToStorage() {
    try {
        localStorage.setItem(STEAM_LIBRARY_STORAGE_KEY, JSON.stringify(steamState.library));
        if (steamState.steamId) {
            localStorage.setItem(STEAM_LIBRARY_STEAM_ID_KEY, steamState.steamId);
        }
    } catch (error) {
        console.error("Falha ao persistir yxt_library:", error);
    }
}

function loadSteamLibraryFromStorage() {
    try {
        const raw = localStorage.getItem(STEAM_LIBRARY_STORAGE_KEY);
        if (!raw) return false;

        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return false;

        steamState.library = parsed
            .map((game) => normalizeSteamGame(game))
            .filter((game) => Number.isFinite(Number(game.appid)) || typeof game.appid === "string");

        const storedSteamId = localStorage.getItem(STEAM_LIBRARY_STEAM_ID_KEY) || "";
        steamState.steamId = storedSteamId;
        return steamState.library.length > 0;
    } catch (error) {
        console.error("Falha ao ler yxt_library:", error);
        return false;
    }
}

function renderSteamLibrary(games) {
    const resultsEl = document.getElementById("steam-results");
    const statusEl = document.getElementById("steam-status");
    if (!resultsEl || !statusEl) return;

    const sortedGames = [...games]
        .filter((g) => (Number(g.playtime_hours) || 0) >= 0)
        .sort((a, b) => (Number(b.playtime_hours) || 0) - (Number(a.playtime_hours) || 0));

    if (!sortedGames.length) {
        resultsEl.innerHTML = "";
        statusEl.textContent = "Nenhum jogo encontrado na biblioteca Steam.";
        statusEl.className = "steam-status steam-status--error";
        return;
    }

    const maxHours = Math.max(...sortedGames.map((g) => Number(g.playtime_hours) || 0), 1);

    resultsEl.innerHTML = '<div class="steam-grid">' + sortedGames.map((g, i) => {
        const barWidth = Math.max(((Number(g.playtime_hours) || 0) / maxHours) * 100, 2);
        const safeName = escapeHtml(g.name);
        const coverSrc = getResolvedGameCover(g);

        return `<div class="steam-card" tabindex="0" role="button" data-appid="${g.appid}" style="animation-delay:${i * 0.03}s">
            <div class="steam-card-rank">#${i + 1}</div>
            <img class="steam-card-img"
                 src="${coverSrc}"
                 alt="${safeName}" loading="lazy"
                 onerror="this.src='${DEFAULT_GAME_COVER_PLACEHOLDER}'" />
            <div class="steam-card-info">
                <span class="steam-card-name">${safeName}</span>
                <div class="steam-card-bar-wrap">
                    <div class="steam-card-bar" style="width:${barWidth}%"></div>
                </div>
                <span class="steam-card-hours">${Number(g.playtime_hours) || 0}h</span>
            </div>
        </div>`;
    }).join("") + "</div>";

    statusEl.textContent = `${sortedGames.length} jogos carregados. Clique em um card para editar metadados.`;
    statusEl.className = "steam-status steam-status--success";
    bindSteamCardEvents();
}

function normalizeManualGame(game) {
    const gameId = String(game?.id || `manual-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
    return {
        id: gameId,
        appid: String(game?.appid || "").trim(),
        name: game?.name || "Novo jogo",
        playtime_hours: Number(game?.playtime_hours) || 0,
        metadata: {
            ...DEFAULT_STEAM_METADATA,
            ...(game?.metadata || {})
        },
        coverSrc: String(game?.coverSrc || "")
    };
}

function loadManualGamesFromStorage() {
    try {
        const raw = localStorage.getItem(MANUAL_GAME_STORAGE_KEY);
        if (!raw) return false;

        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return false;

        manualGameState.library = parsed
            .map((game) => normalizeManualGame(game))
            .filter((game) => Boolean(game.name));

        return manualGameState.library.length > 0;
    } catch (error) {
        console.error("Falha ao ler yxt_manual_games:", error);
        return false;
    }
}

function saveManualGamesToStorage() {
    try {
        localStorage.setItem(MANUAL_GAME_STORAGE_KEY, JSON.stringify(manualGameState.library));
    } catch (error) {
        console.error("Falha ao persistir yxt_manual_games:", error);
    }
}

function renderManualGames(games) {
    const resultsEl = document.getElementById("manual-games-results");
    const statusEl = document.getElementById("manual-status");
    if (!resultsEl || !statusEl) return;

    const sortedGames = [...games]
        .filter((g) => (Number(g.playtime_hours) || 0) >= 0)
        .sort((a, b) => (Number(b.playtime_hours) || 0) - (Number(a.playtime_hours) || 0));

    if (!sortedGames.length) {
        resultsEl.innerHTML = "";
        statusEl.textContent = "Nenhum jogo manual adicionado ainda.";
        statusEl.className = "steam-status steam-status--error";
        return;
    }

    const maxHours = Math.max(...sortedGames.map((g) => Number(g.playtime_hours) || 0), 1);

    resultsEl.innerHTML = '<div class="steam-grid">' + sortedGames.map((g, i) => {
        const barWidth = Math.max(((Number(g.playtime_hours) || 0) / maxHours) * 100, 2);
        const safeName = escapeHtml(g.name);
        const coverSrc = getResolvedGameCover(g);

        return `<div class="steam-card manual-card" tabindex="0" role="button" data-game-id="${escapeHtml(g.id)}" style="animation-delay:${i * 0.03}s">
            <div class="steam-card-rank">#${i + 1}</div>
            <img class="steam-card-img"
                 src="${coverSrc}"
                 alt="${safeName}" loading="lazy"
                 onerror="this.src='${DEFAULT_GAME_COVER_PLACEHOLDER}'" />
            <div class="steam-card-info">
                <span class="steam-card-name">${safeName}</span>
                <div class="steam-card-bar-wrap">
                    <div class="steam-card-bar" style="width:${barWidth}%"></div>
                </div>
                <span class="steam-card-hours">${Number(g.playtime_hours) || 0}h</span>
            </div>
        </div>`;
    }).join("") + "</div>";

    statusEl.textContent = `${sortedGames.length} jogos adicionados manualmente.`;
    statusEl.className = "steam-status steam-status--success";
    bindManualGameEvents();
}

function initializeManualGamesFromStorage() {
    const loaded = loadManualGamesFromStorage();
    if (loaded) {
        renderManualGames(manualGameState.library);
        const statusEl = document.getElementById("manual-status");
        if (statusEl) {
            statusEl.textContent = `${manualGameState.library.length} jogos restaurados do armazenamento local.`;
            statusEl.className = "steam-status steam-status--success";
        }
    }
}

async function addManualGame(event) {
    event.preventDefault();

    const nameInput = document.getElementById("manual-game-name");
    const hoursInput = document.getElementById("manual-game-hours");
    const appIdInput = document.getElementById("manual-game-appid");
    const coverInput = document.getElementById("manual-cover-input");
    const coverUrlInput = document.getElementById("manual-game-cover-url");
    const statusEl = document.getElementById("manual-status");

    const name = String(nameInput?.value || "").trim();
    const playtimeHours = Number(hoursInput?.value || 0);
    let appid = String(appIdInput?.value || "").trim();
    const coverUrl = String(coverUrlInput?.value || "").trim();
    const file = coverInput?.files?.[0] || null;

    if (!name) {
        if (statusEl) {
            statusEl.textContent = "Digite o nome do jogo.";
            statusEl.className = "steam-status steam-status--error";
        }
        return;
    }

    if (!Number.isFinite(playtimeHours)) {
        if (statusEl) {
            statusEl.textContent = "Informe um valor valido para as horas jogadas.";
            statusEl.className = "steam-status steam-status--error";
        }
        return;
    }

    let coverSrc = "";
    if (file) {
        coverSrc = await readFileAsDataUrl(file);
    } else if (coverUrl) {
        coverSrc = coverUrl;
    }

    let autoFillMessage = "";
    if (!appid && !coverSrc) {
        try {
            const match = await searchSteamGameByName(name);
            if (match) {
                appid = match.appid;
                coverSrc = match.cover;
                if (appIdInput) appIdInput.value = appid;
                if (coverUrlInput && match.cover) coverUrlInput.value = match.cover;
                autoFillMessage = " AppID e capa preenchidos automaticamente pela Steam.";
            } else {
                autoFillMessage = " Nao encontrei match automatico na Steam, mas o jogo foi adicionado normalmente.";
            }
        } catch {
            autoFillMessage = " Nao foi possivel buscar na Steam agora, mas o jogo foi adicionado normalmente.";
        }
    }

    const nextGame = normalizeManualGame({
        name,
        playtime_hours: playtimeHours,
        appid,
        coverSrc
    });

    manualGameState.library.unshift(nextGame);
    saveManualGamesToStorage();
    renderManualGames(manualGameState.library);
    updateDashboards();

    if (statusEl) {
        statusEl.textContent = `${name} adicionado aos jogos manuais.${autoFillMessage}`;
        statusEl.className = "steam-status steam-status--success";
    }

    if (nameInput) nameInput.value = "";
    if (hoursInput) hoursInput.value = "";
    if (appIdInput) appIdInput.value = "";
    if (coverUrlInput) coverUrlInput.value = "";
    if (coverInput) coverInput.value = "";
}

function openManualGameModal(gameId) {
    const game = manualGameState.library.find((item) => item.id === String(gameId));
    const modal = getSteamModalElements();
    if (!game || !modal.overlay || !modal.form) return;

    gameEditorState.libraryType = "manual";
    gameEditorState.gameId = String(gameId);
    gameEditorState.pendingCoverSrc = null;

    modal.gameName.textContent = game.name;
    modal.gameHours.textContent = `${game.playtime_hours}h`;
    if (modal.playtimeHours) modal.playtimeHours.value = String(Number(game.playtime_hours) || 0);
    if (modal.appid) modal.appid.value = game.appid || "";
    modal.status.value = game.metadata.status || "";
    modal.avaliacao.value = game.metadata.avaliacao || "";
    modal.multiplayer.value = game.metadata.multiplayer || "";
    modal.prioridade.value = game.metadata.prioridade || "";
    modal.anoConclusao.value = game.metadata.anoConclusao || "";
    modal.plataforma.value = game.metadata.plataforma || "Steam";
    modal.expectativaHoras.value = game.metadata.expectativaHoras || "";
    modal.dificuldade.value = game.metadata.dificuldade || "";
    modal.anoLancamento.value = game.metadata.anoLancamento || "";
    modal.comentarios.value = game.metadata.comentarios || "";

    if (modal.coverUrl) modal.coverUrl.value = "";
    if (modal.coverFile) modal.coverFile.value = "";
    if (modal.coverPreview) modal.coverPreview.src = getResolvedGameCover(game);

    modal.overlay.classList.add("is-open");
    modal.overlay.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
}

function saveGameMetadata(event) {
    event.preventDefault();

    const modal = getSteamModalElements();
    if (!gameEditorState.libraryType || !gameEditorState.gameId) return;

    const metadata = {
        status: modal.status?.value || "",
        avaliacao: modal.avaliacao?.value || "",
        multiplayer: modal.multiplayer?.value || "",
        prioridade: modal.prioridade?.value || "",
        anoConclusao: modal.anoConclusao?.value || "",
        plataforma: modal.plataforma?.value || "Steam",
        expectativaHoras: modal.expectativaHoras?.value || "",
        dificuldade: modal.dificuldade?.value || "",
        anoLancamento: modal.anoLancamento?.value || "",
        comentarios: modal.comentarios?.value || ""
    };

    const nextAppId = String(modal.appid?.value || "").trim();
    const nextPlaytimeRaw = Number(modal.playtimeHours?.value || 0);
    const nextPlaytimeHours = Number.isFinite(nextPlaytimeRaw) && nextPlaytimeRaw >= 0
        ? nextPlaytimeRaw
        : 0;
    const currentCoverSrc = gameEditorState.libraryType === "steam"
        ? steamState.library.find((item) => String(item.appid) === String(gameEditorState.gameId))?.coverSrc || ""
        : manualGameState.library.find((item) => item.id === String(gameEditorState.gameId))?.coverSrc || "";

    const nextCoverSrc = gameEditorState.pendingCoverSrc === null
        ? currentCoverSrc
        : gameEditorState.pendingCoverSrc;

    if (gameEditorState.libraryType === "steam") {
        const idx = steamState.library.findIndex((item) => String(item.appid) === String(gameEditorState.gameId));
        if (idx === -1) return;

        steamState.library[idx] = {
            ...steamState.library[idx],
            appid: nextAppId || steamState.library[idx].appid,
            playtime_hours: nextPlaytimeHours,
            playtime_overridden: true,
            metadata: {
                ...DEFAULT_STEAM_METADATA,
                ...steamState.library[idx].metadata,
                ...metadata
            },
            coverSrc: String(nextCoverSrc || "")
        };

        saveSteamLibraryToStorage();
        renderSteamLibrary(steamState.library);
    } else {
        const idx = manualGameState.library.findIndex((item) => item.id === String(gameEditorState.gameId));
        if (idx === -1) return;

        manualGameState.library[idx] = {
            ...manualGameState.library[idx],
            name: modal.gameName?.textContent || manualGameState.library[idx].name,
            appid: nextAppId || manualGameState.library[idx].appid,
            playtime_hours: nextPlaytimeHours,
            metadata: {
                ...DEFAULT_STEAM_METADATA,
                ...manualGameState.library[idx].metadata,
                ...metadata
            },
            coverSrc: String(nextCoverSrc || "")
        };

        saveManualGamesToStorage();
        renderManualGames(manualGameState.library);
    }

    const statusEl = gameEditorState.libraryType === "manual"
        ? document.getElementById("manual-status")
        : document.getElementById("steam-status");
    if (statusEl) {
        statusEl.textContent = "Metadados salvos com sucesso.";
        statusEl.className = "steam-status steam-status--success";
    }

    closeSteamMetadataModal();
    updateDashboards();
}

function openSteamMetadataModal(appId) {
    const appIdText = String(appId || "");
    const game = steamState.library.find((item) => String(item.appid) === appIdText);
    const modal = getSteamModalElements();
    if (!game || !modal.overlay || !modal.form) return;

    const metadata = {
        ...DEFAULT_STEAM_METADATA,
        ...(game.metadata || {})
    };

    steamState.selectedAppId = appIdText;
    gameEditorState.libraryType = "steam";
    gameEditorState.gameId = appIdText;
    gameEditorState.pendingCoverSrc = null;
    modal.gameName.textContent = game.name;
    modal.gameHours.textContent = `${game.playtime_hours}h`;
    if (modal.playtimeHours) modal.playtimeHours.value = String(Number(game.playtime_hours) || 0);
    if (modal.appid) modal.appid.value = game.appid || "";

    modal.status.value = metadata.status || "";
    modal.avaliacao.value = metadata.avaliacao || "";
    modal.multiplayer.value = metadata.multiplayer || "";
    modal.prioridade.value = metadata.prioridade || "";
    modal.anoConclusao.value = metadata.anoConclusao || "";
    modal.plataforma.value = metadata.plataforma || "Steam";
    modal.expectativaHoras.value = metadata.expectativaHoras || "";
    modal.dificuldade.value = metadata.dificuldade || "";
    modal.anoLancamento.value = metadata.anoLancamento || "";
    modal.comentarios.value = metadata.comentarios || "";
    if (modal.coverUrl) modal.coverUrl.value = "";
    if (modal.coverFile) modal.coverFile.value = "";
    if (modal.coverPreview) modal.coverPreview.src = getResolvedGameCover(game);

    modal.overlay.classList.add("is-open");
    modal.overlay.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
}

function closeSteamMetadataModal() {
    const modal = getSteamModalElements();
    if (!modal.overlay) return;
    steamState.selectedAppId = null;
    gameEditorState.libraryType = "";
    gameEditorState.gameId = null;
    gameEditorState.pendingCoverSrc = null;
    if (modal.coverUrl) modal.coverUrl.value = "";
    if (modal.coverFile) modal.coverFile.value = "";
    if (modal.playtimeHours) modal.playtimeHours.value = "";
    modal.overlay.classList.remove("is-open");
    modal.overlay.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
}

function deleteCurrentGameFromModal() {
    if (!gameEditorState.libraryType || !gameEditorState.gameId) return;

    if (gameEditorState.libraryType === "steam") {
        const previousLength = steamState.library.length;
        steamState.library = steamState.library.filter((item) => String(item.appid) !== String(gameEditorState.gameId));
        if (steamState.library.length === previousLength) return;
        saveSteamLibraryToStorage();
        renderSteamLibrary(steamState.library);

        const statusEl = document.getElementById("steam-status");
        if (statusEl) {
            statusEl.textContent = "Jogo removido da Biblioteca Steam local.";
            statusEl.className = "steam-status steam-status--success";
        }
    } else {
        const previousLength = manualGameState.library.length;
        manualGameState.library = manualGameState.library.filter((item) => String(item.id) !== String(gameEditorState.gameId));
        if (manualGameState.library.length === previousLength) return;
        saveManualGamesToStorage();
        renderManualGames(manualGameState.library);

        const statusEl = document.getElementById("manual-status");
        if (statusEl) {
            statusEl.textContent = "Jogo removido da aba Add Your Game.";
            statusEl.className = "steam-status steam-status--success";
        }
    }

    closeSteamMetadataModal();
    updateDashboards();
}

function getSteamMetadataFromForm() {
    const modal = getSteamModalElements();
    return {
        status: modal.status?.value || "",
        avaliacao: modal.avaliacao?.value || "",
        multiplayer: modal.multiplayer?.value || "",
        prioridade: modal.prioridade?.value || "",
        anoConclusao: modal.anoConclusao?.value || "",
        plataforma: modal.plataforma?.value || "Steam",
        expectativaHoras: modal.expectativaHoras?.value || "",
        dificuldade: modal.dificuldade?.value || "",
        anoLancamento: modal.anoLancamento?.value || "",
        comentarios: modal.comentarios?.value || ""
    };
}

function saveSteamMetadata(event) {
    return saveGameMetadata(event);
}

function bindSteamCardEvents() {
    const cards = document.querySelectorAll(".steam-card[data-appid]");
    cards.forEach((card) => {
        card.addEventListener("click", () => {
            const appid = card.getAttribute("data-appid");
            openSteamMetadataModal(appid);
        });

        card.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                const appid = card.getAttribute("data-appid");
                openSteamMetadataModal(appid);
            }
        });
    });
}

function initializeSteamLibraryFromStorage() {
    const loaded = loadSteamLibraryFromStorage();
    const input = document.getElementById("steam-id-input");
    const statusEl = document.getElementById("steam-status");

    if (input && steamState.steamId) {
        input.value = steamState.steamId;
    }

    if (loaded) {
        renderSteamLibrary(steamState.library);
        if (statusEl) {
            statusEl.textContent = `${steamState.library.length} jogos restaurados do armazenamento local.`;
            statusEl.className = "steam-status steam-status--success";
        }
    }
}

async function fetchSteamLibrary() {
    const input = document.getElementById("steam-id-input");
    const statusEl = document.getElementById("steam-status");
    const resultsEl = document.getElementById("steam-results");
    const steamId = (input?.value || "").trim();

    if (!steamId) {
        statusEl.textContent = "Digite um SteamID64 valido.";
        statusEl.className = "steam-status steam-status--error";
        return;
    }

    statusEl.textContent = "Carregando...";
    statusEl.className = "steam-status steam-status--loading";
    resultsEl.innerHTML = '<div class="steam-loading"><div class="steam-spinner"></div><span>Buscando biblioteca Steam...</span></div>';

    try {
        const response = await fetch(STEAM_API_BASE + encodeURIComponent(steamId));
        if (!response.ok) throw new Error(`Erro ${response.status}`);

        const data = await response.json();
        const games = (data.games || [])
            .sort((a, b) => b.playtime_hours - a.playtime_hours);

        if (!games.length) {
            statusEl.textContent = "Nenhum jogo encontrado na biblioteca Steam.";
            statusEl.className = "steam-status steam-status--error";
            resultsEl.innerHTML = "";
            return;
        }

        const isSameUser = steamState.steamId && steamState.steamId === steamId;

        if (!isSameUser) {
            steamState.library = [];
            steamState.steamId = steamId;
            localStorage.removeItem(STEAM_LIBRARY_STORAGE_KEY);
            localStorage.removeItem(STEAM_LIBRARY_STEAM_ID_KEY);
        }

        const existingByAppId = isSameUser
            ? new Map(steamState.library.map((game) => [String(game.appid), game]))
            : new Map();

        steamState.library = games.map((game) => normalizeSteamGame(
            game,
            existingByAppId.get(String(game.appid))?.metadata || DEFAULT_STEAM_METADATA,
            existingByAppId.get(String(game.appid))?.coverSrc || "",
            existingByAppId.get(String(game.appid))?.playtime_overridden
                ? existingByAppId.get(String(game.appid))?.playtime_hours
                : undefined,
            existingByAppId.get(String(game.appid))?.playtime_overridden || false
        ));
        steamState.steamId = steamId;
        saveSteamLibraryToStorage();
        renderSteamLibrary(steamState.library);
        updateDashboards();

    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        statusEl.textContent = `Falha ao buscar dados da Steam (${reason}).`;
        statusEl.className = "steam-status steam-status--error";
        resultsEl.innerHTML = "";
    }
}

function exportSteamLibraryBackup() {
    try {
        const rawLibrary = localStorage.getItem(STEAM_LIBRARY_STORAGE_KEY);
        const payload = rawLibrary ? JSON.parse(rawLibrary) : [];
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "yxt_backup.json";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        const statusEl = document.getElementById("steam-status");
        if (statusEl) {
            statusEl.textContent = "Backup exportado com sucesso.";
            statusEl.className = "steam-status steam-status--success";
        }
    } catch (error) {
        const statusEl = document.getElementById("steam-status");
        if (statusEl) {
            statusEl.textContent = "Falha ao exportar backup. Verifique os dados locais.";
            statusEl.className = "steam-status steam-status--error";
        }
        console.error("Falha ao exportar yxt_library:", error);
    }
}

function triggerSteamLibraryImport() {
    const input = document.getElementById("import-backup-input");
    if (input) {
        input.value = "";
        input.click();
    }
}

function importSteamLibraryBackup(event) {
    const file = event?.target?.files?.[0];
    const statusEl = document.getElementById("steam-status");
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
        try {
            const parsed = JSON.parse(String(reader.result || "[]"));
            if (!Array.isArray(parsed)) {
                throw new Error("Formato de backup invalido.");
            }

            localStorage.setItem(STEAM_LIBRARY_STORAGE_KEY, JSON.stringify(parsed));
            steamState.library = parsed
                .map((game) => normalizeSteamGame(game))
                .filter((game) => Number.isFinite(Number(game.appid)) || typeof game.appid === "string");

            renderSteamLibrary(steamState.library);
            updateDashboards();

            if (statusEl) {
                statusEl.textContent = `${steamState.library.length} jogos importados do backup.`;
                statusEl.className = "steam-status steam-status--success";
            }
        } catch (error) {
            if (statusEl) {
                statusEl.textContent = "Falha ao importar backup. Arquivo JSON invalido.";
                statusEl.className = "steam-status steam-status--error";
            }
            console.error("Falha ao importar yxt_library:", error);
        }
    };

    reader.onerror = () => {
        if (statusEl) {
            statusEl.textContent = "Falha ao ler o arquivo de backup.";
            statusEl.className = "steam-status steam-status--error";
        }
    };

    reader.readAsText(file, "UTF-8");
}

function bindSteamEvents() {
    const btn = document.getElementById("steam-sync-btn");
    const exportBackupBtn = document.getElementById("export-backup-btn");
    const importBackupBtn = document.getElementById("import-backup-btn");
    const importBackupInput = document.getElementById("import-backup-input");
    const manualAddBtn = document.getElementById("manual-add-game-btn");
    const manualCoverPickerBtn = document.getElementById("manual-cover-picker-btn");
    const manualCoverInput = document.getElementById("manual-cover-input");
    const input = document.getElementById("steam-id-input");
    const modal = getSteamModalElements();

    if (btn) btn.addEventListener("click", fetchSteamLibrary);
    if (exportBackupBtn) exportBackupBtn.addEventListener("click", exportSteamLibraryBackup);
    if (importBackupBtn) importBackupBtn.addEventListener("click", triggerSteamLibraryImport);
    if (importBackupInput) importBackupInput.addEventListener("change", importSteamLibraryBackup);
    if (manualAddBtn) manualAddBtn.addEventListener("click", (event) => { addManualGame(event).catch((error) => console.error("Falha ao adicionar jogo manual:", error)); });
    if (manualCoverPickerBtn && manualCoverInput) {
        manualCoverPickerBtn.addEventListener("click", () => manualCoverInput.click());
    }
    if (input) input.addEventListener("keydown", (e) => { if (e.key === "Enter") fetchSteamLibrary(); });

    if (modal.form) {
        modal.form.addEventListener("submit", saveGameMetadata);
    }

    if (modal.closeBtn) {
        modal.closeBtn.addEventListener("click", closeSteamMetadataModal);
    }

    if (modal.cancelBtn) {
        modal.cancelBtn.addEventListener("click", closeSteamMetadataModal);
    }

    if (modal.deleteBtn) {
        modal.deleteBtn.addEventListener("click", deleteCurrentGameFromModal);
    }

    if (modal.overlay) {
        modal.overlay.addEventListener("click", (event) => {
            if (event.target === modal.overlay) {
                closeSteamMetadataModal();
            }
        });
    }

    if (modal.coverFile) {
        modal.coverFile.addEventListener("change", (event) => {
            handleModalCoverFileChange(event).catch((error) => console.error("Falha ao processar capa:", error));
        });
    }

    if (modal.coverUrl) {
        modal.coverUrl.addEventListener("input", handleModalCoverUrlChange);
        modal.coverUrl.addEventListener("change", handleModalCoverUrlChange);
    }

    if (modal.coverClear) {
        modal.coverClear.addEventListener("click", clearModalCoverOverride);
    }

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            closeSteamMetadataModal();
        }
    });
}

function bindManualGameEvents() {
    const cards = document.querySelectorAll(".manual-card[data-game-id]");
    cards.forEach((card) => {
        card.addEventListener("click", () => {
            openManualGameModal(card.getAttribute("data-game-id"));
        });

        card.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openManualGameModal(card.getAttribute("data-game-id"));
            }
        });
    });
}

function updateModalCoverPreview(src) {
    const modal = getSteamModalElements();
    if (!modal.coverPreview) return;
    modal.coverPreview.src = src || DEFAULT_GAME_COVER_PLACEHOLDER;
}

async function handleModalCoverFileChange(event) {
    const file = event?.target?.files?.[0];
    if (!file) {
        gameEditorState.pendingCoverSrc = null;
        updateModalCoverPreview(DEFAULT_GAME_COVER_PLACEHOLDER);
        return;
    }

    const dataUrl = await readFileAsDataUrl(file);
    gameEditorState.pendingCoverSrc = dataUrl;
    updateModalCoverPreview(dataUrl);
}

function handleModalCoverUrlChange(event) {
    const value = String(event?.target?.value || "").trim();
    gameEditorState.pendingCoverSrc = value || null;
    updateModalCoverPreview(value || DEFAULT_GAME_COVER_PLACEHOLDER);
}

function clearModalCoverOverride() {
    const modal = getSteamModalElements();
    gameEditorState.pendingCoverSrc = "";
    if (modal.coverUrl) modal.coverUrl.value = "";
    if (modal.coverFile) modal.coverFile.value = "";
    updateModalCoverPreview(DEFAULT_GAME_COVER_PLACEHOLDER);
}

/* ====================== TABS, EVENTS, INIT ====================== */

function switchTab(tabId) {
    dom.tabBtns.forEach(btn => btn.classList.remove("active"));
    dom.tabContents.forEach(content => content.classList.remove("active"));

    const targetBtn = document.querySelector(`[data-tab="${tabId}"]`);
    const targetContent = document.getElementById(tabId);
    if (!targetBtn || !targetContent) return;

    targetBtn.classList.add("active");
    targetContent.classList.add("active");

    if (dom.filtersTop) {
        dom.filtersTop.hidden = tabId === "steam-library" || tabId === "add-your-game" || tabId === "world-cup";
    }

    if (tabId === "visao-geral") renderVisaoGeral();
    else if (tabId === "bi-gamer") renderBiGamer();
    else if (tabId === "tempo-jogo") renderTempoJogo();
    else if (tabId === "dificuldade") renderDificuldade();
    else if (tabId === "plataforma") renderPlataforma();
    else if (tabId === "avaliacao") renderAvaliacao();
    else if (tabId === "user-ranking") renderUserRanking();
    else if (tabId === "steam-library") renderSteamLibrary(steamState.library);
    else if (tabId === "add-your-game") renderManualGames(manualGameState.library);
    else if (tabId === "world-cup") renderWorldCup();
}

function bindEvents() {
    if (dom.filterStatus) {
        dom.filterStatus.addEventListener("change", (event) => {
            state.overviewFilters.status = event.target.value;
            const activeTab = document.querySelector(".tab-btn.active")?.getAttribute("data-tab") || "bi-gamer";
            switchTab(activeTab);
        });
    }

    if (dom.filterPlataforma) {
        dom.filterPlataforma.addEventListener("change", (event) => {
            state.overviewFilters.plataforma = event.target.value;
            const activeTab = document.querySelector(".tab-btn.active")?.getAttribute("data-tab") || "bi-gamer";
            switchTab(activeTab);
        });
    }

    if (dom.filterMultiplayer) {
        dom.filterMultiplayer.addEventListener("change", (event) => {
            state.overviewFilters.multiplayer = event.target.value;
            const activeTab = document.querySelector(".tab-btn.active")?.getAttribute("data-tab") || "bi-gamer";
            switchTab(activeTab);
        });
    }

    if (dom.filterAnoConclusao) {
        dom.filterAnoConclusao.addEventListener("change", (event) => {
            state.overviewFilters.anoConclusao = event.target.value;
            const activeTab = document.querySelector(".tab-btn.active")?.getAttribute("data-tab") || "bi-gamer";
            switchTab(activeTab);
        });
    }

    if (dom.refreshButton) {
        dom.refreshButton.addEventListener("click", () => {
            updateDashboards();
        });
    }

    dom.tabBtns.forEach(btn => {
        btn.addEventListener("click", (e) => {
            const tabId = e.target.getAttribute("data-tab");
            switchTab(tabId);
        });
    });
}

/* ====================== WORLD CUP ====================== */

const ultimateGamesList = ['A PLAGUE TALE: INNOCENCE','A PLAGUE TALE: REQUIEM','A SHORT HIKE','A WAY OUT','AETERNA LUCIS','AETERNA NOCTIS','ASSASSIN\'S CREED ORIGINS','ASSASSIN\'S CREED VALHALLA','ASSASSINS CREED BLACK FLAG','ASSASSINS CREED ODYSSEY','ASSASSINS CREED SHADOWS','ASSASSINS CREED UNITY','ATOM EVE','ATOMFALL','ATOMIC HEART','AVATAR THE BURNING EARTH','AVOWED','BACKROOM','BALATRO','BARDUR\'S GATE 3','BATMAN ARKHAM KNIGHT','BATTLEFIELD 1','BATTLETOADS','BEHIND THE FRAME','BEYOND BLUE','BIOSHOCK','BIOSHOCK 2','BIOSHOCK INFINITE','BLACK MITH WUKONG','BLASPHEMOUS','BLOODBRONE','BLOODSTAINED','BLOONS 6','BORDERLANDS 2','BREAD AND FRED','BROTHERS A TALE OF TWO SOULS','CALL OF DUTY BLACK OPS 6','CALL OF DUTY MODERN WARFARE 3','CARRY THE GLASS','CASTLE CRASHERS','CASTLEVANIA','CASTLEVANIA BLOODLINES','CASTLEVANIA II BELMONT\'S REVENGE','CASTLEVANIA II SIMON\'S QUEST','CASTLEVANIA III DRACULA\'S CURSE','CASTLEVANIA THE ADVENTURE','CELESTE','CITIES SKYLINES II','CIVILIZATION VI','CLAIR OBSCUR: EXPEDITION 33','COCOON','CONTROL','COUNTER STRIKE 2','CRASH BANDICOOT 4','CRASH N SANE TRILOGY 1','CRASH N SANE TRILOGY 2','CRASH N SANE TRILOGY 3','CUPHEAD','CYBERPUNK','DARK SOULS 2','DARK SOULS 3','DARK SOULS REMASTERED','DAYS GONE','DEAD CELLS','DEAD ISLAND 2','DEAD SPACE','DEATH STRANDING','DEATHLOOP','DELIVER AT ALL COSTS','DETROIT BECOME HUMAN','DIABLO IV','DISCO ELYSIUM','DIVINITY ORIGINAL SIN 2','DOKI DOKI LITERATURE CLUB PLUS!','DOOM ETERNAL','DOOM THE DARK AGES','DRAGON AGE INQUISITION','DRAGON AGE THE VEILGUARD','DREDGE','DYING LIGHT 2','EAFC 25','ELDEN RING','ELDEN RING NIGHTREIGN','ELDEN RING SHADOW OF THE ERDTREE','ENSLAVED','ENTER THE DUNGEON','ERICA','ESCAPE ACADEMY','FABLE','FAR CRY 5','FAR CRY 6','FAR: CHANGING TIDES','FIGMENT','FIGMENT 2','FINAL FANTASY VII REBIRTH','FINAL FANTASY VII REMAKE','FINAL FANTASY XVI','FIREBREAK','FIREWATCH','FLIGHT SIMULATOR','FORZA HORIZON 5','GEARS','GHOST OF TSUSHIMA','GHOSTRUNNER','GHOSTRUNNER 2','GOD OF WAR 2','GOD OF WAR 2018','GOD OF WAR 3','GOD OF WAR RAGNAROK','GOF OF WAR 3 REMASTERED','GOW RAGNAROK DLC VALHALLA','GRIS','GROUNDED','GROUNDED 2','GTA 5','GTA SAN ANDREAS','GTA VI','HALO INFINITE','HEAVY RAIN','HELA','HELLBLADE: SENUAS\'S SACRIFICE','HELLDIVERS 2','HIDDEN FOLKS','HOLLOW KNIGHT','HORIZON FORBIDDEN WEST','HORIZON ZERO DAWN','IMMORTALITY','IMMORTALITY (NÃO COMPRADO)','INDIANA JONES','INJUSTICE 2','INSIDE','INZOI','IT TAKES TWO','JUSANT','JUST DIE ALREADY','KENA','KINGDOM COME DELIVERANCE','KINGDOM COME DELIVERANCE II','LIES OF P','LIFE IS STRANGE','LIFE IS STRANGE TRUE COLORS','LIKE A DRAGON GAIDEN','LIKE A DRAGON: PIRATE YAKUZA','LIMBO','LITTLE NIGHTMARES','LITTLE NIGHTMARES 2','LORDS OF THE FALLEN','LOST RECORDS','MANDRAGORA','MANOR LORDS','MELTY BLOOD: TYPE LUMINA','MISIDE','MONSTER HUNTER WORLD','MONUMENT VALLEY','MONUMENT VALLEY 2','MOONLIGHTER','MORTAL KOMBAT 1','MORTAL KOMBAT SHAOLIN MONKS','MORTAL SHEEL','NEED FOR SPEED UNDERGROUND 2','NEED FOR SPEES UNBOUND','NIER: AUTOMATA','NINE SOLS','NINJA GAIDEN 4','NIOH','NIOH 2','NO MAN\'S SKY','NOUR: PLAY WITH YOUR FOOD','ORI AND THE BLIND FOREST','ORI AND THE WILL OF THE WISPS','OUTBOUND','OUTWARD','PANICORE','PATHOLOGIC 3','PERSONA 3 RELOAD','PERSONA 4 GOLDEN','PERSONA 5','PILGRIMS','PLANET OF LANA','PORTAL','PORTAL 2','PRAGMATA','PROJECT ZOMBOID','RAFT','RAIN WORLD','RED DEAD REDEMPTION 2','REMATCH','REMNANT 2','RESIDENT EVIL 3 REMAKE','RESIDENT EVIL VILLAGE','RISE OF THE TOMB RAIDER','SALT AND SACRIFICE','SALT AND SANCTUARY','SEA OF THIEVES','SEKIRO','SENUA\'S SAGA HELLBLADE 2','SHADOW OF MORDOR','SHADOW OF THE COLOSSUS','SHADOW OF THE TOMB RAIDER','SIFU','SILENT HILL 2 REMAKE','SILENT HILL f','SILKSONG','SNAKEBIRD','SOMERVILLE','SONS OF THE FOREST','SOUTH OF MIDNIGHT','SPELUNK 2','SPIDER MAN','SPIDER MAN MILES MORALES','SPLIT FICTION','STAR WARS JEDI: SURVIVOR','STARFIELD','STRANDED: ALIEN DAWN','STRAY','SUPER CASTLEVANIA IV','SUPER MEAT BOY','SWORD OF THE SEA','THE ALTERS','THE ASCENT','THE DARK PICTURES: HOUSE OF ASHES','THE DIVISION','THE DIVISION 2','THE ELDER SCROLLS IV: OBLIVION','THE ESCAPISTS 2','THE EVIL WITHIN','THE EVIL WITHIN 2','THE FIRST DESCENDANT','THE LAST GUARDIAN','THE LAST OF US','THE LAST OF US PART 2','THE LAST OF US: LEFT BEHIND','THE LONG DARK','THE OUTER WORLDS','THE QUARRY','THE SPECTRUM RETREAT','THE STANLEY PARABLE','THE SURGE','THE SURGE 2','THE WITCHER 3','TO THE MOON','TOMB RAIDER','TURN ON THE LIGHT','UNCHARTED 2','UNCHARTED 3','UNCHARTED 4','UNCHARTED THE LOST LEGACY','UNPACKING','UNRAVEL','UNRAVEL TWO','UNTIL DAWN','WATCH DOGS 2','WHAT REMAINS OF EDITH FINCH','WORLD WAR Z AFTERMATH','WRECKFEST','WUCHANG: FALLEN FEATHERS','YAKUZA: LIKE A DRAGON','CASTLEVANIA: SYMPHONY OF THE NIGHT','CHRONO TRIGGER','DRAGON QUEST XI: ECHOES OF AN ELUSIVE AGE','FALLOUT: NEW VEGAS','FINAL FANTASY VI','FTL: FASTER THAN LIGHT','GENSHIN IMPACT','HADES','HALF-LIFE 2','KERBAL SPACE PROGRAM','MASS EFFECT 2','METAL GEAR SOLID 3: SNAKE EATER','MINECRAFT','OUTER WILDS','RETURNAL','STARDEW VALLEY','SUPER MARIO GALAXY','SUPER MARIO WORLD','SUPER METROID','TETRIS','THE ELDER SCROLLS V: SKYRIM','THE LEGEND OF ZELDA: BREATH OF THE WILD','THE LEGEND OF ZELDA: OCARINA OF TIME'];

const wcCups = [
    {
        id: "best-games",
        title: "Os Melhores Jogos de Todos os Tempos",
        category: "Jogos",
        cover: "capa.png",
        items: ultimateGamesList
    }
];

const wcState = {
    currentRound: 0,
    matchupsQueue: [],
    winnersQueue: [],
    matchIndex: 0,
    totalMatchesInRound: 0,
    running: false,
    coverCache: new Map(),
    activeCup: null
};

function shuffleArray(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

async function fetchWcCover(gameName) {
    if (wcState.coverCache.has(gameName)) return wcState.coverCache.get(gameName);
    try {
        const result = await searchSteamGameByName(gameName);
        const url = result && result.appid
            ? `https://cdn.akamai.steamstatic.com/steam/apps/${result.appid}/header.jpg`
            : DEFAULT_GAME_COVER_PLACEHOLDER;
        wcState.coverCache.set(gameName, url);
        return url;
    } catch {
        wcState.coverCache.set(gameName, DEFAULT_GAME_COVER_PLACEHOLDER);
        return DEFAULT_GAME_COVER_PLACEHOLDER;
    }
}

function preloadNextMatchup() {
    const queue = wcState.matchupsQueue;
    if (queue.length >= 2) {
        fetchWcCover(queue[0]);
        fetchWcCover(queue[1]);
    }
}

/* ── Showcase ── */

function renderWorldCup() {
    const showcase = document.getElementById("wc-showcase");
    const duel = document.getElementById("wc-duel");
    const champion = document.getElementById("wc-champion");
    const modal = document.getElementById("wc-modal-overlay");

    if (!wcState.running) {
        if (showcase) showcase.hidden = false;
        if (duel) duel.hidden = true;
        if (champion) { champion.hidden = true; champion.innerHTML = ""; }
        if (modal) modal.hidden = true;
    }

    renderWcGrid();
}

function renderWcGrid() {
    const grid = document.getElementById("wc-grid");
    if (!grid) return;

    const searchVal = (document.getElementById("wc-search")?.value || "").trim().toLowerCase();
    const catVal = document.getElementById("wc-category-filter")?.value || "";

    const filtered = wcCups.filter(cup => {
        if (catVal && cup.category !== catVal) return false;
        if (searchVal && !cup.title.toLowerCase().includes(searchVal)) return false;
        return true;
    });

    grid.innerHTML = filtered.map(cup => `
        <div class="wc-cup-card" data-cup-id="${cup.id}">
            <img class="wc-cup-card-img" src="${cup.cover}" alt="${escapeHtml(cup.title)}"
                 onerror="this.src='${DEFAULT_GAME_COVER_PLACEHOLDER}'" />
            <div class="wc-cup-card-body">
                <h4 class="wc-cup-card-title">${escapeHtml(cup.title)}</h4>
                <span class="wc-cup-card-meta">${cup.category} &middot; ${cup.items.length} itens</span>
            </div>
        </div>
    `).join("");

    grid.querySelectorAll(".wc-cup-card").forEach(card => {
        card.addEventListener("click", () => {
            const cupId = card.getAttribute("data-cup-id");
            const cup = wcCups.find(c => c.id === cupId);
            if (cup) openWcSizeModal(cup);
        });
    });
}

function openWcSizeModal(cup) {
    wcState.activeCup = cup;
    const modal = document.getElementById("wc-modal-overlay");
    const title = document.getElementById("wc-modal-title");
    if (title) title.textContent = cup.title;
    if (modal) modal.hidden = false;
}

function closeWcSizeModal() {
    const modal = document.getElementById("wc-modal-overlay");
    if (modal) modal.hidden = true;
    wcState.activeCup = null;
}

/* ── Duel engine ── */

function startWorldCup(size) {
    const cup = wcState.activeCup;
    if (!cup) return;

    const shuffled = shuffleArray(cup.items).slice(0, size);
    wcState.matchupsQueue = shuffled;
    wcState.winnersQueue = [];
    wcState.currentRound = shuffled.length;
    wcState.matchIndex = 0;
    wcState.totalMatchesInRound = shuffled.length / 2;
    wcState.running = true;

    const showcase = document.getElementById("wc-showcase");
    const modal = document.getElementById("wc-modal-overlay");
    const duel = document.getElementById("wc-duel");
    const champion = document.getElementById("wc-champion");

    if (showcase) showcase.hidden = true;
    if (modal) modal.hidden = true;
    if (duel) duel.hidden = false;
    if (champion) { champion.hidden = true; champion.innerHTML = ""; }

    showNextMatchup();
}

function stopWorldCup() {
    wcState.running = false;
    wcState.matchupsQueue = [];
    wcState.winnersQueue = [];
    wcState.activeCup = null;
    renderWorldCup();
}

function updateRoundInfo() {
    const el = document.getElementById("wc-round-info");
    if (!el) return;

    if (wcState.currentRound === 2) {
        el.textContent = `GRANDE FINAL - Duelo ${wcState.matchIndex + 1}/1`;
    } else if (wcState.currentRound === 4) {
        el.textContent = `Semifinal - Duelo ${wcState.matchIndex + 1}/${wcState.totalMatchesInRound}`;
    } else if (wcState.currentRound === 8) {
        el.textContent = `Quartas de Final - Duelo ${wcState.matchIndex + 1}/${wcState.totalMatchesInRound}`;
    } else {
        el.textContent = `Fase de ${wcState.currentRound} - Duelo ${wcState.matchIndex + 1}/${wcState.totalMatchesInRound}`;
    }
}

async function showNextMatchup() {
    if (wcState.matchupsQueue.length < 2) {
        if (wcState.winnersQueue.length === 1) {
            showChampion(wcState.winnersQueue[0]);
            return;
        }
        wcState.matchupsQueue = wcState.winnersQueue;
        wcState.winnersQueue = [];
        wcState.currentRound = wcState.matchupsQueue.length;
        wcState.totalMatchesInRound = wcState.currentRound / 2;
        wcState.matchIndex = 0;
    }

    const left = wcState.matchupsQueue.shift();
    const right = wcState.matchupsQueue.shift();

    updateRoundInfo();

    const cardLeft = document.getElementById("wc-card-left");
    const cardRight = document.getElementById("wc-card-right");
    const imgLeft = document.getElementById("wc-img-left");
    const imgRight = document.getElementById("wc-img-right");
    const nameLeft = document.getElementById("wc-name-left");
    const nameRight = document.getElementById("wc-name-right");

    if (!cardLeft || !cardRight) return;

    cardLeft.className = "wc-card wc-card--left";
    cardRight.className = "wc-card wc-card--right";
    imgLeft.src = DEFAULT_GAME_COVER_PLACEHOLDER;
    imgRight.src = DEFAULT_GAME_COVER_PLACEHOLDER;
    nameLeft.textContent = left;
    nameRight.textContent = right;

    const [coverLeft, coverRight] = await Promise.all([
        fetchWcCover(left),
        fetchWcCover(right)
    ]);

    imgLeft.src = coverLeft;
    imgRight.src = coverRight;
    imgLeft.alt = left;
    imgRight.alt = right;

    preloadNextMatchup();

    const pick = (winner, winnerId, loserId) => {
        document.getElementById(winnerId).classList.add("wc-card--picked");
        document.getElementById(loserId).classList.add("wc-card--lost");
        wcState.winnersQueue.push(winner);
        wcState.matchIndex++;
        setTimeout(() => showNextMatchup(), 550);
    };

    const onClickLeft = () => {
        cardLeft.removeEventListener("click", onClickLeft);
        cardRight.removeEventListener("click", onClickRight);
        pick(left, "wc-card-left", "wc-card-right");
    };
    const onClickRight = () => {
        cardLeft.removeEventListener("click", onClickLeft);
        cardRight.removeEventListener("click", onClickRight);
        pick(right, "wc-card-right", "wc-card-left");
    };

    cardLeft.addEventListener("click", onClickLeft);
    cardRight.addEventListener("click", onClickRight);
}

async function showChampion(name) {
    const duel = document.getElementById("wc-duel");
    const champion = document.getElementById("wc-champion");

    if (duel) duel.hidden = true;

    const cover = await fetchWcCover(name);

    if (champion) {
        champion.hidden = false;
        champion.innerHTML = `
            <p class="wc-champion-label">O GRANDE CAMPE&Atilde;O</p>
            <img class="wc-champion-img" src="${cover}"
                 alt="${escapeHtml(name)}"
                 onerror="this.src='${DEFAULT_GAME_COVER_PLACEHOLDER}'" />
            <h2 class="wc-champion-name">${escapeHtml(name)}</h2>
            <button class="wc-champion-restart" id="wc-champion-restart">Voltar &agrave; Vitrine</button>
        `;
        document.getElementById("wc-champion-restart")?.addEventListener("click", stopWorldCup);
    }

    wcState.running = false;
}

/* ── Events ── */

function bindWorldCupEvents() {
    const modalClose = document.getElementById("wc-modal-close");
    const backBtn = document.getElementById("wc-back-btn");
    const search = document.getElementById("wc-search");
    const catFilter = document.getElementById("wc-category-filter");
    const overlay = document.getElementById("wc-modal-overlay");

    if (modalClose) modalClose.addEventListener("click", closeWcSizeModal);
    if (backBtn) backBtn.addEventListener("click", stopWorldCup);

    if (search) search.addEventListener("input", renderWcGrid);
    if (catFilter) catFilter.addEventListener("change", renderWcGrid);

    if (overlay) {
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) closeWcSizeModal();
        });
    }

    document.querySelectorAll(".wc-size-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const size = Number(btn.getAttribute("data-size"));
            startWorldCup(size);
        });
    });
}

function init() {
    bindEvents();
    bindSteamEvents();
    bindWorldCupEvents();
    initializeSteamLibraryFromStorage();
    initializeManualGamesFromStorage();
    if (dom.filtersTop) dom.filtersTop.hidden = false;
    updateDashboards();
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
