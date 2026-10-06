from flask import Flask, jsonify
from flask_cors import CORS

from api_status import load_status


app = Flask(__name__)

CORS(app)


@app.route("/")
def home():

    return jsonify({
        "system": "SMART EYE",
        "status": "API RUNNING"
    })


@app.route("/api/status")
def get_status():

    return jsonify(load_status())


if __name__ == "__main__":

    print("SMART EYE API started")

    app.run(
        host="127.0.0.1",
        port=5000,
        debug=False
    )