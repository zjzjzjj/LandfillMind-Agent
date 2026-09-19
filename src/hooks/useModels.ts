import { useState, useCallback, useEffect } from 'react';
import type { ModelOption } from '../types';

export type { ModelOption };

const DEFAULT_MODELS: ModelOption[] = [
  { id: 'glm-4-flash-250414', name: 'GLM-4-Flash（智谱直连）', provider: '智谱直连' },
];

export function useModels() {
  const [models, setModels] = useState<ModelOption[]>(DEFAULT_MODELS);
  const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_MODELS[0].id);

  // 服务器是模型列表的唯一真实来源：/api/models 按 .env 实际配置返回可用模型
  const fetchModels = useCallback(async () => {
    try {
      const res = await fetch('/api/models');
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.models) && data.models.length) {
        setModels(data.models);
        setSelectedModel(prev =>
          data.models.some((m: ModelOption) => m.id === prev) ? prev : data.models[0].id
        );
      }
    } catch {}
  }, []);

  useEffect(() => { fetchModels(); }, [fetchModels]);

  return { models, selectedModel, setSelectedModel, fetchModels };
}
