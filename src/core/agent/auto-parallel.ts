
const PARALLEL_KEYWORDS = [
  '并行', 'parallel', '同时', 'simultaneously',
  '多个', 'multiple', '分别', 'separately',
  '各自', 'each', '一起', 'together',
  '而且', 'and also', '另外', 'additionally',
];

export interface AutoParallelSuggestion {
  shouldParallel: boolean;
  confidence: number;
  reason: string;
  suggestedTask: string;
}

export class AutoParallelDetector {
  analyze(task: string): AutoParallelSuggestion {
    let score = 0;
    const matched: string[] = [];

    for (const kw of PARALLEL_KEYWORDS) {
      if (task.toLowerCase().includes(kw.toLowerCase())) {
        score += 15;
        matched.push(kw);
      }
    }

    // Check for multiple independent actions
    const actionIndicators = task.split(/[,;，；]|\band\b|\b同时\b|\b然后\b/i);
    if (actionIndicators.length >= 3) {
      score += 30;
    } else if (actionIndicators.length >= 2) {
      score += 15;
    }

    // Check for file patterns suggesting multiple targets
    if (task.includes('所有') || task.includes('all ') || task.includes('each ')) {
      score += 20;
    }

    const confidence = Math.min(score, 100);
    const shouldParallel = confidence >= 40;

    return {
      shouldParallel,
      confidence,
      reason: shouldParallel
        ? `检测到并行信号: ${matched.join(', ') || '多动作描述'}. 建议拆分为并行子任务。`
        : '任务看起来是串行的，不需要并行化。',
      suggestedTask: task,
    };
  }

}

export const autoParallel = new AutoParallelDetector();
