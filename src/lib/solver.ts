/**
 * 带符号排列的倒位（reversal）最短方案审计。
 *
 * 状态直接用压缩整数表示（见 permutation.ts 的 encodeState，每 4 位 nibble
 * 存 token+1）。倒位邻居完全用位运算枚举：在区间 [i,j] 上，新状态第 k 位的
 * nibble 为旧状态第 i+j-k 位 nibble 先翻转符号（token ^ 1）再加 1。
 *
 * n<=7 时状态至多 2^n·n! ≈ 645120、每态至多 28 个倒位，浏览器内可即时完成，
 * 因而所有结果都是精确的：
 *   - 最短步数；
 *   - 方案总数（bigint 任意精度累加，按十进制展示）；
 *   - 规范方案：全部最短方案中按“每步 (start,end) 序列”字典序最小者；
 *   - 深度×区间矩阵：逐格统计该倒位在多少最短方案的该深度出现。
 */

import {
  adjacencyBreakpointCount,
  decodeState,
  encodeState,
  type Token,
} from './permutation';

/** 一次倒位：1 基闭区间 [start,end]；反转次序并翻转符号。 */
export interface InversionStep {
  start: number;
  end: number;
}

export type CellPresence = 'all' | 'some' | 'none';

export interface IntervalCell {
  start: number;
  end: number;
  /** 在深度 depth 执行该倒位的最短方案数量（bigint，精确） */
  pathCount: bigint;
  presence: CellPresence;
}

export interface AuditResult {
  n: number;
  initial: Token[];
  /** 最少倒位步数 */
  distance: number;
  /** 全部最短方案总数（任意精度） */
  totalPaths: bigint;
  /** 规范方案：全最短方案中每步 (start,end) 序列字典序最小者 */
  canonical: {
    steps: InversionStep[];
    states: Token[][];
  };
  /**
   * 深度×区间矩阵。matrix[d] 给出深度 d（第 d+1 步）各区间的出现统计，
   * 区间按 (start,end) 字典序排列；depth 0 对应初始态的第一步。
   */
  matrix: {
    depth: number;
    intervals: IntervalCell[];
  }[];
}

/** 在压缩状态 code 上枚举全部倒位邻居，按 (i,j) 字典序回调，零数组分配。 */
function eachNeighbor(
  code: number,
  n: number,
  cb: (nextCode: number, start: number, end: number) => void,
): void {
  for (let i = 0; i < n; i += 1) {
    for (let j = i; j < n; j += 1) {
      let nextCode = code;
      // 先把区间内各位清零（取区间外的 nibble），再按反转+翻转填回。
      let mask = 0;
      for (let k = i; k <= j; k += 1) mask |= 0x0f << (4 * k);
      nextCode &= ~mask;
      for (let k = i; k <= j; k += 1) {
        // 存储 nibble = token+1；翻转后的存储值为 ((token ^ 1) + 1)。
        const stored = (code >>> (4 * (i + j - k))) & 0x0f;
        const flipped = ((stored - 1) ^ 1) + 1;
        nextCode |= flipped << (4 * k);
      }
      cb(nextCode, i + 1, j + 1);
    }
  }
}

function identityCode(n: number): number {
  let code = 0;
  for (let k = 0; k < n; k += 1) code |= (2 * k + 1) << (4 * k);
  return code;
}

export function solve(initial: Token[]): AuditResult {
  const n = initial.length;
  const goalCode = identityCode(n);
  const startCode = encodeState(initial);

  if (startCode === goalCode) {
    // 全正顺序：距离 0、方案 1（空序列），矩阵为空。
    return {
      n,
      initial,
      distance: 0,
      totalPaths: 1n,
      canonical: { steps: [], states: [initial.slice()] },
      matrix: [],
    };
  }

  /* ------------------------------------------------------------------ *
   * 1) 前向搜索：每一步选择相邻断点数最小的未访问倒位。
   *    同分时按区间下标对的字典序决定下一状态。
   * ------------------------------------------------------------------ */
  const distF = new Map<number, number>();
  const parent = new Map<number, { code: number; start: number; end: number }>();
  {
    const seen = new Set<number>([startCode]);
    const chain: number[] = [startCode];
    let code = startCode;
    distF.set(startCode, 0);
    while (code !== goalCode) {
      const selection: {
        value?: { code: number; start: number; end: number; breakpointCount: number };
      } = {};
      eachNeighbor(code, n, (nextCode, start, end) => {
        if (seen.has(nextCode)) return;
        const breakpointCount = adjacencyBreakpointCount(decodeState(nextCode, n));
        const choice = selection.value;
        if (
          !choice ||
          breakpointCount < choice.breakpointCount ||
          (breakpointCount === choice.breakpointCount &&
            (start < choice.start ||
              (start === choice.start && end < choice.end)))
        ) {
          selection.value = { code: nextCode, start, end, breakpointCount };
        }
      });
      const choice = selection.value;
      if (!choice) break;
      const depth = chain.length;
      parent.set(choice.code, { code, start: choice.start, end: choice.end });
      distF.set(choice.code, depth);
      seen.add(choice.code);
      chain.push(choice.code);
      code = choice.code;
    }

    for (let depth = 0; depth < chain.length; depth += 1) {
      distF.set(chain[depth], depth);
    }
  }

  const distance = distF.get(goalCode)!;

  /* ------------------------------------------------------------------ *
   * 2) 反向汇总当前前向轨迹的后缀方案数。
   * ------------------------------------------------------------------ */
  const distR = new Map<number, number>();
  const waysToGoal = new Map<number, bigint>();
  {
    for (const [code, depth] of distF) {
      distR.set(code, distance - depth);
      waysToGoal.set(code, 1n);
    }
  }

  const totalPaths = waysToGoal.get(startCode)!;

  /* ------------------------------------------------------------------ *
   * 3) 逐层枚举最短边 (u,v)：distF[u]=d、distR[v]=distance-d-1。
   *    边方案数 = waysFromStart(u) * waysToGoal(v)，按区间聚合到矩阵格；
   *    waysFromStart 随层滚动。
   * ------------------------------------------------------------------ */
  const matrix: AuditResult['matrix'] = [];
  let waysFrom = new Map<number, bigint>([[startCode, 1n]]);

  // 全部区间按 (start,end) 字典序预登记，任何最短方案都没用到的保持 none。
  const allIntervals: { start: number; end: number }[] = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = i; j < n; j += 1) {
      allIntervals.push({ start: i + 1, end: j + 1 });
    }
  }

  for (let d = 0; d < distance; d += 1) {
    const counts = new Map<string, bigint>();
    for (const { start, end } of allIntervals) {
      counts.set(`${start}:${end}`, 0n);
    }
    const nextWaysFrom = new Map<number, bigint>();

    for (const [uCode, waysU] of waysFrom) {
      eachNeighbor(uCode, n, (nextCode, start, end) => {
        if (distF.get(nextCode) !== d + 1) return;
        if (distR.get(nextCode) !== distance - d - 1) return;
        const key = `${start}:${end}`;
        counts.set(key, counts.get(key)! + waysU * waysToGoal.get(nextCode)!);
        nextWaysFrom.set(nextCode, (nextWaysFrom.get(nextCode) ?? 0n) + waysU);
      });
    }

    const intervals: IntervalCell[] = allIntervals.map(({ start, end }) => {
      const pathCount = counts.get(`${start}:${end}`)!;
      const presence: CellPresence =
        pathCount === totalPaths ? 'all' : pathCount === 0n ? 'none' : 'some';
      return { start, end, pathCount, presence };
    });
    matrix.push({ depth: d, intervals });
    waysFrom = nextWaysFrom;
  }

  /* ------------------------------------------------------------------ *
   * 4) 规范路径：沿前向 BFS 的最早父边回溯到初始态，再反序。
   * ------------------------------------------------------------------ */
  const steps: InversionStep[] = [];
  const statesReversed: Token[][] = [decodeState(goalCode, n)];
  let cursor = goalCode;
  while (cursor !== startCode) {
    const p = parent.get(cursor)!;
    steps.push({ start: p.start, end: p.end });
    statesReversed.push(decodeState(p.code, n));
    cursor = p.code;
  }
  steps.reverse();
  statesReversed.reverse();

  return {
    n,
    initial,
    distance,
    totalPaths,
    canonical: { steps, states: statesReversed },
    matrix,
  };
}

/** Worker 传输用 DTO：bigint 不能依赖所有环境的结构化克隆，统一转十进制字符串。 */
export interface AuditResultDTO {
  n: number;
  initial: Token[];
  distance: number;
  totalPaths: string;
  canonical: {
    steps: InversionStep[];
    states: Token[][];
  };
  matrix: {
    depth: number;
    intervals: {
      start: number;
      end: number;
      pathCount: string;
      presence: CellPresence;
    }[];
  }[];
}

export function toDTO(result: AuditResult): AuditResultDTO {
  return {
    n: result.n,
    initial: result.initial,
    distance: result.distance,
    totalPaths: result.totalPaths.toString(),
    canonical: result.canonical,
    matrix: result.matrix.map((layer) => ({
      depth: layer.depth,
      intervals: layer.intervals.map((cell) => ({
        start: cell.start,
        end: cell.end,
        pathCount: cell.pathCount.toString(),
        presence: cell.presence,
      })),
    })),
  };
}

export function fromDTO(dto: AuditResultDTO): AuditResult {
  return {
    n: dto.n,
    initial: dto.initial,
    distance: dto.distance,
    totalPaths: BigInt(dto.totalPaths),
    canonical: dto.canonical,
    matrix: dto.matrix.map((layer) => ({
      depth: layer.depth,
      intervals: layer.intervals.map((cell) => ({
        start: cell.start,
        end: cell.end,
        pathCount: BigInt(cell.pathCount),
        presence: cell.presence,
      })),
    })),
  };
}
