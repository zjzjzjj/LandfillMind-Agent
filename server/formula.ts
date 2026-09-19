/** 把 LaTeX 公式转成工程人员可直接阅读的纯文本 */
export function readableFormula(text: string): string {
  if (!text) return text;
  let s = text;
  // 去掉显示数学定界符 \[ \] \( \)
  s = s.replace(/\\\[|\\\]|\\\(|\\\)/g, '');
  // 先展开上下标大括号，避免 {_{...}} 挡住后续 frac 匹配
  s = s.replace(/_\{([^{}]*)\}/g, '_$1').replace(/\^\{([^{}]*)\}/g, '^$1');
  // 分数（嵌套循环处理）
  for (let i = 0; i < 6; i++) {
    const before = s;
    s = s.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '($1)/($2)');
    if (s === before) break;
  }
  // 根号
  s = s.replace(/\\sqrt\{([^{}]*)\}/g, '√($1)');
  // 文本/数学正体/斜体取内容
  s = s.replace(/\\text\{([^{}]*)\}/g, '$1').replace(/\\mathrm\{([^{}]*)\}/g, '$1').replace(/\\mathit\{([^{}]*)\}/g, '$1');
  // 去除 \left \right
  s = s.replace(/\\left/g, '').replace(/\\right/g, '');
  // 希腊字母、常用函数与算符
  const sym: Record<string, string> = {
    '\\tau':'τ','\\alpha':'α','\\beta':'β','\\gamma':'γ','\\delta':'δ','\\Delta':'Δ',
    '\\theta':'θ','\\Theta':'Θ','\\phi':'φ','\\varphi':'φ','\\Phi':'Φ','\\lambda':'λ',
    '\\mu':'μ','\\nu':'ν','\\sigma':'σ','\\Sigma':'Σ','\\rho':'ρ','\\pi':'π','\\Pi':'Π',
    '\\eta':'η','\\psi':'ψ','\\Psi':'Ψ','\\omega':'ω','\\Omega':'Ω','\\varepsilon':'ε',
    '\\epsilon':'ε','\\Gamma':'Γ','\\cdot':'·','\\times':'×','\\leq':'≤','\\geq':'≥',
    '\\approx':'≈','\\pm':'±','\\neq':'≠','\\infty':'∞','\\degree':'°','\\rightarrow':'→',
    '\\Rightarrow':'⇒','\\partial':'∂','\\nabla':'∇','\\sum':'Σ','\\int':'∫','\\prod':'Π',
    '\\cdotp':'·','\\div':'÷','\\propto':'∝','\\sim':'~','\\equiv':'≡','\\frac':'/',
    '\\cos':'cos','\\sin':'sin','\\tan':'tan','\\cot':'cot','\\log':'log','\\ln':'ln',
    '\\exp':'exp','\\min':'min','\\max':'max','\\lim':'lim','\\cdot ':'·',
  };
  for (const [k, v] of Object.entries(sym)) s = s.split(k).join(v);
  return s;
}
