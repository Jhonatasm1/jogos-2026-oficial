import codecs

with open('script.js', 'r', encoding='utf-8') as f:
    text = f.read()

# Let's fix only the parsing maps and text updates simply
start = text.find('    const parsedRows = state.rows.map(row => {')
end = text.find('    if (ctxTopTempo && typeof Chart !== "undefined") {')

if start != -1 and end != -1:
    new_logic = '''    const parsedRows = state.rows.map(row => {
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
        const isPendenteGroup = st === "iniciado" || st === "logo jogo" || st === "logojogo" || st === "pausado" || st === "pendente";

        if (seconds > 0) {
            if (isJogado) {
                segundosJogados += seconds;
                if (!isCS2) {
                    segundosGameplaySemCS += seconds;
                    qtdGameplaySemCS++;
                }
            }
            if (isPendenteGroup) {
                segundosPendentes += seconds;
            }
            if (st === "concluido") {
                segundosZerados += seconds;
                qtdZerados++;
            }
        }

        return { row, jogo: jogoNome, isCS2, st, isJogado, isSolo: multiType === "solo", tempoRaw: formattedTempo, seconds };
    }).filter(item => item.seconds > 0);

    if (totalHorasJogadasEl && !isNaN(segundosJogados)) {
        totalHorasJogadasEl.textContent = Math.floor(segundosJogados / 3600) + "h";
    }
    if (totalHorasPendentesEl && !isNaN(segundosPendentes)) {
        totalHorasPendentesEl.textContent = Math.floor(segundosPendentes / 3600) + "h";
    }

    if (mediaGameplayEl && qtdGameplaySemCS > 0) {
        mediaGameplayEl.textContent = (segundosGameplaySemCS / 3600 / qtdGameplaySemCS).toFixed(1) + "h";
    }

    if (mediaZeradosEl && qtdZerados > 0) {
        mediaZeradosEl.textContent = (segundosZerados / 3600 / qtdZerados).toFixed(1) + "h";
    }

    if (soloMaisJogadoEl) {
        const soloGames = parsedRows.filter(item => item.isSolo && item.isJogado).sort((a, b) => b.seconds - a.seconds);
        const topSolo = soloGames[0];
        if (topSolo) {
            soloMaisJogadoEl.textContent = topSolo.jogo + " (" + topSolo.tempoRaw + ")";
            soloMaisJogadoEl.title = topSolo.jogo + " (" + topSolo.tempoRaw + ")";
        }
    }

'''
    new_content = text[:start] + new_logic + text[end:]
    with codecs.open('script.js', 'w', encoding='utf-8') as f:
        f.write(new_content)
    print("Script adjusted.")
else:
    print("Could not find boundaries.")
