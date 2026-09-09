import pandas as pd
import numpy as np
import joblib
import json
import os

# Load feature configuration
config_path = os.path.join(os.path.dirname(__file__), 'feature_config.json')
with open(config_path, 'r') as f:
    config = json.load(f)
    FEATURES = config['FEATURES']

# Load model
model_path = os.path.join(os.path.dirname(__file__), 'harvest_window_lgbm.pkl')
final_model = joblib.load(model_path)

def build_live_features(history_df, days_into_flow):
    """
    history_df: DataFrame with columns [timestamp, weight, temperature, humidity, flow],
                daily resolution, sorted oldest -> newest, covering at least the
                current nectar flow's start to now.
    days_into_flow: Integer representing days since flow detection.
    Returns a single-row DataFrame ready for final_model.predict().
    """
    g = history_df.sort_values('timestamp').reset_index(drop=True).copy()

    g['weight_change_1d'] = g['weight'].diff()
    for w in [3, 7, 14]:
        g[f'gain_rate_{w}d']  = g['weight_change_1d'].rolling(w, min_periods=2).mean()
        g[f'weight_std_{w}d'] = g['weight_change_1d'].rolling(w, min_periods=2).std()
    g['gain_accel']    = g['gain_rate_3d'] - g['gain_rate_7d']
    g['weight_vs_14d'] = g['weight'] - g['weight'].rolling(14, min_periods=4).mean()

    g['flow_roll_3d'] = g['flow'].rolling(3, min_periods=2).mean()
    g['flow_roll_7d'] = g['flow'].rolling(7, min_periods=3).mean()
    g['flow_abs_7d']  = g['flow'].abs().rolling(7, min_periods=3).mean()

    g['temp_roll_7d']  = g['temperature'].rolling(7, min_periods=3).mean()
    g['temp_roll_14d'] = g['temperature'].rolling(14, min_periods=4).mean()
    g['humid_roll_7d'] = g['humidity'].rolling(7, min_periods=3).mean()

    doy = g['timestamp'].dt.dayofyear
    g['doy_sin'] = np.sin(2*np.pi*doy/365)
    g['doy_cos'] = np.cos(2*np.pi*doy/365)
    
    # Add days_into_flow before the missing check so FEATURES validation passes
    g['days_into_flow'] = days_into_flow

    row = g.iloc[[-1]].copy()

    missing = row[FEATURES].isna().any(axis=1).iloc[0]
    if missing:
        missing_cols = row[FEATURES].columns[row[FEATURES].isna().iloc[0]].tolist()
        return None, f"Not enough history to compute: {missing_cols}"
    
    return row[FEATURES], None


def predict_harvest_window(history_df, days_into_flow):
    """
    history_df: >= 14 days of REAL daily readings (weight, temperature, humidity, flow),
                ending today.
    days_into_flow: how many days since this flow was detected as started.
    """
    feats, err = build_live_features(history_df, days_into_flow)
    if err:
        return {'status': 'INSUFFICIENT_HISTORY', 'message': err}

    predicted_days = final_model.predict(feats)[0]
    return {'status': 'OK', 'expectedHarvestWindowDays': max(0, int(round(predicted_days)))}
