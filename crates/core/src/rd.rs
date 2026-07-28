//! Rijksdriehoek (EPSG:28992) → WGS84 conversion.
//!
//! Uses the well-known approximate polynomial transformation
//! (Schreutelkamp & Strang van Hees). Accuracy is sub-metre across the Netherlands,
//! far beyond what a moving-vehicle map needs, and it is a handful of multiplications
//! per point — cheap enough for the ingestion hot path.

// Reference point: the O.L.V. tower in Amersfoort.
const X0: f64 = 155_000.0;
const Y0: f64 = 463_000.0;
const LAT0: f64 = 52.155_174_40;
const LON0: f64 = 5.387_206_21;

// (p, q, coefficient) for latitude.
const K: [(u32, u32, f64); 11] = [
    (0, 1, 3_235.653_89),
    (2, 0, -32.582_97),
    (0, 2, -0.247_50),
    (2, 1, -0.849_78),
    (0, 3, -0.065_50),
    (2, 2, -0.017_09),
    (1, 0, -0.007_38),
    (4, 0, 0.005_30),
    (2, 3, -0.000_39),
    (4, 1, 0.000_33),
    (1, 1, -0.000_12),
];

// (p, q, coefficient) for longitude.
const L: [(u32, u32, f64); 12] = [
    (1, 0, 5_260.529_16),
    (1, 1, 105.946_84),
    (1, 2, 2.456_56),
    (3, 0, -0.818_85),
    (1, 3, 0.055_94),
    (3, 1, -0.056_07),
    (0, 1, 0.011_99),
    (3, 2, -0.002_56),
    (1, 4, 0.001_28),
    (0, 2, 0.000_22),
    (2, 0, -0.000_22),
    (5, 0, 0.000_26),
];

/// Convert Rijksdriehoek coordinates (metres) to WGS84 `(lat, lon)` in degrees.
pub fn rd_to_wgs84(x: f64, y: f64) -> (f64, f64) {
    let dx = (x - X0) * 1e-5;
    let dy = (y - Y0) * 1e-5;

    let mut lat = 0.0;
    for (p, q, c) in K {
        lat += c * dx.powi(p as i32) * dy.powi(q as i32);
    }
    let mut lon = 0.0;
    for (p, q, c) in L {
        lon += c * dx.powi(p as i32) * dy.powi(q as i32);
    }

    (LAT0 + lat / 3600.0, LON0 + lon / 3600.0)
}

/// Initial bearing in degrees (0 = north, clockwise) from point a to point b.
pub fn bearing(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f32 {
    let (lat1, lat2) = (lat1.to_radians(), lat2.to_radians());
    let dlon = (lon2 - lon1).to_radians();
    let y = dlon.sin() * lat2.cos();
    let x = lat1.cos() * lat2.sin() - lat1.sin() * lat2.cos() * dlon.cos();
    let deg = y.atan2(x).to_degrees();
    ((deg % 360.0) + 360.0) as f32 % 360.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reference_point_maps_to_amersfoort() {
        let (lat, lon) = rd_to_wgs84(X0, Y0);
        assert!((lat - LAT0).abs() < 1e-6, "lat {lat}");
        assert!((lon - LON0).abs() < 1e-6, "lon {lon}");
    }

    #[test]
    fn known_point_westertoren_amsterdam() {
        // Westertoren, Amsterdam: RD ≈ (120700, 487200) → ~ (52.3740, 4.8838)
        let (lat, lon) = rd_to_wgs84(120_700.0, 487_200.0);
        assert!((lat - 52.3740).abs() < 0.01, "lat {lat}");
        assert!((lon - 4.8838).abs() < 0.01, "lon {lon}");
    }

    #[test]
    fn bearing_north_and_east() {
        assert!((bearing(52.0, 5.0, 53.0, 5.0) - 0.0).abs() < 1.0); // due north
        assert!((bearing(52.0, 5.0, 52.0, 6.0) - 90.0).abs() < 1.0); // due east
    }
}
