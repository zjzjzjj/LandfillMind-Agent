/**
 * iot.ts · IoT 数据接入（嵌入式 MQTT broker + mock 传感器）
 *
 * 设计目标：演示用 — 让 3D 仿真器监测点"活起来"
 *  - aedes 嵌入式 MQTT broker（默认端口 1886，动态探测避免与公网 1883 冲突）
 *  - 5 个 mock 传感器定时发布真实范围数据：
 *      ch4 (CH₄ %LEL, 0-100% LEL, 0-25% by volume)
 *      h2s (H₂S ppm, 0-50, 报警阈值 10)
 *      waterLevel (渗压水位 m, 0-5)
 *      settlement (沉降 mm/d, 0-10, 报警阈值 5)
 *      temperature (堆体温度 ℃, 25-70, 报警阈值 60)
 *  - 监听端口启动日志 + 优雅关闭
 *  - 不替代真实部署：生产环境应外接 EMQX / Mosquitto + 真实传感器协议
 */

import { Aedes } from 'aedes';
import net from 'net';
import mqtt from 'mqtt';

export type SensorKey = 'ch4' | 'h2s' | 'waterLevel' | 'settlement' | 'temperature';

export interface SensorReading {
  /** ISO timestamp */
  ts: string;
  /** 原始测量值 */
  value: number;
  /** 单位 */
  unit: string;
  /** 风险等级（基于阈值自动判定） */
  level: 'green' | 'yellow' | 'orange' | 'red';
  /** 传感器物理位置（3D 场景中监测点世界坐标；用于 SSE 前端定位） */
  position: { x: number; y: number; z: number };
  /** 传感器标签（演示用） */
  label: string;
}

export interface SensorSpec {
  key: SensorKey;
  label: string;
  unit: string;
  base: number;        // 基准值（30 秒前后的中位）
  range: number;       // ± 波动幅度
  warnThreshold: number;
  dangerThreshold: number;
  /** 模拟周期 (ms) */
  periodMs: number;
  /** 3D 世界坐标位置 */
  position: { x: number; y: number; z: number };
}

const SENSORS: SensorSpec[] = [
  { key: 'ch4',         label: '导气井 #1  CH₄',  unit: '%LEL',  base: 18,  range: 12, warnThreshold: 25, dangerThreshold: 50, periodMs: 1800, position: { x: -60, y: 30, z: -40 } },
  { key: 'h2s',         label: '渗滤液 H₂S',      unit: 'ppm',   base: 4,   range: 4,  warnThreshold: 10, dangerThreshold: 20, periodMs: 2400, position: { x: 80,  y: 6,  z: 60 } },
  { key: 'waterLevel',  label: '监测井 #A 水位',  unit: 'm',     base: 2.2, range: 1,  warnThreshold: 3.5, dangerThreshold: 4.5, periodMs: 3000, position: { x: -20, y: 0,  z: -80 } },
  { key: 'settlement',  label: '堆体沉降 S2',     unit: 'mm/d',  base: 2.5, range: 2,  warnThreshold: 5,  dangerThreshold: 8,  periodMs: 3500, position: { x: 50,  y: 28, z: 10 } },
  { key: 'temperature', label: '堆体温度 T3',     unit: '℃',     base: 48,  range: 8,  warnThreshold: 60, dangerThreshold: 68, periodMs: 2200, position: { x: 0,   y: 30, z: 30 } },
];

const TOPIC_PREFIX = 'landfill/sensor/';

let aedes: Aedes | null = null;
let tcpServer: net.Server | null = null;
let timers: ReturnType<typeof setInterval>[] = [];
let lastReadings: Record<SensorKey, SensorReading> = {} as Record<SensorKey, SensorReading>;
let publishClient: mqtt.MqttClient | null = null;

export function classifyLevel(value: number, warn: number, danger: number): SensorReading['level'] {
  if (value >= danger) return 'red';
  if (value >= warn) return 'orange';
  if (value >= warn * 0.7) return 'yellow';
  return 'green';
}

export function nextReading(spec: SensorSpec): SensorReading {
  // 在基准 ± 范围 内抖动（正态分布近似）
  const u = Math.random();
  const v = Math.random();
  const normal = Math.sqrt(-2 * Math.log(u || 1e-6)) * Math.cos(2 * Math.PI * v);
  const raw = spec.base + normal * (spec.range / 2);
  const value = Math.max(0, raw);
  return {
    ts: new Date().toISOString(),
    value: Number(value.toFixed(2)),
    unit: spec.unit,
    level: classifyLevel(value, spec.warnThreshold, spec.dangerThreshold),
    position: spec.position,
    label: spec.label,
  };
}

export async function startIotBroker(preferredPort = 1886): Promise<{ port: number }> {
  if (aedes) return { port: MQTT_PORT };

  aedes = await Aedes.createBroker(); // 1.x 必须经 createBroker 初始化 persistence（new Aedes() 会导致握手静默失败、服务启动挂死）
  // 动态探测可用端口：preferredPort 被占用就 +1，最多重试 10 次（避免开发环境端口漂移导致数据流中断）
  let chosen = preferredPort;
  for (let attempt = 0; attempt < 10; attempt++) {
    chosen = preferredPort + attempt;
    const candidate = net.createServer(aedes.handle);
    try {
      await new Promise<void>((resolve, reject) => {
        candidate.once('error', reject);
        candidate.listen(chosen, () => {
          candidate.off('error', reject);
          candidate.close(() => resolve()); // 仅探测，不持有；之后用真正的 server
        });
      });
      break; // 探测成功，候选端口可用
    } catch {
      /* 继续尝试下一个端口 */
    }
  }

  tcpServer = net.createServer(aedes.handle);
  await new Promise<void>((resolve, reject) => {
    tcpServer!.once('error', reject);
    tcpServer!.listen(chosen, () => {
      tcpServer!.off('error', reject);
      resolve();
    });
  });
  (aedes as any).__port = chosen;
  // 更新导出常量（供外部探针）
  (aedes as any).__chosenPort = chosen;

  // 内部 publish 客户端：连自己 broker 定时发布
  publishClient = mqtt.connect(`mqtt://127.0.0.1:${chosen}`, {
    clientId: 'iot-mock-publisher',
    reconnectPeriod: 1000,
  });
  await new Promise<void>((resolve) => {
    const t = setTimeout(() => resolve(), 3000); // 连接超时兜底：broker 异常时不阻塞服务启动
    publishClient!.once('connect', () => { clearTimeout(t); resolve(); });
    publishClient!.once('error', () => { /* 重连期错误吞掉，超时兜底 */ });
  });

  // 为每个 sensor 启动独立定时器
  for (const spec of SENSORS) {
    const reading = nextReading(spec);
    lastReadings[spec.key] = reading;
    const t = setInterval(() => {
      const r = nextReading(spec);
      lastReadings[spec.key] = r;
      if (publishClient?.connected) {
        publishClient.publish(TOPIC_PREFIX + spec.key, JSON.stringify(r), { qos: 0, retain: false });
      }
    }, spec.periodMs);
    // Node 内 setInterval 返回 TypeScript 中的 Timeout；浏览器是 number。这里是 Node 环境，
    // 但 ESM/TS 类型上 setInterval 返回 ReturnType<typeof setInterval> = Timeout | number，
    // 这里用宽松类型避免在 Node/Browser 双端编译报错
    timers.push(t as unknown as ReturnType<typeof setInterval>);
  }

  console.log(`[iot] ✓ MQTT broker 已启动 :${chosen}，5 个传感器定时发布（CH₄/H₂S/水位/沉降/温度）`);
  return { port: chosen };
}

export async function stopIotBroker(): Promise<void> {
  for (const t of timers) clearInterval(t);
  timers = [];
  if (publishClient) {
    publishClient.end(true);
    publishClient = null;
  }
  if (tcpServer) {
    await new Promise<void>((resolve) => tcpServer!.close(() => resolve()));
    tcpServer = null;
  }
  if (aedes) {
    aedes.close(() => {});
    aedes = null;
  }
}

/** 获取当前 5 个传感器的快照（用于 SSE fallback / 初始推送） */
export function snapshotReadings(): SensorReading[] {
  return SENSORS.map((s) => lastReadings[s.key] ?? nextReading(s));
}

/**
 * 订阅 broker 内所有 landfill/sensor/* 主题的实时消息。
 * 返回 unsubscribe 函数；前端 SSE 路由在 req.close 时调用释放监听。
 * 直接订阅 aedes 'publish' 事件——0 网络开销（不绕一圈走 mqtt 客户端）。
 */
export function onIotPublish(cb: (reading: SensorReading, topic: string) => void): () => void {
  if (!aedes) return () => {};
  const handler = (packet: { topic: string; payload: Buffer | string }) => {
    if (!packet.topic?.startsWith(TOPIC_PREFIX)) return;
    const text = Buffer.isBuffer(packet.payload) ? packet.payload.toString() : String(packet.payload ?? '');
    try {
      cb(JSON.parse(text) as SensorReading, packet.topic);
    } catch { /* 跳过非 JSON 消息 */ }
  };
  aedes.on('publish', handler);
  return () => { aedes?.off('publish', handler); };
}

export const MQTT_PORT = 1886; // 默认；startIotBroker 动态探测时会原地修改
export const MQTT_TOPIC_PREFIX = TOPIC_PREFIX;
export const MQTT_TOPICS = SENSORS.map((s) => TOPIC_PREFIX + s.key);