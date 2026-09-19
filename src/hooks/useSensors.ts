/**
 * useSensors.ts · IoT 传感器数据流订阅 Hook
 *
 * 数据流：
 *   1) 启动时 fetch /api/iot/snapshot → 立即填充初始值
 *   2) EventSource('/api/iot/stream') → SSE 增量更新
 *   3) 自动重连（EventSource 原生）+ 网络异常不抛出
 *
 * 用法：
 *   const { sensors, lastUpdate, isConnected } = useSensors();
 *   <SensorPanel sensors={sensors} />
 */

import { useEffect, useState } from 'react';

export type SensorLevel = 'green' | 'yellow' | 'orange' | 'red';

export interface SensorReading {
  ts: string;
  value: number;
  unit: string;
  level: SensorLevel;
  position: { x: number; y: number; z: number };
  label: string;
}

export type SensorKey = 'ch4' | 'h2s' | 'waterLevel' | 'settlement' | 'temperature';

export const SENSOR_KEYS: SensorKey[] = ['ch4', 'h2s', 'waterLevel', 'settlement', 'temperature'];

export const SENSOR_META: Record<SensorKey, { label: string; unit: string; warn: number; danger: number }> = {
  ch4:         { label: '导气井 #1  CH₄',  unit: '%LEL', warn: 25, danger: 50 },
  h2s:         { label: '渗滤液 H₂S',      unit: 'ppm',  warn: 10, danger: 20 },
  waterLevel:  { label: '监测井 #A 水位',  unit: 'm',    warn: 3.5, danger: 4.5 },
  settlement:  { label: '堆体沉降 S2',     unit: 'mm/d', warn: 5, danger: 8 },
  temperature: { label: '堆体温度 T3',     unit: '℃',   warn: 60, danger: 68 },
};

export interface UseSensorsResult {
  sensors: Partial<Record<SensorKey, SensorReading>>;
  lastUpdate: number | null;
  isConnected: boolean;
}

export function useSensors(): UseSensorsResult {
  const [sensors, setSensors] = useState<Partial<Record<SensorKey, SensorReading>>>({});
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // 1) 初始快照（首屏即填值）
    fetch('/api/iot/snapshot')
      .then((r) => r.json())
      .then((d: { readings: SensorReading[] }) => {
        if (cancelled || !Array.isArray(d.readings)) return;
        const next: Partial<Record<SensorKey, SensorReading>> = {};
        for (const r of d.readings) {
          // 后端 payload 含 label/position 等；key 由 label + position 反推
          // 为简化，使用读取顺序对应 SENSOR_KEYS
          const idx = SENSOR_KEYS.find((k) => SENSOR_META[k].label === r.label);
          if (idx) next[idx] = r;
        }
        setSensors(next);
        setLastUpdate(Date.now());
      })
      .catch(() => { /* 后端 broker 未起：忽略首屏，仍可等 SSE 后续 */ });

    // 2) SSE 实时订阅
    const es = new EventSource('/api/iot/stream');
    es.onopen = () => setIsConnected(true);
    es.onerror = () => setIsConnected(false);

    es.onmessage = (ev: MessageEvent<string>) => {
      if (!ev.data?.startsWith('{')) return; // 心跳跳过
      try {
        const e = JSON.parse(ev.data);
        if (e.type === 'snapshot' && Array.isArray(e.readings)) {
          const next: Partial<Record<SensorKey, SensorReading>> = {};
          for (const r of e.readings as SensorReading[]) {
            const idx = SENSOR_KEYS.find((k) => SENSOR_META[k].label === r.label);
            if (idx) next[idx] = r;
          }
          setSensors(next);
          setLastUpdate(Date.now());
        } else if (e.type === 'reading' && e.reading) {
          const r = e.reading as SensorReading;
          const idx = SENSOR_KEYS.find((k) => SENSOR_META[k].label === r.label);
          if (idx) {
            setSensors((prev) => ({ ...prev, [idx]: r }));
            setLastUpdate(Date.now());
          }
        }
      } catch { /* ignore */ }
    };

    return () => {
      cancelled = true;
      es.close();
    };
  }, []);

  return { sensors, lastUpdate, isConnected };
}