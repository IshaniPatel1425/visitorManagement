from flask import Flask, request, jsonify
from anpr_match import process_gate_entry
import os
import tempfile
import uuid

app = Flask(__name__)

CAMERA_PAGE = """
<!DOCTYPE html>
<html>
<head><title>Gate Camera</title></head>
<body style="font-family: sans-serif; text-align: center; padding: 40px;">
    <h2>Scan Vehicle Number Plate</h2>
    <form id="uploadForm">
        <input type="file" accept="image/*" capture="environment" id="photoInput" style="font-size: 20px;">
        <br><br>
        <button type="submit" style="font-size: 20px; padding: 10px 30px;">Send to Server</button>
    </form>
    <h3 id="result"></h3>

    <script>
        document.getElementById('uploadForm').onsubmit = async function(e) {
            e.preventDefault();
            const file = document.getElementById('photoInput').files[0];
            if (!file) { alert('Take a photo first'); return; }

            const formData = new FormData();
            formData.append('photo', file);

            document.getElementById('result').innerText = 'Checking...';

            const response = await fetch('/check-vehicle', {
                method: 'POST',
                body: formData
            });
            const data = await response.json();

            if (data.status === 'match') {
                document.getElementById('result').innerHTML =
                    '✅ MATCH: ' + data.name + ', Flat ' + data.flat;
                document.getElementById('result').style.color = 'green';
            } else {
                document.getElementById('result').innerText = '❌ NO MATCH - unregistered vehicle';
                document.getElementById('result').style.color = 'red';
            }
        };
    </script>
</body>
</html>
"""


@app.route("/")
def camera_page():
    return CAMERA_PAGE


@app.route("/check-vehicle", methods=["POST"])
def check_vehicle():
    if "photo" not in request.files:
        return jsonify({"error": "No photo uploaded"}), 400

    photo = request.files["photo"]
    # Generate a unique temp file name for each upload
    filename = f"{uuid.uuid4().hex}.jpg"
    save_path = os.path.join(tempfile.gettempdir(), filename)
    photo.save(save_path)

    is_match, info = process_gate_entry(save_path)

    # Clean up temp file after processing
    if os.path.exists(save_path):
        os.remove(save_path)

    if is_match:
        return jsonify({"status": "match", "name": info["name"], "flat": info["flat"]})
    else:
        return jsonify({"status": "no_match"})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)