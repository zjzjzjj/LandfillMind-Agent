/**
 * LandfillMind · 管理员认证中间件（L · 生产安全）
 *
 * 用法：
 *   - 设置环境变量 ADMIN_TOKEN（生产必填）
 *   - 未配置 ADMIN_TOKEN 时，所有管理端点整体禁用（返回 503），
 *     不再提供任何可预测的开发兜底 token（P0 修复：原硬编码 'landfillmind-dev-2026'
 *     生产未配置时即为公开管理入口，且该 token 还会被打印进日志）
 *   - token 只从 X-Admin-Token 请求头读取（不再接受 req.query.token，避免 token 落访问日志）
 *   - 比较使用 crypto.timingSafeEqual，防时序侧信道
 */

import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
/** 是否启用管理端点：仅当显式配置了 ADMIN_TOKEN */
export const adminAuthEnabled = ADMIN_TOKEN.length > 0;

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

/** 返回管理 token（未配置时返回 null；前端按需使用） */
export function getAdminToken(): string | null {
  return adminAuthEnabled ? ADMIN_TOKEN : null;
}

/**
 * Express middleware：校验 X-Admin-Token 请求头
 *  - 未启用：503（明确说明需配置环境变量，而不是用已知 token 放行）
 *  - 已启用但 token 不符：401
 */
export function adminAuth(req: Request, res: Response, next: NextFunction): void {
  if (!adminAuthEnabled) {
    res.status(503).json({
      ok: false,
      error: '管理端点未启用',
      hint: '请在服务器 / Render 控制台配置 ADMIN_TOKEN 环境变量后再访问管理功能',
    });
    return;
  }
  const token = req.header('X-Admin-Token') ?? '';
  if (!token || !safeEqual(token, ADMIN_TOKEN)) {
    res.status(401).json({
      ok: false,
      error: 'admin auth required',
      hint: '请在请求头加 X-Admin-Token: <token>',
    });
    return;
  }
  next();
}

/**
 * 公开检查（无需 token）— 用于前端判断是否显示/解锁管理后台
 */
export function getAdminAuthStatus(): { enabled: boolean; hint?: string } {
  return {
    enabled: adminAuthEnabled,
    hint: adminAuthEnabled
      ? undefined
      : '管理端点未启用：请在服务器环境变量配置 ADMIN_TOKEN 后再使用',
  };
}