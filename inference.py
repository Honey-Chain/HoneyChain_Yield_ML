import lightgbm as lgb
import pandas as pd
import numpy as np
import joblib

# Load the model (the backend will call this when the server starts)
final_model = joblib.load('harvest_window_lgbm.pkl')

FEATURES = [
    'weight', 'weight_change_1d', 'gain_rate_3d', 'gain_rate_7d', 'gain_rate_14d',
    'weight_std_3d', 'weight_std_7d', 'weight_std_14d', 'gain_accel', 'weight_vs_14d',
    'flow', 'flow_roll_3d', 'flow_roll_7d', 'flow_abs_7d', 'temperature', 'temp_roll_7d', 
    'temp_roll_14d', 'humidity', 'humid_roll_7d', 'doy_sin', 'doy_cos', 'days_into_flow'
]
MIN_REAL_DAYS = 6

def build_live_features(history_df):
    g = history_df.sort_values('timestamp').reset_index(drop=True).copy()
    
    n_real_days = g['weight'].notna().sum()
    if n_real_days < MIN_REAL_DAYS:
        return None, (f"Only {n_real_days} real day(s) of weight data, need at least {MIN_REAL_DAYS}.")

    g['weight_change_1d'] = g['weight'].diff()
    for w in [3, 7, 14]:
        g[f'gain_rate_{w}d']  = g['weight_change_1d'].rolling(w, min_periods=2).mean()
        g[f'weight_std_{w}d'] = g['weight_change_1d'].rolling(w, min_periods=2).std()
        
    g['gain_accel']    = g['gain_rate_3d'] - g['gain_rate_7d']
    g['weight_vs_14d'] = g['weight'] - g['weight'].rolling(14, min_periods=4).mean()
    g['flow_roll_3d']  = g['flow'].rolling(3, min_periods=2).mean()
    g['flow_roll_7d']  = g['flow'].rolling(7, min_periods=3).mean()
    g['flow_abs_7d']   = g['flow'].abs().rolling(7, min_periods=3).mean()
    g['temp_roll_7d']  = g['temperature'].rolling(7, min_periods=3).mean()
    g['temp_roll_14d'] = g['temperature'].rolling(14, min_periods=4).mean()
    g['humid_roll_7d'] = g['humidity'].rolling(7, min_periods=3).mean()
    
    doy = g['timestamp'].dt.dayofyear
    g['doy_sin'] = np.sin(2*np.pi*doy/365)
    g['doy_cos'] = np.cos(2*np.pi*doy/365)
    
    row = g.iloc[[-1]].copy()
    
    computable = [f for f in FEATURES if f != 'days_into_flow']
    missing_mask = row[computable].isna()
    if missing_mask.any(axis=1).iloc[0]:
        missing_cols = row[computable].columns[missing_mask.iloc[0]].tolist()
        return None, f"Feature computation failed: {missing_cols} resulted in NaN."
        
    return row, None

def predict_harvest_window(history_df, days_into_flow):
    if days_into_flow < 0:
        return {'status': 'INVALID_INPUT', 'message': f"days_into_flow cannot be negative. Received: {days_into_flow}"}
        
    row, err = build_live_features(history_df)
    if err:
        return {'status': 'INSUFFICIENT_HISTORY', 'message': err}
        
    row['days_into_flow'] = days_into_flow
    predicted_days = final_model.predict(row[FEATURES])[0]
    
    predicted_days_rounded = max(0, int(round(predicted_days)))
    margin = 5
    
    return {
        'status': 'OK',
        'expectedHarvestWindowDays': predicted_days_rounded,
        'harvestWindowRange': f"{max(0, predicted_days_rounded - margin)}-{predicted_days_rounded + margin} days",
        'confidence': 'LOW',
        'note': 'Typical error +/-5 days, worst observed ~19 days. Re-check as the flow develops.'
    }
