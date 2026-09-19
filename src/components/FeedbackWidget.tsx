/**
 * LandfillMind · 用户反馈组件（P3 · E）
 * 显示在每条 AI 回复下方：👍 / 👎 / 💬
 * - 评分：单击即发送 POST /api/feedback
 * - 评论：👎 后展开输入框，可写文字反馈 → 自动入蒸馏队列
 */

import { useState } from 'react';
import { ThumbsUp, ThumbsDown, MessageSquare, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export type FeedbackRating = 'up' | 'down';

export interface FeedbackWidgetProps {
  sessionId: string;
  messageId: string;
  agentKey?: string;
  model?: string;
  kbRefs?: string[];
  abVariant?: string;
  onSubmitted?: (rating: FeedbackRating) => void;
}

export function FeedbackWidget({ sessionId, messageId, agentKey, model, kbRefs, abVariant, onSubmitted }: FeedbackWidgetProps) {
  const [state, setState] = useState<'idle' | 'loading' | 'done'>('idle');
  const [rating, setRating] = useState<FeedbackRating | null>(null);
  const [comment, setComment] = useState('');
  const [showComment, setShowComment] = useState(false);

  const submit = async (r: FeedbackRating, c?: string) => {
    if (state === 'loading') return;
    setState('loading');
    setRating(r);
    try {
      await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId, messageId, rating: r,
          comment: c?.trim() || undefined,
          agentKey, model, kbRefs, abVariant,
        }),
      });
      setState('done');
      onSubmitted?.(r);
    } catch (e) {
      setState('idle');
      setRating(null);
    }
  };

  if (state === 'done') {
    return (
      <div className="flex items-center gap-1.5 text-[10px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
        {rating === 'up' ? <ThumbsUp size={11} className="text-emerald-400" /> : <ThumbsDown size={11} className="text-rose-400" />}
        <span>已记录反馈 {comment ? '（含评论）' : ''} · 感谢</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 mt-1.5">
      <button
        onClick={() => submit('up')}
        disabled={state === 'loading'}
        title="回答有帮助"
        className="p-1 rounded transition-all hover:scale-110 disabled:opacity-30"
        style={{ color: rating === 'up' ? '#10b981' : 'var(--text-muted)' }}
      >
        <ThumbsUp size={12} />
      </button>
      <button
        onClick={() => { setRating('down'); setShowComment(true); }}
        disabled={state === 'loading'}
        title="回答需要改进"
        className="p-1 rounded transition-all hover:scale-110 disabled:opacity-30"
        style={{ color: rating === 'down' ? '#f43f5e' : 'var(--text-muted)' }}
      >
        <ThumbsDown size={12} />
      </button>
      {rating === 'up' && (
        <button
          onClick={() => setShowComment(true)}
          title="添加评论"
          className="p-1 rounded transition-all"
          style={{ color: 'var(--text-muted)' }}
        >
          <MessageSquare size={12} />
        </button>
      )}

      <AnimatePresence>
        {showComment && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="ml-2 w-full overflow-hidden"
          >
            <div className="flex items-center gap-1 mt-1">
              <input
                type="text"
                value={comment}
                onChange={e => setComment(e.target.value)}
                placeholder={rating === 'down' ? '哪里不对？如何改进？（会自动入蒸馏队列）' : '附加说明（可选）'}
                className="flex-1 px-2 py-1 rounded text-xs outline-none border"
                style={{
                  backgroundColor: 'var(--bg-elevated)',
                  borderColor: 'var(--border)',
                  color: 'var(--text-primary)',
                }}
                onKeyDown={e => { if (e.key === 'Enter' && rating) submit(rating, comment); }}
                autoFocus
              />
              <button
                onClick={() => rating && submit(rating, comment)}
                disabled={state === 'loading'}
                className="px-2 py-1 rounded text-xs font-semibold text-white"
                style={{ backgroundColor: 'var(--primary)' }}
              >
                提交
              </button>
              <button
                onClick={() => { setShowComment(false); setComment(''); }}
                className="p-1"
                style={{ color: 'var(--text-muted)' }}
              >
                <X size={12} />
              </button>
            </div>
            {rating === 'down' && (
              <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>
                💡 低分评论会自动进入 KB 蒸馏队列，工程师会基于此改进知识库
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
