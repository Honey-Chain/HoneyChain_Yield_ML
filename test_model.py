import pandas as pd
import numpy as np
from inference import predict_harvest_window

print("=========================================================")
print("   DEEP TESTING: PIPELINE AND BIOLOGICAL SANITY CHECKS   ")
print("=========================================================\n")

# Helper function to generate realistic physical telemetry
def generate_flow_history(days, start_weight, daily_gain_mean, temp, humid, flow_count, add_nans=False, negative_gain_end=False):
    dates = pd.date_range('2024-05-01', periods=days, freq='D')
    gains = np.random.normal(daily_gain_mean, 0.2, days)
    
    if negative_gain_end and days > 2:
        gains[-2:] = -0.5 # Bees consuming stores
    else:
        gains = np.clip(gains, -1.0, None)
        
    weights = start_weight + np.cumsum(gains)
    
    df = pd.DataFrame({
        'timestamp': dates,
        'weight': weights,
        'temperature': np.random.normal(temp, 2, days),
        'humidity': np.random.normal(humid, 5, days),
        'flow': np.random.normal(flow_count, 20, days),
    })
    
    if add_nans and days > 5:
        # Simulate sensor downtime for 2 days in the middle
        df.loc[3:4, ['weight', 'temperature', 'humidity', 'flow']] = np.nan
        
    return df

def run_test(name, expected, df, days_into_flow):
    print(f"--- {name} ---")
    print(f"Goal: {expected}")
    print(f"Input Data: {len(df)} days history, {days_into_flow} days into flow")
    try:
        res = predict_harvest_window(df, days_into_flow)
        print(f"-> Status : {res['status']}")
        if 'message' in res:
            print(f"-> Message: {res['message']}")
        if 'expectedHarvestWindowDays' in res:
            print(f"-> Result : {res['expectedHarvestWindowDays']} days remaining.")
    except Exception as e:
        print(f"-> EXCEPTION: {e}")
    print("\n")


# ---------------------------------------------------------
# CATEGORY 1: Severe Cold Start (< 4 days)
# ---------------------------------------------------------
df_cat1 = generate_flow_history(3, 50.0, 0.5, 24, 60, 100)
run_test("Category 1: Severe Cold Start", 
         "Should fail gracefully with INSUFFICIENT_HISTORY because minimum periods for rolling averages (4) are not met.", 
         df_cat1, 2)


# ---------------------------------------------------------
# CATEGORY 2: Cold Start Bug Verification (5-13 days)
# ---------------------------------------------------------
df_cat2 = generate_flow_history(6, 50.0, 0.5, 24, 60, 100)
run_test("Category 2: Cold Start Bug (Moderate)", 
         "README warns it will INCORRECTLY return OK for 5+ days because pandas min_periods=4 is satisfied. This proves backend MUST enforce 14 days.", 
         df_cat2, 5)


# ---------------------------------------------------------
# CATEGORY 3: Early Strong Nectar Flow
# ---------------------------------------------------------
df_cat3 = generate_flow_history(15, 55.0, 1.5, 25, 60, 250)
run_test("Category 3: Early Strong Nectar Flow", 
         "A fast-gaining hive early in the season should predict a long harvest window.", 
         df_cat3, 14)


# ---------------------------------------------------------
# CATEGORY 4: Plateauing Nectar Flow
# ---------------------------------------------------------
df_cat4 = generate_flow_history(35, 65.0, 0.1, 28, 55, 50)
df_cat4.loc[32:34, 'weight'] = df_cat4.loc[31, 'weight'] + 0.02 # Force plateau
run_test("Category 4: Plateauing Nectar Flow", 
         "A flow that has slowed to a crawl should trigger an imminent harvest window (low days).", 
         df_cat4, 34)


# ---------------------------------------------------------
# CATEGORY 5: Negative Gain during Flow
# ---------------------------------------------------------
df_cat5 = generate_flow_history(16, 60.0, 0.8, 22, 65, 150, negative_gain_end=True)
run_test("Category 5: Negative Gain during Flow", 
         "Weight drops unexpectedly at the end (bees consuming stores or bad weather). Should reduce the expected harvest window.", 
         df_cat5, 15)


# ---------------------------------------------------------
# CATEGORY 6: Missing/Corrupted Data
# ---------------------------------------------------------
df_cat6 = generate_flow_history(16, 55.0, 0.5, 24, 60, 100, add_nans=True)
run_test("Category 6: Missing/Corrupted Data", 
         "Simulating sensor downtime (NaNs in history). Forward-filling or rolling averages should handle it if there's enough surrounding data.", 
         df_cat6, 15)


# ---------------------------------------------------------
# CATEGORY 7: Extreme Environmental Conditions
# ---------------------------------------------------------
df_cat7 = generate_flow_history(16, 55.0, 0.1, 40, 15, 20) # 40C, 15% humidity, very low flow
run_test("Category 7: Extreme Environmental Conditions", 
         "Very high temperatures and low humidity with minimal weight gain. Should predict flow ending soon.", 
         df_cat7, 15)
