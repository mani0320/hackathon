from flask import Flask, render_template, request, jsonify, send_from_directory
from flask_cors import CORS
import requests
from openrouteservice import convert
import json
import os
import math
import random
from datetime import datetime

app = Flask(__name__)
CORS(app)

os.makedirs('static', exist_ok=True)
os.makedirs('templates', exist_ok=True)

try:
    with open('data/safety_data.json') as f:
        safety_data = json.load(f)
except FileNotFoundError:
    os.makedirs('data', exist_ok=True)
    center_lat, center_lon = 36.0995, -80.2442
    safety_data = [
        {
            "lat": center_lat + (random.random() - 0.5) * 0.05,
            "lon": center_lon + (random.random() - 0.5) * 0.05,
            "type": random.choice(["crime", "light"]),
            "severity": random.randint(1, 10)
        }
        for _ in range(50)
    ]
    with open('data/safety_data.json', 'w') as f:
        json.dump(safety_data, f, indent=2)

def geocode_address(address):
    url = f'https://nominatim.openstreetmap.org/search?q={address}&format=json'
    response = requests.get(url, headers={"User-Agent": "SafeRouteApp"})
    data = response.json()
    return (float(data[0]['lat']), float(data[0]['lon'])) if data else (None, None)

from openrouteservice import convert

def decode_polyline(polyline_str):
    decoded = convert.decode_polyline(polyline_str)
    return [[point[1], point[0]] for point in decoded['coordinates']]


def get_walking_route(start_lat, start_lon, end_lat, end_lon):
    api_key = "5b3ce3597851110001cf6248e6f75a16a5ea49d5b830f6ceced8bdf0"
    url = "https://api.openrouteservice.org/v2/directions/foot-walking"
    headers = {
        "Authorization": api_key,
        "Content-Type": "application/json"
    }
    body = {
        "coordinates": [[start_lon, start_lat], [end_lon, end_lat]],
        "instructions": True
    }

    response = requests.post(url, json=body, headers=headers)

    try:
        data = response.json()

        if 'routes' in data and len(data['routes']) > 0:
            geometry = data['routes'][0]['geometry']
            decoded = decode_polyline(geometry)

            summary = data['routes'][0]['summary']
            return {
                'coordinates': decoded,
                'distance': summary.get('distance'),
                'duration': summary.get('duration')
            }
        else:
            print("❌ No route found in response:", data)
            return None
    except Exception as e:
        print("Error fetching walking route:", e)
        print("Full API response:", response.text)
        return None


def score_route(route_coords):
    overall_score = 0
    segment_scores = []
    for i in range(len(route_coords) - 1):
        start = route_coords[i]
        end = route_coords[i + 1]
        segment_score, segment_items = 0, 0
        for item in safety_data:
            dist = min_distance_to_segment(item['lat'], item['lon'], start[0], start[1], end[0], end[1])
            if dist < 0.3:
                segment_items += 1
                if item['type'] == 'crime':
                    segment_score += item['severity']
                elif item['type'] == 'light':
                    segment_score -= item['severity'] * 0.5
        segment_score = (segment_score / segment_items) if segment_items else 3
        segment_score = max(0, min(round(segment_score), 10))
        segment_scores.append(segment_score)
        overall_score += segment_score * get_segment_length(start, end)

    overall_score = sum(segment_scores) / len(segment_scores) if segment_scores else 3
    if 18 <= datetime.now().hour or datetime.now().hour < 6:
        overall_score = min(10, overall_score * 1.2)

    return {
        'safety_score': max(0, min(round(overall_score), 10)),
        'segment_scores': segment_scores
    }

def min_distance_to_segment(px, py, x1, y1, x2, y2):
    px, py, x1, y1, x2, y2 = map(math.radians, [px, py, x1, y1, x2, y2])
    segment_length = get_segment_length([math.degrees(y1), math.degrees(x1)], [math.degrees(y2), math.degrees(x2)]) / 1000
    if segment_length == 0:
        return get_segment_length([math.degrees(py), math.degrees(px)], [math.degrees(y1), math.degrees(x1)]) / 1000
    proj = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / segment_length ** 2
    if proj < 0:
        return get_segment_length([math.degrees(py), math.degrees(px)], [math.degrees(y1), math.degrees(x1)]) / 1000
    elif proj > 1:
        return get_segment_length([math.degrees(py), math.degrees(px)], [math.degrees(y2), math.degrees(x2)]) / 1000
    x = x1 + proj * (x2 - x1)
    y = y1 + proj * (y2 - y1)
    a = math.sin((py - y) / 2) ** 2 + math.cos(y) * math.cos(py) * math.sin((px - x) / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return 6371 * c

def get_segment_length(p1, p2):
    lat1, lon1 = map(math.radians, p1)
    lat2, lon2 = map(math.radians, p2)
    dlon = lon2 - lon1
    dlat = lat2 - lat1
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return 6371000 * c

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/static/<path:filename>')
def serve_static(filename):
    return send_from_directory('static', filename)

@app.route('/route')
def get_safe_route():
    start = request.args.get('start')
    end = request.args.get('end')
    start_lat, start_lon = geocode_address(start)
    end_lat, end_lon = geocode_address(end)
    if None in (start_lat, start_lon, end_lat, end_lon):
        return jsonify({'error': 'Could not geocode addresses'}), 400
    route_data = get_walking_route(start_lat, start_lon, end_lat, end_lon)
    if not route_data:
        return jsonify({'error': 'Route not found'}), 500
    safety_result = score_route(route_data['coordinates'])
    return jsonify({
        'coordinates': route_data['coordinates'],
        'safety_score': safety_result['safety_score'],
        'segment_scores': safety_result['segment_scores'],
        'distance': route_data.get('distance'),
        'duration': route_data.get('duration')
    })

@app.route('/incidents')
def get_incidents():
    return jsonify(safety_data)

@app.route('/safety-data')
def get_safety_data():
    return jsonify([item for item in safety_data if item['type'] == 'crime'])

if __name__ == '__main__':
    print("Safe Route Finder is ready! Starting server...")
    app.run(debug=True)