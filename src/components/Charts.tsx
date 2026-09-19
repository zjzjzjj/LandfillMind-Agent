/**
 * LandfillMind · 可视化图表组件（J · ECharts 仪表盘）
 * 使用 ECharts 展示反馈趋势、AB 测试、agent 表现等数据
 */

import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { LineChart, BarChart, RadarChart } from 'echarts/charts';
import { TitleComponent, TooltipComponent, GridComponent, LegendComponent, DatasetComponent, ToolboxComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { LabelLayout, UniversalTransition } from 'echarts/features';

echarts.use([
  LineChart, BarChart, RadarChart,
  TitleComponent, TooltipComponent, GridComponent, LegendComponent, DatasetComponent, ToolboxComponent,
  CanvasRenderer, LabelLayout, UniversalTransition,
]);

interface TrendDataPoint {
  date: string;  // YYYY-MM-DD
  up: number;
  down: number;
}

interface AgentPerf {
  agent: string;
  upRate: number;  // 0-100
  total: number;
}

interface ABVariant {
  id: string;
  name: string;
  impressions: number;
  upCount: number;
  downCount: number;
}

interface ChartProps {
  className?: string;
  height?: number | string;
}

export function FeedbackTrendChart({ data, className, height = 240 }: { data: TrendDataPoint[] } & ChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    chart.setOption({
      tooltip: { trigger: 'axis' },
      legend: { data: ['👍 好评', '👎 低分'], bottom: 0, textStyle: { fontSize: 11 } },
      grid: { top: 20, left: 40, right: 20, bottom: 40 },
      xAxis: {
        type: 'category',
        data: data.map(d => d.date),
        axisLabel: { fontSize: 10, color: '#7e95b0' },
      },
      yAxis: {
        type: 'value',
        axisLabel: { fontSize: 10, color: '#7e95b0' },
        splitLine: { lineStyle: { color: '#d9e4f2' } },
      },
      series: [
        {
          name: '👍 好评', type: 'line', smooth: true,
          data: data.map(d => d.up),
          itemStyle: { color: '#10b981' },
          areaStyle: { color: 'rgba(16, 185, 129, 0.15)' },
          lineStyle: { width: 2 },
        },
        {
          name: '👎 低分', type: 'line', smooth: true,
          data: data.map(d => d.down),
          itemStyle: { color: '#f43f5e' },
          areaStyle: { color: 'rgba(244, 63, 94, 0.15)' },
          lineStyle: { width: 2 },
        },
      ],
    });
    const resize = () => chart.resize();
    window.addEventListener('resize', resize);
    return () => { window.removeEventListener('resize', resize); chart.dispose(); };
  }, [data]);
  return <div ref={ref} className={className} style={{ width: '100%', height }} />;
}

export function AgentPerformanceChart({ data, className, height = 240 }: { data: AgentPerf[] } & ChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    chart.setOption({
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { top: 20, left: 50, right: 20, bottom: 30 },
      xAxis: {
        type: 'category',
        data: data.map(d => d.agent),
        axisLabel: { fontSize: 10, color: '#7e95b0' },
      },
      yAxis: {
        type: 'value', max: 100,
        axisLabel: { fontSize: 10, color: '#7e95b0', formatter: '{value}%' },
        splitLine: { lineStyle: { color: '#d9e4f2' } },
      },
      series: [{
        type: 'bar',
        data: data.map(d => ({
          value: d.upRate,
          itemStyle: { color: d.upRate >= 80 ? '#10b981' : d.upRate >= 60 ? '#f59e0b' : '#f43f5e' },
        })),
        label: { show: true, position: 'top', formatter: '{c}%', fontSize: 10 },
        barWidth: '50%',
      }],
    });
    const resize = () => chart.resize();
    window.addEventListener('resize', resize);
    return () => { window.removeEventListener('resize', resize); chart.dispose(); };
  }, [data]);
  return <div ref={ref} className={className} style={{ width: '100%', height }} />;
}

export function ABVariantRadar({ data, className, height = 280 }: { data: ABVariant[] } & ChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    const indicators = [
      { name: '曝光量', max: Math.max(100, ...data.map(d => d.impressions)) },
      { name: '👍 好评数', max: Math.max(10, ...data.map(d => d.upCount)) },
      { name: '好评率(%)', max: 100 },
      { name: '👎 投诉数', max: Math.max(10, ...data.map(d => d.downCount)) },
    ];
    chart.setOption({
      tooltip: { trigger: 'item' },
      legend: { bottom: 0, textStyle: { fontSize: 11 } },
      radar: {
        indicator: indicators,
        shape: 'polygon',
        splitNumber: 4,
        axisName: { fontSize: 11, color: '#3f5a78' },
        splitArea: { areaStyle: { color: ['rgba(14,165,183,0.05)', 'rgba(14,165,183,0.10)'] } },
      },
      series: [{
        type: 'radar',
        data: data.map((d, i) => {
          const colors = ['#0ea5b7', '#7c3aed', '#ea580c', '#16a34a'];
          const total = d.upCount + d.downCount;
          const rate = total > 0 ? (d.upCount / total * 100) : 0;
          return {
            name: d.name,
            value: [d.impressions, d.upCount, Math.round(rate), d.downCount],
            itemStyle: { color: colors[i % colors.length] },
            areaStyle: { opacity: 0.2 },
          };
        }),
      }],
    });
    const resize = () => chart.resize();
    window.addEventListener('resize', resize);
    return () => { window.removeEventListener('resize', resize); chart.dispose(); };
  }, [data]);
  return <div ref={ref} className={className} style={{ width: '100%', height }} />;
}

export function KnowledgeDistillGauge({ distilled, total, className, height = 200 }: { distilled: number; total: number } & ChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    const rate = total > 0 ? Math.round(distilled / total * 100) : 0;
    chart.setOption({
      series: [{
        type: 'gauge',
        progress: { show: true, width: 18 },
        axisLine: { lineStyle: { width: 18, color: [[1, '#e5e7eb']] } },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { distance: 25, fontSize: 10, color: '#7e95b0' },
        pointer: { length: '70%', width: 5 },
        anchor: { show: true, size: 18, itemStyle: { borderColor: '#0ea5b7' } },
        title: { show: true, offsetCenter: [0, '35%'], fontSize: 12, color: '#7e95b0' },
        detail: {
          valueAnimation: true,
          offsetCenter: [0, '-10%'],
          fontSize: 24,
          fontWeight: 'bold',
          color: '#0ea5b7',
          formatter: '{value}%',
        },
        data: [{ value: rate, name: 'KB 蒸馏覆盖率' }],
      }],
    });
    const resize = () => chart.resize();
    window.addEventListener('resize', resize);
    return () => { window.removeEventListener('resize', resize); chart.dispose(); };
  }, [distilled, total]);
  return <div ref={ref} className={className} style={{ width: '100%', height }} />;
}
