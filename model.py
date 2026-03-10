# ══════════════════════════════════════════════════════════════
#  ml/model.py
#  XGBoost crowd prediction model.
#  Input features → predicted crowd % for a station.
# ══════════════════════════════════════════════════════════════
import xgboost as xgb
import numpy as np
import pickle, os
from datetime import datetime

MODEL_PATH = "ml/crowd_model.pkl"

# Features used for prediction:
# [hour, day_of_week, is_weekend, is_holiday, line_encoded,
#  station_importance, historical_avg, recent_reports_avg]

def load_model():
    if os.path.exists(MODEL_PATH):
        with open(MODEL_PATH, "rb") as f:
            return pickle.load(f)
    return None

def save_model(model):
    with open(MODEL_PATH, "wb") as f:
        pickle.dump(model, f)

def build_features(station_id: str, line: str, dt: datetime,
                   historical_avg: float, recent_avg: float,
                   station_importance: float = 0.5) -> np.ndarray:
    """Convert inputs into the feature vector the model expects."""
    LINE_ENCODE = {
        "Yellow": 0, "Blue": 1, "Red": 2, "Green": 3,
        "Violet": 4, "Orange": 5, "Pink": 6, "Magenta": 7,
        "Grey": 8, "Rapid": 9, "Aqua": 10
    }
    return np.array([[
        dt.hour,
        dt.weekday(),
        1 if dt.weekday() >= 5 else 0,          # is_weekend
        0,                                        # is_holiday (TODO: Indian holidays)
        LINE_ENCODE.get(line, 0),
        station_importance,
        historical_avg,
        recent_avg,
    ]])

def predict(station_id: str, line: str, dt: datetime = None,
            historical_avg: float = 40.0, recent_avg: float = 40.0) -> dict:
    """
    Returns predicted crowd % + confidence interval.
    Falls back to historical average if model not trained yet.
    """
    if dt is None:
        dt = datetime.now()

    model = load_model()
    if model is None:
        # No model trained yet — return historical average
        return {"crowd_pct": round(historical_avg), "confidence": "low", "source": "historical"}

    features = build_features(station_id, line, dt, historical_avg, recent_avg)
    pred = float(model.predict(features)[0])
    pred = max(0, min(100, pred))

    return {
        "crowd_pct":  round(pred),
        "confidence": "high" if recent_avg > 0 else "medium",
        "source":     "ml_model",
        "hour":       dt.hour,
    }
