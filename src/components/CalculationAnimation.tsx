import { useState, useEffect } from 'react';

export interface CalcStep {
  label: string;
  formula: string;
  detail: string;
  result?: string | number;
}

interface CalculationAnimationProps {
  steps: CalcStep[];
  autoPlay?: boolean;
  speed?: number;
  title?: string;
}

export function CalculationAnimation({
  steps,
  autoPlay = true,
  speed = 1500,
  title = '计算过程',
}: CalculationAnimationProps) {
  const [currentStep, setCurrentStep] = useState(autoPlay ? 0 : -1);
  const [isPlaying, setIsPlaying] = useState(autoPlay);

  useEffect(() => {
    if (!isPlaying || currentStep >= steps.length - 1) return;
    const timer = setTimeout(() => {
      setCurrentStep((prev) => Math.min(prev + 1, steps.length - 1));
    }, speed);
    return () => clearTimeout(timer);
  }, [currentStep, isPlaying, steps.length, speed]);

  const progress = steps.length > 0 ? ((currentStep + 1) / steps.length) * 100 : 0;

  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-surface)' }}>
      <div className="px-4 py-3" style={{ backgroundColor: 'var(--bg-elevated)' }}>
        <h4 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h4>
      </div>
      <div className="h-1 bg-gray-100">
        <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: progress + '%' }} />
      </div>
      <div className="p-4 space-y-3">
        {steps.map((step, index) => {
          const isActive = index === currentStep;
          const isCompleted = index < currentStep;
          return (
            <div key={index} className="p-2 rounded" style={{ backgroundColor: isActive ? 'var(--bg-elevated)' : 'transparent' }}>
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs" style={{ backgroundColor: isCompleted ? '#10b981' : isActive ? '#06b6d4' : '#e5e7eb', color: 'white' }}>
                  {isCompleted ? '✓' : index + 1}
                </span>
                <span className="text-sm font-medium">{step.label}</span>
              </div>
              <div className="font-mono text-xs ml-7 mt-1" style={{ color: 'var(--text-secondary)' }}>{step.formula}</div>
              {isActive && (
                <div className="text-xs ml-7 mt-1 space-y-0.5">
                  <div style={{ color: 'var(--text-muted)' }}>{step.detail}</div>
                  {step.result !== undefined && (
                    <div style={{ color: /满足|达标|✓/.test(String(step.result)) ? '#10b981' : '#ea580c' }}>{step.result}</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default CalculationAnimation;
