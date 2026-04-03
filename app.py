import os

import requests
from flask import Flask, jsonify, abort
from flask_cors import CORS

app = Flask(__name__)

# CORS: libera localhost (dev) e GitHub Pages (produção)
CORS(app, origins=[
    r"^http://localhost:\d+$",
    r"^http://127\.0\.0\.1:\d+$",
    r"^https://[a-zA-Z0-9-]+\.github\.io$",
])

STEAM_API_KEY = os.environ.get("STEAM_API_KEY")
STEAM_API_URL = "https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/"


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


if __name__ == "__main__":
    app.run(debug=True, port=5000)
