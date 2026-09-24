/**
 * verify 一次性服务中的需求核查（业务断言，与单元测试分开、输出可读）：
 *   1) [1,-3,-2,4] 的最短步数必须为 1（且唯一最短倒位为 [2,3]）；
 *   2) [+7,-5,-3,-2,-4,-6,+1] 必须为 6 步、217 条最短方案，规范倒位序列
 *      [1,2],[1,1],[2,7],[2,4],[3,6],[1,5]，矩阵逐层计数之和均为 217；
 *   3) 已排序排列距离为 0、方案数为 1；
 *   4) 重复绝对值必须被校验拒绝（输入不保留给求解器）。
 * 任一断言失败即以非零退出码结束容器。
 */
import { encodeToken, validatePermutation } from '../src/lib/permutation';
import { solve } from '../src/lib/solver';

let failures = 0;

function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    console.log(`PASS: ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ''}`);
    failures += 1;
  }
}

// 1) [1,-3,-2,4] 最短步数为 1
{
  const values = [1, -3, -2, 4];
  const { tokens, errors } = validatePermutation(values.join(','));
  check('[1,-3,-2,4] 通过输入校验', tokens !== undefined && errors.length === 0);
  if (tokens) {
    const r = solve(tokens);
    check('[1,-3,-2,4] 最短步数为 1', r.distance === 1, `实际为 ${r.distance}`);
    check(
      '[1,-3,-2,4] 唯一最短倒位是 [2,3]',
      r.totalPaths === 1n &&
        r.canonical.steps.length === 1 &&
        r.canonical.steps[0].start === 2 &&
        r.canonical.steps[0].end === 3,
      `方案数 ${r.totalPaths}，规范步骤 ${JSON.stringify(r.canonical.steps)}`,
    );
  }
}

// 2) 七标记场景：6 步、217 条最短方案、指定规范轨迹、矩阵逐层守恒
{
  const values = [7, -5, -3, -2, -4, -6, 1];
  const expected = [
    [1, 2],
    [1, 1],
    [2, 7],
    [2, 4],
    [3, 6],
    [1, 5],
  ];
  const { tokens, errors } = validatePermutation(values.join(','));
  check('七标记排列通过输入校验', tokens !== undefined && errors.length === 0);
  if (tokens) {
    const r = solve(tokens);
    check('七标记排列最短步数为 6', r.distance === 6, `实际为 ${r.distance}`);
    check('七标记排列方案总数为 217', r.totalPaths === 217n, `实际为 ${r.totalPaths}`);
    const got = r.canonical.steps.map((s) => [s.start, s.end]);
    check(
      '七标记排列规范倒位序列正确',
      JSON.stringify(got) === JSON.stringify(expected),
      `实际为 ${JSON.stringify(got)}`,
    );
    let trajectoryOk =
      r.canonical.states.length === expected.length + 1 &&
      r.canonical.states[expected.length].every((t, k) => t === 2 * k);
    check('规范轨迹最终到达全正顺序', trajectoryOk);
    check('矩阵层数等于步数', r.matrix.length === r.distance);
    let conservationOk = true;
    const detail: string[] = [];
    for (const layer of r.matrix) {
      let sum = 0n;
      for (const cell of layer.intervals) sum += cell.pathCount;
      if (sum !== r.totalPaths) {
        conservationOk = false;
        detail.push(`深度 ${layer.depth} 之和为 ${sum}`);
      }
    }
    check(
      '矩阵每层各区间计数之和均为 217',
      conservationOk,
      detail.join('；'),
    );
  }
}

// 3) 已排序排列：距离 0、方案数 1（空序列）
{
  const { tokens } = validatePermutation('1,2,3,4,5');
  if (tokens) {
    const r = solve(tokens);
    check(
      '已排序排列距离 0、方案 1、矩阵为空',
      r.distance === 0 && r.totalPaths === 1n && r.matrix.length === 0,
      `距离 ${r.distance}，方案 ${r.totalPaths}`,
    );
  }
}

// 4) 重复绝对值被拒绝（同号重复、异号重复各一例）
for (const raw of ['1,1,3', '1,-1,2', '2,2,2']) {
  const { tokens, errors } = validatePermutation(raw);
  check(
    `重复绝对值被拒绝：“${raw}”`,
    tokens === undefined && errors.some((e) => e.includes('重复')),
    errors.join(' / '),
  );
}

// 附带确认 encodeToken 没有被误用（快速健全性检查）
{
  const tokens = [1, -3, -2, 4].map(encodeToken);
  check('token 编码往返', tokens.length === 4);
}

if (failures > 0) {
  console.error(`需求核查失败 ${failures} 项`);
  process.exit(1);
}
console.log('需求核查全部通过');
