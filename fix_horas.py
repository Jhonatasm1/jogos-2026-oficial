import codecs

with open('script.js', 'r', encoding='utf-8') as f:
    text = f.read()

start_idx = text.find('function renderTempoJogo() {')
end_idx = text.find('function renderDificuldade() {')

if start_idx != -1 and end_idx != -1:
    old_func = text[start_idx:end_idx]
    
    new_func = '''function renderTempoJogo() {
    const tempoHeader = state.resolvedHeaders.tempo;
    const jogoHeader = state.resolvedHeaders.jogo;
    const statusHeader = state.resolvedHeaders.status;

    if (!tempoHeader || !jogoHeader || !statusHeader) return;

    let segundosJogados = 0;

    const parsedRows = state.rows.map(row => {
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

        if (seconds > 0) {
            if (isJogado) {
                segundosJogados += seconds;
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

    // Removido outros calculos para focar exclusivamente no total de horas jogadas como pedido

'''
    # Append the chart and list logic so it doesn't break
    chart_start = old_func.find('    const jogadosSemCS =')
    
    if chart_start != -1:
        new_func += old_func[chart_start:]
    else:
        new_func += '}\\n'

    new_content = text[:start_idx] + new_func + text[end_idx:]
    
    with codecs.open('script.js', 'w', encoding='utf-8') as f:
        f.write(new_content)
    print('Done!')
else:
    print('Indices not found')
