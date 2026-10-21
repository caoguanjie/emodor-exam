/**
 * 心跳时长容差算法（07 册 3.1.2 定稿伪码的纯函数实现，05 册 5.4.2）。
 * 输入毫秒间隔，输出本拍计入毫秒：
 * - diff <= 0（乱序 / 重放）：不计入（返回 0，由调用方丢弃）
 * - 0 < diff <= 45000：按实际间隔计入
 * - diff > 45000（断流后首拍 / 低频上报）：封顶计入 45 秒（单次心跳最大计入 45 秒）
 */
export const HEARTBEAT_CAP_MS = 45_000;

export function creditMs(diffMs: number): number {
  if (diffMs <= 0) return 0;
  return Math.min(diffMs, HEARTBEAT_CAP_MS);
}
