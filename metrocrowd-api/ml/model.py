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

TRAVEL_MODEL_PATH = "ml/travel_time_model.pkl"

def load_travel_model():
    if os.path.exists(TRAVEL_MODEL_PATH):
        with open(TRAVEL_MODEL_PATH, "rb") as f:
            return pickle.load(f)
    return None

def save_travel_model(model):
    with open(TRAVEL_MODEL_PATH, "wb") as f:
        pickle.dump(model, f)

def predict_travel_time(line: str, hour: int, dow: int,
                        station_heat: float = 0.1) -> int:
    """
    Returns predicted travel time in seconds for one inter-station hop.
    Falls back to 150s (2.5 min) if model not trained yet.
    """
    LINE_ENCODE = {"Y":0,"B":1,"R":2,"G":3,"V":4,"A":5,"P":6,"M":7,"Gr":8,"Aq":9}
    model = load_travel_model()
    if model is None:
        return 150  # default 2.5 min per stop
    features = np.array([[hour, dow, 1 if dow >= 5 else 0,
                           LINE_ENCODE.get(line, 1), station_heat]])
    pred = float(model.predict(features)[0])
    return max(60, min(600, int(pred)))

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
