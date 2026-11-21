"""Deterministic, calibrated 2D takeoff math. Pixel measurements are never AI estimates."""
import math


def distance(a, b):
    return math.hypot(b[0]-a[0], b[1]-a[1])


def metres_per_pixel(a, b, known_metres):
    length = distance(a, b)
    if length < 2 or not math.isfinite(known_metres) or known_metres <= 0:
        raise ValueError('Choose two distinct calibration points and enter a positive real-world distance.')
    return known_metres / length


def polyline_length(points, scale):
    if len(points) < 2 or scale <= 0:
        raise ValueError('Length requires at least two points and a calibrated scale.')
    return sum(distance(a,b) for a,b in zip(points,points[1:])) * scale


def polygon_area(points, scale):
    if len(points) < 3 or scale <= 0:
        raise ValueError('Area requires at least three points and a calibrated scale.')
    twice = abs(sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(points,points[1:]+points[:1])))
    if twice < 1e-8:
        raise ValueError('Polygon area is zero. Select a valid outline.')
    return twice * scale * scale / 2


def quantity(points, scale, mode, depth=None):
    if mode == 'Length (m)': return polyline_length(points,scale), 'm'
    area = polygon_area(points,scale)
    if mode == 'Area (m²)': return area, 'm2'
    if mode == 'Volume (m³)':
        if depth is None or not math.isfinite(depth) or depth <= 0:
            raise ValueError('Volume requires a positive depth/thickness in metres.')
        return area*depth, 'm3'
    raise ValueError('Unknown takeoff mode.')
