/**
 * HoneyChain Backend - Yield Production ML Client
 * 
 * Standalone TypeScript client to integrate the Harvest Window ML Microservice
 * into the HoneyChain Express / Node.js backend.
 */

export interface DailyTelemetryReading {
  timestamp: string;     // ISO format or YYYY-MM-DD
  weight: number;        // Daily mean weight (kg)
  temperature: number;   // Daily mean ambient temperature (°C)
  humidity: number;      // Daily mean relative humidity (%)
  flow: number;          // Daily total bee activity count
}

export interface PredictYieldRequest {
  hiveId?: string;
  days_into_flow: number;
  history: DailyTelemetryReading[];
  margin?: number;
}

export interface PredictionDetails {
  expectedHarvestWindowDays: number;
  harvestWindowRange: string;
  minDays: number;
  maxDays: number;
}

export interface PredictYieldResponse {
  success: boolean;
  status: 'OK' | 'INSUFFICIENT_HISTORY' | 'INVALID_INPUT' | 'ERROR';
  hiveId?: string;
  prediction?: PredictionDetails;
  confidence?: 'LOW' | 'MEDIUM' | 'HIGH';
  note?: string;
  message?: string;
  model: string;
  timestamp: string;
}

export interface HealthResponse {
  status: string;
  service: string;
  version: string;
  model_loaded: boolean;
  model_version: string;
  timestamp: string;
}

export class YieldPredictionClient {
  private baseUrl: string;
  private timeoutMs: number;

  constructor(baseUrl?: string, timeoutMs: number = 8000) {
    this.baseUrl = (baseUrl || process.env.YIELD_ML_SERVICE_URL || 'http://localhost:5002').replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
  }

  /**
   * Checks whether the Yield ML service is healthy and model weights are loaded.
   */
  async checkHealth(): Promise<HealthResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`Health check failed with HTTP ${response.status}`);
      }

      return await response.json() as HealthResponse;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Requests an expected harvest window prediction for an active nectar flow.
   * 
   * @param hiveId Identifier for the beehive
   * @param daysIntoFlow Number of days elapsed since nectar flow detection (7-day avg gain >= 0.20 kg/day)
   * @param history Continuous daily aggregated telemetry records ending today (min 6 required, 14+ recommended)
   * @param margin Error margin in days (default: 5)
   */
  async predictHarvestWindow(
    hiveId: string,
    daysIntoFlow: number,
    history: DailyTelemetryReading[],
    margin: number = 5
  ): Promise<PredictYieldResponse> {
    if (daysIntoFlow < 0) {
      throw new Error(`Invalid daysIntoFlow: ${daysIntoFlow}. Must be non-negative.`);
    }

    if (history.length < 6) {
      return {
        success: false,
        status: 'INSUFFICIENT_HISTORY',
        hiveId,
        message: `Telemetry history contains only ${history.length} records. Model requires a minimum of 6 continuous daily records.`,
        model: 'yield-production-v1',
        timestamp: new Date().toISOString()
      };
    }

    if (history.length < 14) {
      console.warn(
        `[YieldPredictionClient] Hive ${hiveId} has ${history.length} days of history. 14+ days recommended for optimal rolling feature accuracy.`
      );
    }

    const payload: PredictYieldRequest = {
      hiveId,
      days_into_flow: daysIntoFlow,
      history,
      margin
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/predict`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      const data = await response.json() as PredictYieldResponse;
      return data;
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new Error(`Yield prediction request timed out after ${this.timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }
}

// Default singleton export
export const yieldPredictionClient = new YieldPredictionClient();

/*
=============================================================================
Example Usage in HoneyChain Express Backend:
=============================================================================

import { yieldPredictionClient } from './services/yieldPredictionService';

// Inside your daily cron job or harvest forecast API route:
app.get('/api/hives/:hiveId/harvest-forecast', async (req, res) => {
  try {
    const { hiveId } = req.params;
    
    // 1. Fetch continuous daily summaries from MongoDB
    const dailyRecords = await DailyTelemetryModel.find({ hiveId })
      .sort({ date: 1 })
      .limit(30);

    // 2. Map to ML format
    const history = dailyRecords.map(r => ({
      timestamp: r.date.toISOString().split('T')[0],
      weight: r.meanWeight,
      temperature: r.meanTemperature,
      humidity: r.meanHumidity,
      flow: r.totalBeeFlow
    }));

    // 3. Compute active flow days from database flow state
    const daysIntoFlow = await calculateDaysIntoFlow(hiveId);

    // 4. Request prediction from ML Microservice
    const result = await yieldPredictionClient.predictHarvestWindow(hiveId, daysIntoFlow, history);

    if (result.success && result.prediction) {
      // Return safe range to the beekeeper frontend
      return res.json({
        hiveId,
        harvestWindow: result.prediction.harvestWindowRange,
        expectedDays: result.prediction.expectedHarvestWindowDays,
        confidence: result.confidence,
        note: result.note
      });
    } else {
      return res.status(400).json({
        error: result.status,
        message: result.message
      });
    }
  } catch (error: any) {
    return res.status(500).json({ error: 'INTERNAL_ERROR', message: error.message });
  }
});
*/
