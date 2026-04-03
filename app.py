import os
import re
import unicodedata
from pathlib import Path

import requests
from flask import Flask, jsonify, abort, request
from flask_cors import CORS


def load_env_file(env_path: Path) -> None:
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        if "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()

        if not key:
            continue

        if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
            value = value[1:-1]

        os.environ.setdefault(key, value)


load_env_file(Path(__file__).resolve().parent / ".env")

app = Flask(__name__)

# CORS: libera localhost (dev) e GitHub Pages (produção)
CORS(app, origins=[
    r"^http://localhost:\d+$",
    r"^http://127\.0\.0\.1:\d+$",
    r"^https://[a-zA-Z0-9-]+\.github\.io$",
])

STEAM_API_KEY = os.environ.get("STEAM_API_KEY")
STEAM_API_URL = "https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/"
STEAM_STORE_SEARCH_URL = "https://store.steampowered.com/api/storesearch/"


def normalize_text(value):
    raw = str(value or "").strip().lower()
    no_accents = "".join(
        char for char in unicodedata.normalize("NFD", raw)
        if unicodedata.category(char) != "Mn"
    )
    return re.sub(r"[^a-z0-9]+", " ", no_accents).strip()


@app.route("/steam-library/<steam_id>")
def steam_library(steam_id):
    if not STEAM_API_KEY:
        abort(500, description="STEAM_API_KEY não configurada no servidor.")

    params = {
        "key": STEAM_API_KEY,
        "steamid": steam_id,
        "include_appinfo": True,
        "include_played_free_games": True,
        "format": "json",
    }

    resp = requests.get(STEAM_API_URL, params=params, timeout=10)

    if resp.status_code != 200:
        abort(502, description="Erro ao consultar a API da Steam.")

    data = resp.json().get("response", {})
    games = data.get("games", [])

    result = [
        {
            "appid": g["appid"],
            "name": g.get("name", "Desconhecido"),
            "playtime_hours": round(g.get("playtime_forever", 0) / 60, 1),
        }
        for g in games
    ]

    return jsonify({"game_count": len(result), "games": result})


@app.route("/steam-search")
def steam_search():
    query = (request.args.get("q") or "").strip()
    if not query:
        abort(400, description="Parametro 'q' e obrigatorio.")

    params = {
        "term": query,
        "l": "portuguese",
        "cc": "BR",
    }

    resp = requests.get(STEAM_STORE_SEARCH_URL, params=params, timeout=10)
    if resp.status_code != 200:
        abort(502, description="Erro ao consultar busca da Steam.")

    data = resp.json() if resp.content else {}
    items = data.get("items", []) if isinstance(data, dict) else []

    if not items:
        return jsonify({"found": False, "query": query, "game": None})

    normalized_query = normalize_text(query)

    def match_score(item):
        candidate = normalize_text(item.get("name", ""))
        if candidate == normalized_query:
            return 3
        if normalized_query and normalized_query in candidate:
            return 2
        if candidate and candidate in normalized_query:
            return 1
        return 0

    best = sorted(items, key=lambda item: (match_score(item), -(item.get("id") or 0)), reverse=True)[0]

    game = {
        "appid": best.get("id"),
        "name": best.get("name", ""),
        "cover": best.get("tiny_image") or "",
    }

    return jsonify({"found": True, "query": query, "game": game})


if __name__ == "__main__":
    app.run(debug=True, port=5000)
