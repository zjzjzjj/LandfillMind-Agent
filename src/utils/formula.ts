/**
 * 单一来源：LaTeX 公式转可读纯文本的实现位于 server/formula.ts（server/diagnose.ts 同源使用），
 * 此处仅 re-export，避免前后端两份实现漂移。
 */
export { readableFormula } from '../../server/formula.js';
