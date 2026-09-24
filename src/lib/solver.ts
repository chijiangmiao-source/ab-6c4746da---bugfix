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

import { decodeState, encodeState, type Token } from './permutation';

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
   * 1) 前向 BFS：计算每个可达状态到初始态的最短距离 distF，并按层保留
   *    所有状态。邻居按 (i,j) 字典序枚举，但最短方案的计数不依赖枚举顺序。
   *    注意：不能用“每步选断点数最少的邻居”的贪心代替——局部断点下降最多
   *    不保证全局最短（贪心会把本例的 6 步误报为 8 步），也会漏掉等长路径。
   * ------------------------------------------------------------------ */
  const distF = new Map<number, number>([[startCode, 0]]);
  const layers: number[][] = [[startCode]];
  {
    const queue: number[] = [startCode];
    for (let head = 0; head < queue.length; head += 1) {
      const code = queue[head];
      if (code === goalCode) break;
      const d = distF.get(code)!;
      eachNeighbor(code, n, (nextCode) => {
        if (!distF.has(nextCode)) {
          distF.set(nextCode, d + 1);
          queue.push(nextCode);
          (layers[d + 1] ??= []).push(nextCode);
        }
      });
    }
  }

  const distance = distF.get(goalCode)!;
  // 只保留位于某条最短路径上的层（goal 所在层及之前）。
  layers.length = distance + 1;

  /* ------------------------------------------------------------------ *
   * 2) 反向 BFS：从目标态出发求 distR（到目标的最短距离）。随后在最短
   *    DAG 上做两次分层 DP：
   *      waysFromStart[u]：初始态 -> u 的最短路径数；
   *      waysToGoal[v]：   v -> 目标态的最短路径数。
   *    全部用 bigint 精确累加。
   * ------------------------------------------------------------------ */
  const distR = new Map<number, number>([[goalCode, 0]]);
  {
    const queue: number[] = [goalCode];
    for (let head = 0; head < queue.length; head += 1) {
      const code = queue[head];
      const d = distR.get(code)!;
      eachNeighbor(code, n, (nextCode) => {
        if (!distR.has(nextCode)) {
          distR.set(nextCode, d + 1);
          queue.push(nextCode);
        }
      });
    }
  }

  const waysFromStart = new Map<number, bigint>([[startCode, 1n]]);
  for (let d = 0; d < distance; d += 1) {
    for (const u of layers[d]) {
      const waysU = waysFromStart.get(u)!;
      eachNeighbor(u, n, (nextCode) => {
        // 仅统计位于最短 DAG 上的边。
        if (distF.get(nextCode) !== d + 1) return;
        if (distR.get(nextCode) !== distance - d - 1) return;
        waysFromStart.set(
          nextCode,
          (waysFromStart.get(nextCode) ?? 0n) + waysU,
        );
      });
    }
  }

  const waysToGoal = new Map<number, bigint>([[goalCode, 1n]]);
  for (let d = distance - 1; d >= 0; d -= 1) {
    for (const u of layers[d]) {
      let total = 0n;
      eachNeighbor(u, n, (nextCode) => {
        if (distF.get(nextCode) !== d + 1) return;
        if (distR.get(nextCode) !== distance - d - 1) return;
        total += waysToGoal.get(nextCode)!;
      });
      waysToGoal.set(u, total);
    }
  }

  const totalPaths = waysFromStart.get(goalCode)!;

  /* ------------------------------------------------------------------ *
   * 3) 逐层枚举最短边 (u,v)：distF[u]=d、distR[v]=distance-d-1。
   *    边方案数 = waysFromStart(u) * waysToGoal(v)，按区间聚合到矩阵格。
   * ------------------------------------------------------------------ */
  const matrix: AuditResult['matrix'] = [];

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

    for (const u of layers[d]) {
      const waysU = waysFromStart.get(u)!;
      eachNeighbor(u, n, (nextCode, start, end) => {
        if (distF.get(nextCode) !== d + 1) return;
        if (distR.get(nextCode) !== distance - d - 1) return;
        const key = `${start}:${end}`;
        counts.set(
          key,
          counts.get(key)! + waysU * waysToGoal.get(nextCode)!,
        );
      });
    }

    const intervals: IntervalCell[] = allIntervals.map(({ start, end }) => {
      const pathCount = counts.get(`${start}:${end}`)!;
      const presence: CellPresence =
        pathCount === totalPaths ? 'all' : pathCount === 0n ? 'none' : 'some';
      return { start, end, pathCount, presence };
    });
    matrix.push({ depth: d, intervals });
  }

  /* ------------------------------------------------------------------ *
   * 4) 规范路径：从初始态出发，每一步在“仍位于最短 DAG 上”的出边中选
   *    (start,end) 字典序最小者，贪心走到目标。这与“全部最短方案里按
   *    每步 (start,end) 序列字典序最小”等价（前缀最小者总能继续走最短边）。
   * ------------------------------------------------------------------ */
  const steps: InversionStep[] = [];
  const states: Token[][] = [initial.slice()];
  {
    let code = startCode;
    while (code !== goalCode) {
      const d = distF.get(code)!;
      // eachNeighbor 本身按 (start,end) 字典序回调，用 holder 对象记录第一个
      // 仍在最短 DAG 上的出边（经闭包赋值的局部变量不会被 TS 流分析跟踪）。
      const choice: {
        value: { code: number; start: number; end: number } | null;
      } = { value: null };
      eachNeighbor(code, n, (nextCode, start, end) => {
        if (choice.value !== null) return;
        if (distF.get(nextCode) !== d + 1) return;
        if (distR.get(nextCode) !== distance - d - 1) return;
        choice.value = { code: nextCode, start, end };
      });
      const pick = choice.value;
      if (!pick) throw new Error('最短 DAG 上出现断点，无法构造规范路径');
      steps.push({ start: pick.start, end: pick.end });
      code = pick.code;
      states.push(decodeState(code, n));
    }
  }

  return {
    n,
    initial,
    distance,
    totalPaths,
    canonical: { steps, states },
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
